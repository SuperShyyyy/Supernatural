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
    const domLang = editor.view.dom.querySelector('.md-codeblock__lang')?.textContent;
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
    const md = editor.getMarkdown();
    expect(md).toContain('```python');
    editor.destroy();
  });

  it('回车触发：整行 ~~~bash 后按 Enter → code_block(params=bash)', () => {
    const editor = mountEditor('');
    editor.view.dispatch(editor.view.state.tr.insertText('~~~bash', 0).scrollIntoView());
    placeCursorAt(editor, firstParaContentEnd(editor));

    expect(pressEnter(editor)).toBe(true);
    expect(codeBlockParams(editor)).toBe('bash');
    const md = editor.getMarkdown();
    expect(md).toContain('~~~bash');
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

// 让 markdownSchema 兜底类型检查（未直接使用但保持导入稳定）
export type { Editor };
void markdownSchema;