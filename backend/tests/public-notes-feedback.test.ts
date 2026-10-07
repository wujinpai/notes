import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { NoteDocument, NoteWorkspace } from "../../src/types/app.js";

interface CreatedUser {
  createdAt: number;
  id: string;
  initialPassword: string;
  username: string;
}

interface PublicNoteSummaryPayload {
  id: string;
  title: string;
  preview: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  publicAt: number;
}

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配公开便签 feedback 测试端口");
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
      throw new Error(`后端在公开便签测试前退出，退出码：${child.exitCode}`);
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

  throw new Error("等待公开便签测试后端超时");
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

function createNote(
  id: string,
  markdown: string,
  overrides: Partial<NoteDocument> = {},
): NoteDocument {
  return {
    id,
    markdown,
    createdAt: 1_000,
    updatedAt: 2_000,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
    publicAt: null,
    ...overrides,
  };
}

function createWorkspace(notes: NoteDocument[]): NoteWorkspace {
  return {
    activeNoteId: notes[0]?.id ?? "",
    folders: [],
    notes,
    version: 1,
  };
}

async function saveWorkspace(
  baseUrl: string,
  cookie: string,
  workspace: NoteWorkspace,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ workspace }),
  });
  assert.equal(response.status, 200);
}

async function fetchPublicNotes(
  baseUrl: string,
): Promise<{ notes: PublicNoteSummaryPayload[] }> {
  const response = await fetch(`${baseUrl}/api/public/notes`);
  assert.equal(response.status, 200);
  return (await response.json()) as { notes: PublicNoteSummaryPayload[] };
}

test("游客只能看到设为公开的便签，隐藏或删除后立即不可见", async (context) => {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-public-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-public-images-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_STORAGE_DIR: dataDir,
      IMAGE_STORAGE_DIR: imageDir,
      PORT: String(port),
      SESSION_SECRET: "public-notes-feedback-secret",
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

  try {
    await waitForHealth(baseUrl, child);

    const adminLogin = await postJson(baseUrl, "/api/superadmin/login", {
      captchaToken: await getCaptchaToken(baseUrl),
      password: "feedback-admin-password",
      remember: true,
      username: "feedback-admin",
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = getCookie(adminLogin);

    async function createAndLoginUser(username: string): Promise<string> {
      const createdResponse = await postJson(
        baseUrl,
        "/api/superadmin/users",
        { username },
        adminCookie,
      );
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()) as { user: CreatedUser };

      const login = await postJson(baseUrl, "/api/auth/login", {
        captchaToken: await getCaptchaToken(baseUrl),
        password: created.user.initialPassword,
        remember: false,
        username,
      });
      assert.equal(login.status, 200);
      return getCookie(login);
    }

    const ownerCookie = await createAndLoginUser("public-owner");
    const otherCookie = await createAndLoginUser("private-owner");

    const publicNote = createNote("note-public", "# 公开的便签\n这是游客能看到的内容", {
      publicAt: 1_500,
      updatedAt: 3_000,
    });
    const privateNote = createNote("note-private", "# 私密便签\n只有自己能看");
    const deletedPublicNote = createNote("note-deleted", "# 已删除的公开便签", {
      deletedAt: 2_500,
      publicAt: 1_500,
    });
    await saveWorkspace(
      baseUrl,
      ownerCookie,
      createWorkspace([publicNote, privateNote, deletedPublicNote]),
    );
    await saveWorkspace(
      baseUrl,
      otherCookie,
      createWorkspace([createNote("note-other", "# 别人的私密便签")]),
    );

    // 超级管理员云端便签同样可以对游客显示，作者是管理员账号名。
    const superadminLogin = await postJson(baseUrl, "/api/auth/login", {
      captchaToken: await getCaptchaToken(baseUrl),
      password: "feedback-admin-password",
      remember: false,
      username: "feedback-admin",
    });
    assert.equal(superadminLogin.status, 200);
    await saveWorkspace(
      baseUrl,
      getCookie(superadminLogin),
      createWorkspace([
        createNote("note-admin", "# 管理员公开便签", {
          publicAt: 1_600,
          updatedAt: 4_000,
        }),
      ]),
    );

    const list = await fetchPublicNotes(baseUrl);
    assert.deepEqual(
      list.notes.map((note) => note.id),
      ["note-admin", "note-public"],
    );
    const publicSummary = list.notes.find((note) => note.id === "note-public");
    assert.ok(publicSummary);
    assert.equal(publicSummary.title, "公开的便签");
    assert.match(publicSummary.preview, /游客能看到/);
    assert.equal(publicSummary.author, "public-owner");
    assert.equal(
      list.notes.find((note) => note.id === "note-admin")?.author,
      "feedback-admin",
    );
    assert.ok(
      list.notes.every(
        (note) => !("markdown" in note) && !note.preview.includes("只有自己能看"),
      ),
    );

    const detailResponse = await fetch(`${baseUrl}/api/public/notes/note-public`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as {
      note: PublicNoteSummaryPayload & { markdown: string };
    };
    assert.equal(detail.note.title, "公开的便签");
    assert.equal(detail.note.author, "public-owner");
    assert.match(detail.note.markdown, /这是游客能看到的内容/);
    // 详情响应必须带齐前端解析所需的全部字段（含 preview），与列表保持同一形状。
    assert.match(detail.note.preview, /游客能看到/);
    assert.equal(detail.note.publicAt, 1_500);
    assert.equal(typeof detail.note.createdAt, "number");
    assert.equal(typeof detail.note.updatedAt, "number");

    for (const hiddenId of ["note-private", "note-deleted", "note-other", "note-missing"]) {
      const hiddenResponse = await fetch(
        `${baseUrl}/api/public/notes/${hiddenId}`,
      );
      assert.equal(hiddenResponse.status, 404, `${hiddenId} 不应对游客可见`);
    }

    // 取消对游客显示后，列表与详情立即不可见。
    await saveWorkspace(
      baseUrl,
      ownerCookie,
      createWorkspace([{ ...publicNote, publicAt: null }, privateNote]),
    );
    const afterUnpublish = await fetchPublicNotes(baseUrl);
    assert.deepEqual(
      afterUnpublish.notes.map((note) => note.id),
      ["note-admin"],
    );
    const unpublishedDetail = await fetch(
      `${baseUrl}/api/public/notes/note-public`,
    );
    assert.equal(unpublishedDetail.status, 404);
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
});
