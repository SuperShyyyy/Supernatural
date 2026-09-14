/**
 * Document Schema —— 编辑器的唯一真理来源。
 *
 * 设计原则（见 docs/ARCHITECTURE.md 3.2）：
 *  - 语义模型：文档里没有 `# `、`**` 这类可见标记，标记偏好存在 attrs 里
 *    （bullet / order / tight / params / width），序列化时再还原成 Markdown。
 *    这样"用户选中的就是粗体文本"，而不是"带着星号的文本"。
 *  - 节点命名与 Markdown 语义一一对应，parser / serializer 只做映射，不做猜测。
 */

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const MIN_HEADING_LEVEL: HeadingLevel = 1;

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

/**
 * 图片：inline + atom（光标整体跳过），宽度存 attrs 而不是内联 style，
 * 这样 Undo/Redo、序列化、NodeView 三者看到的是同一份状态。
 */
const image: NodeSpec = {
  inline: true,
  atom: true,
  group: 'inline',
  attrs: {
    src: { default: '' },
    alt: { default: '' },
    title: { default: '' },
    width: { default: null },
  },
  parseDOM: [
    {
      tag: 'img[src]',
      getAttrs: (dom) => {
        const element = dom as HTMLImageElement;
        return {
          src: element.getAttribute('src') ?? '',
          alt: element.getAttribute('alt') ?? '',
          title: element.getAttribute('title') ?? '',
          width: readWidth(element),
        };
      },
    },
  ],
  toDOM: (node) => {
    const width = node.attrs['width'];
    const style = typeof width === 'number' && width > 0 ? { style: `width:${width}px` } : {};
    return ['img', { src: String(node.attrs['src'] ?? ''), alt: String(node.attrs['alt'] ?? ''), ...style }];
  },
};

/** 行内公式：$ ... $ */
const math_inline: NodeSpec = {
  inline: true,
  atom: true,
  group: 'inline',
  attrs: { latex: { default: '' } },
  parseDOM: [{ tag: 'span[data-math-inline]', getAttrs: (dom) => ({ latex: (dom as HTMLElement).dataset['mathInline'] ?? '' }) }],
  toDOM: (node) => ['span', { 'data-math-inline': String(node.attrs['latex'] ?? '') }],
};

/** 块级公式：$$ ... $$ */
const math_block: NodeSpec = {
  atom: true,
  group: 'block',
  attrs: { latex: { default: '' } },
  parseDOM: [{ tag: 'div[data-math-block]', getAttrs: (dom) => ({ latex: (dom as HTMLElement).dataset['mathBlock'] ?? '' }) }],
  toDOM: (node) => ['div', { 'data-math-block': String(node.attrs['latex'] ?? '') }],
};

/** Mermaid 图表：底层存代码，渲染结果不进文档（避免把 SVG 写回 Markdown）。 */
const diagram: NodeSpec = {
  atom: true,
  group: 'block',
  attrs: { code: { default: '' } },
  parseDOM: [{ tag: 'div[data-diagram]', getAttrs: (dom) => ({ code: (dom as HTMLElement).dataset['diagram'] ?? '' }) }],
  toDOM: (node) => ['div', { 'data-diagram': String(node.attrs['code'] ?? '') }],
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

const link: MarkSpec = {
  attrs: { href: { default: '' }, title: { default: '' } },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs: (dom) => {
        const element = dom as HTMLAnchorElement;
        return {
          href: element.getAttribute('href') ?? '',
          title: element.getAttribute('title') ?? '',
        };
      },
    },
  ],
  toDOM: (mark) => [
    'a',
    {
      href: String(mark.attrs['href'] ?? ''),
      ...(String(mark.attrs['title'] ?? '').length > 0 ? { title: String(mark.attrs['title']) } : {}),
    },
    0,
  ],
};

/**
 * 单元格对齐走 GFM 的 `:--- / :---: / ---:`。
 * 用 prosemirror-tables 的 cellAttributes 扩展，而不是另造一个节点类型，
 * 这样表格命令（增删行列、合并）继续可用。
 */
const tableSpecs = tableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || null,
      setDOMAttr: (value, attrs) => {
        if (typeof value === 'string' && value.length > 0) {
          (attrs as Record<string, string>)['style'] = `text-align: ${value}`;
        }
      },
    },
  },
});

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
    diagram,
    math_block,
    horizontal_rule,
    image,
    math_inline,
    hard_break,
    text,
    ...tableSpecs,
  },
  marks: { strong, em, code, link },
});

function readWidth(element: HTMLImageElement): number | null {
  const raw = element.getAttribute('width') ?? element.style.width.replace('px', '');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
