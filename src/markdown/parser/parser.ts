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
import type { Mark, MarkType, Node as PMNode, Schema } from 'prosemirror-model';

import { headingLevelOf, markdownSchema } from '../../core/document/schema';
import { requireMarkType, requireNodeType } from '../../core/document/nodeTypes';

const tokenizer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});

interface BlockResult {
  readonly nodes: readonly PMNode[];
  /** 结束位置之后的下标（调用方从此处继续扫描） */
  readonly next: number;
}

export function parseMarkdown(source: string, schema: Schema = markdownSchema): PMNode {
  const tokens = tokenizer.parse(source, {});
  const { nodes } = parseBlocks(schema, tokens, 0, () => false);
  return requireNodeType(schema, 'doc').createChecked(null, nodes);
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
        nodes.push(createCodeBlock(schema, stripTrailingNewline(token.content), token.info.trim()));
        index += 1;
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
