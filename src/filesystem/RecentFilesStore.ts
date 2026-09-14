/**
 * 最近打开文件。
 *
 * 用 IndexedDB 而不是 localStorage 的唯一原因：FileSystemFileHandle 是可结构化克隆的
 * 对象，只有存进 IndexedDB 才能在下次启动时免确认地重新打开同一个文件
 * （当然仍需用户授予一次权限，这是浏览器的硬性约束）。
 */

const DB_NAME = 'md-editer';
const STORE_NAME = 'recent-files';
const DB_VERSION = 1;
const MAX_ENTRIES = 10;

export interface RecentFileEntry {
  readonly name: string;
  readonly updatedAt: number;
  readonly handle?: FileSystemFileHandle;
}

export class RecentFilesStore {
  readonly #db: Promise<IDBDatabase>;

  constructor() {
    this.#db = openDatabase();
  }

  async list(): Promise<RecentFileEntry[]> {
    const db = await this.#db;
    const entries = await request<RecentFileEntry[]>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    );
    return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ENTRIES);
  }

  async put(entry: RecentFileEntry): Promise<void> {
    const db = await this.#db;
    await request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entry));
    await this.#trim();
  }

  async remove(name: string): Promise<void> {
    const db = await this.#db;
    await request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(name));
  }

  async #trim(): Promise<void> {
    const entries = await this.list();
    const db = await this.#db;
    for (const entry of entries.slice(MAX_ENTRIES)) {
      await request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(entry.name));
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('无法打开最近文件数据库'));
  });
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error('IndexedDB 请求失败'));
  });
}
