import type { Node as PMNode } from 'prosemirror-model';

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, code: string): Promise<{ svg: string }>;
};

let loader: Promise<MermaidApi> | null = null;

/**
 * Mermaid 体积很大（几 MB），绝不能进首屏 bundle：
 * 只有文档里真的出现 mermaid 代码块时才动态载入。
 */
function loadMermaid(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((module) => {
    const mermaid = module.default as unknown as MermaidApi;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return mermaid;
  });
  return loader;
}

/**
 * 图表 NodeView：文档里存的是 Mermaid 源码，渲染出的 SVG 不回写文档。
 * 渲染失败（语法错误 / 网络）时保留源码视图，不阻塞编辑。
 */
export function createDiagramView(node: PMNode) {
  let current = node;

  const dom = document.createElement('div');
  dom.className = 'md-diagram';
  render();

  function render(): void {
    const code = String(current.attrs['code'] ?? '');
    if (code.trim().length === 0) {
      dom.textContent = '';
      return;
    }

    void loadMermaid()
      .then(async (mermaid) => {
        const id = `diagram-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, code);
        // 只在内容仍是当前版本时写入，避免异步渲染乱序覆盖
        if (String(current.attrs['code'] ?? '') === code) {
          dom.innerHTML = svg;
          dom.classList.remove('md-diagram--error');
        }
      })
      .catch(() => {
        dom.classList.add('md-diagram--error');
        dom.textContent = code;
      });
  }

  return {
    dom,
    update(next: PMNode): boolean {
      if (next.type !== current.type) return false;
      if (next.attrs['code'] === current.attrs['code']) return true;
      current = next;
      render();
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: () => false,
  };
}
