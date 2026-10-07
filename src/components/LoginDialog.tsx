import { useState, type FormEvent } from "react";
import type { AuthUser } from "../lib/auth.js";
import { registerUser } from "../lib/auth.js";
import { SliderCaptcha } from "./SliderCaptcha.js";

interface LoginDialogProps {
  isAdmin?: boolean;
  login: (
    username: string,
    password: string,
    remember: boolean,
    captchaToken: string,
  ) => Promise<AuthUser>;
  onAuthenticated: (user: AuthUser) => void | Promise<void>;
  onClose?: () => void;
}

type LoginMode = "login" | "register";

export function LoginDialog({
  isAdmin = false,
  login,
  onAuthenticated,
  onClose,
}: LoginDialogProps) {
  const [mode, setMode] = useState<LoginMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isRegisterMode = !isAdmin && mode === "register";

  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetKey((value) => value + 1);
  }

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError("");
    setConfirmPassword("");
    resetCaptcha();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || !captchaToken) {
      return;
    }

    if (isRegisterMode) {
      if (password.length < 8 || password.length > 128) {
        setError("新密码长度应为 8–128 个字符。");
        resetCaptcha();
        return;
      }

      if (password !== confirmPassword) {
        setError("两次输入的密码不一致。");
        resetCaptcha();
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setError("");
      const user = isRegisterMode
        ? await registerUser(username, password, captchaToken)
        : await login(username, password, remember, captchaToken);
      await onAuthenticated(user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败。");
      // captchaToken 已被服务端单次消费，失败后必须重新完成滑块验证。
      resetCaptcha();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className={`login-dialog-backdrop${isAdmin ? " is-admin" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
      >
        {onClose ? (
          <button
            type="button"
            className="login-dialog-close"
            aria-label="关闭登录窗口"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}

        <img
          className="login-dialog-logo"
          src="/header/logo.png"
          alt=""
          width="72"
          height="72"
        />
        <h1 id="login-dialog-title">
          {isAdmin ? "锤子便签后台" : "锤子便签"}
        </h1>

        {isAdmin ? (
          <div className="login-dialog-tabs" aria-hidden="true">
            <span className="is-active">管理员登录</span>
          </div>
        ) : (
          <div className="login-dialog-tabs" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => switchMode("login")}
            >
              账号密码登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "is-active" : ""}
              onClick={() => switchMode("register")}
            >
              注册账号
            </button>
          </div>
        )}

        <form className="login-dialog-form" onSubmit={handleSubmit}>
          <label>
            <span className="visually-hidden">用户名或邮箱</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="用户名或邮箱"
              value={username}
              required
              autoFocus
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="login-dialog-password-field">
            <span className="visually-hidden">密码</span>
            <input
              type={isPasswordVisible ? "text" : "password"}
              name="password"
              autoComplete={isRegisterMode ? "new-password" : "current-password"}
              placeholder="密码"
              value={password}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="login-dialog-password-toggle"
              aria-label={isPasswordVisible ? "隐藏密码" : "显示密码"}
              aria-pressed={isPasswordVisible}
              title={isPasswordVisible ? "隐藏密码" : "显示密码"}
              onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z" />
                <circle cx="12" cy="12" r="2.8" />
                {isPasswordVisible ? null : (
                  <path className="login-dialog-eye-slash" d="m4 4 16 16" />
                )}
              </svg>
            </button>
          </label>

          {isRegisterMode ? (
            <label>
              <span className="visually-hidden">确认密码</span>
              <input
                type={isPasswordVisible ? "text" : "password"}
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="确认密码"
                value={confirmPassword}
                required
                minLength={8}
                maxLength={128}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          ) : null}

          <SliderCaptcha
            resetKey={captchaResetKey}
            onVerified={(token) => setCaptchaToken(token)}
          />

          {!isRegisterMode ? (
            <label className="login-dialog-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>记住密码</span>
            </label>
          ) : null}

          {error ? (
            <p className="login-dialog-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="login-dialog-submit"
            disabled={
              isSubmitting ||
              !captchaToken ||
              !username.trim() ||
              !password ||
              (isRegisterMode && !confirmPassword)
            }
          >
            {isSubmitting
              ? isRegisterMode
                ? "注册中..."
                : "登录中..."
              : isRegisterMode
                ? "注册"
                : "登录"}
          </button>
        </form>

        <p className="login-dialog-note">
          {isAdmin
            ? "管理员凭据由服务端环境变量提供。"
            : isRegisterMode
              ? "注册后便签自动保存到云端，并支持跨设备同步。"
              : "登录后便签自动保存到云端，并支持跨设备同步。"}
        </p>
        {isAdmin ? null : (
          <a className="login-dialog-public-link" href="/public">
            不登录，先看看公开便签 →
          </a>
        )}
      </section>
    </div>
  );
}
