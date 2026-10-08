import { useEffect, useState, type FormEvent } from "react";
import {
  createManagedUser,
  deleteManagedUser,
  getAuthSession,
  getSmtpSettings,
  listManagedUsers,
  loginSuperAdmin,
  logoutUser,
  resetManagedUserPassword,
  saveSmtpSettings,
  sendSmtpTestMail,
  type AccountSummary,
  type AuthUser,
  type CreatedAccount,
  type ResetAccountPassword,
  type SmtpSettings,
} from "../lib/auth.js";
import { copyTextToClipboard } from "../lib/clipboard.js";
import { LoginDialog } from "./LoginDialog.js";

function formatCreatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(timestamp));
}

export function SuperAdminPage() {
  const [session, setSession] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<"smtp" | "users">("users");
  const [users, setUsers] = useState<AccountSummary[]>([]);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpHasPass, setSmtpHasPass] = useState(false);
  const [smtpError, setSmtpError] = useState("");
  const [smtpNotice, setSmtpNotice] = useState("");
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);
  const [testMailTo, setTestMailTo] = useState("");
  const [isTestingMail, setIsTestingMail] = useState(false);
  const [username, setUsername] = useState("");
  const [createdAccount, setCreatedAccount] =
    useState<CreatedAccount | null>(null);
  const [resetAccount, setResetAccount] =
    useState<ResetAccountPassword | null>(null);
  const [error, setError] = useState("");
  const [resetError, setResetError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isPasswordCopied, setIsPasswordCopied] = useState(false);
  const [isResetPasswordCopied, setIsResetPasswordCopied] = useState(false);
  const [pendingResetUserId, setPendingResetUserId] = useState<string | null>(
    null,
  );
  const [isResettingUserId, setIsResettingUserId] = useState<string | null>(
    null,
  );
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(
    null,
  );
  const [isDeletingUserId, setIsDeletingUserId] = useState<string | null>(
    null,
  );

  async function loadUsers() {
    setUsers(await listManagedUsers());
  }

  function applySmtpSettings(settings: SmtpSettings) {
    setSmtpHost(settings.host);
    setSmtpPort(String(settings.port));
    setSmtpSecure(settings.secure);
    setSmtpUser(settings.user);
    setSmtpFrom(settings.from);
    setSmtpFromName(settings.fromName);
    setSmtpEnabled(settings.enabled);
    setSmtpHasPass(settings.hasPass);
    setSmtpPass("");
  }

  async function loadSmtpSettings() {
    applySmtpSettings(await getSmtpSettings());
  }

  async function handleSaveSmtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSavingSmtp) {
      return;
    }

    const port = Number(smtpPort);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setSmtpError("SMTP 端口应为 1–65535 的整数。");
      return;
    }

    try {
      setIsSavingSmtp(true);
      setSmtpError("");
      setSmtpNotice("");
      const saved = await saveSmtpSettings({
        enabled: smtpEnabled,
        from: smtpFrom,
        fromName: smtpFromName,
        host: smtpHost,
        pass: smtpPass || undefined,
        port,
        secure: smtpSecure,
        user: smtpUser,
      });
      applySmtpSettings(saved);
      setSmtpNotice("邮箱设置已保存，立即生效。");
    } catch (saveError) {
      setSmtpError(
        saveError instanceof Error ? saveError.message : "保存邮箱设置失败。",
      );
    } finally {
      setIsSavingSmtp(false);
    }
  }

  async function handleSendTestMail() {
    if (isTestingMail) {
      return;
    }

    try {
      setIsTestingMail(true);
      setSmtpError("");
      setSmtpNotice("");
      const result = await sendSmtpTestMail(testMailTo);
      setSmtpNotice(`测试邮件已发送到 ${result.to}。`);
    } catch (testError) {
      setSmtpError(
        testError instanceof Error ? testError.message : "测试邮件发送失败。",
      );
    } finally {
      setIsTestingMail(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const currentSession = await getAuthSession();

        if (cancelled) {
          return;
        }

        if (currentSession?.role === "superadmin") {
          setSession(currentSession);
          await loadUsers();
          await loadSmtpSettings();
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "管理员后台加载失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAuthenticated(user: AuthUser) {
    setSession(user);
    setError("");
    await loadUsers();
    await loadSmtpSettings();
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreating || !username.trim()) {
      return;
    }

    try {
      setIsCreating(true);
      setError("");
      setIsPasswordCopied(false);
      const created = await createManagedUser(username);
      setCreatedAccount(created);
      setUsername("");
      await loadUsers();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "创建用户失败。",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
    } finally {
      setSession(null);
      setUsers([]);
      setCreatedAccount(null);
      setResetAccount(null);
      setActiveTab("users");
      setSmtpError("");
      setSmtpNotice("");
    }
  }

  async function handleResetPassword(user: AccountSummary) {
    if (isResettingUserId) {
      return;
    }

    if (pendingResetUserId !== user.id) {
      setPendingResetUserId(user.id);
      setPendingDeleteUserId(null);
      setResetAccount(null);
      setResetError("");
      return;
    }

    try {
      setIsResettingUserId(user.id);
      setResetError("");
      setIsResetPasswordCopied(false);
      setResetAccount(await resetManagedUserPassword(user.id));
      setPendingResetUserId(null);
    } catch (resetPasswordError) {
      setResetError(
        resetPasswordError instanceof Error
          ? resetPasswordError.message
          : "重置密码失败。",
      );
    } finally {
      setIsResettingUserId(null);
    }
  }

  async function handleDeleteUser(user: AccountSummary) {
    if (isDeletingUserId) {
      return;
    }

    if (pendingDeleteUserId !== user.id) {
      setPendingDeleteUserId(user.id);
      setPendingResetUserId(null);
      setDeleteError("");
      return;
    }

    try {
      setIsDeletingUserId(user.id);
      setDeleteError("");
      const deletedUser = await deleteManagedUser(user.id);
      setUsers((currentUsers) =>
        currentUsers.filter((candidate) => candidate.id !== deletedUser.id),
      );
      setPendingDeleteUserId(null);
      if (pendingResetUserId === user.id) {
        setPendingResetUserId(null);
      }
      setResetAccount((currentResetAccount) =>
        currentResetAccount?.id === user.id ? null : currentResetAccount,
      );
      if (isResettingUserId === user.id) {
        setIsResettingUserId(null);
      }
    } catch (deleteUserError) {
      setDeleteError(
        deleteUserError instanceof Error
          ? deleteUserError.message
          : "删除用户失败。",
      );
    } finally {
      setIsDeletingUserId(null);
    }
  }

  if (isLoading) {
    return (
      <main className="superadmin-loading">
        <p>正在验证管理员身份...</p>
      </main>
    );
  }

  if (!session || session.role !== "superadmin") {
    return (
      <main className="superadmin-login-page">
        <LoginDialog
          isAdmin
          login={loginSuperAdmin}
          onAuthenticated={handleAuthenticated}
        />
      </main>
    );
  }

  return (
    <main className="superadmin-page">
      <header className="superadmin-header">
        <div>
          <span className="superadmin-eyebrow">SUPERADMIN</span>
          <h1>锤子便签用户管理</h1>
        </div>
        <div className="superadmin-session">
          <span>{session.username}</span>
          <a href="/">返回便签</a>
          <button type="button" onClick={() => void handleLogout()}>
            退出
          </button>
        </div>
      </header>

      <div className="superadmin-content">
        <div className="superadmin-tabs" role="tablist" aria-label="管理功能">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            className={activeTab === "users" ? "is-active" : ""}
            onClick={() => setActiveTab("users")}
          >
            用户管理
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "smtp"}
            className={activeTab === "smtp" ? "is-active" : ""}
            onClick={() => setActiveTab("smtp")}
          >
            邮箱设置
          </button>
        </div>

        {activeTab === "users" ? (
          <>
        <section className="superadmin-card superadmin-create-card">
          <div>
            <h2>添加普通用户</h2>
            <p>支持用户名或邮箱，初始密码只在创建成功后显示一次。</p>
          </div>
          <form onSubmit={handleCreateUser}>
            <label>
              <span>用户名或邮箱</span>
              <input
                type="text"
                value={username}
                minLength={3}
                maxLength={254}
                placeholder="用户名或 name@example.com"
                autoComplete="off"
                required
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <button type="submit" disabled={isCreating || !username.trim()}>
              {isCreating ? "正在创建..." : "创建用户并生成密码"}
            </button>
          </form>

          {error ? (
            <p className="superadmin-error" role="alert">
              {error}
            </p>
          ) : null}

          {createdAccount ? (
            <div className="superadmin-credential" role="status">
              <div>
                <span>账号</span>
                <strong>{createdAccount.username}</strong>
              </div>
              <div>
                <span>初始密码</span>
                <code>{createdAccount.initialPassword}</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  void copyTextToClipboard(
                    `账号：${createdAccount.username}\n初始密码：${createdAccount.initialPassword}`,
                  ).then(() => setIsPasswordCopied(true));
                }}
              >
                {isPasswordCopied ? "已复制" : "复制账号密码"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="superadmin-card">
          <div className="superadmin-list-heading">
            <div>
              <h2>普通用户</h2>
              <p>
                每个账号拥有独立的云端便签工作区。管理员无法查看现有密码，只能重置。删除用户将同时删除该用户的云端便签数据，且不可恢复。
              </p>
            </div>
            <strong>{users.length}</strong>
          </div>

          {resetError ? (
            <p className="superadmin-error" role="alert">
              {resetError}
            </p>
          ) : null}

          {deleteError ? (
            <p className="superadmin-error" role="alert">
              {deleteError}
            </p>
          ) : null}

          {resetAccount ? (
            <div
              className="superadmin-credential superadmin-reset-credential"
              role="status"
            >
              <div>
                <span>账号</span>
                <strong>{resetAccount.username}</strong>
              </div>
              <div>
                <span>新临时密码（仅显示一次）</span>
                <code>{resetAccount.temporaryPassword}</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  void copyTextToClipboard(
                    `账号：${resetAccount.username}\n新临时密码：${resetAccount.temporaryPassword}`,
                  ).then(() => setIsResetPasswordCopied(true));
                }}
              >
                {isResetPasswordCopied ? "已复制" : "复制新密码"}
              </button>
            </div>
          ) : null}

          {users.length ? (
            <div className="superadmin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>用户名或邮箱</th>
                    <th>绑定邮箱</th>
                    <th>创建时间</th>
                    <th>用户 ID</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.email ?? "未绑定"}</td>
                      <td>{formatCreatedAt(user.createdAt)}</td>
                      <td>
                        <code>{user.id}</code>
                      </td>
                      <td>
                        <div className="superadmin-user-actions">
                          <button
                            type="button"
                            className="superadmin-reset-password"
                            disabled={
                              Boolean(isResettingUserId) &&
                              isResettingUserId !== user.id
                            }
                            aria-label={`重置密码：${user.username}`}
                            onClick={() => void handleResetPassword(user)}
                          >
                            {isResettingUserId === user.id
                              ? "正在重置..."
                              : pendingResetUserId === user.id
                                ? "确认重置"
                                : "重置密码"}
                          </button>
                          <button
                            type="button"
                            className="superadmin-delete-user"
                            disabled={
                              Boolean(isDeletingUserId) &&
                              isDeletingUserId !== user.id
                            }
                            aria-label={`删除用户：${user.username}`}
                            onClick={() => void handleDeleteUser(user)}
                          >
                            {isDeletingUserId === user.id
                              ? "正在删除..."
                              : pendingDeleteUserId === user.id
                                ? "确认删除"
                                : "删除"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="superadmin-empty">还没有普通用户。</p>
          )}
        </section>
          </>
        ) : null}

        {activeTab === "smtp" ? (
          <section className="superadmin-card superadmin-smtp-card">
            <div>
              <h2>邮箱设置（SMTP）</h2>
              <p>
                用于注册与绑定邮箱时发送验证码。保存后立即生效；未启用或未配置时回退服务端环境变量
                SMTP_*，再无配置时验证码打印到服务端日志。密码加密存储，页面只显示是否已设置。
              </p>
            </div>
            <form className="superadmin-smtp-form" onSubmit={handleSaveSmtp}>
              <label>
                <span>SMTP 主机</span>
                <input
                  type="text"
                  value={smtpHost}
                  placeholder="smtp.example.com"
                  autoComplete="off"
                  onChange={(event) => setSmtpHost(event.target.value)}
                />
              </label>
              <label>
                <span>端口</span>
                <input
                  type="number"
                  value={smtpPort}
                  min={1}
                  max={65535}
                  onChange={(event) => setSmtpPort(event.target.value)}
                />
              </label>
              <label>
                <span>SMTP 账号</span>
                <input
                  type="text"
                  value={smtpUser}
                  placeholder="name@example.com"
                  autoComplete="off"
                  onChange={(event) => setSmtpUser(event.target.value)}
                />
              </label>
              <label>
                <span>
                  SMTP 密码{ smtpHasPass ? "（已设置，留空不修改）" : "（未设置）"}
                </span>
                <input
                  type="password"
                  value={smtpPass}
                  placeholder={smtpHasPass ? "留空表示不修改" : "请输入 SMTP 密码"}
                  autoComplete="new-password"
                  onChange={(event) => setSmtpPass(event.target.value)}
                />
              </label>
              <label>
                <span>发件邮箱</span>
                <input
                  type="email"
                  value={smtpFrom}
                  placeholder="留空则使用 SMTP 账号"
                  autoComplete="off"
                  onChange={(event) => setSmtpFrom(event.target.value)}
                />
              </label>
              <label>
                <span>发件人名称</span>
                <input
                  type="text"
                  value={smtpFromName}
                  placeholder="锤子便签"
                  maxLength={64}
                  autoComplete="off"
                  onChange={(event) => setSmtpFromName(event.target.value)}
                />
              </label>
              <label className="superadmin-smtp-check">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(event) => setSmtpSecure(event.target.checked)}
                />
                <span>使用 SSL/TLS（secure，常见于 465 端口）</span>
              </label>
              <label className="superadmin-smtp-check">
                <input
                  type="checkbox"
                  checked={smtpEnabled}
                  onChange={(event) => setSmtpEnabled(event.target.checked)}
                />
                <span>启用后台 SMTP 配置发信</span>
              </label>
              <button type="submit" disabled={isSavingSmtp}>
                {isSavingSmtp ? "正在保存..." : "保存邮箱设置"}
              </button>
            </form>

            <div className="superadmin-smtp-test">
              <label>
                <span>测试收件邮箱</span>
                <input
                  type="email"
                  value={testMailTo}
                  placeholder="留空则发送到发件邮箱"
                  autoComplete="off"
                  onChange={(event) => setTestMailTo(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={isTestingMail}
                onClick={() => void handleSendTestMail()}
              >
                {isTestingMail ? "正在发送..." : "发送测试邮件"}
              </button>
            </div>

            {smtpError ? (
              <p className="superadmin-error" role="alert">
                {smtpError}
              </p>
            ) : null}
            {smtpNotice ? (
              <p className="superadmin-notice" role="status">
                {smtpNotice}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
