/**
 * Markdown → Document Model。
 *
 * 只在"打开文件 / 导入 / 粘贴外部 Markdown / 切换源码模式"时全量执行，
 * 绝不进入输入热路径（输入路径走 ProseMirror Transaction）。
 *
 * 使用 markdown-it 的 token 流而不是 mdast：token 更接近源码结构（markup / info / hidden），
 * 便于保留列表标记、紧凑/松散、围栏语言这些往返所需的细节。
 */

import MarkdownIt, { type Token } from 'markdown-it';
import texmath from 'markdown-it-texmath';
import type { Mark, MarkType, Node as PMNode, Schema } from 'prosemirror-model';

import { headingLevelOf, markdownSchema } from '../../core/document/schema';
import { requireMarkType, requireNodeType } from '../../core/document/nodeTypes';

/** 允许所有 data:image/* ：通过 <img> 加载的 SVG 不会执行脚本。 */
const ALLOWED_DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;/i;
/** 其余危险协议一律拒绝。 */
const BLOCKED_PROTOCOL = /^(?:javascript|vbscript|file):/i;

/**
 * markdown-it 默认只放行 data:image/(gif|png|jpeg|webp)，
 * 会把 data:image/svg+xml 整段降级成纯文本（表现为"图片变成一串源码文字"）。
 * 这里放行全部 data:image/*，其余危险协议仍然拒绝。
 */
function validateLink(url: string): boolean {
  const value = url.trim().toLowerCase();
  if (value.startsWith('data:')) return ALLOWED_DATA_IMAGE.test(value);
  return !BLOCKED_PROTOCOL.test(value);
}

/**
 * 只用 markdown-it 做词法/语法分析，从不使用它的 renderer —— 渲染交给 ProseMirror。
 * texmath 提供 $...$ 与 $$...$$ 的 token（行内公式在 Phase 2 起支持）。
 */
const tokenizer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
}).use(texmath);

// validateLink 不在构造参数类型里（v15），只能在实例上覆盖
tokenizer.validateLink = validateLink;

interface BlockResult {
  readonly nodes: readonly PMNode[];
  /** 结束位置之后的下标（调用方从此处继续扫描） */
  readonly next: number;
}

export function parseMarkdown(source: string, schema: Schema = markdownSchema): PMNode {
  const tokens = tokenizer.parse(source, {});
  const { nodes } = parseBlocks(schema, tokens, 0, () => false);
  // doc 的内容模型是 block+，空源码必须补一个空段落（新建文档就是这种情况）
  const blocks = nodes.length > 0 ? nodes : [requireNodeType(schema, 'paragraph').createChecked(null)];
  return requireNodeType(schema, 'doc').createChecked(null, blocks);
}

/* ------------------------------- block 层 ------------------------------- */

function parseBlocks(
  schema: Schema,
  tokens: readonly Token[],
  start: number,
  isEnd: (token: Token) => boolean,
): BlockResult {
  const nodes: PMNode[] = [];
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (isEnd(token)) break;

    switch (token.type) {
      case 'heading_open': {
        const close = findClose(tokens, index, 'heading_close');
        const content = parseInline(schema, tokens.slice(index + 1, close));
        nodes.push(
          requireNodeType(schema, 'heading').createChecked(
            { level: headingLevelOf(Number(token.tag.slice(1))) },
            content,
          ),
        );
        index = close + 1;
        break;
      }

      case 'paragraph_open': {
        const close = findClose(tokens, index, 'paragraph_close');
        const content = parseInline(schema, tokens.slice(index + 1, close));
        nodes.push(requireNodeType(schema, 'paragraph').createChecked(null, content));
        index = close + 1;
        break;
      }

      case 'blockquote_open': {
        const close = findClose(tokens, index, 'blockquote_close');
        const inner = parseBlocks(schema, tokens, index + 1, (t) => t === tokens[close]);
        nodes.push(requireNodeType(schema, 'blockquote').createChecked(null, inner.nodes));
        index = close + 1;
        break;
      }

      case 'bullet_list_open':
      case 'ordered_list_open': {
        const list = parseList(schema, tokens, index);
        nodes.push(list.node);
        index = list.next;
        break;
      }

      case 'fence': {
        // fence 是单 token：content 为代码正文（含尾部换行），info 为语言
        const params = token.info.trim();
        if (params === 'mermaid') {
          nodes.push(
            requireNodeType(schema, 'diagram').createChecked({ code: stripTrailingNewline(token.content) }),
          );
        } else {
          nodes.push(createCodeBlock(schema, stripTrailingNewline(token.content), params));
        }
        index += 1;
        break;
      }

      case 'math_block': {
        nodes.push(requireNodeType(schema, 'math_block').createChecked({ latex: token.content.trim() }));
        index += 1;
        break;
      }

      case 'table_open': {
        const table = parseTable(schema, tokens, index);
        nodes.push(table.node);
        index = table.next;
        break;
      }

      case 'code_block': {
        // 缩进代码块没有语言信息
        nodes.push(createCodeBlock(schema, stripTrailingNewline(token.content), ''));
        index += 1;
        break;
      }

      case 'hr': {
        nodes.push(requireNodeType(schema, 'horizontal_rule').createChecked(null));
        index += 1;
        break;
      }

      default:
        index += 1;
        break;
    }
  }

  return { nodes, next: index };
}

function createCodeBlock(schema: Schema, content: string, params: string): PMNode {
  return requireNodeType(schema, 'code_block').createChecked(
    { params },
    content.length > 0 ? schema.text(content) : null,
  );
}

/** markdown-it 的 fence / code_block content 自带尾部换行，序列化时会再补一个，必须去掉。 */
function stripTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function parseList(schema: Schema, tokens: readonly Token[], open: number): { node: PMNode; next: number } {
  const openToken = tokens[open];
  if (openToken === undefined) {
    throw new Error('[markdown] 列表缺少 open token');
  }

  const isOrdered = openToken.type === 'ordered_list_open';
  const closeIndex = findClose(tokens, open, isOrdered ? 'ordered_list_close' : 'bullet_list_close');
  const items: PMNode[] = [];

  let index = open + 1;
  while (index < closeIndex) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.type !== 'list_item_open') {
      index += 1;
      continue;
    }
    const itemClose = findClose(tokens, index, 'list_item_close');
    const inner = parseBlocks(schema, tokens, index + 1, (t) => t === tokens[itemClose]);
    items.push(requireNodeType(schema, 'list_item').createChecked(null, inner.nodes));
    index = itemClose + 1;
  }

  const type = requireNodeType(schema, isOrdered ? 'ordered_list' : 'bullet_list');
  const attrs = isOrdered
    ? { order: listStartOrder(openToken), tight: isTight(tokens, open, closeIndex) }
    : { bullet: openToken.markup.length > 0 ? openToken.markup : '-', tight: isTight(tokens, open, closeIndex) };

  return { node: type.createChecked(attrs, items), next: closeIndex + 1 };
}

/** markdown-it 在紧凑列表中把段落 token 标记为 hidden —— 这是官方判定 tight 的方式。 */
function isTight(tokens: readonly Token[], open: number, close: number): boolean {
  const paragraph = tokens.slice(open + 1, close).find((token) => token.type === 'paragraph_open');
  return paragraph === undefined ? true : paragraph.hidden === true;
}

function listStartOrder(token: Token): number {
  const start = Number(token.attrGet('start'));
  return Number.isFinite(start) && start > 0 ? Math.floor(start) : 1;
}

/** 从 open 位置向后找到配对的 close（同类型嵌套计数）。 */
function findClose(tokens: readonly Token[], openIndex: number, closeType: string): number {
  const openToken = tokens[openIndex];
  if (openToken === undefined) return tokens.length;
  const openType = openToken.type;
  let depth = 0;

  for (let i = openIndex; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) break;
    if (token.type === openType) depth += 1;
    else if (token.type === closeType) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

/**
 * GFM 表格：table > table_row > (table_header | table_cell)。
 * 单元格内容按 inline 处理（GFM 单元格里没有块级结构）。
 */
function parseTable(schema: Schema, tokens: readonly Token[], open: number): { node: PMNode; next: number } {
  const close = findClose(tokens, open, 'table_close');
  const tableType = requireNodeType(schema, 'table');
  const rowType = requireNodeType(schema, 'table_row');
  const headerType = requireNodeType(schema, 'table_header');
  const cellType = requireNodeType(schema, 'table_cell');
  const rows: PMNode[] = [];

  let index = open + 1;
  while (index < close) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.type !== 'tr_open') {
      index += 1;
      continue;
    }

    const rowClose = findClose(tokens, index, 'tr_close');
    const cells: PMNode[] = [];
    let cursor = index + 1;

    while (cursor < rowClose) {
      const cellToken = tokens[cursor];
      if (cellToken === undefined) break;
      if (cellToken.type !== 'th_open' && cellToken.type !== 'td_open') {
        cursor += 1;
        continue;
      }
      const isHeader = cellToken.type === 'th_open';
      const cellClose = findClose(tokens, cursor, isHeader ? 'th_close' : 'td_close');
      const content = parseInline(schema, tokens.slice(cursor + 1, cellClose));
      cells.push(
        (isHeader ? headerType : cellType).createChecked({ align: readAlign(cellToken) }, content),
      );
      cursor = cellClose + 1;
    }

    rows.push(rowType.createChecked(null, cells));
    index = rowClose + 1;
  }

  return { node: tableType.createChecked(null, rows), next: close + 1 };
}

/**
 * 图片 attrs。宽度借用 title 通道存放（`![alt](src "width=300")`）：
 * Markdown 图片的标题本身极少使用，用它承载宽度可以做到纯文本往返而无需扩展语法。
 */
function readImageAttrs(token: Token): { src: string; alt: string; title: string; width: number | null } {
  const title = stringAttr(token, 'title');
  const widthMatch = /(?:^|\s)width=(\d+)(?:\s|$)/.exec(title);
  const width = widthMatch === null ? null : Number(widthMatch[1]);
  return {
    src: stringAttr(token, 'src'),
    alt: token.content,
    title: width === null ? title : title.replace(widthMatch?.[0] ?? '', '').trim(),
    width: width !== null && Number.isFinite(width) && width > 0 ? width : null,
  };
}

/** GFM 对齐写在 th/td 的 style 属性里（`text-align:center`）。 */
function readAlign(token: Token): string | null {
  const style = stringAttr(token, 'style');
  const match = /text-align:\s*(left|center|right)/.exec(style);
  return match === null ? null : (match[1] ?? null);
}

function stringAttr(token: Token, name: string): string {
  const value = token.attrGet(name);
  return value === null || value === undefined ? '' : String(value);
}

/* ------------------------------- inline 层 ------------------------------- */

function parseInline(schema: Schema, tokens: readonly Token[]): readonly PMNode[] {
  const nodes: PMNode[] = [];
  const marks: Mark[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'inline':
        nodes.push(...parseInline(schema, token.children ?? []));
        break;

      case 'text':
        pushText(schema, nodes, token.content, marks);
        break;

      case 'code_inline':
        pushText(schema, nodes, token.content, [...marks, requireMarkType(schema, 'code').create()]);
        break;

      case 'image': {
        const attrs = readImageAttrs(token);
        nodes.push(requireNodeType(schema, 'image').createChecked(attrs, null, [...marks]));
        break;
      }

      case 'math_inline':
        nodes.push(
          requireNodeType(schema, 'math_inline').createChecked({ latex: token.content }, null, [...marks]),
        );
        break;

      case 'link_open':
        marks.push(
          requireMarkType(schema, 'link').create({
            href: stringAttr(token, 'href'),
            title: stringAttr(token, 'title'),
          }),
        );
        break;

      case 'link_close':
        dropMark(marks, requireMarkType(schema, 'link'));
        break;

      case 'strong_open':
        marks.push(requireMarkType(schema, 'strong').create());
        break;

      case 'em_open':
        marks.push(requireMarkType(schema, 'em').create());
        break;

      case 'strong_close':
        dropMark(marks, requireMarkType(schema, 'strong'));
        break;

      case 'em_close':
        dropMark(marks, requireMarkType(schema, 'em'));
        break;

      case 'softbreak':
        // 保留 \n：Markdown 语义上是软换行，浏览器渲染时折叠为空格，往返无损
        pushText(schema, nodes, '\n', marks);
        break;

      case 'hard_break':
        nodes.push(requireNodeType(schema, 'hard_break').createChecked(null));
        break;

      default:
        break;
    }
  }

  return nodes;
}

function pushText(schema: Schema, nodes: PMNode[], content: string, marks: readonly Mark[]): void {
  if (content.length === 0) return;
  nodes.push(schema.text(content, marks.length > 0 ? [...marks] : null));
}

function dropMark(marks: Mark[], type: MarkType): void {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    if (marks[i]?.type === type) {
      marks.splice(i, 1);
      return;
    }
  }
}
