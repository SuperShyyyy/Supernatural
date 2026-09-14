import type { EditorView } from 'prosemirror-view';

import { runCommand, type CommandRegistry } from '../core/commands/registry';
import type { RecentFileEntry } from '../filesystem/RecentFilesStore';

export interface MenuBarActions {
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  onFind(): void;
  onReplace(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  onToggleTheme(): void;
  onShowShortcuts(): void;
  onOpenRecent(entry: RecentFileEntry): void;
}

interface MenuItem {
  readonly title: string;
  readonly keys?: string | undefined;
  readonly run: () => void;
}

interface Menu {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

/**
 * 菜单栏。刻意只保留 Typora 式的克制结构：六个菜单 + 一个最近文件区，
 * 不占用额外垂直空间（一行，高度与状态栏一致）。
 */
export class MenuBar {
  readonly #root: HTMLElement;
  readonly #registry: CommandRegistry;
  readonly #getView: () => EditorView | null;
  readonly #actions: MenuBarActions;
  readonly #openMenu: { node: HTMLElement | null } = { node: null };

  #recentFiles: readonly RecentFileEntry[] = [];

  constructor(
    root: HTMLElement,
    options: {
      registry: CommandRegistry;
      getView: () => EditorView | null;
      actions: MenuBarActions;
    },
  ) {
    this.#root = root;
    this.#registry = options.registry;
    this.#getView = options.getView;
    this.#actions = options.actions;

    this.render();

    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!this.#root.contains(target)) this.closeAll();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeAll();
    });
  }

  setRecentFiles(entries: readonly RecentFileEntry[]): void {
    this.#recentFiles = entries;
    this.render();
  }

  private render(): void {
    const nav = document.querySelector('.ui-menubar');
    nav?.replaceChildren();

    for (const menu of this.menus()) {
      const wrapper = document.createElement('div');
      wrapper.className = 'ui-menu';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-menu__button';
      button.textContent = menu.label;

      const list = document.createElement('div');
      list.className = 'ui-menu__list';
      list.hidden = true;
      for (const item of menu.items) {
        list.append(this.createMenuItem(item, list));
      }

      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const wasOpen = !list.hidden;
        this.closeAll();
        list.hidden = wasOpen;
        this.#openMenu.node = wasOpen ? null : list;
      });

      wrapper.append(button, list);
      nav?.append(wrapper);
    }
  }

  private menus(): Menu[] {
    const view = () => this.#getView();
    const run = (id: string): void => {
      const editorView = view();
      if (editorView !== null) runCommand(editorView, this.#registry, id);
    };
    const keys = (id: string): string | undefined => this.#registry.get(id)?.keys?.[0];

    const file: Menu = {
      label: '文件',
      items: [
        { title: '新建', run: () => this.#actions.onNew() },
        { title: '打开…', run: () => this.#actions.onOpen() },
        { title: '保存', keys: 'Ctrl/Cmd + S', run: () => this.#actions.onSave() },
        { title: '另存为…', run: () => this.#actions.onSaveAs() },
        ...this.#recentFiles.map<MenuItem>((entry) => ({
          title: entry.name,
          run: () => this.#actions.onOpenRecent(entry),
        })),
      ],
    };

    const edit: Menu = {
      label: '编辑',
      items: [
        { title: '撤销', keys: 'Ctrl/Cmd + Z', run: () => run('history.undo') },
        { title: '重做', keys: 'Ctrl/Cmd + Shift + Z', run: () => run('history.redo') },
        { title: '查找', keys: 'Ctrl/Cmd + F', run: () => this.#actions.onFind() },
        { title: '替换', keys: 'Ctrl/Cmd + H', run: () => this.#actions.onReplace() },
      ],
    };

    const viewMenu: Menu = {
      label: '视图',
      items: [
        { title: '放大', keys: 'Ctrl/Cmd + +', run: () => this.#actions.onZoomIn() },
        { title: '缩小', keys: 'Ctrl/Cmd + -', run: () => this.#actions.onZoomOut() },
        { title: '重置缩放', keys: 'Ctrl/Cmd + 0', run: () => this.#actions.onZoomReset() },
        { title: '切换深色 / 浅色', run: () => this.#actions.onToggleTheme() },
      ],
    };

    const format: Menu = {
      label: '格式',
      items: [
        { title: '粗体', keys: keys('format.strong'), run: () => run('format.strong') },
        { title: '斜体', keys: keys('format.em'), run: () => run('format.em') },
        { title: '行内代码', keys: keys('format.code'), run: () => run('format.code') },
        { title: '链接', keys: keys('format.link'), run: () => run('format.link') },
        { title: '标题 1', keys: keys('format.heading1'), run: () => run('format.heading1') },
        { title: '标题 2', keys: keys('format.heading2'), run: () => run('format.heading2') },
        { title: '标题 3', keys: keys('format.heading3'), run: () => run('format.heading3') },
        { title: '正文', keys: keys('format.paragraph'), run: () => run('format.paragraph') },
        { title: '无序列表', keys: keys('format.bulletList'), run: () => run('format.bulletList') },
        { title: '有序列表', keys: keys('format.orderedList'), run: () => run('format.orderedList') },
        { title: '引用', keys: keys('format.blockquote'), run: () => run('format.blockquote') },
        { title: '代码块', keys: keys('format.codeBlock'), run: () => run('format.codeBlock') },
        { title: '增加缩进', keys: 'Tab', run: () => run('format.indent') },
        { title: '减少缩进', keys: 'Shift + Tab', run: () => run('format.outdent') },
      ],
    };

    const insert: Menu = {
      label: '插入',
      items: [
        { title: '图片', keys: keys('insert.image'), run: () => run('insert.image') },
        { title: '表格', keys: keys('insert.table'), run: () => run('insert.table') },
        { title: '数学公式', keys: keys('insert.math'), run: () => run('insert.math') },
        { title: '分割线', run: () => run('insert.horizontalRule') },
      ],
    };

    const help: Menu = {
      label: '帮助',
      items: [{ title: '快捷键', run: () => this.#actions.onShowShortcuts() }],
    };

    return [file, edit, viewMenu, format, insert, help];
  }

  private createMenuItem(item: MenuItem, list: HTMLElement): HTMLElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'ui-menu__item';

    const label = document.createElement('span');
    label.textContent = item.title;
    node.append(label);

    if (item.keys !== undefined) {
      const hint = document.createElement('span');
      hint.className = 'ui-menu__keys';
      hint.textContent = formatKeys(item.keys);
      node.append(hint);
    }

    node.addEventListener('click', () => {
      this.closeAll();
      item.run();
    });
    void list;
    return node;
  }

  private closeAll(): void {
    for (const list of document.querySelectorAll('.ui-menu__list')) {
      if (list instanceof HTMLElement) list.hidden = true;
    }
    this.#openMenu.node = null;
  }
}

function formatKeys(keys: string): string {
  return keys.replace(/Mod/g, 'Ctrl/Cmd').replace(/-/g, '+').replace(/Shift/g, 'Shift');
}
