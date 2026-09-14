// @vitest-environment jsdom

import { undo } from 'prosemirror-history';
import { beforeEach, describe, expect, it } from 'vitest';

import { createEditor, type Editor } from '../src/core/editor/createEditor';
import { markdownSchema } from '../src/core/document/schema';

const SOURCE = '# 标题\n\n第一段 **粗体** 文本。\n\n- 项目一\n- 项目二\n\n> 引用\n';

describe('编辑器内核冒烟', () => {
  let mount: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    document.body.replaceChildren();
    mount = document.createElement('div');
    document.body.append(mount);
    editor = createEditor({ mount, markdown: SOURCE });
  });

  it('把 contenteditable 挂到指定容器，并渲染为语义节点', () => {
    const dom = mount.querySelector('.editor-content');
    expect(dom).not.toBeNull();
    expect(dom?.getAttribute('contenteditable')).toBe('true');

    // Live Preview：看到的是真标题，不是 "# 标题"
    expect(mount.querySelector('h1')?.textContent).toBe('标题');
    expect(mount.querySelector('blockquote')?.textContent).toBe('引用');
    expect(mount.querySelectorAll('li').length).toBe(2);
    expect(mount.querySelector('strong')?.textContent).toBe('粗体');
  });

  it('Markdown 往返一致', () => {
    expect(editor.getMarkdown()).toBe(SOURCE);
  });

  it('Transaction 编辑会改变文档，Undo 可以还原', () => {
    const { view } = editor;
    const insertAt = view.state.doc.content.size - 2;
    view.dispatch(view.state.tr.insertText('X', insertAt));
    expect(editor.getMarkdown()).toContain('X');

    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe(SOURCE);
  });

  it('统计信息可用', () => {
    const stats = editor.getStats();
    // 顶层块：heading / paragraph / bullet_list / blockquote
    expect(stats.blocks).toBe(4);
    expect(stats.characters).toBeGreaterThan(0);
    expect(stats.words).toBeGreaterThan(0);
  });

  it('setMarkdown 会重建文档状态', () => {
    editor.setMarkdown('## 新文档\n');
    expect(editor.getMarkdown()).toBe('## 新文档\n');
    expect(mount.querySelector('h2')?.textContent).toBe('新文档');
  });

  it('schema 不泄漏 Markdown 标记到可见文本', () => {
    const doc = markdownSchema.nodes['doc'];
    expect(doc).toBeDefined();
    expect(mount.textContent).not.toContain('**');
    expect(mount.textContent).not.toContain('# ');
  });
});
