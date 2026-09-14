import type { DocumentSource, FileSystemAdapter } from './FileSystemAdapter';

const STORAGE_KEY = 'md-editer.document';

/**
 * 浏览器本地存储适配器（Phase 1 的临时实现）。
 *
 * 存在的唯一理由：在真正的 File System Access / Electron 适配器落地之前，
 * 编辑器已经是一个"可以真正写东西且不会丢"的应用，而不是一个刷新即清空的 Demo。
 * 命名对话框目前用 window.prompt —— 明显是临时方案，Phase 3 会换成 Dialog 组件。
 */
export class LocalStorageAdapter implements FileSystemAdapter {
  readonly id = 'local-storage';

  async open(): Promise<DocumentSource | null> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isDocumentSource(parsed)) return null;
      return { name: parsed.name, content: parsed.content };
    } catch {
      return null;
    }
  }

  async save(source: DocumentSource): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
  }

  async saveAs(source: DocumentSource): Promise<string | null> {
    const name = window.prompt('另存为', source.name);
    if (name === null || name.trim().length === 0) return null;
    const renamed: DocumentSource = { name: name.trim(), content: source.content };
    await this.save(renamed);
    return renamed.name;
  }
}

function isDocumentSource(value: unknown): value is DocumentSource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['name'] === 'string' && typeof candidate['content'] === 'string';
}
