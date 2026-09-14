/**
 * Markdown 文本转义。
 *
 * 只转义"会改变语义"的字符，不做全量转义 —— 全量转义会让源码变得不可读，
 * 而可读性正是 Markdown 的价值所在。
 */

/**
 * 行内会构成 Markdown 语法的字符。
 * `$` 也在其中：Phase 2 起 `$...$` 会被解析成公式，字面量美元符号必须转义。
 */
const INLINE_SPECIALS = /([\\`*_[\]$])/g;

/** 位于行首时会变成块级语法的字符（段落首字符需要处理）。 */
const BLOCK_START_SPECIALS = /^(\s*)([#>+-]|\d+\.)/;

export function escapeInline(text: string): string {
  return text.replace(INLINE_SPECIALS, '\\$1');
}

/**
 * 处理行首特例：`# 标题`、`> 引用`、`- 列表`、`1. 有序列表` 这类内容
 * 出现在普通段落首行时必须转义，否则再次解析会变成别的块。
 */
export function escapeBlockStart(text: string): string {
  const match = BLOCK_START_SPECIALS.exec(text);
  if (match === null) return text;
  const [, indent = '', marker = ''] = match;
  return `${indent}\\${marker}${text.slice(indent.length + marker.length)}`;
}

/**
 * 编码链接目标（图片 src / 链接 href）。
 *
 * Markdown 的 link destination 不允许出现裸空格与尖括号，一旦出现整行就会
 * 退化成纯文本（data URI 最容易踩到：`<svg xmlns='...' width='...'>` 里全是空格）。
 * 已经存在的 %xx 编码保持不动，避免二次编码。
 */
export function encodeUrl(url: string): string {
  return url.replace(/\s/g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E');
}

/** 计算字符串中最长的连续反引号长度，用于选择足够的围栏长度。 */
export function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    if (char === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** 为行内代码挑选合适的反引号围栏：内容含反引号时需要更长的围栏并加空格。 */
export function fenceInlineCode(text: string): string {
  const fence = '`'.repeat(Math.max(1, longestBacktickRun(text) + 1));
  const needsPadding = text.startsWith('`') || text.endsWith('`');
  return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** 为代码块挑选围栏：内容里出现 ``` 时加长围栏，保证闭合。 */
export function fenceCodeBlock(text: string, params: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${params}\n${text}\n${fence}`;
}
