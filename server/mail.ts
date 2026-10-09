import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import {
  getSessionSecret,
  type EmailCodePurpose,
  type SmtpSettingsRecord,
} from "./auth.js";

/* ---------- SMTP 密码加密存储 ----------
   用 SESSION_SECRET 派生密钥做 AES-256-GCM；接口绝不回显密码明文。 */

function secretKey(): Buffer {
  return scryptSync(getSessionSecret(), "notes-smtp-settings", 32);
}

export function encryptSmtpPassword(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

export function decryptSmtpPassword(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith("enc:")) return stored;
  try {
    const buf = Buffer.from(stored.slice(4), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return "";
  }
}

/* ---------- 配置读取 ---------- */

export interface SmtpConfig {
  enabled: boolean;
  from: string;
  fromName: string;
  host: string;
  pass: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface SmtpSettingsView {
  enabled: boolean;
  from: string;
  fromName: string;
  hasPass: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

export function toSmtpConfig(
  record: SmtpSettingsRecord | null,
): SmtpConfig | null {
  if (!record) return null;
  return {
    enabled: record.enabled,
    from: record.from,
    fromName: record.fromName,
    host: record.host,
    pass: decryptSmtpPassword(record.pass),
    port: record.port,
    secure: record.secure,
    user: record.user,
  };
}

/** 管理后台回显用：绝不包含密码明文，只给 hasPass */
export function getSmtpSettingsView(
  record: SmtpSettingsRecord | null,
): SmtpSettingsView {
  const cfg = toSmtpConfig(record);
  return {
    enabled: cfg?.enabled ?? false,
    from: cfg?.from ?? "",
    fromName: cfg?.fromName ?? "",
    hasPass: Boolean(record?.pass),
    host: cfg?.host ?? "",
    port: cfg?.port ?? 465,
    secure: cfg?.secure ?? true,
    user: cfg?.user ?? "",
  };
}

/**
 * 实际发信配置：优先超级管理员后台配置（启用且主机/账号齐全），
 * 否则回退环境变量 SMTP_*；都没有返回 null（调用方走日志打印降级）。
 */
export function resolveSmtpConfig(
  stored: SmtpConfig | null,
): SmtpConfig | null {
  if (stored && stored.enabled && stored.host && stored.user) return stored;
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return {
      enabled: true,
      from: process.env.SMTP_FROM || "",
      fromName: process.env.SMTP_FROM_NAME || "",
      host: process.env.SMTP_HOST,
      pass: process.env.SMTP_PASS || "",
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true") === "true",
      user: process.env.SMTP_USER,
    };
  }
  return null;
}

/* ---------- 发信 ---------- */

let cachedKey = "";
let cachedTransporter: Transporter | null = null;

export function transporterFor(cfg: SmtpConfig): Transporter {
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass]);
  if (!cachedTransporter || key !== cachedKey) {
    cachedTransporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    cachedKey = key;
  }
  return cachedTransporter;
}

export function sanitizeMailError(err: unknown, pass: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (pass) msg = msg.split(pass).join("***");
  return msg.slice(0, 300) || "发送失败";
}

/** 发信人展示：填了名称用 "名称" <邮箱> 标准格式，未填退化为裸邮箱 */
export function formatFrom(cfg: SmtpConfig): string {
  const addr = cfg.from || cfg.user;
  const name = cfg.fromName.replace(/[\r\n"]/g, "").trim();
  return name ? `"${name}" <${addr}>` : addr;
}

function mailBrand(cfg: SmtpConfig): string {
  return cfg.fromName.replace(/[\r\n"]/g, "").trim() || "锤子便签";
}

export function logEmailCode(email: string, code: string): void {
  console.log(
    `[email-code] SMTP 未配置，邮箱 ${email} 的验证码为 ${code}（10 分钟内有效）`,
  );
}

const CODE_MAIL_INTROS: Record<EmailCodePurpose, string> = {
  bind: "您正在绑定或更换邮箱",
  register: "您正在注册账号",
  reset: "您正在重置登录密码",
};

export async function sendVerificationCodeMail(
  cfg: SmtpConfig,
  to: string,
  code: string,
  purpose: EmailCodePurpose = "register",
): Promise<void> {
  const brand = mailBrand(cfg);
  const intro = CODE_MAIL_INTROS[purpose];
  try {
    await transporterFor(cfg).sendMail({
      from: formatFrom(cfg),
      to,
      subject: `${brand} · 验证码`,
      text: `${intro}，您的验证码是 ${code}，10 分钟内有效。如非本人操作请忽略。`,
      html: codeMailHtml(code, brand, intro),
    });
  } catch (err) {
    throw new Error(sanitizeMailError(err, cfg.pass));
  }
}

export async function sendTestMail(cfg: SmtpConfig, to: string): Promise<void> {
  try {
    await transporterFor(cfg).sendMail({
      from: formatFrom(cfg),
      to,
      subject: "锤子便签 邮箱设置测试",
      text: "这是一封测试邮件，来自「锤子便签」。收到它，说明 SMTP 发信配置可用。",
    });
  } catch (err) {
    throw new Error(sanitizeMailError(err, cfg.pass));
  }
}

/** 验证码邮件 HTML 模板：简单干净，验证码大号居中；同时带 text 兜底 */
function codeMailHtml(code: string, brand: string, intro: string): string {
  const brandHtml = brand
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f1f3f4;font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px 28px;border-top:4px solid #1a73e8;">
    <div style="font-size:15px;color:#1a73e8;font-weight:600;letter-spacing:1px;">${brandHtml}</div>
    <h1 style="font-size:20px;color:#202124;margin:14px 0 10px;">邮箱验证码</h1>
    <p style="font-size:14px;color:#5f6368;line-height:1.7;margin:0;">${intro}，本次验证码为：</p>
    <div style="text-align:center;font-size:36px;font-weight:700;letter-spacing:8px;color:#202124;margin:24px 0;">${code}</div>
    <p style="font-size:13px;color:#5f6368;line-height:1.7;margin:0;">验证码 <strong>10 分钟</strong>内有效，请尽快完成验证。</p>
    <p style="font-size:12px;color:#80868b;line-height:1.7;margin:18px 0 0;">如非本人操作，请忽略本邮件，账号不会有任何变更。</p>
  </div>
</body></html>`;
}
