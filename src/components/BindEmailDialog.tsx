import { useEffect, useState, type FormEvent } from "react";
import { bindOwnEmail, sendEmailCode } from "../lib/auth.js";
import { SliderCaptcha } from "./SliderCaptcha.js";

interface BindEmailDialogProps {
  currentEmail: string | null;
  onBound: (email: string) => void;
  onClose: () => void;
}

export function BindEmailDialog({
  currentEmail,
  onBound,
  onClose,
}: BindEmailDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [codeNotice, setCodeNotice] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const isRebind = Boolean(currentEmail);

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
    if (isSendingCode || codeCountdown > 0) {
      return;
    }

    if (!email.trim()) {
      setError("请先填写新邮箱。");
      return;
    }

    if (!captchaToken) {
      setError("请先完成滑块验证，再获取验证码。");
      return;
    }

    try {
      setIsSendingCode(true);
      setError("");
      await sendEmailCode({ captchaToken, email, purpose: "bind" });
      setCodeNotice("验证码已发送，请查收邮箱（10 分钟内有效）。");
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

    try {
      setIsSubmitting(true);
      setError("");
      const boundEmail = await bindOwnEmail({
        currentPassword,
        email,
        emailCode,
      });
      onBound(boundEmail);
      setIsComplete(true);
    } catch (bindError) {
      setError(
        bindError instanceof Error ? bindError.message : "绑定邮箱失败。",
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
        aria-labelledby="bind-email-title"
      >
        <button
          type="button"
          className="change-password-close"
          aria-label="关闭邮箱绑定窗口"
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="bind-email-title">{isRebind ? "更换邮箱" : "绑定邮箱"}</h2>

        {isComplete ? (
          <div className="change-password-success" role="status">
            <strong>{isRebind ? "邮箱更换成功" : "邮箱绑定成功"}</strong>
            <p>当前绑定邮箱：{email}</p>
            <button type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <form className="change-password-form" onSubmit={handleSubmit}>
            <p>
              {isRebind
                ? `当前绑定邮箱为 ${currentEmail}，更换后旧邮箱立即释放。`
                : "绑定后可用于接收验证码，邮箱仅自己与管理员可见。"}
            </p>
            <div className="change-password-field">
              <label htmlFor="bindCurrentPassword">当前密码</label>
              <span className="change-password-input-wrap">
                <input
                  id="bindCurrentPassword"
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  value={currentPassword}
                  required
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </span>
            </div>
            <div className="change-password-field">
              <label htmlFor="bindEmail">新邮箱</label>
              <span className="change-password-input-wrap">
                <input
                  id="bindEmail"
                  type="email"
                  name="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </span>
            </div>
            <div className="change-password-field">
              <label htmlFor="bindEmailCode">邮箱验证码</label>
              <span className="email-code-row">
                <input
                  id="bindEmailCode"
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
                  disabled={
                    !captchaToken ||
                    isSendingCode ||
                    codeCountdown > 0 ||
                    !email.trim()
                  }
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
                !currentPassword ||
                !email.trim() ||
                emailCode.length !== 6
              }
            >
              {isSubmitting
                ? "正在提交..."
                : isRebind
                  ? "确认更换"
                  : "确认绑定"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
