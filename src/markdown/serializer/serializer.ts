/**
 * Document Model → Markdown。
 *
 * 与 parser 成对演进：所有标记偏好（bullet / order / tight / params / width）来自节点 attrs，
 * 因此 `md → doc → md` 的第一次输出可能做规范化（如 `_em_` → `*em*`），
 * 但第二次输出必须与之完全一致（幂等），这条契约由测试锁住。
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';

import { headingLevelOf } from '../../core/document/schema';
import { encodeUrl, escapeBlockStart, escapeInline, fenceCodeBlock, fenceInlineCode } from './escape';

const BLOCK_SEPARATOR = '\n\n';

export function serializeMarkdown(doc: PMNode): string {
  // 空段落不对应任何 Markdown 文本（它就是源码里的空行），序列化时丢弃
  const blocks = serializeChildren(doc).filter((block) => block.length > 0);
  return blocks.length === 0 ? '' : `${blocks.join(BLOCK_SEPARATOR)}\n`;
}

function serializeChildren(parent: PMNode): string[] {
  const blocks: string[] = [];
  parent.forEach((child) => {
    const text = serializeBlock(child);
    if (text !== null) blocks.push(text);
  });
  return blocks;
}

function serializeBlock(node: PMNode): string | null {
  switch (node.type.name) {
    case 'paragraph':
      return escapeBlockStart(serializeInline(node));

    case 'heading':
      return `${'#'.repeat(headingLevelOf(node.attrs['level']))} ${serializeInline(node)}`;

    case 'blockquote':
      return serializeBlockquote(node);

    case 'code_block':
      return fenceCodeBlock(node.textContent, stringAttr(node, 'params', ''));

    case 'diagram':
      return fenceCodeBlock(stringAttr(node, 'code', ''), 'mermaid');

    case 'math_block':
      return `$$\n${stringAttr(node, 'latex', '')}\n$$`;

    case 'table':
      return serializeTable(node);

    case 'bullet_list':
    case 'ordered_list':
      return serializeList(node);

    case 'horizontal_rule':
      return '---';

    default:
      return null;
  }
}

function serializeBlockquote(node: PMNode): string {
  const inner = serializeChildren(node).join(BLOCK_SEPARATOR);
  return inner
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

function serializeList(list: PMNode): string {
  const tight = list.attrs['tight'] === true;
  const isOrdered = list.type.name === 'ordered_list';
  const start = numberAttr(list, 'order', 1);
  const bullet = stringAttr(list, 'bullet', '-');
  const separator = tight ? '\n' : BLOCK_SEPARATOR;

  const items: string[] = [];
  let index = 0;

  list.forEach((item) => {
    const marker = isOrdered ? `${start + index}.` : bullet;
    index += 1;
    const body = serializeChildren(item).join(separator);
    items.push(`${marker} ${indentContinuation(body, ' '.repeat(marker.length + 1))}`);
  });

  return items.join(separator);
}

/** 续行缩进到与首行正文对齐；空行不加尾随空格。 */
function indentContinuation(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 || line.length === 0 ? line : pad + line))
    .join('\n');
}

function serializeTable(table: PMNode): string {
  const rows: string[][] = [];
  let aligns: readonly (string | null)[] = [];

  table.forEach((row, _offset, index) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(serializeInline(cell)));
    // GFM 的对齐信息只在分隔行出现一次，取表头行的 align 即可
    if (index === 0) aligns = readRowAligns(row);
    rows.push(cells);
  });

  if (rows.length === 0) return '';

  const widths = rows.reduce<number[]>(
    (acc, cells) => cells.map((cell, i) => Math.max(acc[i] ?? 0, cell.length)),
    [],
  );
  const rule = `| ${widths
    .map((width, i) => alignmentRule(aligns[i] ?? null, width))
    .join(' | ')} |`;
  const lines = rows.map(
    (cells) => `| ${cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join(' | ')} |`,
  );

  return [lines[0] ?? '', rule, ...lines.slice(1)].join('\n');
}

function readRowAligns(row: PMNode): (string | null)[] {
  const aligns: (string | null)[] = [];
  row.forEach((cell) => {
    const align = cell.attrs['align'];
    aligns.push(typeof align === 'string' && align.length > 0 ? align : null);
  });
  return aligns;
}

function alignmentRule(align: string | null, width: number): string {
  if (align === null) return '-'.repeat(Math.max(3, width));
  const dashes = '-'.repeat(Math.max(1, Math.max(3, width) - 2));
  if (align === 'center') return `:${dashes}:`;
  return align === 'right' ? `${dashes}:` : `:${dashes}`;
}

function serializeInline(parent: PMNode): string {
  let out = '';

  parent.forEach((child) => {
    if (child.type.name === 'hard_break') {
      out += '  \n';
      return;
    }

    const hasCodeMark = child.marks.some((mark) => mark.type.name === 'code');
    const text = child.isText
      ? hasCodeMark
        ? (child.text ?? '')
        : escapeInline(child.text ?? '')
      : serializeInlineNode(child);

    out += applyMarks(text, child.marks);
  });

  return out;
}

function serializeInlineNode(node: PMNode): string {
  switch (node.type.name) {
    case 'image':
      return serializeImage(node);
    case 'math_inline':
      return `$${stringAttr(node, 'latex', '')}$`;
    default:
      return serializeInline(node);
  }
}

function serializeImage(node: PMNode): string {
  const alt = escapeInline(stringAttr(node, 'alt', ''));
  const src = encodeUrl(stringAttr(node, 'src', ''));
  const width = node.attrs['width'];
  const title =
    typeof width === 'number' && width > 0 ? `width=${width}` : stringAttr(node, 'title', '');
  const titlePart = title.length > 0 ? ` "${title}"` : '';
  return `![${alt}](${src}${titlePart})`;
}

function applyMarks(text: string, marks: readonly Mark[]): string {
  return marks.reduce((acc, mark) => wrapMark(acc, mark), text);
}

function wrapMark(text: string, mark: Mark): string {
  switch (mark.type.name) {
    case 'strong':
      return `**${text}**`;
    case 'em':
      return `*${text}*`;
    case 'code':
      return fenceInlineCode(text);
    case 'link': {
      const href = encodeUrl(stringAttrOfMark(mark, 'href'));
      const title = stringAttrOfMark(mark, 'title');
      const titlePart = title.length > 0 ? ` "${title}"` : '';
      return `[${text}](${href}${titlePart})`;
    }
    default:
      return text;
  }
}

function stringAttrOfMark(mark: Mark, name: string): string {
  const value = mark.attrs[name];
  return typeof value === 'string' ? value : '';
}

function stringAttr(node: PMNode, name: string, fallback: string): string {
  const value = node.attrs[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberAttr(node: PMNode, name: string, fallback: number): number {
  const value = node.attrs[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
