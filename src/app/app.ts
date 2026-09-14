import { createEditor, type Editor } from '../core/editor/createEditor';
import { createCoreRegistry } from '../core/commands/registry';
import { markdownSchema } from '../core/document/schema';
import type { DocumentSource } from '../filesystem/FileSystemAdapter';
import { FileSystemAccessAdapter } from '../filesystem/FileSystemAccessAdapter';
import { DraftAdapter } from '../filesystem/DraftAdapter';
import { LocalStorageAdapter } from '../filesystem/LocalStorageAdapter';
import { RecentFilesStore } from '../filesystem/RecentFilesStore';
import { AutosaveService, type SaveStatus } from '../services/autosave/AutosaveService';
import { ZoomController, loadZoom, saveZoom } from '../services/zoom/ZoomController';
import { MenuBar } from '../ui/menubar';
import { SearchPanel } from '../ui/searchPanel';
import { ShortcutsDialog } from '../ui/shortcutsDialog';
import { DEMO_DOCUMENT } from './demoDocument';

const DEFAULT_DOCUMENT_NAME = '未命名.md';
const AUTOSAVE_DELAY_MS = 800;
const THEME_STORAGE_KEY = 'md-editer.theme';

type Theme = 'light' | 'dark';

interface AppRefs {
  readonly viewport: HTMLElement;
  readonly docName: HTMLElement;
  readonly saveStatus: HTMLElement;
  readonly zoomValue: HTMLElement;
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

  const editor: Editor = createEditor({
    mount: refs.viewport,
    markdown: initialMarkdown,
    onChange: () => {
      autosave.markDirty();
      scheduleStatsUpdate();
    },
  });

  const registry = createCoreRegistry(markdownSchema);
  const zoom = new ZoomController(document.documentElement, loadZoom());
  const searchPanel = new SearchPanel({
    getView: () => editor.view,
    onClose: () => editor.focus(),
  });
  const shortcutsDialog = new ShortcutsDialog(registry);

  const applySource = (source: DocumentSource): void => {
    documentName = source.name;
    editor.setMarkdown(source.content);
    renderDocumentName(refs.docName, documentName);
    scheduleStatsUpdate();
    editor.focus();
    autosave.markDirty();
  };

  const rememberRecent = (): void => {
    const handle = fileAdapter.handle;
    if (handle === null) return;
    void recentStore
      .put({ name: handle.name, updatedAt: Date.now(), handle })
      .then(() => recentStore.list())
      .then((entries) => menubar.setRecentFiles(entries))
      .catch(() => undefined);
  };

  const saveAs = (): void => {
    void fileAdapter
      .saveAs({ name: documentName, content: editor.getMarkdown() })
      .then((name) => {
        if (name === null) return;
        documentName = name;
        renderDocumentName(refs.docName, documentName);
        rememberRecent();
        void autosave.saveNow();
      })
      .catch(() => undefined);
  };

  const menubar = new MenuBar(root, {
    registry,
    getView: () => editor.view,
    actions: {
      onNew: () => {
        const content = editor.getMarkdown();
        if (content.trim().length > 0 && !window.confirm('新建会清空当前内容，继续？')) return;
        documentName = DEFAULT_DOCUMENT_NAME;
        fileAdapter.setHandle(null, documentName);
        editor.setMarkdown('');
        renderDocumentName(refs.docName, documentName);
        scheduleStatsUpdate();
        editor.focus();
        autosave.markDirty();
      },
      onOpen: () => {
        void fileAdapter
          .open()
          .then((source) => {
            if (source === null) return;
            applySource(source);
            rememberRecent();
          })
          .catch(() => undefined);
      },
      onSave: () => void autosave.saveNow(),
      onSaveAs: saveAs,
      onFind: () => searchPanel.show(false),
      onReplace: () => searchPanel.show(true),
      onZoomIn: () => zoom.step(1),
      onZoomOut: () => zoom.step(-1),
      onZoomReset: () => zoom.reset(),
      onToggleTheme: () => {
        const next: Theme = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      },
      onShowShortcuts: () => shortcutsDialog.show(),
      onOpenRecent: (entry) => {
        if (entry.handle === undefined) return;
        void fileAdapter
          .openHandle(entry.handle)
          .then((source) => {
            if (source === null) return;
            applySource(source);
            rememberRecent();
          })
          .catch(() => undefined);
      },
    },
  });

  zoom.onChange((level) => {
    saveZoom(level);
    refs.zoomValue.textContent = `${level}%`;
  });
  refs.zoomValue.textContent = `${zoom.level}%`;

  applyTheme(readTheme());
  void recentStore
    .list()
    .then((entries) => menubar.setRecentFiles(entries))
    .catch(() => undefined);

  renderDocumentName(refs.docName, documentName);
  scheduleStatsUpdate();
  editor.focus();

  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    switch (event.key) {
      case 's':
      case 'S':
        event.preventDefault();
        if (event.shiftKey) saveAs();
        else void autosave.saveNow();
        return;
      case 'f':
      case 'F':
        event.preventDefault();
        searchPanel.show(event.shiftKey);
        return;
      case 'h':
      case 'H':
        event.preventDefault();
        searchPanel.show(true);
        return;
      case '+':
      case '=':
        event.preventDefault();
        zoom.step(1);
        return;
      case '-':
      case '_':
        event.preventDefault();
        zoom.step(-1);
        return;
      case '0':
        event.preventDefault();
        zoom.reset();
        return;
      default:
        return;
    }
  });
}

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* 忽略：主题只是偏好 */
  }
}

function resolveRefs(root: HTMLElement): AppRefs {
  return {
    viewport: requireElement(root, '.editor-viewport'),
    docName: requireElement(root, '#doc-name'),
    saveStatus: requireElement(root, '#save-status'),
    zoomValue: requireElement(root, '#zoom-value'),
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
