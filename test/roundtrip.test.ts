import { describe, expect, it } from 'vitest';

import { DEMO_DOCUMENT } from '../src/app/demoDocument';
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
  '| 列一 | 列二 |\n| --- | --- |\n| a | b |\n',
  '![alt](img.png "width=300")\n',
  '![alt](img.png "标题")\n',
  '[ProseMirror](https://prosemirror.net)\n',
  '[带标题的链接](https://example.com "标题")\n',
  '行内 $a^2$ 公式\n',
  '$$\nE = mc^2\n$$\n',
  '```mermaid\ngraph LR\n  A --> B\n```\n',
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

  it('URL 里的空格会被编码，保证往返后仍是图片 / 链接', () => {
    // 裸空格在 CommonMark 里不是合法链接目标，必须用 <...> 包裹；
    // 我们序列化时统一编码成 %20，这样再次解析不需要尖括号也不会退化成文本。
    const image = roundTrip('![alt](<https://example.com/a b.png>)\n');
    expect(image).toBe('![alt](https://example.com/a%20b.png)\n');
    expect(parseMarkdown(image).firstChild?.firstChild?.type.name).toBe('image');

    const link = roundTrip('[标题](<https://example.com/a b.html>)\n');
    expect(link).toBe('[标题](https://example.com/a%20b.html)\n');
    expect(parseMarkdown(link).firstChild?.firstChild?.marks[0]?.type.name).toBe('link');
  });

  it('放宽 data: 校验但仍挡住危险协议', () => {
    // markdown-it 默认只放行 data:image/(gif|png|jpeg|webp)，svg 会被降级成文本；
    // parser 里放行全部 data:image/*，其余危险协议仍然拒绝。
    const svg = "![img](data:image/svg+xml;utf8,%3Csvg/%3E)\n";
    expect(roundTrip(svg)).toBe(svg);

    // 被拒绝的协议会退化成纯文本，绝不会变成链接 mark
    const dangerous = parseMarkdown('[x](javascript:alert(1))\n');
    expect(dangerous.firstChild?.firstChild?.marks.length).toBe(0);

    const htmlData = parseMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)\n');
    expect(htmlData.firstChild?.firstChild?.marks.length).toBe(0);
  });

  it('编码后的 data URI 图片可以正常往返', () => {
    const source =
      "![img](data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='64'%20height='64'%3E%3C/svg%3E)\n";
    const once = roundTrip(source);
    expect(once).toBe(source);
    expect(parseMarkdown(once).firstChild?.firstChild?.type.name).toBe('image');
  });

  it('示例文档能被完整解析（图片 / 表格 / 公式 / 图表都在）', () => {
    const doc = parseMarkdown(DEMO_DOCUMENT);
    const types = new Set<string>();
    doc.descendants((node) => {
      types.add(node.type.name);
      return true;
    });

    for (const expected of ['heading', 'paragraph', 'bullet_list', 'ordered_list', 'blockquote', 'code_block', 'table', 'image', 'math_inline', 'math_block', 'diagram']) {
      expect(types.has(expected)).toBe(true);
    }
  });

  it('图片宽度通过 title 通道往返', () => {
    const source = '![alt](img.png "width=300")\n';
    expect(roundTrip(source)).toBe(source);
    const doc = parseMarkdown(source);
    expect(doc.firstChild?.firstChild?.type.name).toBe('image');
    expect(doc.firstChild?.firstChild?.attrs['width']).toBe(300);
  });

  it('表格解析为语义结构（表头行用 th）', () => {
    const doc = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    const table = doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(2);
    expect(table?.child(0).child(0).type.name).toBe('table_header');
    expect(table?.child(1).child(0).type.name).toBe('table_cell');
  });

  it('公式与图表是原子节点，内容不参与普通文本转义', () => {
    const doc = parseMarkdown('$$\n\\frac{1}{2}\n$$\n');
    expect(doc.firstChild?.type.name).toBe('math_block');
    expect(doc.firstChild?.attrs['latex']).toBe('\\frac{1}{2}');

    const diagram = parseMarkdown('```mermaid\ngraph LR\n  A --> B\n```\n').firstChild;
    expect(diagram?.type.name).toBe('diagram');
    expect(diagram?.attrs['code']).toBe('graph LR\n  A --> B');
  });

  it('链接是 mark，不影响文本本身', () => {
    const doc = parseMarkdown('[文字](https://e.com)\n');
    const textNode = doc.firstChild?.firstChild;
    expect(textNode?.text).toBe('文字');
    expect(textNode?.marks[0]?.type.name).toBe('link');
    expect(textNode?.marks[0]?.attrs['href']).toBe('https://e.com');
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
