import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { MarkType, Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

import { requireNodeType } from '../document/nodeTypes';

/**
 * Markdown 快捷输入（Typora 手感的核心）：
 *
 *   `# ` / `## ` … → 标题      `- ` / `* ` / `+ ` → 无序列表
 *   `1. ` → 有序列表            `> ` → 引用
 *   ` ``` ` → 代码块            `---` → 分割线
 *   `**粗体**` / `*斜体*` / `` `代码` `` → 对应 mark
 *
 * 规则作用在"块内光标前的文本"上，因此不会在正文中间误触发。
 */
export function createMarkdownInputRules(schema: Schema): Plugin {
  const heading = requireNodeType(schema, 'heading');
  const bulletList = requireNodeType(schema, 'bullet_list');
  const orderedList = requireNodeType(schema, 'ordered_list');
  const blockquote = requireNodeType(schema, 'blockquote');
  const codeBlock = requireNodeType(schema, 'code_block');

  const rules: InputRule[] = [];

  for (let level = 1; level <= 6; level += 1) {
    rules.push(
      textblockTypeInputRule(new RegExp(`^(#{${level}})\\s$`), heading, () => ({ level })),
    );
  }

  rules.push(
    wrappingInputRule(/^\s*([-+*])\s$/, bulletList, (match) => ({ bullet: match[1] ?? '-' })),
    wrappingInputRule(/^\s*(\d+)([.)])\s$/, orderedList, (match) => ({
      order: Number(match[1] ?? 1),
    })),
    wrappingInputRule(/^\s*>\s$/, blockquote),
    textblockTypeInputRule(/^```([A-Za-z0-9+#._-]*)\s$/, codeBlock, (match) => ({
      params: match[1] ?? '',
    })),
    // Typora 风格：~~~ 围栏同样支持带语言，如 ~~~java / ~~~python
    textblockTypeInputRule(/^~~~([A-Za-z0-9+#._-]*)\s$/, codeBlock, (match) => ({
      params: match[1] ?? '',
    })),
    horizontalRuleRule(requireNodeType(schema, 'horizontal_rule')),
    markRule(/(?:^|\s)\*\*([^*]+)\*\*$/, requireMark(schema, 'strong'), 2),
    markRule(/(?:^|\s)(?<!\*)\*([^*]+)\*$/, requireMark(schema, 'em'), 1),
    markRule(/(?:^|\s)`([^`]+)`$/, requireMark(schema, 'code'), 1),
  );

  return inputRules({ rules });
}

function requireMark(schema: Schema, name: string): MarkType {
  const type = schema.marks[name];
  if (type === undefined) throw new Error(`[inputRules] 未定义的标记类型: ${name}`);
  return type;
}

/**
 * 行内标记规则：`**文本**` 输入完成后立刻变成粗体文本（标记字符被删掉）。
 *
 * `start` 由 ProseMirror 传入，指向 match[0] 在文档中的起始位置；
 * `end` 指向光标，因此 `end - start === match[0].length`。
 * 只删除标记字符本身，前导空白（用于避免正文中间误触发）必须保留。
 */
function markRule(regexp: RegExp, markType: MarkType, markerLength: number): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const content = match[1];
    const whole = match[0];
    if (content === undefined || whole === undefined || content.length === 0) return null;

    const contentIndex = whole.indexOf(content);
    if (contentIndex < markerLength) return null;

    const from = start + contentIndex;
    const to = from + content.length;
    // 触发规则时，最后输入的那个字符还没进文档，所以 [to, end) 就是已输入的后缀标记
    if (to > end) return null;

    const tr = state.tr;
    tr.addMark(from, to, markType.create());
    // 先删尾部再删头部，避免第一次删除把第二次的位置挪动
    tr.delete(to, end);
    tr.delete(from - markerLength, from);
    return tr;
  });
}

/**
 * `---` → 分割线。
 * 注意替换的是 [start - 1, end]：start 指向文本内容起点，减 1 才能覆盖整个文本块，
 * 否则会把 hr 塞进段落内部，产生非法文档。
 */
function horizontalRuleRule(nodeType: ReturnType<typeof requireNodeType>): InputRule {
  return new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
    if (start <= 0) return null;
    return state.tr.replaceWith(start - 1, end, nodeType.createChecked(null));
  });
}
