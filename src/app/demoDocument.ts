/** 首次打开（本地没有任何文档时）的示例内容，覆盖 Phase 1 支持的全部节点。 */

export const DEMO_DOCUMENT = `# md-editer

这是一个**语义节点**驱动的 Markdown 编辑器：你看到的就是渲染结果，而不是源码。

## 可以立刻试

- 输入 \`# \`、\`- \`、\`1. \`、\`> \` 这类前缀后按空格（Markdown 快捷输入在 Phase 4）
- \`Ctrl/Cmd + B\` 粗体、\`+ I\` 斜体、\`+ E\` 行内代码
- \`Ctrl/Cmd + 1..6\` 标题、\`+ 0\` 正文
- \`Ctrl/Cmd + Shift + 8/9\` 无序 / 有序列表
- \`Tab\` / \`Shift + Tab\` 调整列表层级
- \`Ctrl/Cmd + Z\` / \`Ctrl/Cmd + Shift + Z\` 撤销 / 重做
- \`Ctrl/Cmd + S\` 立即保存

## 已经支持的节点

1. 标题（H1–H6）
2. 段落与软换行
3. **粗体**、*斜体*、\`行内代码\`
4. 有序列表
5. 无序列表
6. 引用

> 引用里可以再放列表：
>
> - 嵌套项一
> - 嵌套项二

还有一个代码块：

\`\`\`typescript
export function hello(name: string): string {
  return \`hello, \${name}\`;
}
\`\`\`

## 富内容

| 功能 | 快捷键 | 说明 |
| --- | --- | --- |
| 图片 | \`Ctrl/Cmd + Alt + I\` | 拖动右下角把手可调整宽度 |
| 表格 | \`Ctrl/Cmd + Alt + T\` | 在表格内按 \`Tab\` 跳到下一格 |
| 链接 | \`Ctrl/Cmd + K\` | 有选区则加链接，无选区则插入 URL |

行内公式：$a^2 + b^2 = c^2$

块级公式：

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

![示例图片](data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='160'><rect width='100%' height='100%' fill='%234b8bf4'/><text x='50%' y='50%' fill='white' font-size='26' text-anchor='middle' dominant-baseline='middle'>示例图片（可拖动右下角调整宽度）</text></svg>)

\`\`\`mermaid
graph LR
  A[Markdown] --> B[Document Model]
  B --> C[Editor View]
\`\`\`

---

随意修改：内容会自动保存到浏览器本地，刷新后仍在。
`;
