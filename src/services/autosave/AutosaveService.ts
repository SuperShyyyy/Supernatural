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
        // 序列化是 O(doc)，放在空闲帧执行，避免和输入抢主线程
        const source = await whenIdle(() => this.#source());
        await this.#adapter.save(source);
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

/** 在浏览器空闲时段执行；不支持 requestIdleCallback 时退化为下一个宏任务。 */
function whenIdle<T>(task: () => T): Promise<T> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      // timeout 放宽到 2s：给浏览器更多机会找到真正的空闲片段，
      // 避免"强制在忙时执行"抢掉输入主线程（表现为打字掉帧）
      window.requestIdleCallback(() => resolve(task()), { timeout: 2000 });
      return;
    }
    window.setTimeout(() => resolve(task()), 0);
  });
}
