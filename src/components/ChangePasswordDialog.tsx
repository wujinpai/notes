import {
  useEffect,
  useState,
  type FormEvent,
  type HTMLInputAutoCompleteAttribute,
} from "react";
import { sendEmailCode } from "../lib/auth.js";
import { SliderCaptcha } from "./SliderCaptcha.js";

interface ChangePasswordDialogProps {
  boundEmail: string | null;
  changePassword: (emailCode: string, newPassword: string) => Promise<void>;
  onBindEmail: () => void;
  onClose: () => void;
}

interface PasswordInputProps {
  autoComplete: HTMLInputAutoCompleteAttribute;
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}

function PasswordInput({
  autoComplete,
  label,
  name,
  onChange,
  value,
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="change-password-field">
      <label htmlFor={name}>{label}</label>
      <span className="change-password-input-wrap">
        <input
          id={name}
          type={isVisible ? "text" : "password"}
          name={name}
          autoComplete={autoComplete}
          minLength={8}
          maxLength={128}
          value={value}
          required
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="change-password-toggle"
          aria-label={`${isVisible ? "隐藏" : "显示"}${label}`}
          aria-pressed={isVisible}
          onClick={() => setIsVisible((visible) => !visible)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8-6-3.5 6-9.8 6-9.8-6-9.8-6Z" />
            <circle cx="12" cy="12" r="2.8" />
            {isVisible ? null : <path d="m4 4 16 16" />}
          </svg>
        </button>
      </span>
    </div>
  );
}

export function ChangePasswordDialog({
  boundEmail,
  changePassword,
  onBindEmail,
  onClose,
}: ChangePasswordDialogProps) {
  const [emailCode, setEmailCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [codeNotice, setCodeNotice] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (codeCountdown <= 0) {
      return;
    }

    const timer = globalThis.setTimeout(
      () => setCodeCountdown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => globalThis.clearTimeout(timer);
  }, [codeCountdown]);

  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetKey((value) => value + 1);
  }

  async function handleRequestCode() {
    if (isSendingCode || codeCountdown > 0 || !boundEmail) {
      return;
    }

    if (!captchaToken) {
      setError("请先完成滑块验证，再获取验证码。");
      return;
    }

    try {
      setIsSendingCode(true);
      setError("");
      await sendEmailCode({
        captchaToken,
        email: boundEmail,
        purpose: "reset",
      });
      setCodeNotice("验证码已发送到绑定邮箱，请查收（10 分钟内有效）。");
      setCodeCountdown(60);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "验证码发送失败。",
      );
    } finally {
      setIsSendingCode(false);
      // 滑块票据已被服务端单次消费。
      resetCaptcha();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    if (!/^\d{6}$/.test(emailCode.trim())) {
      setError("请输入 6 位邮箱验证码。");
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      setError("新密码长度应为 8–128 个字符。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      await changePassword(emailCode, newPassword);
      setEmailCode("");
      setNewPassword("");
      setConfirmPassword("");
      setIsComplete(true);
    } catch (changeError) {
      setError(
        changeError instanceof Error ? changeError.message : "修改密码失败。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="change-password-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="change-password-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
      >
        <button
          type="button"
          className="change-password-close"
          aria-label="关闭修改密码窗口"
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="change-password-title">修改密码</h2>

        {isComplete ? (
          <div className="change-password-success" role="status">
            <strong>密码修改成功</strong>
            <p>新密码已生效，其他设备上的旧登录会话已失效。</p>
            <button type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : !boundEmail ? (
          <div className="change-password-form">
            <p>
              修改密码需要先验证绑定邮箱。当前账号尚未绑定邮箱，请先绑定邮箱后再修改密码。
            </p>
            <button
              type="button"
              className="change-password-submit"
              onClick={onBindEmail}
            >
              去绑定邮箱
            </button>
          </div>
        ) : (
          <form className="change-password-form" onSubmit={handleSubmit}>
            <p>
              验证码将发送到绑定邮箱 {boundEmail}
              ，验证后设置新密码。修改后，其他设备需要使用新密码重新登录。
            </p>
            <div className="change-password-field">
              <label htmlFor="changePasswordEmailCode">邮箱验证码</label>
              <span className="email-code-row">
                <input
                  id="changePasswordEmailCode"
                  type="text"
                  name="emailCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={emailCode}
                  required
                  onChange={(event) =>
                    setEmailCode(event.target.value.replace(/\D/g, ""))
                  }
                />
                <button
                  type="button"
                  className="email-code-button"
                  disabled={!captchaToken || isSendingCode || codeCountdown > 0}
                  onClick={() => void handleRequestCode()}
                >
                  {isSendingCode
                    ? "发送中..."
                    : codeCountdown > 0
                      ? `${codeCountdown} 秒后重发`
                      : "获取验证码"}
                </button>
              </span>
            </div>

            <SliderCaptcha
              resetKey={captchaResetKey}
              onVerified={(token) => setCaptchaToken(token)}
            />

            <PasswordInput
              autoComplete="new-password"
              label="新密码"
              name="newPassword"
              value={newPassword}
              onChange={setNewPassword}
            />
            <PasswordInput
              autoComplete="new-password"
              label="确认新密码"
              name="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />

            {codeNotice ? (
              <p className="email-code-notice" role="status">
                {codeNotice}
              </p>
            ) : null}

            {error ? (
              <p className="change-password-error" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="change-password-submit"
              disabled={
                isSubmitting ||
                emailCode.length !== 6 ||
                !newPassword ||
                !confirmPassword
              }
            >
              {isSubmitting ? "正在修改..." : "确认修改"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
