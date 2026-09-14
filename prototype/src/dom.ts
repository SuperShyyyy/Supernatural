/** 极小的 DOM 工具集（Prototype 专用，正式项目会换成编辑器自带的 NodeView 体系）。 */

export function q<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector(selector);
  if (found === null) {
    throw new Error(`[prototype] 未找到元素: ${selector}`);
  }
  return found as T;
}

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: ReadonlyArray<Node | string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs !== undefined) {
    for (const [key, value] of Object.entries(options.attrs)) {
      node.setAttribute(key, value);
    }
  }
  if (options.children !== undefined) {
    for (const child of options.children) {
      node.append(child);
    }
  }
  return node;
}

/** requestAnimationFrame 合流：同一帧内的多次请求只执行一次。 */
export function rafThrottle(fn: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn();
    });
  };
}
