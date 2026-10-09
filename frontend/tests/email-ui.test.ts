import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BindEmailDialog } from "../../src/components/BindEmailDialog.js";

test("注册模式提供邮箱验证码字段且发码走滑块票据", () => {
  const loginSource = readFileSync("src/components/LoginDialog.tsx", "utf8");
  const authSource = readFileSync("src/lib/auth.ts", "utf8");

  assert.match(loginSource, /邮箱（用于接收验证码）/);
  assert.match(loginSource, /name="email"/);
  assert.match(loginSource, /name="emailCode"/);
  assert.match(loginSource, /获取验证码/);
  assert.match(
    loginSource,
    /purpose: isForgotMode \? "reset" : "register"/,
  );
  assert.match(loginSource, /请输入 6 位邮箱验证码/);
  assert.match(
    loginSource,
    /registerUser\(username, password, captchaToken, email, emailCode\)/,
  );
  assert.match(authSource, /"\/api\/auth\/email-code"/);
  assert.match(authSource, /"\/api\/auth\/register"/);
});

test("登录弹窗提供忘记密码入口并通过邮箱验证码重置", () => {
  const loginSource = readFileSync("src/components/LoginDialog.tsx", "utf8");
  const authSource = readFileSync("src/lib/auth.ts", "utf8");

  assert.match(loginSource, /忘记密码？/);
  assert.match(loginSource, /switchMode\("forgot"\)/);
  assert.match(loginSource, /账号绑定的邮箱/);
  assert.match(
    loginSource,
    /resetUserPassword\(email, emailCode, password, captchaToken\)/,
  );
  assert.match(loginSource, /密码已重置，请用新密码登录。/);
  assert.match(loginSource, /重置密码/);
  assert.match(authSource, /"\/api\/auth\/reset-password"/);
  assert.match(authSource, /"reset"/);
});

test("绑定邮箱弹窗要求当前密码、新邮箱与验证码", () => {
  const html = renderToStaticMarkup(
    createElement(BindEmailDialog, {
      currentEmail: null,
      onBound: () => undefined,
      onClose: () => undefined,
    }),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, />绑定邮箱</);
  assert.match(html, />当前密码</);
  assert.match(html, />新邮箱</);
  assert.match(html, />邮箱验证码</);
  assert.match(html, /获取验证码/);
  assert.match(html, /class="slider-captcha"/);

  const rebindHtml = renderToStaticMarkup(
    createElement(BindEmailDialog, {
      currentEmail: "old@example.com",
      onBound: () => undefined,
      onClose: () => undefined,
    }),
  );

  assert.match(rebindHtml, />更换邮箱</);
  assert.match(rebindHtml, /old@example\.com/);
  assert.match(rebindHtml, /确认更换/);
});

test("账号设置提供绑定邮箱入口并展示当前邮箱", () => {
  const settingsSource = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const appSource = readFileSync("src/App.tsx", "utf8");

  assert.match(settingsSource, /绑定邮箱/);
  assert.match(settingsSource, /更换邮箱/);
  assert.match(settingsSource, /onBindEmail/);
  assert.match(settingsSource, /authEmail/);
  assert.match(appSource, /<BindEmailDialog/);
  assert.match(appSource, /getOwnEmail/);
});

test("超级管理员后台提供邮箱设置页签、SMTP 表单与用户绑定邮箱列", () => {
  const adminSource = readFileSync("src/components/SuperAdminPage.tsx", "utf8");
  const authSource = readFileSync("src/lib/auth.ts", "utf8");

  assert.match(adminSource, /邮箱设置/);
  assert.match(adminSource, /SMTP 主机/);
  assert.match(adminSource, /SMTP 密码/);
  assert.match(adminSource, /留空表示不修改/);
  assert.match(adminSource, /发送测试邮件/);
  assert.match(adminSource, /启用后台 SMTP 配置发信/);
  assert.match(adminSource, /绑定邮箱/);
  assert.match(adminSource, /getSmtpSettings/);
  assert.match(adminSource, /saveSmtpSettings/);
  assert.match(adminSource, /sendSmtpTestMail/);
  assert.match(authSource, /"\/api\/superadmin\/smtp-settings"/);
  assert.match(authSource, /"\/api\/superadmin\/smtp-settings\/test"/);
});
