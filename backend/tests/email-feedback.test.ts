import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配邮箱 feedback 测试端口");
  }

  const port = address.port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`后端在邮箱测试前退出，退出码：${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动。
    }

    await delay(100);
  }

  throw new Error("等待邮箱测试后端超时");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    delay(5_000, undefined, { ref: false }).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function getCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

async function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function getCaptchaToken(baseUrl: string): Promise<string> {
  const challengeResponse = await fetch(`${baseUrl}/api/auth/slider-challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(challengeResponse.status, 200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    targetRatio: number;
  };
  const verifyResponse = await fetch(`${baseUrl}/api/auth/slider-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      durationMs: 900,
      moveCount: 8,
      positionRatio: challenge.targetRatio,
    }),
  });
  assert.equal(verifyResponse.status, 200);
  const { captchaToken } = (await verifyResponse.json()) as {
    captchaToken: string;
  };
  assert.ok(captchaToken);
  return captchaToken;
}

async function waitForEmailCode(
  getStdout: () => string,
  email: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`邮箱 ${escapedEmail} 的验证码为 (\\d{6})`);

  while (Date.now() < deadline) {
    const matches = [...getStdout().matchAll(new RegExp(pattern, "g"))];
    const match = matches[matches.length - 1];

    if (match) {
      return match[1];
    }

    await delay(50);
  }

  throw new Error(`等待邮箱 ${email} 的验证码日志超时`);
}

interface TestServer {
  baseUrl: string;
  getStdout: () => string;
}

async function startServer(context: { after: (fn: () => Promise<void>) => void }) {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-email-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-email-images-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.SMTP_HOST;
  delete env.SMTP_PORT;
  delete env.SMTP_SECURE;
  delete env.SMTP_USER;
  delete env.SMTP_PASS;
  delete env.SMTP_FROM;
  delete env.SMTP_FROM_NAME;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...env,
      DATA_STORAGE_DIR: dataDir,
      IMAGE_STORAGE_DIR: imageDir,
      PORT: String(port),
      SESSION_SECRET: "email-feedback-secret",
      SUPERADMIN: "feedback-admin",
      SUPERADMINPASSWORD: "feedback-admin-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  context.after(async () => {
    await stopChild(child);
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
  });

  const server: TestServer = { baseUrl, getStdout: () => stdout };

  try {
    await waitForHealth(baseUrl, child);
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return server;
}

async function requestEmailCode(
  server: TestServer,
  email: string,
  purpose: "bind" | "register" | "reset",
  cookie?: string,
): Promise<string> {
  const response = await postJson(
    server.baseUrl,
    "/api/auth/email-code",
    {
      captchaToken: await getCaptchaToken(server.baseUrl),
      email,
      purpose,
    },
    cookie,
  );
  assert.equal(response.status, 200);
  return waitForEmailCode(server.getStdout, email);
}

async function superadminCookie(server: TestServer): Promise<string> {
  const response = await postJson(server.baseUrl, "/api/superadmin/login", {
    captchaToken: await getCaptchaToken(server.baseUrl),
    password: "feedback-admin-password",
    remember: false,
    username: "feedback-admin",
  });
  assert.equal(response.status, 200);
  return getCookie(response);
}

test("注册须验码且邮箱唯一，绑定换绑需密码与验证码，旧邮箱换绑后立即释放", async (context) => {
  const server = await startServer(context);
  const { baseUrl } = server;

  const registerWithoutCode = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    password: "alice-password-2026",
    username: "alice",
  });
  assert.equal(registerWithoutCode.status, 400);

  const codeWithoutCaptcha = await postJson(baseUrl, "/api/auth/email-code", {
    email: "alice@example.com",
    purpose: "register",
  });
  assert.equal(codeWithoutCaptcha.status, 400);

  const codeWithBadEmail = await postJson(baseUrl, "/api/auth/email-code", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "not-an-email",
    purpose: "register",
  });
  assert.equal(codeWithBadEmail.status, 400);

  const aliceCode = await requestEmailCode(server, "alice@example.com", "register");

  const resendTooFast = await postJson(baseUrl, "/api/auth/email-code", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "alice@example.com",
    purpose: "register",
  });
  assert.equal(resendTooFast.status, 429);

  const registerWrongCode = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "alice@example.com",
    emailCode: "000000",
    password: "alice-password-2026",
    username: "alice",
  });
  assert.equal(registerWrongCode.status, 400);

  const registerResponse = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "alice@example.com",
    emailCode: aliceCode,
    password: "alice-password-2026",
    username: "alice",
  });
  assert.equal(registerResponse.status, 200);
  const aliceCookie = getCookie(registerResponse);

  const aliceEmailResponse = await fetch(`${baseUrl}/api/auth/email`, {
    headers: { Cookie: aliceCookie },
  });
  assert.equal(aliceEmailResponse.status, 200);
  assert.deepEqual(await aliceEmailResponse.json(), {
    email: "alice@example.com",
  });

  const takenCode = await postJson(baseUrl, "/api/auth/email-code", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "alice@example.com",
    purpose: "register",
  });
  assert.equal(takenCode.status, 409);

  const bindAnonymous = await postJson(baseUrl, "/api/auth/email/bind", {
    currentPassword: "alice-password-2026",
    email: "alice2@example.com",
    emailCode: "123456",
  });
  assert.equal(bindAnonymous.status, 401);

  const bindWrongPassword = await postJson(
    baseUrl,
    "/api/auth/email/bind",
    {
      currentPassword: "wrong-password-2026",
      email: "alice2@example.com",
      emailCode: "123456",
    },
    aliceCookie,
  );
  assert.equal(bindWrongPassword.status, 400);

  const bindCode = await requestEmailCode(
    server,
    "alice2@example.com",
    "bind",
    aliceCookie,
  );

  const bindWrongCode = await postJson(
    baseUrl,
    "/api/auth/email/bind",
    {
      currentPassword: "alice-password-2026",
      email: "alice2@example.com",
      emailCode: "000000",
    },
    aliceCookie,
  );
  assert.equal(bindWrongCode.status, 400);

  const bindOk = await postJson(
    baseUrl,
    "/api/auth/email/bind",
    {
      currentPassword: "alice-password-2026",
      email: "alice2@example.com",
      emailCode: bindCode,
    },
    aliceCookie,
  );
  assert.equal(bindOk.status, 200);
  assert.deepEqual(await bindOk.json(), { email: "alice2@example.com" });

  const aliceEmailAfter = await fetch(`${baseUrl}/api/auth/email`, {
    headers: { Cookie: aliceCookie },
  });
  assert.deepEqual(await aliceEmailAfter.json(), {
    email: "alice2@example.com",
  });

  // 换绑后旧邮箱立即释放：bob 可用 alice 的旧邮箱注册。
  const bobCode = await requestEmailCode(server, "alice@example.com", "register");
  const bobRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "alice@example.com",
    emailCode: bobCode,
    password: "bob-password-2026",
    username: "bob",
  });
  assert.equal(bobRegister.status, 200);
  const bobCookie = getCookie(bobRegister);
  const bobId = ((await bobRegister.clone().json()) as { user: { id: string } })
    .user.id;

  // 没有邮箱的老账号（超管创建）照常登录，不强制补绑。
  const adminCookie = await superadminCookie(server);
  const createCarol = await postJson(
    baseUrl,
    "/api/superadmin/users",
    { username: "carol" },
    adminCookie,
  );
  assert.equal(createCarol.status, 201);
  const carol = (await createCarol.json()) as {
    user: { id: string; initialPassword: string };
  };

  const carolLogin = await postJson(baseUrl, "/api/auth/login", {
    captchaToken: await getCaptchaToken(baseUrl),
    password: carol.user.initialPassword,
    remember: false,
    username: "carol",
  });
  assert.equal(carolLogin.status, 200);
  const carolCookie = getCookie(carolLogin);
  const carolEmail = await fetch(`${baseUrl}/api/auth/email`, {
    headers: { Cookie: carolCookie },
  });
  assert.deepEqual(await carolEmail.json(), { email: null });

  // 超管用户列表可见绑定邮箱；删除用户后邮箱随账号一并释放。
  const usersResponse = await fetch(`${baseUrl}/api/superadmin/users`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(usersResponse.status, 200);
  const usersPayload = (await usersResponse.json()) as {
    users: { email: string | null; id: string; username: string }[];
  };
  const byName = new Map(usersPayload.users.map((user) => [user.username, user]));
  assert.equal(byName.get("alice")?.email, "alice2@example.com");
  assert.equal(byName.get("bob")?.email, "alice@example.com");
  assert.equal(byName.get("carol")?.email, null);

  const deleteBob = await fetch(`${baseUrl}/api/superadmin/users/${bobId}`, {
    method: "DELETE",
    headers: { Cookie: adminCookie },
  });
  assert.equal(deleteBob.status, 200);

  const daveCode = await requestEmailCode(server, "alice@example.com", "register");
  const daveRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "alice@example.com",
    emailCode: daveCode,
    password: "dave-password-2026",
    username: "dave",
  });
  assert.equal(daveRegister.status, 200);
  assert.ok(bobCookie);
});

test("超管 SMTP 设置仅超管可用、密码只回遮罩、测试失败信息脱敏可读，清空后回退日志验证码", async (context) => {
  const server = await startServer(context);
  const { baseUrl } = server;

  const userCode = await requestEmailCode(server, "erin@example.com", "register");
  const userRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "erin@example.com",
    emailCode: userCode,
    password: "erin-password-2026",
    username: "erin",
  });
  assert.equal(userRegister.status, 200);
  const userCookie = getCookie(userRegister);

  const anonymousGet = await fetch(`${baseUrl}/api/superadmin/smtp-settings`);
  assert.equal(anonymousGet.status, 401);

  const userGet = await fetch(`${baseUrl}/api/superadmin/smtp-settings`, {
    headers: { Cookie: userCookie },
  });
  assert.equal(userGet.status, 403);

  const userPut = await fetch(`${baseUrl}/api/superadmin/smtp-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: userCookie },
    body: JSON.stringify({
      enabled: false,
      from: "",
      fromName: "",
      host: "",
      port: 465,
      secure: true,
      user: "",
    }),
  });
  assert.equal(userPut.status, 403);

  const userTest = await postJson(
    baseUrl,
    "/api/superadmin/smtp-settings/test",
    { to: "erin@example.com" },
    userCookie,
  );
  assert.equal(userTest.status, 403);

  const adminCookie = await superadminCookie(server);

  const initialGet = await fetch(`${baseUrl}/api/superadmin/smtp-settings`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(initialGet.status, 200);
  const initialView = (await initialGet.json()) as {
    enabled: boolean;
    hasPass: boolean;
    host: string;
  };
  assert.equal(initialView.enabled, false);
  assert.equal(initialView.hasPass, false);

  const enabledWithoutHost = await fetch(
    `${baseUrl}/api/superadmin/smtp-settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        enabled: true,
        from: "",
        fromName: "",
        host: "",
        port: 465,
        secure: true,
        user: "",
      }),
    },
  );
  assert.equal(enabledWithoutHost.status, 400);

  const smtpSecret = "test-smtp-secret-2026";
  const saveResponse = await fetch(`${baseUrl}/api/superadmin/smtp-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({
      enabled: true,
      from: "noreply@example.com",
      fromName: "锤子便签测试",
      host: "127.0.0.1",
      pass: smtpSecret,
      port: 1,
      secure: false,
      user: "noreply@example.com",
    }),
  });
  assert.equal(saveResponse.status, 200);
  const saveText = await saveResponse.text();
  assert.ok(!saveText.includes(smtpSecret));
  const savedView = JSON.parse(saveText) as {
    enabled: boolean;
    hasPass: boolean;
    host: string;
    port: number;
  };
  assert.equal(savedView.enabled, true);
  assert.equal(savedView.hasPass, true);
  assert.equal(savedView.host, "127.0.0.1");

  const afterGet = await fetch(`${baseUrl}/api/superadmin/smtp-settings`, {
    headers: { Cookie: adminCookie },
  });
  const afterText = await afterGet.text();
  assert.ok(!afterText.includes(smtpSecret));
  assert.equal((JSON.parse(afterText) as { hasPass: boolean }).hasPass, true);

  const keepPassResponse = await fetch(
    `${baseUrl}/api/superadmin/smtp-settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        enabled: true,
        from: "noreply@example.com",
        fromName: "锤子便签测试",
        host: "127.0.0.1",
        pass: "",
        port: 1,
        secure: false,
        user: "noreply@example.com",
      }),
    },
  );
  assert.equal(keepPassResponse.status, 200);
  assert.equal(
    ((await keepPassResponse.json()) as { hasPass: boolean }).hasPass,
    true,
  );

  const testResponse = await postJson(
    baseUrl,
    "/api/superadmin/smtp-settings/test",
    { to: "someone@example.com" },
    adminCookie,
  );
  assert.notEqual(testResponse.status, 200);
  const testPayload = (await testResponse.json()) as { error: string };
  assert.match(testPayload.error, /测试邮件发送失败/);
  assert.ok(!testPayload.error.includes(smtpSecret));

  // 清空（停用）后台配置后，无 env SMTP 时验证码回退到服务端日志。
  const clearResponse = await fetch(`${baseUrl}/api/superadmin/smtp-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({
      enabled: false,
      from: "",
      fromName: "",
      host: "",
      port: 465,
      secure: true,
      user: "",
    }),
  });
  assert.equal(clearResponse.status, 200);

  const frankCode = await requestEmailCode(server, "frank@example.com", "register");
  const frankRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "frank@example.com",
    emailCode: frankCode,
    password: "frank-password-2026",
    username: "frank",
  });
  assert.equal(frankRegister.status, 200);
});

test("找回密码统一响应且不可串用其他用途验证码，重置后全部旧会话失效", async (context) => {
  const server = await startServer(context);
  const { baseUrl } = server;

  const graceCode = await requestEmailCode(server, "grace@example.com", "register");
  const graceRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "grace@example.com",
    emailCode: graceCode,
    password: "grace-password-2026",
    username: "grace",
  });
  assert.equal(graceRegister.status, 200);

  async function loginGrace(password: string): Promise<Response> {
    return postJson(baseUrl, "/api/auth/login", {
      captchaToken: await getCaptchaToken(baseUrl),
      password,
      remember: false,
      username: "grace",
    });
  }

  const loginA = await loginGrace("grace-password-2026");
  assert.equal(loginA.status, 200);
  const cookieA = getCookie(loginA);
  const loginB = await loginGrace("grace-password-2026");
  assert.equal(loginB.status, 200);
  const cookieB = getCookie(loginB);

  // 邮箱不存在：发码统一返回成功，不生成验证码、不写日志。
  const unknownSend = await postJson(baseUrl, "/api/auth/email-code", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "nobody@example.com",
    purpose: "reset",
  });
  assert.equal(unknownSend.status, 200);
  assert.deepEqual(await unknownSend.json(), { ok: true });
  assert.ok(!server.getStdout().includes("nobody@example.com"));

  const unknownReset = await postJson(baseUrl, "/api/auth/reset-password", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "nobody@example.com",
    emailCode: "123456",
    newPassword: "nobody-password-2026",
  });
  assert.equal(unknownReset.status, 400);

  // 注册验证码不能用于找回密码（purpose 隔离）。
  const karenRegisterCode = await requestEmailCode(
    server,
    "karen@example.com",
    "register",
  );
  const resetWithRegisterCode = await postJson(
    baseUrl,
    "/api/auth/reset-password",
    {
      captchaToken: await getCaptchaToken(baseUrl),
      email: "karen@example.com",
      emailCode: karenRegisterCode,
      newPassword: "karen-password-2026",
    },
  );
  assert.equal(resetWithRegisterCode.status, 400);

  // karen 的注册验证码未被上面的失败尝试消费，仍可正常注册。
  const karenRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "karen@example.com",
    emailCode: karenRegisterCode,
    password: "karen-password-2026",
    username: "karen",
  });
  assert.equal(karenRegister.status, 200);

  const resetCode = await requestEmailCode(server, "grace@example.com", "reset");

  // 重置验证码不能用于注册（邮箱与用途双重绑定）。
  const registerWithResetCode = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "karen2@example.com",
    emailCode: resetCode,
    password: "karen2-password-2026",
    username: "karen2",
  });
  assert.equal(registerWithResetCode.status, 400);

  // 绑定验证码不能用于找回密码（purpose 隔离，收件邮箱即本人绑定邮箱）。
  const bindCode = await requestEmailCode(
    server,
    "grace@example.com",
    "bind",
    cookieA,
  );
  const resetWithBindCode = await postJson(baseUrl, "/api/auth/reset-password", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "grace@example.com",
    emailCode: bindCode,
    newPassword: "grace-password-x1",
  });
  assert.equal(resetWithBindCode.status, 400);

  const resetWrongCode = await postJson(baseUrl, "/api/auth/reset-password", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "grace@example.com",
    emailCode: "000000",
    newPassword: "grace-password-x1",
  });
  assert.equal(resetWrongCode.status, 400);

  const resetOk = await postJson(baseUrl, "/api/auth/reset-password", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "grace@example.com",
    emailCode: resetCode,
    newPassword: "grace-password-x1",
  });
  assert.equal(resetOk.status, 200);
  assert.deepEqual(await resetOk.json(), { ok: true });

  // 验证码消费后不可重放。
  const resetReplay = await postJson(baseUrl, "/api/auth/reset-password", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "grace@example.com",
    emailCode: resetCode,
    newPassword: "grace-password-x2",
  });
  assert.equal(resetReplay.status, 400);

  // 重置前签发的全部会话都已失效。
  for (const cookie of [cookieA, cookieB]) {
    const emailResponse = await fetch(`${baseUrl}/api/auth/email`, {
      headers: { Cookie: cookie },
    });
    assert.equal(emailResponse.status, 401);
  }

  const oldLogin = await loginGrace("grace-password-2026");
  assert.equal(oldLogin.status, 401);
  const newLogin = await loginGrace("grace-password-x1");
  assert.equal(newLogin.status, 200);
});

test("设置改密改用绑定邮箱验证码，当前会话续签而其他会话失效，未绑邮箱先提示绑定", async (context) => {
  const server = await startServer(context);
  const { baseUrl } = server;

  const heidiCode = await requestEmailCode(server, "heidi@example.com", "register");
  const heidiRegister = await postJson(baseUrl, "/api/auth/register", {
    captchaToken: await getCaptchaToken(baseUrl),
    email: "heidi@example.com",
    emailCode: heidiCode,
    password: "heidi-password-2026",
    username: "heidi",
  });
  assert.equal(heidiRegister.status, 200);

  async function loginHeidi(password: string): Promise<Response> {
    return postJson(baseUrl, "/api/auth/login", {
      captchaToken: await getCaptchaToken(baseUrl),
      password,
      remember: false,
      username: "heidi",
    });
  }

  const loginC = await loginHeidi("heidi-password-2026");
  assert.equal(loginC.status, 200);
  const cookieC = getCookie(loginC);
  const loginD = await loginHeidi("heidi-password-2026");
  assert.equal(loginD.status, 200);
  const cookieD = getCookie(loginD);

  const changeWithoutCode = await postJson(
    baseUrl,
    "/api/auth/password",
    { newPassword: "heidi-password-x1" },
    cookieC,
  );
  assert.equal(changeWithoutCode.status, 400);

  const changeWrongCode = await postJson(
    baseUrl,
    "/api/auth/password",
    { emailCode: "000000", newPassword: "heidi-password-x1" },
    cookieC,
  );
  assert.equal(changeWrongCode.status, 400);

  const changeCode = await requestEmailCode(
    server,
    "heidi@example.com",
    "reset",
    cookieC,
  );
  const changeOk = await postJson(
    baseUrl,
    "/api/auth/password",
    { emailCode: changeCode, newPassword: "heidi-password-x1" },
    cookieC,
  );
  assert.equal(changeOk.status, 200);
  const renewedCookie = getCookie(changeOk);

  // 当前会话靠续签 Cookie 继续可用，其他旧会话全部失效。
  const renewedEmail = await fetch(`${baseUrl}/api/auth/email`, {
    headers: { Cookie: renewedCookie },
  });
  assert.equal(renewedEmail.status, 200);
  assert.deepEqual(await renewedEmail.json(), {
    email: "heidi@example.com",
  });

  for (const cookie of [cookieC, cookieD]) {
    const staleResponse = await fetch(`${baseUrl}/api/auth/email`, {
      headers: { Cookie: cookie },
    });
    assert.equal(staleResponse.status, 401);
  }

  const oldLogin = await loginHeidi("heidi-password-2026");
  assert.equal(oldLogin.status, 401);
  const newLogin = await loginHeidi("heidi-password-x1");
  assert.equal(newLogin.status, 200);

  // 未绑定邮箱的老账号改密时先提示去绑定邮箱。
  const adminCookie = await superadminCookie(server);
  const createLeo = await postJson(
    baseUrl,
    "/api/superadmin/users",
    { username: "leo" },
    adminCookie,
  );
  assert.equal(createLeo.status, 201);
  const leo = (await createLeo.json()) as {
    user: { initialPassword: string };
  };
  const leoLogin = await postJson(baseUrl, "/api/auth/login", {
    captchaToken: await getCaptchaToken(baseUrl),
    password: leo.user.initialPassword,
    remember: false,
    username: "leo",
  });
  assert.equal(leoLogin.status, 200);
  const leoCookie = getCookie(leoLogin);

  const leoChange = await postJson(
    baseUrl,
    "/api/auth/password",
    { emailCode: "123456", newPassword: "leo-password-2026" },
    leoCookie,
  );
  assert.equal(leoChange.status, 400);
  const leoPayload = (await leoChange.json()) as { error: string };
  assert.match(leoPayload.error, /请先绑定邮箱/);
});
