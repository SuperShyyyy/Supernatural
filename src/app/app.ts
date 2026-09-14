import { createEditor, type Editor } from '../core/editor/createEditor';
import type { DocumentSource, FileSystemAdapter } from '../filesystem/FileSystemAdapter';
import { LocalStorageAdapter } from '../filesystem/LocalStorageAdapter';
import { AutosaveService, type SaveStatus } from '../services/autosave/AutosaveService';
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
  const adapter: FileSystemAdapter = new LocalStorageAdapter();
  const opened = await adapter.open();

  let documentName = opened?.name ?? DEFAULT_DOCUMENT_NAME;
  const initialMarkdown = opened?.content ?? DEMO_DOCUMENT;

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
      void saveAs(adapter, () => ({ name: documentName, content: editor?.getMarkdown() ?? '' })).then(
        (name) => {
          if (name === null) return;
          documentName = name;
          renderDocumentName(refs.docName, documentName);
        },
      );
    }
  });
}

async function saveAs(
  adapter: FileSystemAdapter,
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
