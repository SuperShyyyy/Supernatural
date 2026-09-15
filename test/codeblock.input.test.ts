// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { markdownSchema } from '../src/core/document/schema';
import { createEditor, type Editor } from '../src/core/editor/createEditor';

/**
 * 代码块输入的两种触发方式（与 Typora 对齐）：
 *  1. 行首输入 ``` / ~~~ + 可选语言，再按 空格（输入规则）
 *  2. 整行 === 围栏前缀时按 Enter（键盘映射）
 * 两种都应把该行变成带 params 的 code_block，且后续输入不会让它消失。
 */
describe('代码块输入触发', () => {
  function mountEditor(markdown = ''): Editor {
    const mount = document.createElement('div');
    document.body.append(mount);
    return createEditor({ mount, markdown });
  }

  function firstParaContentEnd(editor: Editor): number {
    const para = editor.view.state.doc.firstChild;
    return 1 + (para?.content.size ?? 0);
  }

  function placeCursorAt(editor: Editor, pos: number): void {
    editor.view.dispatch(
      editor.view.state.tr
        .setSelection(TextSelection.near(editor.view.state.doc.resolve(pos)))
        .scrollIntoView(),
    );
  }

  /**
   * 严格复刻 EditorView 的 keydown 派发：按插件顺序依次询问 handleKeyDown，
   * 第一个返回 true（已处理）即停止。避免 someProp 语义歧义。
   */
  function pressEnter(editor: Editor): boolean {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
    for (const plugin of editor.view.state.plugins) {
      const handler = (plugin as unknown as { spec?: { props?: Record<string, unknown> } }).spec?.props?.handleKeyDown;
      if (handler && (handler as (v: Editor['view'], e: KeyboardEvent) => boolean)(editor.view, ev)) {
        return true;
      }
    }
    return false;
  }

  function firstCodeBlock(editor: Editor): boolean {
    let found = false;
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') found = true;
      return false;
    });
    return found;
  }

  function codeBlockParams(editor: Editor): string | undefined {
    let params: string | undefined;
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') params = node.attrs.params as string;
      return false;
    });
    return params;
  }

  function codeBlockText(editor: Editor): string {
    let text = '';
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') { text = node.textContent; return false; }
      return true;
    });
    return text;
  }

  // ---- 空格触发（输入规则）----

  it('空格触发：首行 ```java + 空格 → code_block(params=java)', () => {
    const editor = mountEditor('');
    editor.view.dispatch(editor.view.state.tr.insertText('```java', 0).scrollIntoView());
    const pos = firstParaContentEnd(editor);
    placeCursorAt(editor, pos);

    // 逐插件询问 handleTextInput，复刻空格输入（Typora 习惯 1）
    let handled = false;
    editor.view.state.plugins.forEach((p) => {
      const h = (p as unknown as { spec?: { props?: Record<string, unknown> } }).spec?.props?.handleTextInput;
      if (h && (h as (v: Editor['view'], f: number, t: number, x: string) => boolean)(editor.view, pos, pos, ' ')) {
        handled = true;
      }
    });

    expect(handled).toBe(true);
    expect(codeBlockParams(editor)).toBe('java');
    const domLang = (editor.view.dom.querySelector('.md-codeblock__lang') as HTMLInputElement | null)?.value;
    expect(domLang).toBe('java');
    editor.destroy();
  });

  // ---- 回车触发（Typora 习惯）----

  it('回车触发：整行 ```python 后按 Enter → code_block(params=python)', () => {
    const editor = mountEditor('');
    editor.view.dispatch(editor.view.state.tr.insertText('```python', 0).scrollIntoView());
    placeCursorAt(editor, firstParaContentEnd(editor));

    expect(pressEnter(editor)).toBe(true);
    expect(firstCodeBlock(editor)).toBe(true);
    expect(codeBlockParams(editor)).toBe('python');
    // 围栏文本不能残留成代码块内容
    expect(codeBlockText(editor)).toBe('');
    const md = editor.getMarkdown();
    expect(md).toContain('```python');
    editor.destroy();
  });

  it('回车触发：整行 ~~~bash 后按 Enter → code_block(params=bash) 且围栏文本被清除', () => {
    const editor = mountEditor('');
    editor.view.dispatch(editor.view.state.tr.insertText('~~~bash', 0).scrollIntoView());
    placeCursorAt(editor, firstParaContentEnd(editor));

    expect(pressEnter(editor)).toBe(true);
    expect(codeBlockParams(editor)).toBe('bash');
    // 围栏文本不能残留成代码块内容（回归保护）
    expect(codeBlockText(editor)).toBe('');
    expect(editor.getMarkdown()).toContain('bash');
    editor.destroy();
  });

  it('回车触发：正文非围栏时不误触发（保持普通段落拆分）', () => {
    const editor = mountEditor('');
    editor.view.dispatch(editor.view.state.tr.insertText('hello world', 0).scrollIntoView());
    placeCursorAt(editor, firstParaContentEnd(editor));

    expect(pressEnter(editor)).toBe(true); // 被 splitBlock 处理
    expect(firstCodeBlock(editor)).toBe(false);
    const md = editor.getMarkdown();
    expect(md).toContain('hello world');
    editor.destroy();
  });

  // ---- 输入后代码块不消失 ----

  it('在代码块内输入 + 回车，代码块保持且内容不丢', () => {
    const editor = mountEditor('');
    editor.view.dispatch(editor.view.state.tr.insertText('```java', 0).scrollIntoView());
    placeCursorAt(editor, firstParaContentEnd(editor));
    pressEnter(editor); // 生成 code_block

    editor.view.dispatch(editor.view.state.tr.insertText('print(1)', editor.view.state.selection.from).scrollIntoView());
    pressEnter(editor);
    editor.view.dispatch(editor.view.state.tr.insertText('print(2)', editor.view.state.selection.from).scrollIntoView());

    const md = editor.getMarkdown();
    expect(md).toContain('print(1)');
    expect(md).toContain('print(2)');
    expect(firstCodeBlock(editor)).toBe(true);
    editor.destroy();
  });
});

describe('代码块语言修改与语法高亮', () => {
  function mount(md: string): Editor {
    const el = document.createElement('div');
    document.body.append(el);
    return createEditor({ mount: el, markdown: md });
  }

  function currentParams(editor: Editor): string {
    let params = '';
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') { params = String(node.attrs['params']); return false; }
      return true;
    });
    return params;
  }

  it('修改语言输入框 → 更新 code_block.params', () => {
    const editor = mount('```java\nint x = 1;\n```\n');
    const input = editor.view.dom.querySelector('.md-codeblock__lang') as HTMLInputElement;
    expect(input.value).toBe('java');

    input.value = 'python';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(currentParams(editor)).toBe('python');
    expect(editor.getMarkdown()).toContain('```python');
    editor.destroy();
  });

  it('代码块语法高亮生效（挂类 + 产出 hljs span）', async () => {
    const editor = mount('```java\npublic class A { int x = 1; }\n```\n');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const block = editor.view.dom.querySelector('.md-codeblock');
    const pretty = editor.view.dom.querySelector('.md-codeblock__pretty');
    expect(block?.classList.contains('md-codeblock--highlighted')).toBe(true);
    expect(pretty?.innerHTML ?? '').toContain('hljs-keyword');
    editor.destroy();
  });
});

describe('代码块内删除与缩进（Typora 手感）', () => {
  function mount(md = ''): Editor {
    const el = document.createElement('div');
    document.body.append(el);
    return createEditor({ mount: el, markdown: md });
  }

  function typeInto(view: Editor['view'], text: string): void {
    for (const char of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', (handler) =>
        handler(view, from, to, char, () => view.state.tr),
      );
      if (handled !== true) view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }

  function pressKey(editor: Editor, key: string): boolean {
    const ev = new KeyboardEvent('keydown', { key, code: key, bubbles: true });
    for (const plugin of editor.view.state.plugins) {
      const handler = (plugin as unknown as { spec?: { props?: Record<string, unknown> } }).spec?.props?.handleKeyDown;
      if (handler && (handler as (v: Editor['view'], e: KeyboardEvent) => boolean)(editor.view, ev)) return true;
    }
    return false;
  }

  function codeInfo(editor: Editor): string {
    let out = '(none)';
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') { out = JSON.stringify(node.textContent); return false; }
      return true;
    });
    return out;
  }

  function hasCodeBlock(editor: Editor): boolean {
    let found = false;
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') { found = true; return false; }
      return true;
    });
    return found;
  }

  it('删掉块内最后一个字符 → 代码块仍然存在（只是内容被清空）', () => {
    const editor = mount('```java\nw\n```\n');
    let pos = 0;
    editor.view.state.doc.descendants((node, p) => {
      if (node.type.name === 'code_block') { pos = p + 1 + node.content.size; return false; }
      return true;
    });
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.near(editor.view.state.doc.resolve(pos))),
    );

    pressKey(editor, 'Backspace');

    expect(hasCodeBlock(editor)).toBe(true);
    expect(codeInfo(editor)).toBe('""');
    editor.destroy();
  });

  it('空代码块内按 Backspace → 删除整块（退回普通段落）', () => {
    const editor = mount('');
    typeInto(editor.view, '~~~java');
    typeInto(editor.view, ' '); // 生成空代码块
    expect(hasCodeBlock(editor)).toBe(true);

    pressKey(editor, 'Backspace');

    expect(hasCodeBlock(editor)).toBe(false);
    editor.destroy();
  });

  function pressKeyWith(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
    const ev = new KeyboardEvent('keydown', { key, code: key, bubbles: true, ...init });
    for (const plugin of editor.view.state.plugins) {
      const handler = (plugin as unknown as { spec?: { props?: Record<string, unknown> } }).spec?.props?.handleKeyDown;
      if (handler && (handler as (v: Editor['view'], e: KeyboardEvent) => boolean)(editor.view, ev)) return true;
    }
    return false;
  }

  function blockNames(editor: Editor): string[] {
    const names: string[] = [];
    editor.view.state.doc.descendants((node) => {
      names.push(node.type.name);
      return false;
    });
    return names;
  }

  it('代码块内按 Ctrl/Cmd+Enter → 在代码块后新建段落（可继续输入）', () => {
    const editor = mount('```java\nx\n```\n');
    let pos = 0;
    editor.view.state.doc.descendants((node, p) => {
      if (node.type.name === 'code_block') { pos = p + 1; return false; }
      return true;
    });
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.near(editor.view.state.doc.resolve(pos))),
    );

    const handled = pressKeyWith(editor, 'Enter', { ctrlKey: true });

    expect(handled).toBe(true);
    expect(blockNames(editor)).toEqual(['code_block', 'paragraph']);
    editor.destroy();
  });

  it('点击内容下方空白 → 末尾补段落（最后一块是代码块时也能继续输入）', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const editor = createEditor({ mount: el, markdown: '```java\nx\n```\n' });

    // jsdom 下 getBoundingClientRect 全为 0，clientY > bottom 即视为"点在下方空白"
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 100 }));

    expect(blockNames(editor)).toEqual(['code_block', 'paragraph']);
    editor.destroy();
  });

  it('代码块内按 Tab → 插入缩进（而不是把焦点移到别的代码块）', () => {
    const editor = mount('```java\nx\n```\n');
    let pos = 0;
    editor.view.state.doc.descendants((node, p) => {
      if (node.type.name === 'code_block') { pos = p + 1 + node.content.size; return false; }
      return true;
    });
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.near(editor.view.state.doc.resolve(pos))),
    );

    const handled = pressKey(editor, 'Tab');

    expect(handled).toBe(true);
    expect(codeInfo(editor)).toBe('"x  "');
    editor.destroy();
  });
});

// 让 markdownSchema 兜底类型检查（未直接使用但保持导入稳定）
export type { Editor };
void markdownSchema;