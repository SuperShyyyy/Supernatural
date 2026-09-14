import type { DocumentSource, FileSystemAdapter } from '../../filesystem/FileSystemAdapter';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutosaveOptions {
  /** 停止输入后多久落盘 */
  readonly delayMs?: number;
  readonly onStatusChange?: (status: SaveStatus, savedAt: Date | null) => void;
}

/**
 * 自动保存：把"输入"和"序列化 + 落盘"彻底解耦。
 *
 * 输入路径只调用 markDirty()（O(1)），真正的序列化在停止输入 delayMs 之后执行；
 * 因此大文档下连续输入不会因为 autosave 产生周期性掉帧。
 */
export class AutosaveService {
  readonly #adapter: FileSystemAdapter;
  readonly #source: () => DocumentSource;
  readonly #delayMs: number;
  readonly #onStatusChange: ((status: SaveStatus, savedAt: Date | null) => void) | undefined;

  #timer: number | null = null;
  #status: SaveStatus = 'idle';
  #savedAt: Date | null = null;
  #pending: Promise<void> = Promise.resolve();

  constructor(adapter: FileSystemAdapter, source: () => DocumentSource, options: AutosaveOptions = {}) {
    this.#adapter = adapter;
    this.#source = source;
    this.#delayMs = options.delayMs ?? 800;
    this.#onStatusChange = options.onStatusChange;
  }

  get status(): SaveStatus {
    return this.#status;
  }

  markDirty(): void {
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#setStatus('pending');
    this.#timer = window.setTimeout(() => {
      this.#timer = null;
      void this.saveNow();
    }, this.#delayMs);
  }

  /** 手动保存（Ctrl/Cmd+S）：与自动保存共用同一条串行队列，避免并发写。 */
  async saveNow(): Promise<void> {
    if (this.#timer !== null) {
      window.clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#setStatus('saving');
    this.#pending = this.#pending.then(async () => {
      try {
        await this.#adapter.save(this.#source());
        this.#savedAt = new Date();
        this.#setStatus('saved', this.#savedAt);
      } catch {
        this.#setStatus('error');
      }
    });
    return this.#pending;
  }

  dispose(): void {
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #setStatus(status: SaveStatus, savedAt: Date | null = null): void {
    this.#status = status;
    this.#onStatusChange?.(status, savedAt ?? this.#savedAt);
  }
}
