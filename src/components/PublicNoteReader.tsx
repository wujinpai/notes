import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { copyTextToClipboard } from "../lib/clipboard.js";
import {
  exportMarkdownArchive,
  exportMarkdownAsPng,
  getExportErrorMessage,
} from "../lib/export.js";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
} from "../lib/footer.js";
import { splitSections } from "../lib/markdown.js";
import {
  buildPublicNoteShareUrl,
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
}

const BASE_NOTE_WIDTH = 330;
const DESKTOP_NOTE_SCALE = 2;
const MOBILE_NOTE_SCALE = 1.4;
const MOBILE_BREAKPOINT = 640;

/**
 * 公开便签只读阅读器：与本地预览一致的主题卡片、主题选择与分享
 * （复制链接 / Markdown、导出长图与离线归档），仅不可编辑。
 */
export function PublicNoteReader({
  detail,
  missing,
  onClose,
}: PublicNoteReaderProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [noteScale, setNoteScale] = useState(DESKTOP_NOTE_SCALE);
  const [themeOverride, setThemeOverride] = useState<NoteCardThemeId | null>(
    () => getInitialNoteCardTheme(),
  );
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [copiedKind, setCopiedKind] = useState<"link" | "markdown" | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [exportError, setExportError] = useState("");

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

  async function handleCopy(kind: "link" | "markdown") {
    if (!detail || typeof window === "undefined") {
      return;
    }

    try {
      await copyTextToClipboard(
        kind === "link"
          ? buildPublicNoteShareUrl(window.location.origin, detail.id)
          : detail.markdown,
      );
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind(null), 1600);
    } catch {
      // 剪贴板不可用时静默失败，不打扰阅读。
    }
  }

  async function handleExportPng() {
    if (!detail || isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      await exportMarkdownAsPng(detail.markdown, noteCardTheme, {
        footerBrand: DEFAULT_FOOTER_BRAND,
        footerLogoUrl: DEFAULT_FOOTER_LOGO_URL,
        footerVia: DEFAULT_FOOTER_VIA,
      });
      setIsShareOpen(false);
    } catch (error) {
      console.error("Public note PNG export failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleArchive() {
    if (!detail || isArchiving) {
      return;
    }

    try {
      setIsArchiving(true);
      setExportError("");
      await exportMarkdownArchive(detail.markdown, noteCardTheme, {
        footerBrand: DEFAULT_FOOTER_BRAND,
        footerLogoUrl: DEFAULT_FOOTER_LOGO_URL,
        footerVia: DEFAULT_FOOTER_VIA,
      });
      setIsShareOpen(false);
    } catch (error) {
      console.error("Public note archive download failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

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
            <button
              type="button"
              className="public-note-reader-share"
              onClick={() => setIsShareOpen(true)}
            >
              分享
            </button>
          </>
        ) : null}
      </div>

      {exportError ? <p className="export-status">{exportError}</p> : null}

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

      {isShareOpen && detail ? (
        <>
          <button
            type="button"
            className="share-panel-backdrop"
            aria-label="关闭分享面板"
            onClick={() => setIsShareOpen(false)}
          />
          <div
            className="share-panel"
            role="dialog"
            aria-modal="true"
            aria-label="分享公开便签"
          >
            <header className="share-panel-header">
              <h2>分享这篇便签</h2>
              <button
                type="button"
                className="share-panel-close"
                aria-label="关闭分享面板"
                onClick={() => setIsShareOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="share-actions">
              <button
                type="button"
                className="share-action"
                onClick={() => void handleCopy("link")}
              >
                <span className="share-action-label">
                  {copiedKind === "link" ? "链接已复制" : "复制链接"}
                </span>
                <span className="share-action-description">
                  任何人打开链接都能只读查看这篇便签
                </span>
              </button>
              <button
                type="button"
                className="share-action"
                onClick={() => void handleCopy("markdown")}
              >
                <span className="share-action-label">
                  {copiedKind === "markdown" ? "已复制" : "复制 Markdown"}
                </span>
                <span className="share-action-description">
                  复制当前 Markdown 源文本
                </span>
              </button>
              <button
                type="button"
                className="share-action"
                disabled={isExporting}
                onClick={() => void handleExportPng()}
              >
                <span className="share-action-label">
                  {isExporting ? "正在生成图片..." : "以图片形式分享"}
                </span>
                <span className="share-action-description">
                  导出当前便签长图
                </span>
              </button>
              <button
                type="button"
                className="share-action"
                disabled={isArchiving}
                onClick={() => void handleArchive()}
              >
                <span className="share-action-label">
                  {isArchiving ? "归档中..." : "导出离线归档"}
                </span>
                <span className="share-action-description">
                  下载 Markdown、HTML、图片和字体
                </span>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
