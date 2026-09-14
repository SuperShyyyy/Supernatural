import type { DocumentSource, FileSystemAdapter } from './FileSystemAdapter';

const MARKDOWN_TYPES: FilePickerAcceptType[] = [
  {
    description: 'Markdown',
    accept: {
      'text/markdown': ['.md', '.markdown', '.mdown'],
      'text/plain': ['.txt'],
    },
  },
];

/**
 * 桌面文件系统适配器（File System Access API）。
 *
 * 有句柄时直接写回原文件（不弹对话框）；没有句柄时（新建文档）首次保存弹 Save As。
 * 浏览器不支持该 API 时降级：打开用 <input type=file>，保存用下载。
 */
export class FileSystemAccessAdapter implements FileSystemAdapter {
  readonly id = 'file-system-access';

  #handle: FileSystemFileHandle | null = null;
  #name = '未命名.md';

  static isSupported(): boolean {
    return typeof window.showOpenFilePicker === 'function';
  }

  get fileName(): string {
    return this.#handle?.name ?? this.#name;
  }

  get hasHandle(): boolean {
    return this.#handle !== null;
  }

  get handle(): FileSystemFileHandle | null {
    return this.#handle;
  }

  setHandle(handle: FileSystemFileHandle | null, name: string): void {
    this.#handle = handle;
    this.#name = name;
  }

  async open(): Promise<DocumentSource | null> {
    if (!FileSystemAccessAdapter.isSupported()) return openWithFileInput();

    const handles = await window.showOpenFilePicker?.({
      types: MARKDOWN_TYPES,
      multiple: false,
      excludeAcceptAllOption: false,
    });
    const handle = handles?.[0];
    return handle === undefined ? null : this.#read(handle);
  }

  /** 从"最近文件"直接重开：句柄来自持久化存储，需要重新确认权限。 */
  async openHandle(handle: FileSystemFileHandle): Promise<DocumentSource | null> {
    if (!(await ensurePermission(handle, 'read'))) return null;
    return this.#read(handle);
  }

  async save(source: DocumentSource): Promise<void> {
    const handle = this.#handle;
    if (handle !== null && (await ensurePermission(handle, 'readwrite'))) {
      await writeFile(handle, source.content);
      return;
    }
    const name = await this.saveAs(source);
    if (name === null) throw new Error('保存已取消');
  }

  async saveAs(source: DocumentSource): Promise<string | null> {
    if (!FileSystemAccessAdapter.isSupported()) {
      downloadFile(source.name, source.content);
      return source.name;
    }

    const handle = await window.showSaveFilePicker?.({
      suggestedName: source.name,
      types: MARKDOWN_TYPES,
    });
    if (handle === undefined) return null;

    await writeFile(handle, source.content);
    this.setHandle(handle, handle.name);
    return handle.name;
  }

  async #read(handle: FileSystemFileHandle): Promise<DocumentSource> {
    const file = await handle.getFile();
    const content = await file.text();
    this.setHandle(handle, handle.name);
    return { name: handle.name, content };
  }
}

async function ensurePermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite',
): Promise<boolean> {
  const options = { mode };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

async function writeFile(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** 不支持 File System Access API 时的打开降级方案。 */
function openWithFileInput(): Promise<DocumentSource | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.txt';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
        return;
      }
      void file.text().then((content) => resolve({ name: file.name, content }));
    });
    input.addEventListener('cancel', () => resolve(null));

    input.click();
  });
}

/** 不支持 File System Access API 时的保存降级方案。 */
function downloadFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
