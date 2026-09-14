// ProseMirror 自带的基础编辑样式（pre-wrap、光标、选区保护）必须先加载，
// 我们的样式在它之上做覆盖。
import 'prosemirror-view/style/prosemirror.css';

import './styles/tokens.css';
import './styles/layout.css';
import './styles/ui.css';
import './styles/content.css';
import './styles/blocks.css';
import './styles/editor.css';

import 'katex/dist/katex.min.css';
import 'prosemirror-tables/style/tables.css';

import { startApp } from './app/app';

const root = document.querySelector('#app');

if (!(root instanceof HTMLElement)) {
  throw new Error('[main] 未找到 #app 挂载点');
}

void startApp(root);
