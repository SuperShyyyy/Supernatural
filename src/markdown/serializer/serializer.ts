/**
 * Document Model → Markdown。
 *
 * 与 parser 成对演进：所有标记偏好（bullet / order / tight / params）来自节点 attrs，
 * 因此 `md → doc → md` 的第一次输出可能做规范化（如 `_em_` → `*em*`），
 * 但第二次输出必须与之完全一致（幂等），这条契约由测试锁住。
 */

import type { Node as PMNode } from 'prosemirror-model';

import { headingLevelOf } from '../../core/document/schema';
import { escapeBlockStart, escapeInline, fenceCodeBlock, fenceInlineCode } from './escape';

const BLOCK_SEPARATOR = '\n\n';

export function serializeMarkdown(doc: PMNode): string {
  const blocks = serializeChildren(doc);
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

function serializeInline(parent: PMNode): string {
  let out = '';

  parent.forEach((child) => {
    if (child.type.name === 'hard_break') {
      out += '  \n';
      return;
    }

    const hasCodeMark = child.marks.some((mark) => mark.type.name === 'code');
    const raw = child.isText ? (child.text ?? '') : serializeInline(child);
    let text = hasCodeMark ? raw : escapeInline(raw);

    for (const mark of child.marks) {
      text = wrapMark(mark.type.name, text);
    }
    out += text;
  });

  return out;
}

function wrapMark(name: string, text: string): string {
  switch (name) {
    case 'strong':
      return `**${text}**`;
    case 'em':
      return `*${text}*`;
    case 'code':
      return fenceInlineCode(text);
    default:
      return text;
  }
}

function stringAttr(node: PMNode, name: string, fallback: string): string {
  const value = node.attrs[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberAttr(node: PMNode, name: string, fallback: number): number {
  const value = node.attrs[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
