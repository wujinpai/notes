import {
  formatPublicNoteTime,
  type PublicNoteDetail,
} from "../lib/public-notes.js";
import { MarkdownText } from "./MarkdownText.js";

interface PublicNoteReaderProps {
  detail: PublicNoteDetail | null;
  missing: boolean;
  onClose: () => void;
}

/** 首页主区域的公开便签只读阅读器（游客视角）。 */
export function PublicNoteReader({
  detail,
  missing,
  onClose,
}: PublicNoteReaderProps) {
  return (
    <section className="public-note-reader" aria-label="公开便签正文">
      <button
        type="button"
        className="public-note-reader-back"
        onClick={onClose}
      >
        ← 返回便签列表
      </button>

      {detail ? (
        <>
          <header className="public-note-reader-meta">
            <span>{detail.author}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(detail.updatedAt).toISOString()}>
              {formatPublicNoteTime(detail.updatedAt)}
            </time>
            <span className="public-note-reader-badge">公开便签 · 只读</span>
          </header>
          <div className="public-note-reader-markdown">
            <MarkdownText>{detail.markdown}</MarkdownText>
          </div>
        </>
      ) : missing ? (
        <p className="public-notes-status">
          这篇便签没有对游客显示，或者已经被作者隐藏了。
        </p>
      ) : (
        <p className="public-notes-status">正在加载这篇便签…</p>
      )}
    </section>
  );
}
