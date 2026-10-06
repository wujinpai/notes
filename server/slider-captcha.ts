import { randomBytes } from "node:crypto";

// 滑块验证（拼图式）服务端状态。
//
// 设计说明：targetRatio 就是界面上缺口在轨道中的相对位置。对直接调用 API 的
// 客户端来说，challenge 响应里包含 targetRatio，等同于把缺口位置直接告知
// 调用方——这是拼图类滑块的固有形态（浏览器端同样需要知道缺口画在哪里）。
// 因此这里的防护并不声称能识别“真人”，主要靠：challenge 与 captchaToken 都
// 是一次性、短时效的随机票据，拖动必须满足最小时长与最少移动次数，且通过后
// 签发的 token 在登录/注册时被立即消费。它防的是无成本的脚本化批量提交、
// 重放与凭据爆破，而不是高强度的机器人对抗；若需要更强保障，应接入带行为
// 分析的第三方验证码服务。

const challengeTtlMs = 120_000;
const captchaTokenTtlMs = 5 * 60_000;
const positionTolerance = 0.045;
const minDurationMs = 300;
const minMoveCount = 3;
const cleanupIntervalMs = 60_000;

export interface SliderChallenge {
  challengeId: string;
  targetRatio: number;
}

interface StoredChallenge {
  expiresAt: number;
  targetRatio: number;
  used: boolean;
}

interface StoredCaptchaToken {
  expiresAt: number;
  used: boolean;
}

const challenges = new Map<string, StoredChallenge>();
const captchaTokens = new Map<string, StoredCaptchaToken>();

function pruneExpired(now = Date.now()): void {
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now || challenge.used) {
      challenges.delete(id);
    }
  }

  for (const [token, stored] of captchaTokens) {
    if (stored.expiresAt <= now || stored.used) {
      captchaTokens.delete(token);
    }
  }
}

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) {
    return;
  }

  cleanupTimer = setInterval(() => pruneExpired(), cleanupIntervalMs);
  cleanupTimer.unref?.();
}

export function createSliderChallenge(): SliderChallenge {
  ensureCleanupTimer();
  pruneExpired();

  // 缺口位置限制在轨道中后段，避免贴边导致拖动距离过短。
  const targetRatio = 0.55 + Math.random() * 0.35;
  const challengeId = randomBytes(24).toString("base64url");

  challenges.set(challengeId, {
    expiresAt: Date.now() + challengeTtlMs,
    targetRatio,
    used: false,
  });

  return { challengeId, targetRatio };
}

export function verifySliderChallenge(input: {
  challengeId?: unknown;
  durationMs?: unknown;
  moveCount?: unknown;
  positionRatio?: unknown;
}): string | null {
  const { challengeId, durationMs, moveCount, positionRatio } = input;

  if (
    typeof challengeId !== "string" ||
    typeof positionRatio !== "number" ||
    !Number.isFinite(positionRatio) ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    typeof moveCount !== "number" ||
    !Number.isFinite(moveCount)
  ) {
    return null;
  }

  const challenge = challenges.get(challengeId);

  if (!challenge || challenge.used || challenge.expiresAt <= Date.now()) {
    if (challenge) {
      challenges.delete(challengeId);
    }
    return null;
  }

  const passed =
    Math.abs(positionRatio - challenge.targetRatio) <= positionTolerance &&
    durationMs >= minDurationMs &&
    moveCount >= minMoveCount;

  if (!passed) {
    return null;
  }

  // 单次使用：无论后续 token 是否被消费，该 challenge 都不能再次验证。
  challenge.used = true;
  challenges.delete(challengeId);

  const captchaToken = randomBytes(32).toString("base64url");
  captchaTokens.set(captchaToken, {
    expiresAt: Date.now() + captchaTokenTtlMs,
    used: false,
  });

  return captchaToken;
}

export function consumeCaptchaToken(token: unknown): boolean {
  if (typeof token !== "string" || !token) {
    return false;
  }

  const stored = captchaTokens.get(token);

  if (!stored) {
    return false;
  }

  if (stored.used || stored.expiresAt <= Date.now()) {
    captchaTokens.delete(token);
    return false;
  }

  stored.used = true;
  captchaTokens.delete(token);
  return true;
}
