export interface PublicNoteSummary {
  id: string;
  title: string;
  preview: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  publicAt: number;
}

export interface PublicNoteDetail extends PublicNoteSummary {
  markdown: string;
}

export function excludeOwnPublicNotes(
  publicNotes: PublicNoteSummary[],
  ownNoteIds: ReadonlySet<string>,
): PublicNoteSummary[] {
  if (ownNoteIds.size === 0) {
    return publicNotes;
  }

  return publicNotes.filter((note) => !ownNoteIds.has(note.id));
}

export function buildPublicNoteShareUrl(
  origin: string,
  noteId: string,
): string {
  return `${origin}/public?note=${encodeURIComponent(noteId)}`;
}

export function getPublicNoteIdFromSearch(search: string): string | null {
  const noteId = new URLSearchParams(search).get("note");

  return noteId ? noteId : null;
}

export function formatPublicNoteTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePublicNoteSummary(value: unknown): PublicNoteSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.title !== "string" ||
    typeof value.preview !== "string" ||
    typeof value.author !== "string" ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    !isFiniteNumber(value.publicAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    preview: value.preview,
    author: value.author,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    publicAt: value.publicAt,
  };
}

export function parsePublicNotesResponse(value: unknown): PublicNoteSummary[] {
  if (!isRecord(value) || !Array.isArray(value.notes)) {
    return [];
  }

  return value.notes
    .map(parsePublicNoteSummary)
    .filter((note): note is PublicNoteSummary => note !== null);
}

export function parsePublicNoteDetailResponse(
  value: unknown,
): PublicNoteDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = parsePublicNoteSummary(value.note);

  if (!summary || !isRecord(value.note) || typeof value.note.markdown !== "string") {
    return null;
  }

  return { ...summary, markdown: value.note.markdown };
}

export async function fetchPublicNotes(): Promise<PublicNoteSummary[]> {
  const response = await fetch("/api/public/notes", {
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error("公开便签加载失败，请稍后重试。");
  }

  return parsePublicNotesResponse(await response.json());
}

export async function fetchPublicNote(
  noteId: string,
): Promise<PublicNoteDetail | null> {
  const response = await fetch(
    `/api/public/notes/${encodeURIComponent(noteId)}`,
    { credentials: "same-origin" },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("公开便签加载失败，请稍后重试。");
  }

  return parsePublicNoteDetailResponse(await response.json());
}
