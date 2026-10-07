import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSidebar } from "../../src/components/NoteSidebar.js";
import { PublicNoteReader } from "../../src/components/PublicNoteReader.js";
import {
  buildPublicNoteShareUrl,
  getPublicNoteIdFromSearch,
  type PublicNoteDetail,
  type PublicNoteSummary,
} from "../../src/lib/public-notes.js";

const noop = () => undefined;

const sidebarProps = {
  activeNoteId: "own-1",
  categoryLabel: "全部便签",
  isTrashView: false,
  isOpen: true,
  isDesktopCategoryCollapsed: false,
  notes: [],
  searchQuery: "",
  onClose: noop,
  onCreateNote: noop,
  onDeleteNote: noop,
  onPermanentlyDeleteNote: noop,
  onReorderNotes: noop,
  onRestoreNote: noop,
  onSearchQueryChange: noop,
  onSelectNote: noop,
  onTogglePublic: noop,
  onTogglePinned: noop,
  onToggleStarred: noop,
  onToggleDesktopCategory: noop,
};

const publicSummary: PublicNoteSummary = {
  id: "pub-1",
  title: "游客能看的便签",
  preview: "这是摘要",
  author: "jisu",
  createdAt: 1_000,
  updatedAt: 2_000,
  publicAt: 3_000,
};

test("首页便签列表把公开便签混排为普通卡片", () => {
  const html = renderToStaticMarkup(
    createElement(NoteSidebar, {
      ...sidebarProps,
      publicNotes: [publicSummary],
      activePublicNoteId: "pub-1",
      onSelectPublicNote: noop,
    }),
  );

  assert.match(html, /note-list-item note-list-item-public active/);
  assert.match(html, /游客能看的便签/);
  assert.match(html, /jisu · 公开/);
});

test("首页便签列表没有公开便签时不渲染公开卡片", () => {
  const html = renderToStaticMarkup(createElement(NoteSidebar, sidebarProps));

  assert.doesNotMatch(html, /note-list-item-public/);
});

test("公开便签阅读器以主题卡片渲染正文并提供主题与分享入口", () => {
  const detail: PublicNoteDetail = {
    ...publicSummary,
    markdown: "# 游客能看的便签\n\n这是游客正文内容。",
  };
  const html = renderToStaticMarkup(
    createElement(PublicNoteReader, {
      detail,
      missing: false,
      onClose: noop,
    }),
  );

  assert.match(html, /preview-card-theme/);
  assert.match(html, /游客正文内容/);
  assert.match(html, /公开便签 · 只读/);
  assert.match(html, /返回便签列表/);
  assert.match(html, /分享/);
  assert.match(html, /切换预览主题/);
});

test("公开便签阅读器对未公开与加载中给出明确状态", () => {
  const missingHtml = renderToStaticMarkup(
    createElement(PublicNoteReader, {
      detail: null,
      missing: true,
      onClose: noop,
    }),
  );
  assert.match(missingHtml, /这篇便签没有对游客显示/);

  const loadingHtml = renderToStaticMarkup(
    createElement(PublicNoteReader, {
      detail: null,
      missing: false,
      onClose: noop,
    }),
  );
  assert.match(loadingHtml, /正在加载这篇便签/);
});

test("公开便签分享链接与直达参数互相匹配", () => {
  assert.equal(
    buildPublicNoteShareUrl("https://notes.jisu.cn", "a/b c"),
    "https://notes.jisu.cn/public?note=a%2Fb%20c",
  );
  assert.equal(getPublicNoteIdFromSearch("?note=abc-123"), "abc-123");
  assert.equal(getPublicNoteIdFromSearch("?other=1"), null);
  assert.equal(getPublicNoteIdFromSearch("?note="), null);
  assert.equal(getPublicNoteIdFromSearch(""), null);
});
