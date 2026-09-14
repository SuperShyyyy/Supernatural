import type { MarkType, NodeType, Schema } from 'prosemirror-model';

/**
 * schema.nodes / schema.marks 的索引访问在 noUncheckedIndexedAccess 下可能为 undefined，
 * 但这些 key 全部来自本地常量，取不到只可能是代码写错了 —— 直接抛错比到处判空更诚实。
 */
export function requireNodeType(schema: Schema, name: string): NodeType {
  const type = schema.nodes[name];
  if (type === undefined) {
    throw new Error(`[schema] 未定义的节点类型: ${name}`);
  }
  return type;
}

export function requireMarkType(schema: Schema, name: string): MarkType {
  const type = schema.marks[name];
  if (type === undefined) {
    throw new Error(`[schema] 未定义的标记类型: ${name}`);
  }
  return type;
}
