import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  createSliderChallenge,
  verifySliderCaptcha,
} from "../lib/auth.js";

interface SliderCaptchaProps {
  onVerified: (captchaToken: string) => void;
  resetKey?: number;
}

type SliderStatus = "loading" | "ready" | "verifying" | "passed" | "failed";

const HANDLE_WIDTH_RATIO = 0.12;

export function SliderCaptcha({ onVerified, resetKey = 0 }: SliderCaptchaProps) {
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [targetRatio, setTargetRatio] = useState<number | null>(null);
  const [ratio, setRatio] = useState(0);
  const [status, setStatus] = useState<SliderStatus>("loading");
  const [message, setMessage] = useState("正在加载滑块验证...");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    firstMoveAt: number | null;
    moveCount: number;
    pointerId: number;
    startRatio: number;
    startX: number;
  } | null>(null);
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  const loadChallenge = useCallback(async () => {
    setStatus("loading");
    setMessage("正在加载滑块验证...");
    setRatio(0);
    setChallengeId(null);
    setTargetRatio(null);
    dragRef.current = null;

    try {
      const challenge = await createSliderChallenge();
      setChallengeId(challenge.challengeId);
      setTargetRatio(challenge.targetRatio);
      setStatus("ready");
      setMessage("拖动滑块到缺口位置");
    } catch {
      setStatus("failed");
      setMessage("滑块验证加载失败，点击重试");
    }
  }, []);

  // 只在挂载后请求 challenge；静态渲染时不发请求、也不崩溃。
  useEffect(() => {
    void loadChallenge();
  }, [loadChallenge, resetKey]);

  const updateRatioFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    const drag = dragRef.current;

    if (!track || !drag) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const maxOffset = Math.max(1, rect.width * (1 - HANDLE_WIDTH_RATIO));
    const offset = Math.min(
      maxOffset,
      Math.max(0, clientX - drag.startX + drag.startRatio * maxOffset),
    );
    const nextRatio = offset / maxOffset;

    if (drag.firstMoveAt === null) {
      drag.firstMoveAt = performance.now();
    }
    drag.moveCount += 1;
    setRatio(nextRatio);
  }, []);

  async function finishDrag() {
    const drag = dragRef.current;
    dragRef.current = null;

    if (!drag || !challengeId || targetRatio === null || status !== "ready") {
      return;
    }

    const durationMs = drag.firstMoveAt
      ? Math.round(performance.now() - drag.firstMoveAt)
      : 0;

    if (Math.abs(ratio - targetRatio) > 0.045) {
      setStatus("failed");
      setMessage("没有对准缺口，请重试");
      setRatio(0);
      return;
    }

    try {
      setStatus("verifying");
      setMessage("正在验证...");
      const captchaToken = await verifySliderCaptcha({
        challengeId,
        durationMs,
        moveCount: drag.moveCount,
        positionRatio: ratio,
      });
      setStatus("passed");
      setMessage("验证通过");
      onVerifiedRef.current(captchaToken);
    } catch {
      setStatus("failed");
      setMessage("滑块验证未通过，请重试");
      setRatio(0);
      // 验证失败后重新取一个 challenge，避免复用旧 challenge。
      void loadChallenge();
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (status !== "ready") {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      firstMoveAt: null,
      moveCount: 0,
      pointerId: event.pointerId,
      startRatio: ratio,
      startX: event.clientX,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    updateRatioFromClientX(event.clientX);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    void finishDrag();
  }

  return (
    <div className="slider-captcha" data-status={status}>
      <div
        className="slider-captcha-track"
        ref={trackRef}
        role="presentation"
      >
        {targetRatio !== null ? (
          <span
            className="slider-captcha-target"
            style={{
              left: `${targetRatio * (1 - HANDLE_WIDTH_RATIO) * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
        <span
          className="slider-captcha-fill"
          style={{ width: `${ratio * (1 - HANDLE_WIDTH_RATIO) * 100}%` }}
          aria-hidden="true"
        />
        <button
          type="button"
          className="slider-captcha-handle"
          style={{ left: `${ratio * (1 - HANDLE_WIDTH_RATIO) * 100}%` }}
          aria-label="拖动滑块完成验证"
          disabled={status !== "ready"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {status === "passed" ? "✓" : "»"}
        </button>
      </div>
      <p className="slider-captcha-message" aria-live="polite">
        {status === "passed" ? "验证通过" : message}
        {status === "failed" ? (
          <button
            type="button"
            className="slider-captcha-retry"
            onClick={() => void loadChallenge()}
          >
            重试
          </button>
        ) : null}
      </p>
    </div>
  );
}
