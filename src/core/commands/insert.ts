/**
 * 插入类命令。
 *
 * TODO(Phase 4)：这些命令目前用 window.prompt 取参数，属于临时方案。
 * Command System 落地后会统一走 Dialog + 命令注册表，这里只保留纯逻辑。
 */

import type { Node as PMNode, NodeType } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

import { requireMarkType, requireNodeType } from '../document/nodeTypes';

export const insertImage: Command = (state, dispatch) => {
  const src = window.prompt('图片地址（URL 或相对路径）');
  if (src === null || src.trim().length === 0) return false;

  const node = requireNodeType(state.schema, 'image').createChecked({ src: src.trim(), alt: '' });
  if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  return true;
};

export const insertTable: Command = (state, dispatch) => {
  const tableType = requireNodeType(state.schema, 'table');
  const rowType = requireNodeType(state.schema, 'table_row');
  const headerType = requireNodeType(state.schema, 'table_header');
  const cellType = requireNodeType(state.schema, 'table_cell');

  const makeRow = (cell: NodeType, texts: readonly string[]): PMNode =>
    rowType.createChecked(
      null,
      texts.map((text) => cell.createChecked(null, text.length > 0 ? state.schema.text(text) : null)),
    );

  const table = tableType.createChecked(null, [
    makeRow(headerType, ['列 1', '列 2', '列 3']),
    makeRow(cellType, ['', '', '']),
    makeRow(cellType, ['', '', '']),
  ]);

  if (dispatch) dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
  return true;
};

export const insertMathBlock: Command = (state, dispatch) => {
  const latex = window.prompt('LaTeX 公式', 'E = mc^2');
  if (latex === null) return false;

  const node = requireNodeType(state.schema, 'math_block').createChecked({ latex: latex.trim() });
  if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  return true;
};

export const insertHorizontalRule: Command = (state, dispatch) => {
  const node = requireNodeType(state.schema, 'horizontal_rule').createChecked(null);
  if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  return true;
};

/** 有选区 → 给选区加链接；无选区 → 插入 URL 文本并整体加链接；已有链接 → 移除。 */
export const applyLink: Command = (state, dispatch) => {
  const linkType = requireMarkType(state.schema, 'link');
  const { from, to, empty } = state.selection;

  const existing = linkType.isInSet(state.selection.$from.marks());
  if (existing !== undefined && existing !== null) {
    if (dispatch) dispatch(state.tr.removeMark(from, to, linkType));
    return true;
  }

  const href = window.prompt('链接地址');
  if (href === null || href.trim().length === 0) return false;

  const mark = linkType.create({ href: href.trim(), title: '' });
  if (empty) {
    const text = state.schema.text(href.trim(), [mark]);
    if (dispatch) dispatch(state.tr.insert(from, text).scrollIntoView());
    return true;
  }

  if (dispatch) dispatch(state.tr.addMark(from, to, mark));
  return true;
};
