import { createEditor, type Editor } from '../core/editor/createEditor';
import type { DocumentSource } from '../filesystem/FileSystemAdapter';
import { FileSystemAccessAdapter } from '../filesystem/FileSystemAccessAdapter';
import { DraftAdapter } from '../filesystem/DraftAdapter';
import { LocalStorageAdapter } from '../filesystem/LocalStorageAdapter';
import { RecentFilesStore } from '../filesystem/RecentFilesStore';
import { AutosaveService, type SaveStatus } from '../services/autosave/AutosaveService';
import { Topbar } from '../ui/topbar';
import { DEMO_DOCUMENT } from './demoDocument';

const DEFAULT_DOCUMENT_NAME = '未命名.md';
const AUTOSAVE_DELAY_MS = 800;

interface AppRefs {
  readonly viewport: HTMLElement;
  readonly docName: HTMLElement;
  readonly saveStatus: HTMLElement;
  readonly statCharacters: HTMLElement;
  readonly statWords: HTMLElement;
  readonly statBlocks: HTMLElement;
}

export async function startApp(root: HTMLElement): Promise<void> {
  const refs = resolveRefs(root);

  const fileAdapter = new FileSystemAccessAdapter();
  const draftAdapter = new LocalStorageAdapter();
  const recentStore = new RecentFilesStore();
  const adapter = new DraftAdapter(fileAdapter, draftAdapter);

  // 上次没保存完的草稿优先恢复，避免"刷新即失"
  const draft = await draftAdapter.open();
  let documentName = draft?.name ?? DEFAULT_DOCUMENT_NAME;
  const initialMarkdown = draft?.content ?? DEMO_DOCUMENT;

  let editor: Editor | null = null;
  let frame = 0;

  const autosave = new AutosaveService(
    adapter,
    () => ({ name: documentName, content: editor?.getMarkdown() ?? '' }),
    {
      delayMs: AUTOSAVE_DELAY_MS,
      onStatusChange: (status, savedAt) => renderSaveStatus(refs.saveStatus, status, savedAt),
    },
  );

  const scheduleStatsUpdate = (): void => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (editor === null) return;
      const stats = editor.getStats();
      refs.statCharacters.textContent = String(stats.characters);
      refs.statWords.textContent = String(stats.words);
      refs.statBlocks.textContent = String(stats.blocks);
    });
  };

  editor = createEditor({
    mount: refs.viewport,
    markdown: initialMarkdown,
    onChange: () => {
      autosave.markDirty();
      scheduleStatsUpdate();
    },
  });

  const applySource = (source: DocumentSource): void => {
    documentName = source.name;
    editor?.setMarkdown(source.content);
    renderDocumentName(refs.docName, documentName);
    scheduleStatsUpdate();
    editor?.focus();
    autosave.markDirty();
  };

  const rememberRecent = (): void => {
    const handle = fileAdapter.handle;
    if (handle === null) return;
    void recentStore
      .put({ name: handle.name, updatedAt: Date.now(), handle })
      .then(() => recentStore.list())
      .then((entries) => topbar.setRecentFiles(entries))
      .catch(() => undefined);
  };

  const topbar = new Topbar(root, {
    onNew: () => {
      const content = editor?.getMarkdown() ?? '';
      if (content.trim().length > 0 && !window.confirm('新建会清空当前内容，继续？')) return;
      documentName = DEFAULT_DOCUMENT_NAME;
      fileAdapter.setHandle(null, documentName);
      editor?.setMarkdown('');
      renderDocumentName(refs.docName, documentName);
      scheduleStatsUpdate();
      editor?.focus();
      autosave.markDirty();
    },
    onOpen: () => {
      void fileAdapter.open().then((source) => {
        if (source === null) return;
        applySource(source);
        rememberRecent();
      });
    },
    onSaveAs: () => {
      void saveAsVia(fileAdapter, () => ({
        name: documentName,
        content: editor?.getMarkdown() ?? '',
      })).then((name) => {
        if (name === null) return;
        documentName = name;
        renderDocumentName(refs.docName, documentName);
        rememberRecent();
        void autosave.saveNow();
      });
    },
    onOpenRecent: (entry) => {
      if (entry.handle === undefined) return;
      void fileAdapter.openHandle(entry.handle).then((source) => {
        if (source === null) return;
        applySource(source);
        rememberRecent();
      });
    },
  });

  void recentStore
    .list()
    .then((entries) => topbar.setRecentFiles(entries))
    .catch(() => undefined);

  renderDocumentName(refs.docName, documentName);
  scheduleStatsUpdate();
  editor.focus();

  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      void autosave.saveNow();
      return;
    }
    if (event.shiftKey && (event.key === 's' || event.key === 'S')) {
      event.preventDefault();
      void saveAsVia(fileAdapter, () => ({
        name: documentName,
        content: editor?.getMarkdown() ?? '',
      })).then((name) => {
        if (name === null) return;
        documentName = name;
        renderDocumentName(refs.docName, documentName);
        rememberRecent();
      });
    }
  });
}

async function saveAsVia(
  adapter: FileSystemAccessAdapter,
  source: () => DocumentSource,
): Promise<string | null> {
  return adapter.saveAs(source());
}

function resolveRefs(root: HTMLElement): AppRefs {
  return {
    viewport: requireElement(root, '.editor-viewport'),
    docName: requireElement(root, '#doc-name'),
    saveStatus: requireElement(root, '#save-status'),
    statCharacters: requireElement(root, '#stat-characters'),
    statWords: requireElement(root, '#stat-words'),
    statBlocks: requireElement(root, '#stat-blocks'),
  };
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`[app] 缺少必需的 DOM 节点: ${selector}`);
  }
  return found;
}

function renderDocumentName(target: HTMLElement, name: string): void {
  target.textContent = name;
  document.title = `${name} — md-editer`;
}

function renderSaveStatus(target: HTMLElement, status: SaveStatus, savedAt: Date | null): void {
  switch (status) {
    case 'pending':
      target.textContent = '未保存';
      break;
    case 'saving':
      target.textContent = '保存中…';
      break;
    case 'saved':
      target.textContent = savedAt === null ? '已保存' : `已保存 ${formatTime(savedAt)}`;
      break;
    case 'error':
      target.textContent = '保存失败';
      break;
    default:
      target.textContent = '';
      break;
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}
