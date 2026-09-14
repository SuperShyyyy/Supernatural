import type { DocumentSource, FileSystemAdapter } from './FileSystemAdapter';

/**
 * Electron 适配器：通过 preload 暴露的窄接口读写**真实文件**。
 *
 * 与浏览器版的 FileSystemAccessAdapter 实现同一个接口，所以 app 启动时只需要
 * 判断 `window.mdEditor` 是否存在就能切换宿主，编辑器核心零改动。
 */
export class ElectronAdapter implements FileSystemAdapter {
  readonly id = 'electron';

  #path: string | null = null;

  get hasHandle(): boolean {
    return this.#path !== null;
  }

  get filePath(): string | null {
    return this.#path;
  }

  setPath(filePath: string | null): void {
    this.#path = filePath;
  }

  async open(): Promise<DocumentSource | null> {
    const bridge = getBridge();
    if (bridge === undefined) return null;

    const opened = await bridge.openFile();
    if (opened === null) return null;
    this.#path = opened.path;
    return { name: opened.name, content: opened.content };
  }

  async openPath(filePath: string): Promise<DocumentSource | null> {
    const bridge = getBridge();
    if (bridge === undefined) return null;

    const opened = await bridge.openPath(filePath);
    if (opened === null) return null;
    this.#path = opened.path;
    return { name: opened.name, content: opened.content };
  }

  async openRef(ref: string | FileSystemFileHandle): Promise<DocumentSource | null> {
    return typeof ref === 'string' ? this.openPath(ref) : null;
  }

  async save(source: DocumentSource): Promise<void> {
    const bridge = getBridge();
    if (bridge === undefined) throw new Error('Electron 桥接不可用');

    const saved = await bridge.saveFile(source.content, this.#path);
    if (saved === null) throw new Error('保存已取消');
    this.#path = saved.path;
  }

  async saveAs(source: DocumentSource): Promise<string | null> {
    const bridge = getBridge();
    if (bridge === undefined) return null;

    const saved = await bridge.saveFileAs(source.content, source.name);
    if (saved === null) return null;
    this.#path = saved.path;
    return saved.name;
  }
}

export function getBridge(): ElectronBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.mdEditor;
}

export function isElectron(): boolean {
  return getBridge() !== undefined;
}
