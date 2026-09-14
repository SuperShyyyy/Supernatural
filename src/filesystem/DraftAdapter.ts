import type { DocumentSource, FileSystemAdapter } from './FileSystemAdapter';
import type { FileSystemAccessAdapter } from './FileSystemAccessAdapter';

/**
 * 自动保存的落点选择：
 *  - 已经打开/另存过真实文件 → 写回原文件（用户的"保存"直觉）
 *  - 还没有文件句柄 → 写本地草稿，保证任何情况下内容都不丢
 *
 * 这样 autosave 永远有地方可写，不需要在 UI 里到处判断"能不能保存"。
 */
export class DraftAdapter implements FileSystemAdapter {
  readonly id = 'draft-aware';

  readonly #file: FileSystemAccessAdapter;
  readonly #draft: FileSystemAdapter;

  constructor(file: FileSystemAccessAdapter, draft: FileSystemAdapter) {
    this.#file = file;
    this.#draft = draft;
  }

  async open(): Promise<DocumentSource | null> {
    return this.#draft.open();
  }

  async save(source: DocumentSource): Promise<void> {
    if (this.#file.hasHandle) {
      await this.#file.save(source);
      return;
    }
    await this.#draft.save(source);
  }

  async saveAs(source: DocumentSource): Promise<string | null> {
    return this.#file.saveAs(source);
  }
}
