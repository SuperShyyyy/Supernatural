import katex from 'katex';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * 公式 NodeView。
 *
 * 文档里只存 LaTeX 源码，渲染结果是 KaTeX 的输出、不回写文档 —— 否则
 * 每次打开都会把上一轮的 SVG/HTML 当成正文再序列化一次，Markdown 会被污染。
 *
 * 渲染是同步的：KaTeX 对单个公式是毫秒级，没必要引入异步 + 占位符抖动。
 * 真出现超大公式矩阵时再考虑分片。
 */
export function createMathView(node: PMNode, displayMode: boolean) {
  let current = node;

  const dom = document.createElement(displayMode ? 'div' : 'span');
  dom.className = displayMode ? 'md-math' : 'md-math-inline';

  render();

  function render(): void {
    const latex = String(current.attrs['latex'] ?? '');
    try {
      katex.render(latex, dom, { displayMode, throwOnError: false, strict: 'ignore' });
    } catch {
      // 渲染失败时退回源码，用户至少还能看到并修改 LaTeX
      dom.textContent = latex;
    }
  }

  return {
    dom,
    update(next: PMNode): boolean {
      if (next.type !== current.type) return false;
      if (next.attrs['latex'] === current.attrs['latex']) return true;
      current = next;
      render();
      return true;
    },
    // KaTeX 自己管理子树，任何 DOM 变化都不该触发 PM 的重新解析
    ignoreMutation: () => true,
    stopEvent: () => false,
  };
}
