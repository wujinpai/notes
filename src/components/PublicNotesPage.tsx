import { useEffect, useState } from "react";
import {
  fetchPublicNote,
  fetchPublicNotes,
  formatPublicNoteTime,
  getPublicNoteIdFromSearch,
  type PublicNoteDetail,
  type PublicNoteSummary,
} from "../lib/public-notes.js";
import { getInitialTheme } from "../lib/themes.js";
import { useResolvedTheme } from "../lib/use-theme.js";
import { PublicNoteReader } from "./PublicNoteReader.js";
import { PublicSharePanel } from "./PublicSharePanel.js";

export function PublicNotesPage() {
  const themePreference = getInitialTheme();
  const theme = useResolvedTheme(themePreference);
  const [notes, setNotes] = useState<PublicNoteSummary[] | null>(null);
  const [detail, setDetail] = useState<PublicNoteDetail | null>(null);
  const [detailMissing, setDetailMissing] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : getPublicNoteIdFromSearch(window.location.search),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPublicShareOpen, setIsPublicShareOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    fetchPublicNotes()
      .then((publicNotes) => {
        if (!cancelled) {
          setNotes(publicNotes);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "公开便签加载失败，请稍后重试。",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedNoteId) {
      setDetail(null);
      setDetailMissing(false);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailMissing(false);

    fetchPublicNote(selectedNoteId)
      .then((publicNote) => {
        if (!cancelled) {
          if (publicNote) {
            setDetail(publicNote);
          } else {
            setDetailMissing(true);
          }
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "公开便签加载失败，请稍后重试。",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNoteId]);

  function handleSelectNote(noteId: string) {
    setSelectedNoteId(noteId);

    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `/public?note=${encodeURIComponent(noteId)}`,
      );
    }
  }

  function handleBackToList() {
    setSelectedNoteId(null);

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/public");
    }
  }

  return (
    <main className="public-notes-page">
      <header className="public-notes-header">
        <div>
          <h1>公开便签</h1>
          <p>登录用户设为「对游客显示」的便签会出现在这里，无需登录即可只读浏览。</p>
        </div>
        <a className="public-notes-enter" href="/">
          进入便签
        </a>
      </header>

      {error ? (
        <p className="public-notes-status" role="alert">
          {error}
        </p>
      ) : null}

      {selectedNoteId ? (
        <PublicNoteReader
          detail={detail}
          missing={detailMissing}
          onClose={handleBackToList}
          onShareRequest={() => setIsPublicShareOpen(true)}
        />
      ) : notes === null ? (
        <p className="public-notes-status">正在加载公开便签…</p>
      ) : notes.length === 0 ? (
        <p className="public-notes-status">
          还没有对游客显示的便签。登录后在便签列表点眼睛按钮，即可把便签显示到这里。
        </p>
      ) : (
        <ul className="public-notes-list">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className="public-notes-card"
                onClick={() => handleSelectNote(note.id)}
              >
                <strong>{note.title}</strong>
                <span className="public-notes-card-preview">{note.preview}</span>
                <span className="public-notes-card-meta">
                  <span>{note.author}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={new Date(note.updatedAt).toISOString()}>
                    {formatPublicNoteTime(note.updatedAt)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isPublicShareOpen && detail ? (
        <PublicSharePanel
          detail={detail}
          onClose={() => setIsPublicShareOpen(false)}
        />
      ) : null}
    </main>
  );
}
