import type { EditorView } from 'prosemirror-view';

import { closeSearch, getSearchState, moveSearch, replaceAll, replaceCurrent, setSearchQuery } from '../core/editor/search';

export interface SearchPanelOptions {
  readonly getView: () => EditorView | null;
  readonly onClose: () => void;
  /** 替换模式（Ctrl+H）时聚焦替换框 */
  readonly withReplace?: boolean;
}

const INPUT_DEBOUNCE_MS = 120;

/**
 * 查找 / 替换面板。
 *
 * 查询输入做了 120ms 防抖：文档索引是 O(n) 的，逐字符重算在大文档上会掉帧。
 * 面板关闭时清空查询，插件随之停止维护匹配列表，不留下任何常驻开销。
 */
export class SearchPanel {
  readonly #dom: HTMLElement;
  readonly #input: HTMLInputElement;
  readonly #replaceInput: HTMLInputElement;
  readonly #counter: HTMLElement;
  readonly #getView: () => EditorView | null;
  readonly #onClose: () => void;

  #timer = 0;

  constructor(options: SearchPanelOptions) {
    this.#getView = options.getView;
    this.#onClose = options.onClose;

    this.#dom = element('div', 'search-panel');
    this.#dom.hidden = true;

    this.#input = input('search-input', '查找');
    this.#replaceInput = input('replace-input', '替换');
    this.#counter = element('span', 'search-panel__count');
    this.#counter.textContent = '0/0';

    const prev = button('‹', '上一个');
    const next = button('›', '下一个');
    const replace = button('替换', '替换当前');
    const replaceAllButton = button('全部替换', '替换全部');
    const close = button('✕', '关闭');

    this.#input.addEventListener('input', () => this.#scheduleSearch());
    this.#input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        moveSearchView(this.#getView(), event.shiftKey ? -1 : 1);
        this.refresh();
      }
      if (event.key === 'Escape') this.hide();
    });
    this.#replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#replaceOne();
      }
      if (event.key === 'Escape') this.hide();
    });

    prev.addEventListener('click', () => this.#move(-1));
    next.addEventListener('click', () => this.#move(1));
    replace.addEventListener('click', () => this.#replaceOne());
    replaceAllButton.addEventListener('click', () => {
      const view = this.#getView();
      if (view !== null) replaceAll(view, this.#replaceInput.value);
      this.refresh();
    });
    close.addEventListener('click', () => this.hide());

    this.#dom.append(
      this.#input,
      this.#counter,
      prev,
      next,
      element('span', 'search-panel__divider'),
      this.#replaceInput,
      replace,
      replaceAllButton,
      close,
    );

    document.body.append(this.#dom);
  }

  show(withReplace = false): void {
    this.#dom.hidden = false;
    const view = this.#getView();
    const selected = view === null ? '' : view.state.doc.textBetween(
      view.state.selection.from,
      view.state.selection.to,
      '\n',
      '\n',
    );
    if (selected.length > 0 && selected.length < 100) this.#input.value = selected;

    (withReplace ? this.#replaceInput : this.#input).focus();
    this.#input.select();
    this.#scheduleSearch();
  }

  hide(): void {
    this.#dom.hidden = true;
    const view = this.#getView();
    if (view !== null) closeSearch(view);
    this.#onClose();
  }

  get visible(): boolean {
    return !this.#dom.hidden;
  }

  refresh(): void {
    const view = this.#getView();
    const state = view === null ? undefined : getSearchState(view);
    const total = state?.matches.length ?? 0;
    const current = total === 0 ? 0 : (state?.current ?? -1) + 1;
    this.#counter.textContent = `${current}/${total}`;
  }

  #scheduleSearch(): void {
    if (this.#timer !== 0) window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.#timer = 0;
      const view = this.#getView();
      if (view === null) return;
      setSearchQuery(view, this.#input.value, false);
      moveSearchView(view, 0);
      this.refresh();
    }, INPUT_DEBOUNCE_MS);
  }

  #move(delta: number): void {
    moveSearchView(this.#getView(), delta);
    this.refresh();
  }

  #replaceOne(): void {
    const view = this.#getView();
    if (view === null) return;
    if (replaceCurrent(view, this.#replaceInput.value)) moveSearchView(view, 0);
    this.refresh();
  }
}

/** delta = 0 表示"停在/跳到当前匹配"，用于首次定位与替换后重新定位。 */
function moveSearchView(view: EditorView | null, delta: number): void {
  if (view === null) return;
  if (delta === 0) {
    const state = getSearchState(view);
    if (state !== undefined && state.current < 0 && state.matches.length > 0) moveSearch(view, 1);
    else moveSearch(view, 0);
    return;
  }
  moveSearch(view, delta);
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function input(className: string, placeholder: string): HTMLInputElement {
  const node = document.createElement('input');
  node.type = 'text';
  node.className = `search-panel__input ${className}`;
  node.placeholder = placeholder;
  return node;
}

function button(label: string, title: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'search-panel__btn';
  node.textContent = label;
  node.title = title;
  return node;
}
