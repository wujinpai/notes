import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
} from "../lib/footer.js";
import { splitSections } from "../lib/markdown.js";
import {
  formatPublicNoteTime,
  type PublicNoteDetail,
} from "../lib/public-notes.js";
import {
  getInitialNoteCardTheme,
  NOTE_CARD_THEME_STORAGE_KEY,
} from "../lib/themes.js";
import type { NoteCardThemeId } from "../types/app.js";
import { NoteSheet } from "./NoteSheet.js";
import { NoteCardThemePicker } from "./PreviewPanel.js";

interface PublicNoteReaderProps {
  detail: PublicNoteDetail | null;
  missing: boolean;
  onClose: () => void;
  /** 提供时在工具栏显示分享入口；首页内由顶栏纸飞机触发，不传。 */
  onShareRequest?: () => void;
}

const BASE_NOTE_WIDTH = 330;
const DESKTOP_NOTE_SCALE = 2;
const MOBILE_NOTE_SCALE = 1.4;
const MOBILE_BREAKPOINT = 640;

/**
 * 公开便签只读阅读器：与本地预览一致的主题卡片与主题选择，仅不可编辑；
 * 分享动作统一走外部入口（首页顶栏纸飞机 / 公开页工具栏）。
 */
export function PublicNoteReader({
  detail,
  missing,
  onClose,
  onShareRequest,
}: PublicNoteReaderProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [noteScale, setNoteScale] = useState(DESKTOP_NOTE_SCALE);
  const [themeOverride, setThemeOverride] = useState<NoteCardThemeId | null>(
    () => getInitialNoteCardTheme(),
  );

  const noteCardTheme: NoteCardThemeId = themeOverride ?? "default";

  useEffect(() => {
    if (themeOverride && typeof window !== "undefined") {
      window.localStorage.setItem(NOTE_CARD_THEME_STORAGE_KEY, themeOverride);
    }
  }, [themeOverride]);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage || typeof window === "undefined") {
      return;
    }

    const updateNoteScale = () => {
      const styles = window.getComputedStyle(stage);
      const paddingX =
        parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const availableWidth = Math.max(stage.clientWidth - paddingX, 0);
      const targetScale =
        window.innerWidth <= MOBILE_BREAKPOINT
          ? MOBILE_NOTE_SCALE
          : DESKTOP_NOTE_SCALE;
      const fittedScale =
        availableWidth > 0 ? availableWidth / BASE_NOTE_WIDTH : targetScale;

      setNoteScale(Math.min(targetScale, fittedScale));
    };

    updateNoteScale();

    const resizeObserver = new ResizeObserver(updateNoteScale);
    resizeObserver.observe(stage);
    window.addEventListener("resize", updateNoteScale);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateNoteScale);
    };
  }, [detail]);

  return (
    <section className="public-note-reader" aria-label="公开便签正文">
      <div className="public-note-reader-toolbar">
        <button
          type="button"
          className="public-note-reader-back"
          onClick={onClose}
        >
          ← 返回便签列表
        </button>
        {detail ? (
          <>
            <span className="public-note-reader-meta">
              <span>{detail.author}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={new Date(detail.updatedAt).toISOString()}>
                {formatPublicNoteTime(detail.updatedAt)}
              </time>
              <span className="public-note-reader-badge">公开便签 · 只读</span>
            </span>
            {onShareRequest ? (
              <button
                type="button"
                className="public-note-reader-share"
                onClick={onShareRequest}
              >
                分享
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {detail ? (
        <>
          <div
            className="preview-stage public-note-reader-stage"
            ref={stageRef}
            style={{ "--note-scale": String(noteScale) } as CSSProperties}
          >
            <div
              className="preview-card-theme"
              data-preview-theme={noteCardTheme}
            >
              <NoteSheet
                notes={splitSections(detail.markdown)}
                footerBrand={DEFAULT_FOOTER_BRAND}
                footerLogoUrl={DEFAULT_FOOTER_LOGO_URL}
                footerVia={DEFAULT_FOOTER_VIA}
              />
            </div>
          </div>
          <NoteCardThemePicker
            value={noteCardTheme}
            onChange={(theme) => setThemeOverride(theme)}
          />
        </>
      ) : missing ? (
        <p className="public-notes-status public-note-reader-status">
          这篇便签没有对游客显示，或者已经被作者隐藏了。
        </p>
      ) : (
        <p className="public-notes-status public-note-reader-status">
          正在加载这篇便签…
        </p>
      )}
    </section>
  );
}
