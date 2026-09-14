import type { Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, type Plugin, type Transaction } from 'prosemirror-state';
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
    destroy: () => view.destroy(),
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
