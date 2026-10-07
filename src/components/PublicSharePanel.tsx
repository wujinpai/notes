import { useState } from "react";
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
import {
  buildPublicNoteShareUrl,
  type PublicNoteDetail,
} from "../lib/public-notes.js";
import { getInitialNoteCardTheme } from "../lib/themes.js";
import type { NoteCardThemeId } from "../types/app.js";

interface PublicSharePanelProps {
  detail: PublicNoteDetail;
  onClose: () => void;
}

function resolveShareTheme(): NoteCardThemeId {
  return getInitialNoteCardTheme() ?? "default";
}

/** 公开便签分享面板：复制链接 / Markdown、长图导出与离线归档，均免登录。 */
export function PublicSharePanel({ detail, onClose }: PublicSharePanelProps) {
  const [copiedKind, setCopiedKind] = useState<"link" | "markdown" | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [exportError, setExportError] = useState("");

  async function handleCopy(kind: "link" | "markdown") {
    if (typeof window === "undefined") {
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
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      await exportMarkdownAsPng(detail.markdown, resolveShareTheme(), {
        footerBrand: DEFAULT_FOOTER_BRAND,
        footerLogoUrl: DEFAULT_FOOTER_LOGO_URL,
        footerVia: DEFAULT_FOOTER_VIA,
      });
      onClose();
    } catch (error) {
      console.error("Public note PNG export failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleArchive() {
    if (isArchiving) {
      return;
    }

    try {
      setIsArchiving(true);
      setExportError("");
      await exportMarkdownArchive(detail.markdown, resolveShareTheme(), {
        footerBrand: DEFAULT_FOOTER_BRAND,
        footerLogoUrl: DEFAULT_FOOTER_LOGO_URL,
        footerVia: DEFAULT_FOOTER_VIA,
      });
      onClose();
    } catch (error) {
      console.error("Public note archive download failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="share-panel-backdrop"
        aria-label="关闭分享面板"
        onClick={onClose}
      />
      <div
        id="app-share-panel"
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
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {exportError ? <p className="export-status">{exportError}</p> : null}
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
            <span className="share-action-description">导出当前便签长图</span>
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
  );
}
