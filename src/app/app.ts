import { createEditor, type Editor } from '../core/editor/createEditor';
import { createCoreRegistry, runCommand } from '../core/commands/registry';
import { markdownSchema } from '../core/document/schema';
import type { DocumentSource } from '../filesystem/FileSystemAdapter';
import { FileSystemAccessAdapter } from '../filesystem/FileSystemAccessAdapter';
import { DraftAdapter } from '../filesystem/DraftAdapter';
import { ElectronAdapter, getBridge, isElectron } from '../filesystem/ElectronAdapter';
import { LocalStorageAdapter } from '../filesystem/LocalStorageAdapter';
import { RecentFilesStore, type RecentFileEntry } from '../filesystem/RecentFilesStore';
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

/** 最近文件的宿主无关视图：浏览器给句柄，Electron 给路径。 */
interface RecentSource {
  list(): Promise<readonly RecentFileEntry[]>;
}

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
  const electron = isElectron();

  // 宿主选择：Electron 里走真实文件，浏览器里走 File System Access API（带降级）
  const fileAdapter = electron ? new ElectronAdapter() : new FileSystemAccessAdapter();
  const draftAdapter = new LocalStorageAdapter();
  const recentSource: RecentSource = electron ? createElectronRecentSource() : new RecentFilesStore();
  const adapter = new DraftAdapter(fileAdapter, draftAdapter);

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
  const searchPanel = new SearchPanel({ getView: () => editor.view, onClose: () => editor.focus() });
  const shortcutsDialog = new ShortcutsDialog(registry);

  const applySource = (source: DocumentSource): void => {
    documentName = source.name;
    editor.setMarkdown(source.content);
    renderDocumentName(refs.docName, documentName);
    scheduleStatsUpdate();
    editor.focus();
    autosave.markDirty();
  };

  const refreshRecent = (): void => {
    void recentSource
      .list()
      .then((entries) => menubar.setRecentFiles(entries))
      .catch(() => undefined);
  };

  const rememberRecent = (): void => {
    if (electron) {
      // Electron 侧由主进程在保存 / 打开时写入，这里只负责刷新菜单
      refreshRecent();
      return;
    }
    const handle = fileAdapter instanceof FileSystemAccessAdapter ? fileAdapter.handle : null;
    if (handle === null) return;
    const store = recentSource instanceof RecentFilesStore ? recentSource : null;
    if (store === null) return;
    void store
      .put({ name: handle.name, updatedAt: Date.now(), handle })
      .then(refreshRecent)
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

  const actions = {
    new: () => {
      const content = editor.getMarkdown();
      if (content.trim().length > 0 && !window.confirm('新建会清空当前内容，继续？')) return;
      documentName = DEFAULT_DOCUMENT_NAME;
      if (fileAdapter instanceof FileSystemAccessAdapter) fileAdapter.setHandle(null, documentName);
      else if (fileAdapter instanceof ElectronAdapter) fileAdapter.setPath(null);
      editor.setMarkdown('');
      renderDocumentName(refs.docName, documentName);
      scheduleStatsUpdate();
      editor.focus();
      autosave.markDirty();
    },
    open: () => {
      void fileAdapter
        .open()
        .then((source) => {
          if (source === null) return;
          applySource(source);
          rememberRecent();
        })
        .catch(() => undefined);
    },
    save: () => void autosave.saveNow(),
    saveAs,
    find: () => searchPanel.show(false),
    replace: () => searchPanel.show(true),
    zoomIn: () => zoom.step(1),
    zoomOut: () => zoom.step(-1),
    zoomReset: () => zoom.reset(),
    toggleTheme: () => {
      const next: Theme = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    },
    shortcuts: () => shortcutsDialog.show(),
    loadDemo: () => {
      if (!window.confirm('载入示例文档会替换当前内容，继续？')) return;
      editor.setMarkdown(DEMO_DOCUMENT);
      scheduleStatsUpdate();
      editor.focus();
      autosave.markDirty();
    },
    openRecent: (entry: RecentFileEntry) => {
      const ref = entry.path ?? entry.handle;
      if (ref === undefined) return;
      void fileAdapter
        .openRef?.(ref)
        .then((source) => {
          if (source === null || source === undefined) return;
          applySource(source);
          rememberRecent();
        })
        .catch(() => undefined);
    },
  };

  /** 供原生菜单调用的动作（不含需要参数的 openRecent） */
  const appActions: Record<string, () => void> = {
    new: actions.new,
    open: actions.open,
    save: actions.save,
    saveAs: actions.saveAs,
    find: actions.find,
    replace: actions.replace,
    zoomIn: actions.zoomIn,
    zoomOut: actions.zoomOut,
    zoomReset: actions.zoomReset,
    toggleTheme: actions.toggleTheme,
    shortcuts: actions.shortcuts,
    loadDemo: actions.loadDemo,
  };

  const menubar = new MenuBar(root, {
    registry,
    getView: () => editor.view,
    actions: {
      onNew: actions.new,
      onOpen: actions.open,
      onSave: actions.save,
      onSaveAs: actions.saveAs,
      onFind: actions.find,
      onReplace: actions.replace,
      onZoomIn: actions.zoomIn,
      onZoomOut: actions.zoomOut,
      onZoomReset: actions.zoomReset,
      onToggleTheme: actions.toggleTheme,
      onShowShortcuts: actions.shortcuts,
      onLoadDemo: actions.loadDemo,
      onOpenRecent: actions.openRecent,
    },
  });

  zoom.onChange((level) => {
    saveZoom(level);
    refs.zoomValue.textContent = `${level}%`;
  });
  refs.zoomValue.textContent = `${zoom.level}%`;

  applyTheme(readTheme());
  refreshRecent();

  renderDocumentName(refs.docName, documentName);
  scheduleStatsUpdate();
  editor.focus();

  // 原生菜单（Electron）把动作转发进来，和应用内菜单栏走同一份 actions
  const bridge = getBridge();
  bridge?.onAction((message) => {
    if (message.type === 'command') {
      runCommand(editor.view, registry, message.id);
      return;
    }
    appActions[message.id]?.();
  });
  bridge?.onOpened((doc) => {
    applySource({ name: doc.name, content: doc.content });
    rememberRecent();
  });

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

function createElectronRecentSource(): RecentSource {
  return {
    async list(): Promise<readonly RecentFileEntry[]> {
      const bridge = getBridge();
      if (bridge === undefined) return [];
      const entries = await bridge.listRecent();
      return entries.map((entry) => ({
        name: entry.name,
        updatedAt: entry.updatedAt,
        path: entry.path,
      }));
    },
  };
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
