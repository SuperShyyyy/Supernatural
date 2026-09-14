import type { RecentFileEntry } from '../filesystem/RecentFilesStore';

export interface TopbarActions {
  onNew(): void;
  onOpen(): void;
  onSaveAs(): void;
  onOpenRecent(entry: RecentFileEntry): void;
}

/**
 * 顶部栏。刻意保持极简：四个动作，没有图标墙。
 * Phase 4 的 Command System 会把这些按钮改成命令的另一种入口，逻辑位置不变。
 */
export class Topbar {
  readonly #actions: TopbarActions;
  readonly #recentButton: HTMLElement;
  readonly #recentList: HTMLElement;

  constructor(root: HTMLElement, actions: TopbarActions) {
    this.#actions = actions;
    this.#recentButton = requireElement(root, '#btn-recent');
    this.#recentList = requireElement(root, '#recent-list');

    requireElement(root, '#btn-new').addEventListener('click', () => actions.onNew());
    requireElement(root, '#btn-open').addEventListener('click', () => actions.onOpen());
    requireElement(root, '#btn-save-as').addEventListener('click', () => actions.onSaveAs());

    this.#recentButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleMenu();
    });

    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!this.#recentList.contains(target) && !this.#recentButton.contains(target)) {
        this.closeMenu();
      }
    });
  }

  setRecentFiles(entries: readonly RecentFileEntry[]): void {
    this.#recentList.replaceChildren();

    if (entries.length === 0) {
      this.#recentList.append(createElement('div', 'ui-menu__empty', '暂无最近文件'));
      return;
    }

    for (const entry of entries) {
      const item = createElement('button', 'ui-menu__item', entry.name);
      if (item instanceof HTMLButtonElement) item.type = 'button';
      item.title =
        entry.handle === undefined ? '需要重新选择文件' : `更新于 ${formatDate(entry.updatedAt)}`;
      item.addEventListener('click', () => {
        this.closeMenu();
        this.#actions.onOpenRecent(entry);
      });
      this.#recentList.append(item);
    }
  }

  toggleMenu(): void {
    this.#recentList.hidden = !this.#recentList.hidden;
  }

  closeMenu(): void {
    this.#recentList.hidden = true;
  }
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`[topbar] 缺少必需的 DOM 节点: ${selector}`);
  }
  return found;
}

function createElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}
