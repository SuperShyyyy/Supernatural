import type { Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import { columnResizing, tableEditing } from 'prosemirror-tables';

import { parseMarkdown, serializeMarkdown } from '../../markdown';
import { markdownSchema } from '../document/schema';
import { createBaseKeymap, createEditorKeymap } from './keymap';
import { createMarkdownInputRules } from './inputRules';
import { createNodeViews } from './nodeViews';
import { createSearchPlugin } from './search';

export interface EditorOptions {
  readonly mount: HTMLElement;
  readonly markdown: string;
  /**
   * 只通知"文档发生变化"，不携带序列化结果 —— 序列化（O(doc)）绝不能进入输入热路径，
   * 何时序列化由调用方（autosave / 保存命令）决定。
   */
  readonly onChange?: () => void;
  readonly schema?: Schema;
}

export interface DocumentStats {
  readonly characters: number;
  readonly words: number;
  readonly blocks: number;
}

export interface Editor {
  readonly view: EditorView;
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  getStats(): DocumentStats;
  focus(): void;
  destroy(): void;
}

export function createEditor(options: EditorOptions): Editor {
  const schema = options.schema ?? markdownSchema;
  const onChange = options.onChange;

  const plugins: Plugin[] = [
    history(),
    columnResizing(),
    tableEditing(),
    createMarkdownInputRules(schema),
    createSearchPlugin(),
    createEditorKeymap(schema),
    createBaseKeymap(),
  ];

  const state = EditorState.create({
    schema,
    doc: parseMarkdown(options.markdown, schema),
    plugins,
  });

  function dispatchTransaction(this: EditorView, transaction: Transaction): void {
    this.updateState(this.state.apply(transaction));
    if (transaction.docChanged) onChange?.();
  }

  const view = new EditorView(options.mount, {
    state,
    attributes: { class: 'editor-content', spellcheck: 'false' },
    nodeViews: createNodeViews(),
    dispatchTransaction,
  });

  /**
   * 点击编辑区下方的空白区域：若最后一个块不是段落，就补一个空段落并聚焦。
   *
   * 否则当最后一块是代码块 / 标题 / 公式这类非段落块时，点击它下方完全没反应，
   * 用户"没法在最后一行下面继续输入"。
   */
  const handleBlankAreaClick = (event: MouseEvent): void => {
    // 以"最后一个块"的底边为界（而不是整个编辑区）：点在它下方即视为"想在末尾继续写"。
    // 这样即使编辑区被撑满、点击仍落在 .editor-content 内，也能正确识别。
    const lastChild = view.dom.lastElementChild;
    const bottom =
      lastChild instanceof HTMLElement
        ? lastChild.getBoundingClientRect().bottom
        : view.dom.getBoundingClientRect().bottom;
    if (event.clientY <= bottom) return;

    const paragraph = schema.nodes['paragraph'];
    if (paragraph === undefined) return;
    const { state } = view;
    const last = state.doc.lastChild;
    if (last === null) return;

    // 阻止默认行为，避免 ProseMirror 把光标放到最后一个块（代码块）内部
    event.preventDefault();

    if (last.type.name === 'paragraph') {
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(state.doc.content.size))));
    } else {
      const insertPos = state.doc.content.size;
      const tr = state.tr.insert(insertPos, paragraph.createAndFill() ?? paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
      view.dispatch(tr);
    }
    view.focus();
  };
  // 用捕获阶段：在 ProseMirror 处理之前拦下"下方空白"的点击
  options.mount.addEventListener('mousedown', handleBlankAreaClick, true);

  return {
    view,
    getMarkdown: () => serializeMarkdown(view.state.doc),
    setMarkdown: (markdown: string) => {
      view.updateState(
        EditorState.create({ schema, doc: parseMarkdown(markdown, schema), plugins: view.state.plugins }),
      );
    },
    getStats: () => measure(view.state.doc),
    focus: () => view.focus(),
    destroy: () => {
      options.mount.removeEventListener('mousedown', handleBlankAreaClick, true);
      view.destroy();
    },
  };
}

function measure(doc: PMNode): DocumentStats {
  let blocks = 0;
  doc.forEach(() => {
    blocks += 1;
  });
  const text = doc.textContent;
  return { characters: text.length, words: countWords(text), blocks };
}

/** 中英混排计数：CJK 按字计，拉丁语系按词计。 */
function countWords(text: string): number {
  const cjk = text.match(/[㐀-鿿぀-ヿ]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
  return cjk + latin;
}
