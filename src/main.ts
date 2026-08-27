import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import frontMatterPlugin from "markdown-it-front-matter";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

// hljs theme CSS as strings, so HTML export can be fully self-contained.
import hljsLightCss from "highlight.js/styles/github.css?inline";
import hljsDarkCss from "highlight.js/styles/github-dark.css?inline";

// ---------- Safe localStorage access (storage can be disabled / full) ----------
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preference just won't persist */
  }
}

// ---------- Color theme (system / light / dark) ----------
type ThemePref = "system" | "light" | "dark";
const systemDarkMQ = window.matchMedia("(prefers-color-scheme: dark)");
let themePref = (lsGet("theme") as ThemePref | null) ?? "system";

// Whether the *effective* theme is dark, given the user's preference.
function currentDark(): boolean {
  return themePref === "dark" || (themePref === "system" && systemDarkMQ.matches);
}

// highlight.js theme is swapped by rewriting this <style> element's contents.
const hljsStyle = document.createElement("style");
hljsStyle.textContent = currentDark() ? hljsDarkCss : hljsLightCss;
document.head.appendChild(hljsStyle);

let lastFrontMatter = "";

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    // Leave mermaid blocks untouched so we can render them lazily later.
    if (lang === "mermaid") {
      return `<pre class="mermaid">${md.utils.escapeHtml(str)}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${
          hljs.highlight(str, { language: lang }).value
        }</code></pre>`;
      } catch {
        /* fall through to plain escaping */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
})
  .use(taskLists, { enabled: true, label: true })
  .use(frontMatterPlugin, (fm: string) => {
    lastFrontMatter = fm;
  });

// Disable setext headings so `text` immediately above `---` / `===` stays a
// paragraph + horizontal rule (the usual intent) instead of becoming a heading
// that pollutes the outline.
md.disable("lheading");

const content = document.getElementById("content") as HTMLElement;
const toc = document.getElementById("toc") as HTMLElement;
const layout = document.getElementById("layout") as HTMLElement;
const tocToggle = document.getElementById("toc-toggle") as HTMLButtonElement;
const editor = document.getElementById("editor") as HTMLTextAreaElement;
const editToggle = document.getElementById("edit-toggle") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const fontInc = document.getElementById("font-inc") as HTMLButtonElement;
const fontDec = document.getElementById("font-dec") as HTMLButtonElement;
const wideToggle = document.getElementById("wide-toggle") as HTMLButtonElement;
const themeToggle = document.getElementById("theme-toggle") as HTMLButtonElement;
const openBtn = document.getElementById("open-btn") as HTMLButtonElement;
const filesBtn = document.getElementById("files-btn") as HTMLButtonElement;
const filesPanel = document.getElementById("files") as HTMLElement;
const findBar = document.getElementById("find-bar") as HTMLElement;
const findInput = document.getElementById("find-input") as HTMLInputElement;
const findCount = document.getElementById("find-count") as HTMLElement;
const closeModal = document.getElementById("close-modal") as HTMLElement;
const closeDocBtn = document.getElementById("close-doc-btn") as HTMLButtonElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const appWindow = getCurrentWindow();
const EMPTY_STATE_HTML = `<div class="empty-state">
  <h1>Supernatural</h1>
  <p>将 <code>.md</code> 文件拖到这里，或<a id="empty-open" href="#">打开一个</a>。</p>
  <p class="app-version"><a id="about-open" href="#">关于 / About</a></p>
  <div id="recent-list"></div>
</div>`;
let closeAction: "window" | "doc" | "switch" = "window";
let pendingSwitchPath: string | null = null;
let currentPath: string | null = null;
let currentText = "";
let editMode = false;
let dirty = false;
let suppressReloadUntil = 0;
let spy: IntersectionObserver | null = null;
let renderSeq = 0; // stale-render guard for overlapping renderMarkdown calls
let openSeq = 0; // stale-open guard for overlapping openFile calls
let filesSeq = 0; // stale-listing guard for overlapping renderFiles calls

// Build the left-hand outline from the rendered headings.
function buildToc(): void {
  spy?.disconnect();
  toc.innerHTML = "";
  const headings = Array.from(
    content.querySelectorAll<HTMLElement>("h1, h2, h3"),
  );

  if (headings.length < 2) {
    layout.classList.remove("has-toc");
    return;
  }
  layout.classList.add("has-toc");

  const links = new Map<string, HTMLAnchorElement>();
  headings.forEach((h, i) => {
    h.id = `h-${i}`;
    const a = document.createElement("a");
    a.href = `#h-${i}`;
    a.textContent = h.textContent ?? "";
    a.className = `toc-link toc-${h.tagName.toLowerCase()}`;
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      // Expand any collapsed <details> the heading lives inside, otherwise it's
      // hidden and scrollIntoView can't reach it (e.g. unclosed <details>).
      let p: HTMLElement | null = h.parentElement;
      while (p && p !== content) {
        if (p instanceof HTMLDetailsElement) p.open = true;
        p = p.parentElement;
      }
      h.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    toc.appendChild(a);
    links.set(h.id, a);
  });

  // Scroll-spy: highlight the heading currently near the top.
  spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          toc.querySelector(".active")?.classList.remove("active");
          const link = links.get(e.target.id);
          link?.classList.add("active");
          link?.scrollIntoView({ block: "nearest" });
        }
      }
    },
    { root: content, rootMargin: "0px 0px -80% 0px", threshold: 0 },
  );
  headings.forEach((h) => spy!.observe(h));
}

// Add a "copy" button to each highlighted code block (skips mermaid diagrams).
function addCopyButtons(): void {
  content
    .querySelectorAll<HTMLPreElement>("pre.hljs")
    .forEach((pre) => {
      if (pre.querySelector(".copy-btn")) return; // already added
      pre.classList.add("has-copy");
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.title = "复制";
      btn.setAttribute("aria-label", "复制代码");
      btn.textContent = "📋";
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const code = pre.querySelector("code")?.textContent ?? "";
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = "✓";
          btn.classList.add("copied");
          window.setTimeout(() => {
            btn.textContent = "📋";
            btn.classList.remove("copied");
          }, 1400);
        } catch {
          toast("复制失败");
        }
      });
      pre.appendChild(btn);
    });
}

// ---------- Resizable table columns (drag the header borders) ----------
const MIN_COL_W = 40;

// Per-file, per-table storage key so column widths are remembered on reopen.
function tableKey(tableIndex: number): string | null {
  if (!currentPath) return null;
  return `colw:${currentPath}::${tableIndex}`;
}
function loadColWidths(tableIndex: number): number[] | null {
  const key = tableKey(tableIndex);
  if (!key) return null;
  try {
    const arr = JSON.parse(lsGet(key) ?? "null");
    return Array.isArray(arr) && arr.every((n) => typeof n === "number")
      ? arr
      : null;
  } catch {
    return null;
  }
}
function saveColWidths(tableIndex: number, widths: number[]): void {
  const key = tableKey(tableIndex);
  if (!key) return;
  lsSet(key, JSON.stringify(widths.map((w) => Math.round(w))));
}

// Give every table a drag handle on each header cell's right edge. The first
// drag (or a stored width) switches the table to a fixed layout with an
// explicit <colgroup>, after which columns can be widened or narrowed freely.
function makeTablesResizable(): void {
  content.querySelectorAll<HTMLTableElement>("table").forEach((table, tIndex) => {
    // Wrap once for horizontal scrolling when columns exceed the viewport.
    if (!table.parentElement?.classList.contains("md-table-wrap")) {
      const wrap = document.createElement("div");
      wrap.className = "md-table-wrap";
      table.parentNode?.insertBefore(wrap, table);
      wrap.appendChild(table);
    }

    const cells = Array.from(
      table.querySelectorAll<HTMLTableCellElement>("thead th"),
    );
    if (cells.length < 1) return;

    const getColgroup = (): HTMLElement => {
      let cg = table.querySelector("colgroup");
      if (!cg) {
        cg = document.createElement("colgroup");
        for (let i = 0; i < cells.length; i++) {
          cg.appendChild(document.createElement("col"));
        }
        table.insertBefore(cg, table.firstChild);
      }
      return cg as HTMLElement;
    };

    const applyFixed = (widths: number[]): void => {
      const cols = Array.from(getColgroup().children) as HTMLElement[];
      widths.forEach((w, i) => {
        if (cols[i]) cols[i].style.width = `${w}px`;
      });
      table.classList.add("resizable");
      table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
    };

    // Restore remembered widths (only if the column count still matches).
    const stored = loadColWidths(tIndex);
    if (stored && stored.length === cells.length) applyFixed(stored);

    const ensureFixed = (): void => {
      if (table.classList.contains("resizable")) return;
      applyFixed(cells.map((c) => c.getBoundingClientRect().width));
    };

    cells.forEach((th, i) => {
      th.classList.add("has-resizer");
      const handle = document.createElement("div");
      handle.className = "col-resizer";
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ensureFixed();
        const cols = Array.from(getColgroup().children) as HTMLElement[];
        const startX = e.clientX;
        const startW =
          parseFloat(cols[i].style.width) ||
          cells[i].getBoundingClientRect().width;
        document.body.classList.add("col-resizing");
        const onMove = (me: MouseEvent): void => {
          const w = Math.max(MIN_COL_W, startW + (me.clientX - startX));
          cols[i].style.width = `${w}px`;
          table.style.width = `${cols.reduce(
            (a, c) => a + (parseFloat(c.style.width) || 0),
            0,
          )}px`;
        };
        const onUp = (): void => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          document.body.classList.remove("col-resizing");
          saveColWidths(
            tIndex,
            cols.map((c) => parseFloat(c.style.width) || 0),
          );
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
      th.appendChild(handle);
    });
  });
}

// Resolve relative-path images against the open file's folder via the asset protocol.
function resolveImages(): void {
  if (!currentPath) return;
  const dir = currentPath.replace(/[\\/][^\\/]*$/, "");
  content.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    // Skip absolute URLs (http:, data:, asset:, file:, …) and protocol-relative.
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return;
    // Remember the original reference so an HTML export can restore it — a
    // converted asset:// URL is meaningless outside the app.
    img.dataset.origSrc = src;
    // Markdown encodes spaces etc. as %20, the filesystem doesn't have them.
    let rel = src;
    try {
      rel = decodeURIComponent(src);
    } catch {
      /* malformed percent-encoding — try the raw value */
    }
    const abs = `${dir}/${rel}`.replace(/\\/g, "/");
    img.src = convertFileSrc(abs);
  });
}

function formatFmValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function buildFmCard(data: Record<string, unknown>): HTMLElement | null {
  const card = document.createElement("div");
  card.className = "fm-card";
  const used = new Set<string>();

  if (typeof data.title === "string" && data.title.trim()) {
    const t = document.createElement("div");
    t.className = "fm-title";
    t.textContent = data.title;
    card.appendChild(t);
  }
  used.add("title");

  if (typeof data.description === "string" && data.description.trim()) {
    const d = document.createElement("div");
    d.className = "fm-desc";
    d.textContent = data.description;
    card.appendChild(d);
  }
  used.add("description");

  const meta = document.createElement("div");
  meta.className = "fm-meta";
  const dateVal = data.pubDate ?? data.date ?? data.published;
  ["pubDate", "date", "published"].forEach((k) => used.add(k));
  if (dateVal) {
    const s = document.createElement("span");
    s.className = "fm-chip fm-date";
    s.textContent = `📅 ${formatFmValue(dateVal)}`;
    meta.appendChild(s);
  }
  used.add("tags");
  if (Array.isArray(data.tags)) {
    data.tags.forEach((tag) => {
      const c = document.createElement("span");
      c.className = "fm-chip fm-tag";
      c.textContent = `#${String(tag)}`;
      meta.appendChild(c);
    });
  }
  used.add("draft");
  if (data.draft === true) {
    const b = document.createElement("span");
    b.className = "fm-chip fm-badge";
    b.textContent = "Draft";
    meta.appendChild(b);
  }
  if (meta.childNodes.length) card.appendChild(meta);

  const rest = Object.keys(data).filter((k) => {
    if (used.has(k)) return false;
    const v = data[k];
    if (v === null || v === "" || v === undefined) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (rest.length) {
    const dl = document.createElement("dl");
    dl.className = "fm-dl";
    rest.forEach((k) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = formatFmValue(data[k]);
      dl.append(dt, dd);
    });
    card.appendChild(dl);
  }

  return card.childNodes.length ? card : null;
}

// Parse YAML front matter (lazy-loaded) and prepend a metadata card.
async function renderFrontMatter(): Promise<void> {
  if (!lastFrontMatter.trim()) return;
  try {
    const yaml = await import("js-yaml");
    const data = yaml.load(lastFrontMatter);
    if (!data || typeof data !== "object") return;
    const card = buildFmCard(data as Record<string, unknown>);
    if (card) content.prepend(card);
  } catch (e) {
    console.error("front matter parse failed", e);
  }
}

async function renderMarkdown(
  text: string,
  preserveScroll = false,
  scrollFrac?: number,
): Promise<void> {
  // A newer render supersedes this one: every `await` below re-checks the
  // token so a slow (mermaid / front-matter) render can never clobber the
  // DOM or scroll position of a newer render.
  const seq = ++renderSeq;
  // Restore by scroll *fraction*, not absolute pixels: the preview column is
  // only half as wide in edit mode, so the same document reflows to very
  // different heights between modes — absolute offsets land far away from the
  // text the user was looking at. Callers that flip the layout class (i.e.
  // setEditMode) pass the fraction in, captured BEFORE the reflow.
  const maxBefore = content.scrollHeight - content.clientHeight;
  const fracBefore =
    scrollFrac ?? (maxBefore > 0 ? content.scrollTop / maxBefore : 0);
  // Pause scroll-sync while the preview is rebuilt: resetting innerHTML
  // briefly clamps content.scrollTop to 0, and the scroll event that fires
  // mid-render (during the awaits below) would otherwise drag the editor
  // straight back to the top on every keystroke.
  previewRendering = true;
  try {
    lastFrontMatter = "";
    // Sanitize rendered HTML to neutralise scripts / event handlers in untrusted docs.
    content.innerHTML = DOMPurify.sanitize(md.render(text), {
      ADD_TAGS: ["pre"],
      ADD_ATTR: ["class"],
    });
    await renderFrontMatter();
    if (seq !== renderSeq) return;
    resolveImages();
    addCopyButtons();
    makeTablesResizable();
    buildToc();

    // Lazily pull in mermaid only when a diagram is actually present.
    const diagrams = content.querySelectorAll<HTMLElement>("pre.mermaid");
    if (diagrams.length > 0) {
      const mermaid = (await import("mermaid")).default;
      if (seq !== renderSeq) return;
      // Re-initialise each render so diagrams follow the current theme.
      mermaid.initialize({
        startOnLoad: false,
        theme: currentDark() ? "dark" : "default",
        securityLevel: "strict",
      });
      try {
        await mermaid.run({ nodes: Array.from(diagrams) });
      } catch (e) {
        console.error("mermaid render failed", e);
      }
      if (seq !== renderSeq) return;
      // Click a rendered diagram to open it in the zoom/pan lightbox.
      diagrams.forEach((pre) => {
        const svg = pre.querySelector("svg");
        if (!svg) return;
        pre.classList.add("mermaid-zoomable");
        pre.addEventListener("click", () => openDiagram(svg));
      });
    }

    // New documents start at the top; only hot-reload / live-edit keep position.
    const maxAfter = content.scrollHeight - content.clientHeight;
    content.scrollTop = preserveScroll ? fracBefore * maxAfter : 0;
  } finally {
    // Keep sync paused until the scroll event queued by the restore above has
    // been dispatched, and flush any stale echo entries, so a re-render never
    // yanks the editor around or swallows the next real scroll.
    requestAnimationFrame(() => {
      if (seq === renderSeq) {
        previewRendering = false;
        syncEcho.clear();
      }
    });
  }
}

function setTitle(): void {
  const name = currentPath?.split(/[\\/]/).pop() ?? "Supernatural";
  document.title = `${dirty ? "● " : ""}${name} — Supernatural`;
  saveBtn.hidden = !editMode;
  saveBtn.disabled = !dirty;
  saveBtn.textContent = dirty ? "💾 保存*" : "💾 已保存";
  closeDocBtn.hidden = !currentPath;
}

// Close the current document and return to the home / empty-state screen.
function goHome(): void {
  currentPath = null;
  currentText = "";
  dirty = false;
  if (editMode) {
    editMode = false;
    layout.classList.remove("mode-edit");
    editToggle.textContent = "✎ 编辑";
  }
  content.innerHTML = EMPTY_STATE_HTML;
  buildToc();
  renderRecents();
  if (filesOpen) void renderFiles(null);
  setTitle();
}

async function openFile(
  path: string,
  watch = true,
  preserveScroll = false,
): Promise<void> {
  const seq = ++openSeq;
  try {
    const text = await invoke<string>("read_md", { path });
    if (seq !== openSeq) return;
    currentPath = path;
    currentText = text;
    dirty = false;
    addRecent(path);
    if (editMode) {
      // Assigning .value resets the textarea's scroll and caret to the top —
      // keep the user's viewport (clamped to the new text length) instead.
      const st = editor.scrollTop;
      const pos = Math.min(editor.selectionStart, text.length);
      editor.value = text;
      editor.scrollTop = st;
      editor.setSelectionRange(pos, pos);
    }
    setTitle();
    await renderMarkdown(text, preserveScroll);
    if (watch) {
      try {
        await invoke("watch_file", { path });
      } catch (e) {
        // The document is open — a failed watcher only disables hot reload.
        toast(`文件监听失败: ${String(e)}`);
      }
    }
    if (filesOpen) void renderFiles(dirOf(path));
  } catch (e) {
    if (seq !== openSeq) return;
    content.innerHTML = `<div class="empty-state"><p>${md.utils.escapeHtml(String(e))}</p></div>`;
    buildToc();
  }
}

// ---------- Edit mode + live preview ----------

let previewTimer: number | undefined;
function schedulePreview(): void {
  dirty = editor.value !== currentText;
  setTitle();
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    // Leaving edit mode renders directly; a stale debounce firing after that
    // would re-render mid-transition with a clamped (≈0) scroll offset and
    // fling the preview to the top of the document.
    if (!editMode) return;
    void renderMarkdown(editor.value, true);
  }, 180);
}

function setEditMode(on: boolean): void {
  // A deliberate mode toggle ends the caret-snap watch: the editor mirror
  // below scrolls the textarea on purpose and must never be "reverted".
  snapWatchUntil = 0;
  // Capture the preview's scroll fraction BEFORE flipping the layout class:
  // toggling .mode-edit resizes the preview column, and any offset read after
  // the toggle refers to an already-reflowed (wrong) geometry. The editor and
  // preview are kept ratio-synced, so if the two disagree beyond sync
  // tolerance the preview's offset is stale (a caret-reveal / render race
  // dragged it mid-frame) — trust the editor, which is where the user is.
  const eMax = editor.scrollHeight - editor.clientHeight;
  const eFrac = eMax > 0 ? editor.scrollTop / eMax : 0;
  const max = content.scrollHeight - content.clientHeight;
  let frac = max > 0 ? content.scrollTop / max : 0;
  if (editMode && Math.abs(eFrac - frac) > 0.2) frac = eFrac;
  editMode = on;
  layout.classList.toggle("mode-edit", on);
  editToggle.textContent = on ? "👁 预览" : "✎ 编辑";
  if (on) {
    // Only reload from the saved snapshot when there are no unsaved edits;
    // otherwise entering edit mode would wipe the user's unsaved buffer
    // (worst case: a freshly-opened empty file loses everything typed).
    if (!dirty && editor.value !== currentText) editor.value = currentText;
    // Start the editor where the preview currently is, so the text the user
    // was reading stays in view instead of jumping back to the very top.
    let pos = Math.round(frac * editor.value.length);
    if (pos > 0) {
      // Snap to the start of a line so the caret lands on real text.
      const nl = editor.value.lastIndexOf("\n", pos);
      pos = nl === -1 ? 0 : nl + 1;
    }
    editor.focus();
    editor.setSelectionRange(pos, pos);
    // Mirror the scroll silently: register the echo first so the programmatic
    // write doesn't bounce straight back into the scroll-sync logic.
    syncEcho.add(editor);
    const eSpan = editor.scrollHeight - editor.clientHeight;
    editor.scrollTop = frac * eSpan;
    // The preview column just got narrower and reflowed taller — re-anchor it
    // to the editor's actual landing fraction (the mirror write above is the
    // single source of truth), or the two panes can drift apart in a race
    // with a pending re-render.
    const anchorFrac = eSpan > 0 ? editor.scrollTop / eSpan : frac;
    syncEcho.add(content);
    const maxNarrow = content.scrollHeight - content.clientHeight;
    content.scrollTop = anchorFrac * maxNarrow;
  } else {
    // Leaving edit mode: render the latest source at the captured position.
    window.clearTimeout(previewTimer);
    void renderMarkdown(editor.value, true, frac);
  }
  setTitle();
}

function toggleEdit(): void {
  if (!currentPath) {
    toast("请先打开一个 Markdown 文件");
    return;
  }
  setEditMode(!editMode);
}

async function save(): Promise<boolean> {
  if (!currentPath || !dirty) return true;
  try {
    // Ignore the watcher event our own write is about to trigger.
    suppressReloadUntil = Date.now() + 1000;
    await invoke("write_md", { path: currentPath, content: editor.value });
    currentText = editor.value;
    dirty = false;
    setTitle();
    return true;
  } catch (e) {
    console.error("save failed", e);
    toast(`保存失败: ${String(e)}`);
    return false;
  }
}

editToggle.addEventListener("click", toggleEdit);

// Native textareas scroll the caret into view on every edit: pressing Enter
// (or any key) while the caret is scrolled out of sight — the user wheel-
// scrolled elsewhere to read — yanks the editor back to the caret and the
// scroll-sync drags the preview along, so the text they were looking at
// suddenly disappears. Undo that snap: a legit reveal (typing at the edge of
// the viewport) only ever moves the view a line or two; anything larger is a
// jump to a far-away caret and gets reverted, so the view stays put (the edit
// itself still lands at the caret, exactly like VSCode).
let preInputScroll = 0;
let snapWatchUntil = 0;
editor.addEventListener("beforeinput", () => {
  preInputScroll = editor.scrollTop;
});
// Native textareas scroll the caret into view on every edit. When the caret
// is scrolled far out of sight (the user wheel-scrolled elsewhere to read),
// that yanks the editor back to the caret and scroll-sync drags the preview
// along — the text they were looking at disappears. Undo the jump instead
// (VSCode behaves the same): the edit still lands at the caret, off-screen.
// The reveal can land asynchronously — even animated, frame by frame — so
// watch the editor's scroll events for a short window after each input and
// revert any single jump bigger than a legitimate at-the-edge reveal. Small
// deltas are adopted as the new baseline, so genuine user scrolling right
// after typing is never fought.
function revertCaretSnap(): void {
  if (Math.abs(editor.scrollTop - preInputScroll) <= editor.clientHeight * 0.25) {
    // Small move (normal reveal / user wheel): adopt it as the new baseline.
    preInputScroll = editor.scrollTop;
    return;
  }
  syncEcho.add(editor); // restore silently — don't drag the preview along
  editor.scrollTop = preInputScroll;
  // The reveal's scroll event already dragged the preview via scroll-sync
  // before this revert ran — re-anchor it at the same fraction as the editor.
  const eMax = editor.scrollHeight - editor.clientHeight;
  const frac = eMax > 0 ? editor.scrollTop / eMax : 0;
  const cMax = content.scrollHeight - content.clientHeight;
  syncEcho.add(content);
  content.scrollTop = frac * cMax;
}
editor.addEventListener("scroll", () => {
  if (Date.now() < snapWatchUntil) revertCaretSnap();
});
editor.addEventListener("input", () => {
  schedulePreview();
  snapWatchUntil = Date.now() + 400;
  revertCaretSnap();
});
saveBtn.addEventListener("click", () => void save());

// ---------- Toast ----------
let toastTimer: number | undefined;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2800);
}

// ---------- Export to standalone HTML (with TOC sidebar) ----------
const EXPORT_CSS = `
:root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--code-bg:#f6f8fa;--accent:#0969da;--stripe:#f6f8fa}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--border:#30363d;--code-bg:#161b22;--accent:#2f81f7;--stripe:#161b22}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;display:flex;align-items:flex-start}
.toc{flex:0 0 264px;width:264px;position:sticky;top:0;max-height:100vh;overflow:auto;padding:24px 12px 40px;border-right:1px solid var(--border);font-size:13.5px;line-height:1.5}
.toc a{display:block;padding:3px 10px;margin:1px 0;color:var(--muted);text-decoration:none;border-left:2px solid transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toc a:hover{color:var(--fg);background:var(--code-bg)}
.toc .l1{font-weight:600}.toc .l2{padding-left:22px}.toc .l3{padding-left:34px;font-size:13px}
.markdown-body{flex:1;min-width:0;max-width:860px;margin:0 auto;padding:32px 40px 80px;word-wrap:break-word}
.markdown-body h1,.markdown-body h2{border-bottom:1px solid var(--border);padding-bottom:.3em}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{margin-top:1.4em;margin-bottom:.6em;font-weight:600;line-height:1.25}
.markdown-body a{color:var(--accent);text-decoration:none}.markdown-body a:hover{text-decoration:underline}
.markdown-body code{background:var(--code-bg);padding:.2em .4em;border-radius:6px;font-size:85%;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.markdown-body pre{background:var(--code-bg);padding:16px;border-radius:8px;overflow:auto;line-height:1.45}
.markdown-body pre code{background:transparent;padding:0;font-size:90%}
.markdown-body blockquote{margin:0;padding:0 1em;color:var(--muted);border-left:4px solid var(--border)}
.markdown-body table{border-collapse:collapse;display:block;width:max-content;max-width:100%;overflow:auto;margin:1em 0}
.markdown-body th,.markdown-body td{border:1px solid var(--border);padding:6px 13px}
.markdown-body tr:nth-child(2n){background:var(--stripe)}
.markdown-body img{max-width:100%}
.markdown-body hr{border:none;border-top:1px solid var(--border);margin:1.6em 0}
.markdown-body .task-list-item{list-style:none}
.markdown-body .task-list-item input{margin:0 .4em .25em -1.4em}
.markdown-body pre.mermaid{background:transparent;text-align:center;padding:8px 0}
`;

function buildExportHtml(): string {
  // Clone so we don't mutate the live DOM.
  const article = content.cloneNode(true) as HTMLElement;
  // Local images were rewritten to asset:// for in-app display; an exported
  // file must reference them the way the source document did.
  article
    .querySelectorAll<HTMLImageElement>("img[data-orig-src]")
    .forEach((img) => {
      img.setAttribute("src", img.dataset.origSrc ?? "");
      delete img.dataset.origSrc;
    });
  // Copy buttons are UI-only — strip them from the exported document.
  article.querySelectorAll(".copy-btn").forEach((b) => b.remove());
  // Strip column-resize scaffolding so exported tables use the default layout.
  article.querySelectorAll(".col-resizer").forEach((h) => h.remove());
  article.querySelectorAll<HTMLTableElement>("table.resizable").forEach((t) => {
    t.classList.remove("resizable");
    t.removeAttribute("style");
    t.querySelector("colgroup")?.remove();
  });
  article.querySelectorAll(".md-table-wrap").forEach((w) => {
    const t = w.querySelector("table");
    if (t) w.replaceWith(t);
  });
  const headings = Array.from(
    article.querySelectorAll<HTMLElement>("h1, h2, h3"),
  );

  let tocHtml = "";
  if (headings.length >= 2) {
    const items = headings
      .map((h, i) => {
        if (!h.id) h.id = `h-${i}`;
        const level = h.tagName.toLowerCase().replace("h", "l");
        const label = (h.textContent ?? "").replace(/[<>&]/g, "");
        return `<a class="${level}" href="#${h.id}">${label}</a>`;
      })
      .join("\n");
    tocHtml = `<nav class="toc">\n${items}\n</nav>\n`;
  }

  const title = md.utils.escapeHtml(currentPath?.split(/[\\/]/).pop()?.replace(/\.(md|markdown)$/i, "") ?? "Document");
  const themeCss = currentDark() ? hljsDarkCss : hljsLightCss;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${EXPORT_CSS}</style>
<style>${themeCss}</style>
</head>
<body>
${tocHtml}<article class="markdown-body">
${article.innerHTML}
</article>
</body>
</html>`;
}

async function exportHtml(): Promise<void> {
  if (!currentPath) {
    toast("没有打开的文件");
    return;
  }
  try {
    // Make sure the preview reflects the latest source (e.g. while editing).
    if (editMode) await renderMarkdown(editor.value, true);
    const base = currentPath.replace(/\.(md|markdown)$/i, "");
    const out = `${base}.html`;
    await invoke("write_md", { path: out, content: buildExportHtml() });
    toast(`已导出 ${out.split(/[\\/]/).pop()}`);
  } catch (e) {
    toast(`导出失败: ${String(e)}`);
  }
}

exportBtn.addEventListener("click", () => void exportHtml());

// ---------- Synced scrolling (editor <-> preview) ----------
// Writing `to.scrollTop` fires a scroll event on `to`; without a guard the
// two listeners bounce the position back and forth, and because scrollTop
// is rounded to whole pixels each round trip loses a fraction of a pixel —
// the view visibly creeps towards the top on its own. Swallow exactly one
// echo per programmatic write instead of relying on rAF timing.
const syncEcho = new Set<HTMLElement>();
let previewRendering = false;
function syncScroll(from: HTMLElement, to: HTMLElement): void {
  // Consume the echo FIRST: a scroll event raised by a programmatic write
  // must be swallowed even while a preview render is pausing sync, otherwise
  // a stale entry would eat the next real user scroll.
  if (syncEcho.has(from)) {
    syncEcho.delete(from);
    return;
  }
  if (!editMode || previewRendering) return;
  const max = from.scrollHeight - from.clientHeight;
  const ratio = max > 0 ? from.scrollTop / max : 0;
  const target = ratio * (to.scrollHeight - to.clientHeight);
  // Ignore sub-pixel differences so rounding can't start an echo chain.
  if (Math.abs(to.scrollTop - target) < 1) return;
  syncEcho.add(to);
  to.scrollTop = target;
}
editor.addEventListener("scroll", () => syncScroll(editor, content));
content.addEventListener("scroll", () => syncScroll(content, editor));

// ---------- Close confirmation when there are unsaved changes ----------
function showCloseModal(): void {
  closeModal.hidden = false;
}
function hideCloseModal(): void {
  closeModal.hidden = true;
  closeAction = "window";
  pendingSwitchPath = null;
}
(document.getElementById("modal-cancel") as HTMLButtonElement).addEventListener(
  "click",
  hideCloseModal,
);
function finishClose(): void {
  dirty = false;
  if (closeAction === "doc") {
    goHome();
  } else if (closeAction === "switch") {
    if (pendingSwitchPath) void openFile(pendingSwitchPath);
  } else {
    void appWindow.destroy();
  }
}
(document.getElementById("modal-discard") as HTMLButtonElement).addEventListener(
  "click",
  () => {
    hideCloseModal();
    finishClose();
  },
);
(document.getElementById("modal-save") as HTMLButtonElement).addEventListener(
  "click",
  async () => {
    if (await save()) {
      hideCloseModal();
      finishClose();
    }
  },
);

// Close the current document (back to home), confirming if there are edits.
closeDocBtn.addEventListener("click", () => {
  if (dirty) {
    closeAction = "doc";
    showCloseModal();
  } else {
    goHome();
  }
});

// Content font scaling (persisted).
let fontScale = parseFloat(lsGet("fontScale") ?? "1") || 1;
function applyFontScale(): void {
  fontScale = Math.min(2.6, Math.max(0.6, Math.round(fontScale * 10) / 10));
  document.documentElement.style.setProperty("--content-scale", String(fontScale));
  lsSet("fontScale", String(fontScale));
}
function bumpFont(delta: number): void {
  fontScale += delta;
  applyFontScale();
}
fontInc.addEventListener("click", () => bumpFont(0.1));
fontDec.addEventListener("click", () => bumpFont(-0.1));
applyFontScale();

// Wide-content mode: fill the available width instead of the centered column.
// Defaults to wide when the user has no saved preference yet.
let wideContent = (lsGet("wideContent") ?? "true") === "true";
function applyWide(): void {
  layout.classList.toggle("wide-content", wideContent);
  wideToggle.classList.toggle("on", wideContent);
  lsSet("wideContent", String(wideContent));
}
function toggleWide(): void {
  wideContent = !wideContent;
  applyWide();
}
wideToggle.addEventListener("click", toggleWide);
applyWide();

// Cycle the color theme: system → light → dark → system.
const THEME_ICON: Record<ThemePref, string> = {
  system: "🖥️",
  light: "☀️",
  dark: "🌙",
};
const THEME_TITLE: Record<ThemePref, string> = {
  system: "主题：跟随系统（点击切换）",
  light: "主题：亮色（点击切换）",
  dark: "主题：暗色（点击切换）",
};
function applyTheme(): void {
  document.documentElement.dataset.theme = themePref;
  hljsStyle.textContent = currentDark() ? hljsDarkCss : hljsLightCss;
  themeToggle.textContent = THEME_ICON[themePref];
  themeToggle.title = THEME_TITLE[themePref];
  lsSet("theme", themePref);
  // Re-render the open document so mermaid diagrams pick up the new theme
  // (highlighted code recolors automatically via the swapped <style>).
  if (currentPath) {
    void renderMarkdown(editMode ? editor.value : currentText, true);
  }
}
function cycleTheme(): void {
  themePref =
    themePref === "system" ? "light" : themePref === "light" ? "dark" : "system";
  applyTheme();
}
themeToggle.addEventListener("click", cycleTheme);
// Follow live OS theme changes while in "system" mode.
systemDarkMQ.addEventListener("change", () => {
  if (themePref === "system") applyTheme();
});
applyTheme();

// ---------- Settings: reading font (separate Latin + CJK) ----------
// Each option is a fallback stack; unavailable fonts degrade gracefully, and
// the browser's last-resort fallback still renders glyphs a font lacks.
interface FontOption {
  id: string;
  label: string;
  stack: string; // families only (no generic); empty = system default
  generic?: string; // appended after the CJK families
}
const DEFAULT_LATIN_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial';
const LATIN_FONTS: FontOption[] = [
  { id: "system", label: "系统默认 Sans", stack: DEFAULT_LATIN_STACK, generic: "sans-serif" },
  { id: "serif", label: "Serif (Georgia)", stack: 'Georgia, "Times New Roman"', generic: "serif" },
  { id: "helvetica", label: "Helvetica / Arial", stack: "Helvetica, Arial", generic: "sans-serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva", generic: "sans-serif" },
  { id: "mono", label: "等宽 Mono", stack: "ui-monospace, Consolas", generic: "monospace" },
];
const CJK_FONTS: FontOption[] = [
  { id: "system", label: "系统默认", stack: "" },
  { id: "jhenghei", label: "微软雅黑", stack: '"Microsoft JhengHei", "Microsoft YaHei"' },
  { id: "pingfang", label: "苹方 PingFang", stack: '"PingFang TC", "PingFang SC"' },
  { id: "notosans", label: "思源黑体 Noto Sans", stack: '"Noto Sans TC", "Noto Sans CJK TC"' },
  { id: "notoserif", label: "思源宋体 Noto Serif", stack: '"Noto Serif TC", "Noto Serif CJK TC"' },
  { id: "kai", label: "楷体", stack: '"DFKai-SB", "BiauKai", "Kaiti TC"' },
];

const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsModal = document.getElementById("settings-modal") as HTMLElement;
const fontLatinSel = document.getElementById("font-latin") as HTMLSelectElement;
const fontCjkSel = document.getElementById("font-cjk") as HTMLSelectElement;
const fontLatinCustomEl = document.getElementById("font-latin-custom") as HTMLInputElement;
const fontCjkCustomEl = document.getElementById("font-cjk-custom") as HTMLInputElement;
const fontList = document.getElementById("font-list") as HTMLDataListElement;

function fillFontSelect(sel: HTMLSelectElement, opts: FontOption[]): void {
  opts.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  // "Custom" lets the user type any installed font family by name.
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "自定义… / Custom…";
  sel.appendChild(custom);
}
fillFontSelect(fontLatinSel, LATIN_FONTS);
fillFontSelect(fontCjkSel, CJK_FONTS);

let fontLatinId = lsGet("fontLatin") ?? "system";
let fontCjkId = lsGet("fontCjk") ?? "system";
let fontLatinCustom = lsGet("fontLatinCustom") ?? "";
let fontCjkCustom = lsGet("fontCjkCustom") ?? "";

// Turn a typed font name into a CSS family fragment (quote it unless the user
// already typed a comma-separated stack of their own).
function toFamily(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return t.includes(",") ? t : `"${t.replace(/["']/g, "")}"`;
}

function applyReadingFont(): void {
  const latin = LATIN_FONTS.find((f) => f.id === fontLatinId) ?? LATIN_FONTS[0];
  const latinStack = fontLatinId === "custom" ? toFamily(fontLatinCustom) : latin.stack;
  const latinGeneric = fontLatinId === "custom" ? "sans-serif" : latin.generic ?? "sans-serif";
  const cjkStack =
    fontCjkId === "custom"
      ? toFamily(fontCjkCustom)
      : (CJK_FONTS.find((f) => f.id === fontCjkId) ?? CJK_FONTS[0]).stack;

  const parts = [latinStack, cjkStack, latinGeneric,
    '"Apple Color Emoji"', '"Segoe UI Emoji"'].filter(Boolean);
  document.documentElement.style.setProperty("--reading-font", parts.join(", "));

  fontLatinSel.value = fontLatinId;
  fontCjkSel.value = fontCjkId;
  fontLatinCustomEl.hidden = fontLatinId !== "custom";
  fontCjkCustomEl.hidden = fontCjkId !== "custom";
  fontLatinCustomEl.value = fontLatinCustom;
  fontCjkCustomEl.value = fontCjkCustom;

  lsSet("fontLatin", fontLatinId);
  lsSet("fontCjk", fontCjkId);
  lsSet("fontLatinCustom", fontLatinCustom);
  lsSet("fontCjkCustom", fontCjkCustom);
}
fontLatinSel.addEventListener("change", () => {
  fontLatinId = fontLatinSel.value;
  applyReadingFont();
  if (fontLatinId === "custom") fontLatinCustomEl.focus();
});
fontCjkSel.addEventListener("change", () => {
  fontCjkId = fontCjkSel.value;
  applyReadingFont();
  if (fontCjkId === "custom") fontCjkCustomEl.focus();
});
fontLatinCustomEl.addEventListener("input", () => {
  fontLatinCustom = fontLatinCustomEl.value;
  applyReadingFont();
});
fontCjkCustomEl.addEventListener("input", () => {
  fontCjkCustom = fontCjkCustomEl.value;
  applyReadingFont();
});
(document.getElementById("settings-reset") as HTMLButtonElement).addEventListener(
  "click",
  () => {
    fontLatinId = "system";
    fontCjkId = "system";
    fontLatinCustom = "";
    fontCjkCustom = "";
    applyReadingFont();
  },
);

// Populate the autocomplete list with actually-installed fonts (once). Uses the
// Local Font Access API — available on WebView2/Windows; on WKWebView (macOS)
// and WebKitGTK (Linux) it's absent, so users just type the name manually.
let fontsQueried = false;
async function populateInstalledFonts(): Promise<void> {
  if (fontsQueried) return;
  fontsQueried = true;
  const query = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> })
    .queryLocalFonts;
  if (typeof query !== "function") return;
  try {
    const fonts = await query();
    const seen = new Set<string>();
    for (const f of fonts) {
      if (f.family && !seen.has(f.family)) {
        seen.add(f.family);
        const o = document.createElement("option");
        o.value = f.family;
        fontList.appendChild(o);
      }
    }
  } catch {
    /* unsupported or permission denied — manual typing still works */
  }
}

function openSettings(): void {
  settingsModal.hidden = false;
  void populateInstalledFonts();
}
function closeSettings(): void {
  settingsModal.hidden = true;
}
settingsBtn.addEventListener("click", openSettings);
(document.getElementById("settings-close") as HTMLButtonElement).addEventListener(
  "click",
  closeSettings,
);
// Click the dimmed backdrop (outside the box) to dismiss.
settingsModal.addEventListener("click", (ev) => {
  if (ev.target === settingsModal) closeSettings();
});
applyReadingFont();

// ---------- About dialog (version info) ----------
const aboutModal = document.getElementById("about-modal") as HTMLElement;
const aboutVersion = document.getElementById("about-version") as HTMLElement;
aboutVersion.textContent = `v${__APP_VERSION__}`;
document.getElementById("about-close")?.addEventListener("click", () => {
  aboutModal.hidden = true;
});

// ---------- Open file dialog + recent files ----------
// Open a file, asking for confirmation first when there are unsaved edits.
function requestOpen(path: string): void {
  if (!path || path === currentPath) return;
  if (dirty) {
    closeAction = "switch";
    pendingSwitchPath = path;
    showCloseModal();
  } else {
    void openFile(path);
  }
}

async function openViaDialog(): Promise<void> {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (typeof selected === "string") requestOpen(selected);
  } catch (e) {
    console.error("open dialog failed", e);
  }
}
openBtn.addEventListener("click", () => void openViaDialog());
// Delegated so the empty-state links keep working after goHome() rebuilds them.
content.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  if (target.closest("#empty-open")) {
    ev.preventDefault();
    void openViaDialog();
  } else if (target.closest("#about-open")) {
    ev.preventDefault();
    aboutModal.hidden = false;
  }
});

function getRecents(): string[] {
  try {
    return JSON.parse(lsGet("recents") ?? "[]") as string[];
  } catch {
    return [];
  }
}
function addRecent(path: string): void {
  const list = getRecents().filter((p) => p !== path);
  list.unshift(path);
  lsSet("recents", JSON.stringify(list.slice(0, 8)));
}
function renderRecents(): void {
  const host = document.getElementById("recent-list");
  if (!host) return;
  host.innerHTML = "";
  const list = getRecents();
  if (!list.length) return;
  const h = document.createElement("h3");
  h.textContent = "最近打开";
  host.appendChild(h);
  list.forEach((p) => {
    const a = document.createElement("a");
    a.className = "recent-item";
    a.href = "#";
    const name = document.createElement("span");
    name.className = "rf-name";
    name.textContent = p.split(/[\\/]/).pop() ?? p;
    const full = document.createElement("span");
    full.className = "rf-path";
    full.textContent = p;
    a.append(name, full);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      requestOpen(p);
    });
    host.appendChild(a);
  });
}

// ---------- File explorer panel ----------
interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}
interface DirListing {
  dir: string;
  parent: string | null;
  entries: DirEntry[];
}

let filesOpen = lsGet("filesOpen") === "true";

function dirOf(p: string): string {
  return p.replace(/[\\/][^\\/]*$/, "");
}

function fileRow(
  label: string,
  icon: string,
  onClick: () => void,
  opts: { active?: boolean; muted?: boolean; onContext?: (ev: MouseEvent) => void } = {},
): HTMLElement {
  const a = document.createElement("a");
  a.className = "file-item";
  if (opts.active) a.classList.add("active");
  if (opts.muted) a.classList.add("muted");
  a.href = "#";
  const ic = document.createElement("span");
  ic.className = "fi-icon";
  ic.textContent = icon;
  const nm = document.createElement("span");
  nm.className = "fi-name";
  nm.textContent = label;
  a.append(ic, nm);
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    onClick();
  });
  if (opts.onContext) a.addEventListener("contextmenu", opts.onContext);
  return a;
}

// Right-click context menu for files.
let fileMenuEl: HTMLElement | null = null;
function closeFileMenu(): void {
  fileMenuEl?.remove();
  fileMenuEl = null;
}
function showFileMenu(ev: MouseEvent, path: string): void {
  ev.preventDefault();
  closeFileMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  const item = document.createElement("button");
  item.textContent = "在新窗口打开";
  item.addEventListener("click", () => {
    closeFileMenu();
    void invoke("open_new_window", { path });
  });
  menu.appendChild(item);
  document.body.appendChild(menu);
  // Keep within the viewport.
  const mw = 180;
  menu.style.left = `${Math.min(ev.clientX, window.innerWidth - mw)}px`;
  menu.style.top = `${ev.clientY}px`;
  fileMenuEl = menu;
}
window.addEventListener("click", closeFileMenu);
window.addEventListener("blur", closeFileMenu);

async function renderFiles(dir: string | null): Promise<void> {
  const seq = ++filesSeq;
  if (!dir) {
    filesPanel.innerHTML = "";
    const hint = document.createElement("div");
    hint.className = "files-hint";
    hint.textContent = "打开文件后可浏览其目录";
    filesPanel.appendChild(hint);
    return;
  }
  let listing: DirListing;
  try {
    listing = await invoke<DirListing>("list_dir", { path: dir });
    if (seq !== filesSeq) return;
  } catch (e) {
    // Keep the current view; just report (e.g. typed a path that doesn't exist).
    toast(String(e));
    return;
  }

  filesPanel.innerHTML = "";

  // Editable full-path bar — type a folder and press Enter to jump there.
  const pathInput = document.createElement("input");
  pathInput.className = "files-path";
  pathInput.value = listing.dir;
  pathInput.spellcheck = false;
  pathInput.title = listing.dir;
  pathInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const v = pathInput.value.trim();
      if (v) void renderFiles(v);
    } else if (ev.key === "Escape") {
      pathInput.value = listing.dir;
      pathInput.blur();
    }
  });
  filesPanel.appendChild(pathInput);

  if (listing.parent) {
    filesPanel.appendChild(
      fileRow("..", "📁", () => void renderFiles(listing.parent), {
        muted: true,
      }),
    );
  }
  for (const entry of listing.entries) {
    if (entry.is_dir) {
      filesPanel.appendChild(
        fileRow(entry.name, "📁", () => void renderFiles(entry.path)),
      );
    } else {
      filesPanel.appendChild(
        fileRow(entry.name, "📄", () => switchToFile(entry.path), {
          active: entry.path === currentPath,
          onContext: (ev) => showFileMenu(ev, entry.path),
        }),
      );
    }
  }
}

function switchToFile(path: string): void {
  requestOpen(path);
}

function toggleFiles(): void {
  filesOpen = !filesOpen;
  layout.classList.toggle("files-open", filesOpen);
  lsSet("filesOpen", String(filesOpen));
  if (filesOpen) void renderFiles(currentPath ? dirOf(currentPath) : null);
}
filesBtn.addEventListener("click", toggleFiles);
// Restore persisted state on load.
if (filesOpen) layout.classList.add("files-open");

// ---------- Mermaid diagram lightbox (click to zoom/pan) ----------
const diagramModal = document.getElementById("diagram-modal") as HTMLElement;
const diagramStage = document.getElementById("diagram-stage") as HTMLElement;
const dgZoomLabel = document.getElementById("dg-zoom") as HTMLElement;
let dgEl: HTMLElement | null = null;
let dgScale = 1;
let dgX = 0;
let dgY = 0;
let dgNatW = 0;
let dgNatH = 0;

function dgApply(): void {
  if (dgEl) dgEl.style.transform = `translate(${dgX}px, ${dgY}px) scale(${dgScale})`;
  dgZoomLabel.textContent = `${Math.round(dgScale * 100)}%`;
}
function dgFit(): void {
  const sw = diagramStage.clientWidth;
  const sh = diagramStage.clientHeight;
  if (!dgNatW || !dgNatH) return;
  dgScale = Math.min(sw / dgNatW, sh / dgNatH, 1) || 1;
  dgX = (sw - dgNatW * dgScale) / 2;
  dgY = (sh - dgNatH * dgScale) / 2;
  dgApply();
}
function dgZoomAt(cx: number, cy: number, factor: number): void {
  const ns = Math.min(8, Math.max(0.1, dgScale * factor));
  const k = ns / dgScale;
  dgX = cx - (cx - dgX) * k;
  dgY = cy - (cy - dgY) * k;
  dgScale = ns;
  dgApply();
}
function openDiagram(svg: SVGElement): void {
  diagramStage.innerHTML = "";
  const card = document.createElement("div");
  card.className = "dg-card";
  const clone = svg.cloneNode(true) as SVGElement;
  const vb = (svg as SVGSVGElement).viewBox?.baseVal;
  clone.removeAttribute("style");
  if (vb && vb.width && vb.height) {
    clone.setAttribute("width", String(vb.width));
    clone.setAttribute("height", String(vb.height));
  }
  card.appendChild(clone);
  diagramStage.appendChild(card);
  dgEl = card;
  diagramModal.hidden = false;
  dgNatW = card.offsetWidth;
  dgNatH = card.offsetHeight;
  dgFit();
}
function closeDiagram(): void {
  diagramModal.hidden = true;
  diagramStage.innerHTML = "";
  dgEl = null;
}

diagramStage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = diagramStage.getBoundingClientRect();
    dgZoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false },
);
let dgDragging = false;
let dgLastX = 0;
let dgLastY = 0;
diagramStage.addEventListener("mousedown", (e) => {
  dgDragging = true;
  dgLastX = e.clientX;
  dgLastY = e.clientY;
  diagramStage.classList.add("grabbing");
});
window.addEventListener("mousemove", (e) => {
  if (!dgDragging) return;
  dgX += e.clientX - dgLastX;
  dgY += e.clientY - dgLastY;
  dgLastX = e.clientX;
  dgLastY = e.clientY;
  dgApply();
});
window.addEventListener("mouseup", () => {
  dgDragging = false;
  diagramStage.classList.remove("grabbing");
});
function dgCenterZoom(factor: number): void {
  dgZoomAt(diagramStage.clientWidth / 2, diagramStage.clientHeight / 2, factor);
}
(document.getElementById("dg-zoomin") as HTMLButtonElement).addEventListener("click", () => dgCenterZoom(1.25));
(document.getElementById("dg-zoomout") as HTMLButtonElement).addEventListener("click", () => dgCenterZoom(0.8));
(document.getElementById("dg-reset") as HTMLButtonElement).addEventListener("click", dgFit);
(document.getElementById("dg-close") as HTMLButtonElement).addEventListener("click", closeDiagram);

// ---------- Find in document (Ctrl+F) ----------
function openFind(): void {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}
function closeFind(): void {
  findBar.hidden = true;
  findCount.textContent = "";
  window.getSelection()?.removeAllRanges();
}
function runFind(backwards: boolean): void {
  const q = findInput.value;
  if (!q) {
    findCount.textContent = "";
    return;
  }
  // window.find(text, caseSensitive, backwards, wrapAround)
  const found = (
    window as unknown as {
      find: (s: string, c: boolean, b: boolean, w: boolean) => boolean;
    }
  ).find(q, false, backwards, true);
  findCount.textContent = found ? "" : "无匹配";
}
findInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    runFind(ev.shiftKey);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    closeFind();
  }
});
findInput.addEventListener("input", () => runFind(false));
(document.getElementById("find-next") as HTMLButtonElement).addEventListener("click", () => runFind(false));
(document.getElementById("find-prev") as HTMLButtonElement).addEventListener("click", () => runFind(true));
(document.getElementById("find-close") as HTMLButtonElement).addEventListener("click", closeFind);

// Collapse / expand the outline.
function toggleToc(): void {
  layout.classList.toggle("toc-collapsed");
}
tocToggle.addEventListener("click", toggleToc);
window.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey && (ev.key === "\\" || ev.key === "|")) {
    // Shift turns "\" into "|" on many layouts; treat both as the same chord.
    ev.preventDefault();
    if (ev.shiftKey) toggleWide();
    else toggleToc();
  } else if (ev.ctrlKey && (ev.key === "e" || ev.key === "E")) {
    ev.preventDefault();
    toggleEdit();
  } else if (ev.ctrlKey && (ev.key === "s" || ev.key === "S")) {
    ev.preventDefault();
    void save();
  } else if (ev.ctrlKey && (ev.key === "=" || ev.key === "+")) {
    ev.preventDefault();
    bumpFont(0.1);
  } else if (ev.ctrlKey && ev.key === "-") {
    ev.preventDefault();
    bumpFont(-0.1);
  } else if (ev.ctrlKey && (ev.key === "o" || ev.key === "O")) {
    ev.preventDefault();
    void openViaDialog();
  } else if (ev.ctrlKey && (ev.key === "f" || ev.key === "F")) {
    ev.preventDefault();
    openFind();
  } else if (ev.ctrlKey && (ev.key === "b" || ev.key === "B")) {
    ev.preventDefault();
    toggleFiles();
  } else if (ev.key === "Escape" && !aboutModal.hidden) {
    aboutModal.hidden = true;
  } else if (ev.key === "Escape" && !diagramModal.hidden) {
    closeDiagram();
  } else if (ev.key === "Escape" && !settingsModal.hidden) {
    closeSettings();
  } else if (ev.key === "Escape" && !findBar.hidden) {
    closeFind();
  } else if (ev.key === "Escape" && !closeModal.hidden) {
    hideCloseModal();
  }
});

// Open external links in the user's default browser instead of navigating
// the webview away from the document.
content.addEventListener("click", (ev) => {
  const anchor = (ev.target as HTMLElement).closest("a");
  if (anchor) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      ev.preventDefault();
      void openUrl(href);
    }
  }
});

// ---------- Window size persistence ----------
// macOS is single-instance and, when a window's Space is re-activated, the OS
// sometimes resizes it to fill the screen. We remember the user's size and
// restore it on focus so switching desktops keeps the chosen width.
interface WinSize {
  width: number;
  height: number;
}
// Matches the window's minWidth/minHeight in tauri.conf.json. Sizes below this
// are degenerate (e.g. the OS reports 0×0 while minimized) and must never be
// saved or restored — doing so shrinks the window to an unusable sliver.
const MIN_WIN_W = 400;
const MIN_WIN_H = 300;
function isSaneSize(w: unknown, h: unknown): w is number {
  return (
    typeof w === "number" &&
    typeof h === "number" &&
    w >= MIN_WIN_W &&
    h >= MIN_WIN_H
  );
}
function loadWinSize(): WinSize | null {
  try {
    const s = JSON.parse(lsGet("winSize") ?? "null");
    // Reject degenerate stored values so an upgrade auto-heals a corrupt size.
    return s && isSaneSize(s.width, s.height)
      ? { width: s.width, height: s.height }
      : null;
  } catch {
    return null;
  }
}
function saveWinSize(width: number, height: number): void {
  // Never persist a minimized / degenerate size.
  if (!isSaneSize(width, height)) return;
  lsSet(
    "winSize",
    JSON.stringify({ width: Math.round(width), height: Math.round(height) }),
  );
}

let suppressWinSaveUntil = 0;
let winSaveTimer: number | undefined;
let monitorWidth = 0; // cached (physical px) so the resize handler stays sync

async function refreshMonitorWidth(): Promise<void> {
  try {
    const m = await currentMonitor();
    if (m) monitorWidth = m.size.width;
  } catch {
    /* ignore */
  }
}

async function setupWindowSize(): Promise<void> {
  await refreshMonitorWidth();

  // Restore the last size on launch.
  const saved = loadWinSize();
  if (saved) {
    try {
      await appWindow.setSize(new PhysicalSize(saved.width, saved.height));
    } catch {
      /* ignore */
    }
  }

  // Persist user resizes (debounced). Skips saving while suppressed and ignores
  // a width that fills the monitor — that's the Spaces-switch jump, not a drag.
  await appWindow.onResized(({ payload }) => {
    if (Date.now() < suppressWinSaveUntil) return;
    if (monitorWidth && payload.width >= monitorWidth - 2) return;
    // Ignore minimized / degenerate sizes (0×0 etc.) — saveWinSize also guards.
    if (!isSaneSize(payload.width, payload.height)) return;
    const { width, height } = payload;
    window.clearTimeout(winSaveTimer);
    winSaveTimer = window.setTimeout(() => saveWinSize(width, height), 300);
  });

  // On regaining focus (e.g. switching back to this Space), restore the saved
  // size and briefly suppress saving so the OS resize can't overwrite it.
  await appWindow.onFocusChanged(({ payload: focused }) => {
    if (!focused) return;
    void refreshMonitorWidth();
    const s = loadWinSize();
    if (!s) return;
    suppressWinSaveUntil = Date.now() + 600;
    void appWindow.setSize(new PhysicalSize(s.width, s.height));
  });
}

let reloadTimer: number | undefined;
async function init(): Promise<void> {
  // Each step is isolated so a failure in one (e.g. window-size restore on an
  // unusual WM) can never silently skip the rest of the startup sequence.
  try {
    // Remember/restore the window size (see setupWindowSize).
    await setupWindowSize();
  } catch (e) {
    console.error("window size init failed", e);
  }

  try {
    // Hot reload when the watched file changes on disk. Skip while editing,
    // when the change came from our own save, or when there are unsaved edits.
    await listen<string>("md-changed", (ev) => {
      if (ev.payload && currentPath && ev.payload !== currentPath) return;
      if (editMode || dirty || Date.now() <= suppressReloadUntil) return;
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        if (currentPath && !editMode && !dirty) {
          void openFile(currentPath, false, true);
        }
      }, 200);
    });
  } catch (e) {
    console.error("failed to register file-watch listener", e);
  }

  try {
    // macOS delivers file-association opens at runtime.
    await listen<string>("open-file", (ev) => {
      requestOpen(ev.payload);
    });
  } catch (e) {
    console.error("failed to register open-file listener", e);
  }

  try {
    // Drag-and-drop a .md file onto the window.
    await getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type === "drop") {
        const file = ev.payload.paths.find((p) => /\.(md|markdown)$/i.test(p));
        if (file) requestOpen(file);
      }
    });
  } catch (e) {
    console.error("failed to register drag-drop listener", e);
  }

  try {
    // Intercept window close when there are unsaved edits.
    await appWindow.onCloseRequested((event) => {
      if (dirty) {
        event.preventDefault();
        closeAction = "window";
        showCloseModal();
      }
    });
  } catch (e) {
    console.error("failed to register close listener", e);
  }

  try {
    // Signal the backend that listeners are ready, flushing any file-open
    // requests that arrived during cold start (fixes macOS first-open blank).
    await invoke("frontend_ready");
  } catch (e) {
    console.error("frontend_ready failed", e);
  }

  // Populate the empty-state recent-files list.
  renderRecents();

  // Restore the file-explorer panel if it was left open.
  if (filesOpen) void renderFiles(null);

  try {
    // File the app was launched with (Windows / Linux association).
    const initial = await invoke<string | null>("get_initial_path");
    if (initial) {
      await openFile(initial);
      // Optional `--edit` flag opens straight into edit mode.
      if (await invoke<boolean>("start_in_edit")) {
        setEditMode(true);
      }
    }

    // Optional `--zoom=<factor>` flag scales the whole UI.
    const zoom = await invoke<number>("start_zoom");
    if (zoom && zoom > 0) {
      await getCurrentWebview().setZoom(zoom);
    }
  } catch (e) {
    console.error("startup file-open failed", e);
  }
}

void init();
