/** preload 注入到渲染进程的窄接口（见 electron/preload.js）。全局声明，无需 import。 */

interface OpenedDocument {
  readonly name: string;
  readonly path: string;
  readonly content: string;
}

interface SavedDocument {
  readonly name: string;
  readonly path: string;
}

interface RecentPathEntry {
  readonly name: string;
  readonly path: string;
  readonly updatedAt: number;
}

interface MenuActionMessage {
  readonly type: 'command' | 'app';
  readonly id: string;
}

interface ElectronBridge {
  readonly isElectron: true;
  openFile(): Promise<OpenedDocument | null>;
  openPath(filePath: string): Promise<OpenedDocument | null>;
  saveFile(content: string, filePath: string | null): Promise<SavedDocument | null>;
  saveFileAs(content: string, suggestedName: string): Promise<SavedDocument | null>;
  listRecent(): Promise<RecentPathEntry[]>;
  onAction(listener: (action: MenuActionMessage) => void): () => void;
  onOpened(listener: (doc: OpenedDocument) => void): () => void;
  /** 渲染进程初始化完成、已注册好监听器后调用，通知主进程可以安全投递启动文件 */
  ready(): void;
}

interface Window {
  readonly mdEditor?: ElectronBridge;
}
