import type { NoteWorkspace } from "../types/app.js";

export type AuthRole = "user" | "superadmin";

export interface AuthUser {
  id: string;
  role: AuthRole;
  username: string;
}

export function canUseCloudWorkspace(
  user: AuthUser | null,
): user is AuthUser {
  return user !== null;
}

export interface AccountSummary {
  createdAt: number;
  email: string | null;
  id: string;
  username: string;
}

export type EmailCodePurpose = "bind" | "register";

export interface SmtpSettings {
  enabled: boolean;
  from: string;
  fromName: string;
  hasPass: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface SmtpSettingsInput {
  enabled: boolean;
  from: string;
  fromName: string;
  host: string;
  pass?: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface CreatedAccount extends AccountSummary {
  initialPassword: string;
}

export interface ResetAccountPassword extends AccountSummary {
  temporaryPassword: string;
}

export interface CloudWorkspace {
  updatedAt: number | null;
  workspace: NoteWorkspace | null;
}

interface ErrorPayload {
  error?: string;
  hint?: string;
}

async function readApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
  return [payload?.error, payload?.hint].filter(Boolean).join(" ") || fallback;
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackError: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, fallbackError));
  }

  return (await response.json()) as T;
}

export async function getAuthSession(): Promise<AuthUser | null> {
  const result = await requestJson<{ user: AuthUser | null }>(
    "/api/auth/session",
    undefined,
    "无法读取登录状态。",
  );
  return result.user;
}

export interface SliderChallenge {
  challengeId: string;
  targetRatio: number;
}

export async function createSliderChallenge(): Promise<SliderChallenge> {
  return requestJson<SliderChallenge>(
    "/api/auth/slider-challenge",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
    "滑块验证加载失败，请稍后重试。",
  );
}

export async function verifySliderCaptcha(input: {
  challengeId: string;
  durationMs: number;
  moveCount: number;
  positionRatio: number;
}): Promise<string> {
  const result = await requestJson<{ captchaToken: string }>(
    "/api/auth/slider-verify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    "滑块验证未通过，请重试。",
  );
  return result.captchaToken;
}

export async function registerUser(
  username: string,
  password: string,
  captchaToken: string,
  email: string,
  emailCode: string,
): Promise<AuthUser> {
  const result = await requestJson<{ user: AuthUser }>(
    "/api/auth/register",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ captchaToken, email, emailCode, password, username }),
    },
    "注册服务暂不可用，请确认后端服务已启动并部署了最新版本。",
  );
  return result.user;
}

export async function sendEmailCode(input: {
  captchaToken: string;
  email: string;
  purpose: EmailCodePurpose;
}): Promise<void> {
  await requestJson<{ ok: true }>(
    "/api/auth/email-code",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    "验证码发送失败，请稍后重试。",
  );
}

export async function getOwnEmail(): Promise<string | null> {
  const result = await requestJson<{ email: string | null }>(
    "/api/auth/email",
    undefined,
    "读取绑定邮箱失败。",
  );
  return result.email;
}

export async function bindOwnEmail(input: {
  currentPassword: string;
  email: string;
  emailCode: string;
}): Promise<string> {
  const result = await requestJson<{ email: string }>(
    "/api/auth/email/bind",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    "绑定邮箱失败，请稍后重试。",
  );
  return result.email;
}

async function loginAt(
  url: string,
  username: string,
  password: string,
  remember: boolean,
  captchaToken: string,
): Promise<AuthUser> {
  const result = await requestJson<{ user: AuthUser }>(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ captchaToken, password, remember, username }),
    },
    "登录服务暂不可用，请确认后端服务已启动并部署了最新版本。",
  );
  return result.user;
}

export function loginUser(
  username: string,
  password: string,
  remember: boolean,
  captchaToken: string,
): Promise<AuthUser> {
  return loginAt("/api/auth/login", username, password, remember, captchaToken);
}

export function loginSuperAdmin(
  username: string,
  password: string,
  remember: boolean,
  captchaToken: string,
): Promise<AuthUser> {
  return loginAt("/api/superadmin/login", username, password, remember, captchaToken);
}

export async function logoutUser(): Promise<void> {
  await requestJson<{ ok: true }>(
    "/api/auth/logout",
    {
      method: "POST",
    },
    "退出登录失败。",
  );
}

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await requestJson<{ ok: true }>(
    "/api/auth/password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    },
    "修改密码失败。",
  );
}

export async function downloadHermesSkillPackage(): Promise<void> {
  const response = await fetch("/api/hermes-skill/download", {
    method: "POST",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(
      await readApiError(response, "Hermes Skill 下载失败，请稍后重试。"),
    );
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  try {
    link.href = objectUrl;
    link.download = "notes-workspace-api.zip";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

export interface HermesSkillInstallLink {
  installUrl: string;
}

export function getHermesSkillInstallLink(): Promise<HermesSkillInstallLink> {
  return requestJson<HermesSkillInstallLink>(
    "/api/hermes-skill/install-link",
    {
      method: "POST",
    },
    "Hermes 安装链接生成失败，请稍后重试。",
  );
}

export function resetHermesSkillInstallLink(): Promise<HermesSkillInstallLink> {
  return requestJson<HermesSkillInstallLink>(
    "/api/hermes-skill/install-link/reset",
    {
      method: "POST",
    },
    "Hermes 安装链接重置失败，请稍后重试。",
  );
}

export function getCloudWorkspace(): Promise<CloudWorkspace> {
  return requestJson<CloudWorkspace>(
    "/api/workspace",
    undefined,
    "读取云端便签失败。",
  );
}

export function saveCloudWorkspace(
  workspace: NoteWorkspace,
): Promise<CloudWorkspace> {
  return requestJson<CloudWorkspace>(
    "/api/workspace",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspace }),
    },
    "保存云端便签失败。",
  );
}

export async function listManagedUsers(): Promise<AccountSummary[]> {
  const result = await requestJson<{ users: AccountSummary[] }>(
    "/api/superadmin/users",
    undefined,
    "读取用户列表失败。",
  );
  return result.users;
}

export async function createManagedUser(
  username: string,
): Promise<CreatedAccount> {
  const result = await requestJson<{ user: CreatedAccount }>(
    "/api/superadmin/users",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    },
    "创建用户失败。",
  );
  return result.user;
}

export async function resetManagedUserPassword(
  userId: string,
): Promise<ResetAccountPassword> {
  const result = await requestJson<{ user: ResetAccountPassword }>(
    `/api/superadmin/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: "POST",
    },
    "重置密码失败。",
  );
  return result.user;
}

export async function deleteManagedUser(
  userId: string,
): Promise<AccountSummary> {
  const result = await requestJson<{ user: AccountSummary }>(
    `/api/superadmin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    },
    "删除用户失败。",
  );
  return result.user;
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  return requestJson<SmtpSettings>(
    "/api/superadmin/smtp-settings",
    undefined,
    "读取邮箱设置失败。",
  );
}

export async function saveSmtpSettings(
  input: SmtpSettingsInput,
): Promise<SmtpSettings> {
  return requestJson<SmtpSettings>(
    "/api/superadmin/smtp-settings",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    "保存邮箱设置失败。",
  );
}

export async function sendSmtpTestMail(to: string): Promise<{ to: string }> {
  return requestJson<{ ok: true; to: string }>(
    "/api/superadmin/smtp-settings/test",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to }),
    },
    "测试邮件发送失败。",
  );
}
