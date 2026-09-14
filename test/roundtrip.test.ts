import { describe, expect, it } from 'vitest';

import { parseMarkdown, serializeMarkdown } from '../src/markdown';

function roundTrip(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown));
}

/** 第一次序列化允许做规范化，但第二次必须完全一致 —— 这是往返契约。 */
const IDEMPOTENT_CASES: readonly string[] = [
  '# Hello\n',
  '## 二级标题\n\n正文段落。\n',
  '**粗体** 与 *斜体* 与 `行内代码`\n',
  '- 一\n- 二\n- 三\n',
  '* 星号列表\n* 第二项\n',
  '3. 三\n4. 四\n',
  '- 外层\n  - 内层\n    - 更深层\n',
  '1. 外层\n   1. 内层\n',
  '> 引用内容\n',
  '> 外层引用\n>\n> > 嵌套引用\n',
  '---\n',
  '- 松散一\n\n- 松散二\n',
  '第一段\n软换行继续\n',
  '```ts\nconst a: number = 1;\n```\n',
  '~~~\nplain fence\n~~~\n',
  '- 列表项\n\n  列表项第二段\n',
  '包含 \\* 转义与 _下划线_ 的段落\n',
];

describe('markdown 往返', () => {
  it.each(IDEMPOTENT_CASES)('幂等：%j', (markdown) => {
    const once = roundTrip(markdown);
    expect(roundTrip(once)).toBe(once);
  });

  it('保留 ATX 标题级别', () => {
    expect(roundTrip('###### 六级\n')).toBe('###### 六级\n');
  });

  it('保留列表起始序号', () => {
    expect(roundTrip('3. 三\n4. 四\n')).toBe('3. 三\n4. 四\n');
  });

  it('保留代码围栏语言', () => {
    expect(roundTrip('```typescript\nconst a = 1;\n```\n')).toBe('```typescript\nconst a = 1;\n```\n');
  });

  it('保留紧凑 / 松散列表差异', () => {
    expect(roundTrip('- 一\n- 二\n')).toBe('- 一\n- 二\n');
    expect(roundTrip('- 一\n\n- 二\n')).toBe('- 一\n\n- 二\n');
  });

  it('行内代码含反引号时自动加长围栏', () => {
    // 代码内容为 `a`b``，单个反引号无法包裹，必须使用双反引号
    const once = roundTrip('``a`b``\n');
    expect(once).toBe('``a`b``\n');
    expect(roundTrip(once)).toBe(once);
  });

  it('代码块内容与围栏冲突时加长围栏', () => {
    const source = '````\n```\n````\n';
    const once = roundTrip(source);
    expect(once).toBe('````\n```\n````\n');
    expect(roundTrip(once)).toBe(once);
  });

  it('行首的块级标记会被转义，避免二次解析变形', () => {
    const once = roundTrip('# 不是标题的段落\n');
    expect(roundTrip(once)).toBe(once);
    expect(roundTrip('\\# 不是标题的段落\n')).toBe('\\# 不是标题的段落\n');
  });

  it('文档结构映射到语义节点而非可见标记', () => {
    const doc = parseMarkdown('# Hello\n\n**World**\n');
    expect(doc.child(0).type.name).toBe('heading');
    expect(doc.child(0).attrs['level']).toBe(1);
    expect(doc.child(0).textContent).toBe('Hello');

    const paragraph = doc.child(1);
    expect(paragraph.type.name).toBe('paragraph');
    expect(paragraph.firstChild?.marks.some((mark) => mark.type.name === 'strong')).toBe(true);
  });
});
