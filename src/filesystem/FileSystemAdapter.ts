/**
 * 文件系统抽象。
 *
 * 编辑器核心只依赖这个接口，不依赖 Electron / Tauri / Node / File System Access API，
 * 因此同一份编辑器核心可以跑在 Browser / Electron / Tauri / 桌面端。
 * Phase 3 会补上真正的实现（File System Access API + Electron/Tauri 适配器），
 * Phase 1 先用 LocalStorageAdapter 保证"能写不丢"。
 */

export interface DocumentSource {
  readonly name: string;
  readonly content: string;
}

export interface FileSystemAdapter {
  readonly id: string;
  /** 打开一个文档；用户取消时返回 null。 */
  open(): Promise<DocumentSource | null>;
  save(source: DocumentSource): Promise<void>;
  /** 另存为新文档，返回最终使用的文件名；取消时返回 null。 */
  saveAs(source: DocumentSource): Promise<string | null>;
  /**
   * 用宿主自己的"文件引用"重新打开（最近文件用）：
   * Electron 传路径字符串，浏览器传 FileSystemFileHandle。
   * 传错类型或宿主不支持时返回 null。
   */
  openRef?(ref: string | FileSystemFileHandle): Promise<DocumentSource | null>;
}
