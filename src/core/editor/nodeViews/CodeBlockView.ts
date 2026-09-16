import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

type Highlighter = (code: string, language: string) => string;

let loader: Promise<Highlighter> | null = null;

/** 缓存上限：高亮结果可能很大，不能无限增长。 */
const CACHE_LIMIT = 200;
const MAX_HIGHLIGHT_LENGTH = 20_000;
/** 停止输入多久后重算高亮：避免每个按键都跑一次 highlight.js */
const HIGHLIGHT_DELAY_MS = 120;
const cache = new Map<string, string>();

/**
 * highlight.js 体积不小，按需加载；加载完成前代码块保持"纯文本 + 正常可编辑"状态，
 * 因此首屏和高亮失败都不会影响输入。
 */
function loadHighlighter(): Promise<Highlighter> {
  loader ??= import('highlight.js').then((module) => {
    const hljs = module.default;
    return (code: string, language: string): string => {
      if (language.length > 0 && hljs.getLanguage(language) !== undefined) {
        return hljs.highlight(code, { language }).value;
      }
      return hljs.highlightAuto(code).value;
    };
  });
  return loader;
}

function highlight(code: string, language: string): string | null {
  if (code.length > MAX_HIGHLIGHT_LENGTH) return null;
  const key = `${language} ${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  return null;
}

function remember(key: string, html: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done !== true) cache.delete(oldest.value);
  }
  cache.set(key, html);
}

/**
 * 代码块 NodeView：可编辑语言 + 复制按钮 + 语法高亮。
 *
 * 高亮采用"透明源码层 + 高亮显示层叠加"：
 *  - 源码层是 contentDOM，始终是唯一的可编辑真源，光标与选区完全由 ProseMirror 管理；
 *  - 显示层只是绝对定位的装饰，pointer-events:none，不参与任何交互与序列化。
 * 只有在高亮结果就绪后才把源码文字变透明，因此加载失败时用户看到的仍是正常可编辑文本。
 *
 * 顶部栏（语言输入 + 复制）属于装饰性控件：标记 contenteditable=false，并通过 stopEvent
 * 阻止 ProseMirror 接管其事件，既让语言输入框正常工作，也避免光标被浏览器放进装饰区。
 */
export function createCodeBlockView(
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
) {
  let current = node;
  let copyTimer: number | null = null;
  let highlightTimer: number | null = null;

  const dom = document.createElement('div');
  dom.className = 'md-codeblock';

  const bar = document.createElement('div');
  bar.className = 'md-codeblock__bar';
  bar.setAttribute('contenteditable', 'false');

  const languageInput = document.createElement('input');
  languageInput.type = 'text';
  languageInput.className = 'md-codeblock__lang';
  languageInput.placeholder = 'text';
  languageInput.spellcheck = false;
  languageInput.setAttribute('aria-label', '代码语言');

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'md-codeblock__copy';
  copyButton.textContent = '复制';
  bar.append(languageInput, copyButton);

  const scroll = document.createElement('div');
  scroll.className = 'md-codeblock__scroll';

  const source = document.createElement('pre');
  source.className = 'md-codeblock__source';
  const codeElement = document.createElement('code');
  source.append(codeElement);

  const pretty = document.createElement('pre');
  pretty.className = 'md-codeblock__pretty';
  pretty.setAttribute('aria-hidden', 'true');

  scroll.append(source, pretty);
  dom.append(bar, scroll);

  // ---- 修改代码语言：写回 code_block 的 params ----
  function commitLanguage(): void {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const next = languageInput.value.trim();
    if (next === String(current.attrs['params'] ?? '')) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, params: next }));
  }

  /** 删除整个代码块（退回普通段落）。 */
  function removeBlock(): void {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const { state } = view;
    const node = state.doc.nodeAt(pos);
    if (node === null || node.type.name !== 'code_block') return;
    const paragraph = state.schema.nodes['paragraph'];
    if (paragraph === undefined) return;
    view.dispatch(state.tr.setBlockType(pos, pos + node.nodeSize, paragraph));
    view.focus();
  }

  languageInput.addEventListener('change', commitLanguage);
  languageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitLanguage();
      languageInput.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      languageInput.value = String(current.attrs['params'] ?? '');
      languageInput.blur();
      return;
    }
    // 输入框会阻止 keydown 冒泡（否则打字会被编辑器拦截），
    // 因此删除键到不了 ProseMirror —— 这里显式处理"输入框已空且代码块也空"的删除，
    // 否则焦点在语言框时按删除键，代码块删不掉、只剩顶部那一行。
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (languageInput.value.length === 0 && current.content.size === 0) {
        event.preventDefault();
        removeBlock();
      }
    }
  });
  // 输入框内的事件不要冒泡给 ProseMirror / 编辑器
  for (const type of ['mousedown', 'click', 'keydown', 'keyup', 'keypress'] as const) {
    languageInput.addEventListener(type, (event) => event.stopPropagation());
  }

  copyButton.addEventListener('mousedown', (event) => event.preventDefault());
  copyButton.addEventListener('click', () => {
    const text = current.textContent;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        copyButton.textContent = '已复制';
        copyTimer = window.setTimeout(() => {
          copyButton.textContent = '复制';
        }, 1200);
      })
      .catch(() => {
        copyButton.textContent = '复制失败';
      });
  });

  render();

  /** 命中缓存就直接上色（零延迟）；内容为空则清掉高亮。返回是否已处理完。 */
  function applyCached(): boolean {
    const language = String(current.attrs['params'] ?? '');
    const code = current.textContent;
    if (code.trim().length === 0) {
      dom.classList.remove('md-codeblock--highlighted');
      return true;
    }
    const cached = highlight(code, language);
    if (cached === null) return false;
    applyHighlight(cached);
    return true;
  }

  /**
   * 防抖后再算高亮。
   * 连续输入时每个按键都跑一次 highlight.js + pretty.innerHTML 会让输入掉帧，
   * 这里只在停止输入 HIGHLIGHT_DELAY_MS 后计算一次，输入过程中旧高亮保持不动。
   */
  function scheduleHighlight(): void {
    if (highlightTimer !== null) window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => {
      highlightTimer = null;
      void runHighlight();
    }, HIGHLIGHT_DELAY_MS);
  }

  async function runHighlight(): Promise<void> {
    const language = String(current.attrs['params'] ?? '');
    const code = current.textContent;
    if (code.trim().length === 0) {
      dom.classList.remove('md-codeblock--highlighted');
      return;
    }
    const cached = highlight(code, language);
    if (cached !== null) {
      applyHighlight(cached);
      return;
    }
    try {
      const highlighter = await loadHighlighter();
      const html = highlighter(code, language);
      remember(`${language} ${code}`, html);
      applyHighlight(html);
    } catch {
      dom.classList.remove('md-codeblock--highlighted');
    }
  }

  function render(): void {
    const language = String(current.attrs['params'] ?? '');
    // 用户正在输入语言时不要覆盖其输入
    if (document.activeElement !== languageInput) {
      languageInput.value = language;
    }
    if (applyCached()) return;
    scheduleHighlight();
  }

  function applyHighlight(html: string): void {
    pretty.innerHTML = html;
    dom.classList.add('md-codeblock--highlighted');
  }

  return {
    dom,
    contentDOM: codeElement,
    update(next: PMNode): boolean {
      if (next.type !== current.type) return false;
      current = next;
      render();
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: (event: Event): boolean => {
      const target = event.target;
      return target instanceof Node && bar.contains(target);
    },
    destroy(): void {
      // 节点视图被移除时取消仍排队中的定时器，避免向已脱离文档的 DOM 写入
      if (copyTimer !== null) window.clearTimeout(copyTimer);
      if (highlightTimer !== null) window.clearTimeout(highlightTimer);
    },
  };
}
