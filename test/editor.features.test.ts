// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';

import { createEditor, type Editor } from '../src/core/editor/createEditor';
import { DocumentIndex } from '../src/services/search/DocumentIndex';
import { getSearchState, replaceAll, setSearchQuery } from '../src/core/editor/search';

/** 模拟真实输入：走 view 的 handleTextInput，才能触发 input rules。 */
function type(view: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, char, () => view.state.tr),
    );
    if (handled !== true) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

describe('Markdown 快捷输入', () => {
  let editor: Editor;

  beforeEach(() => {
    document.body.replaceChildren();
    const mount = document.createElement('div');
    document.body.append(mount);
    editor = createEditor({ mount, markdown: '' });
  });

  it('空源码也能创建可编辑的空文档', () => {
    expect(editor.getMarkdown()).toBe('');
    expect(editor.view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('# + 空格 → 标题', () => {
    type(editor.view, '# 标题');
    expect(editor.view.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.view.state.doc.firstChild?.attrs['level']).toBe(1);
    expect(editor.getMarkdown()).toBe('# 标题\n');
  });

  it('- + 空格 → 无序列表，且保留标记字符', () => {
    type(editor.view, '- 第一项');
    expect(editor.view.state.doc.firstChild?.type.name).toBe('bullet_list');
    expect(editor.getMarkdown()).toBe('- 第一项\n');
  });

  it('1. + 空格 → 有序列表', () => {
    type(editor.view, '1. 第一项');
    expect(editor.view.state.doc.firstChild?.type.name).toBe('ordered_list');
  });

  it('> + 空格 → 引用', () => {
    type(editor.view, '> 引用内容');
    expect(editor.view.state.doc.firstChild?.type.name).toBe('blockquote');
  });

  it('``` + 空格 → 代码块', () => {
    type(editor.view, '```ts');
    type(editor.view, ' ');
    const first = editor.view.state.doc.firstChild;
    expect(first?.type.name).toBe('code_block');
    expect(first?.attrs['params']).toBe('ts');
  });

  it('--- → 分割线', () => {
    type(editor.view, '---');
    expect(editor.view.state.doc.firstChild?.type.name).toBe('horizontal_rule');
  });

  it('**文本** → 粗体，标记字符被消费掉', () => {
    type(editor.view, '**粗体**');
    const paragraph = editor.view.state.doc.firstChild;
    expect(paragraph?.textContent).toBe('粗体');
    expect(paragraph?.firstChild?.marks.some((mark) => mark.type.name === 'strong')).toBe(true);
    expect(editor.getMarkdown()).toBe('**粗体**\n');
  });

  it('`文本` → 行内代码', () => {
    type(editor.view, '`code`');
    expect(editor.getMarkdown()).toBe('`code`\n');
  });
});

describe('查找与替换', () => {
  let editor: Editor;

  beforeEach(() => {
    document.body.replaceChildren();
    const mount = document.createElement('div');
    document.body.append(mount);
    editor = createEditor({ mount, markdown: '# 标题\n\nfoo bar foo\n' });
  });

  it('文档索引能定位到文档坐标', () => {
    const index = DocumentIndex.build(editor.view.state.doc);
    const matches = index.findAll('foo', false);
    expect(matches.length).toBe(2);

    for (const match of matches) {
      expect(editor.view.state.doc.textBetween(match.from, match.to)).toBe('foo');
    }
  });

  it('设置查询后插件持有匹配项', () => {
    setSearchQuery(editor.view, 'foo', false);
    const state = getSearchState(editor.view);
    expect(state?.matches.length).toBe(2);
  });

  it('大小写不敏感，且替换全部会改到源码', () => {
    setSearchQuery(editor.view, 'FOO', false);
    expect(getSearchState(editor.view)?.matches.length).toBe(2);

    replaceAll(editor.view, 'baz');
    expect(editor.getMarkdown()).toBe('# 标题\n\nbaz bar baz\n');
  });

  it('查询为空时不产生任何匹配', () => {
    setSearchQuery(editor.view, '', false);
    expect(getSearchState(editor.view)?.matches.length).toBe(0);
  });
});
