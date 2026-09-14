/**
 * Document Schema —— 编辑器的唯一真理来源。
 *
 * 设计原则（见 docs/ARCHITECTURE.md 3.2）：
 *  - 语义模型：文档里没有 `# `、`**` 这类可见标记，标记偏好存在 attrs 里
 *    （bullet / order / tight / params），序列化时再还原成 Markdown。
 *    这样"用户选中的就是粗体文本"，而不是"带着星号的文本"。
 *  - 节点命名与 Markdown 语义一一对应，parser / serializer 只做映射，不做猜测。
 */

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const MIN_HEADING_LEVEL: HeadingLevel = 1;
export const MAX_HEADING_LEVEL: HeadingLevel = 6;

export function isHeadingLevel(value: unknown): value is HeadingLevel {
  return HEADING_LEVELS.includes(value as HeadingLevel);
}

export function headingLevelOf(value: unknown): HeadingLevel {
  return isHeadingLevel(value) ? value : MIN_HEADING_LEVEL;
}

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block',
  parseDOM: [{ tag: 'p' }],
  toDOM: () => ['p', 0],
};

const heading: NodeSpec = {
  attrs: { level: { default: MIN_HEADING_LEVEL } },
  content: 'inline*',
  group: 'block',
  defining: true,
  parseDOM: HEADING_LEVELS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
  toDOM: (node) => [`h${headingLevelOf(node.attrs['level'])}`, 0],
};

const blockquote: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM: () => ['blockquote', 0],
};

/**
 * 列表节点手写而非直接复用 prosemirror-schema-list 的 addListNodes：
 * 我们需要在 attrs 里保留 Markdown 标记（bullet / order / tight），
 * 而 addListNodes 的签名依赖 OrderedMap，会额外引入一层不必要的数据结构耦合。
 * 列表命令（wrapInList / splitListItem / sinkListItem / liftListItem）仍直接用官方实现。
 */
const bullet_list: NodeSpec = {
  attrs: {
    bullet: { default: '-' },
    tight: { default: true },
  },
  content: 'list_item+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM: () => ['ul', 0],
};

const ordered_list: NodeSpec = {
  attrs: {
    order: { default: 1 },
    tight: { default: true },
  },
  content: 'list_item+',
  group: 'block',
  parseDOM: [
    {
      tag: 'ol',
      getAttrs: (dom) => {
        const start = Number((dom as HTMLElement).getAttribute('start'));
        return Number.isFinite(start) && start > 1 ? { order: start } : null;
      },
    },
  ],
  toDOM: (node) => {
    const order = node.attrs['order'];
    return typeof order === 'number' && order > 1 ? ['ol', { start: String(order) }, 0] : ['ol', 0];
  },
};

const list_item: NodeSpec = {
  content: 'paragraph block*',
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM: () => ['li', 0],
};

const code_block: NodeSpec = {
  attrs: { params: { default: '' } },
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
  toDOM: (node) => {
    const params = node.attrs['params'];
    const attrs = typeof params === 'string' && params.length > 0 ? { class: `language-${params}` } : {};
    return ['pre', ['code', attrs, 0]];
  },
};

const horizontal_rule: NodeSpec = {
  group: 'block',
  parseDOM: [{ tag: 'hr' }],
  toDOM: () => ['hr'],
};

const hard_break: NodeSpec = {
  inline: true,
  group: 'inline',
  selectable: false,
  parseDOM: [{ tag: 'br' }],
  toDOM: () => ['br'],
};

const text: NodeSpec = { group: 'inline' };

const strong: MarkSpec = {
  parseDOM: [
    { tag: 'strong' },
    { tag: 'b' },
    {
      style: 'font-weight',
      getAttrs: (value) => (/^(bold(er)?|[5-9]\d{2,})$/.test(String(value)) ? null : false),
    },
  ],
  toDOM: () => ['strong', 0],
};

const em: MarkSpec = {
  parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
  toDOM: () => ['em', 0],
};

const code: MarkSpec = {
  code: true,
  parseDOM: [{ tag: 'code' }],
  toDOM: () => ['code', 0],
};

export const markdownSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph,
    heading,
    blockquote,
    bullet_list,
    ordered_list,
    list_item,
    code_block,
    horizontal_rule,
    hard_break,
    text,
  },
  marks: { strong, em, code },
});
