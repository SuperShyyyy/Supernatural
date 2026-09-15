import type { DocumentSource, FileSystemAdapter } from './FileSystemAdapter';

const STORAGE_KEY = 'md-editer.document';

/**
 * 草稿落盘上限：超大文档（典型 >2MB）不再写进 localStorage。
 * 原因：localStorage 单源配额约 5MB，整篇序列化字符串既会撑爆配额、又属于
 * "文档已被 ProseMirror 持有"之外的又一份冗余数据；超大文档通常已保存为真实文件
 * （此时 DraftAdapter 走文件而非 localStorage），未保存时的崩溃恢复代价可忽略。
 */
const MAX_DRAFT_CHARS = 2_000_000;

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
    // 超过上限的文档跳过写入：保留磁盘上已有的（可能更小）草稿，避免写入更膨胀的内容，
    // 也不在这里 removeItem —— 否则崩溃后反而拿不到任何旧版本。
    if (source.content.length > MAX_DRAFT_CHARS) return;
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
