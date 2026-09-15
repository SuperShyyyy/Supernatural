/**
 * 快捷键层。
 *
 * 键位来自命令注册表（core/commands/registry.ts），这里只补充"与上下文相关"的
 * 绑定（Enter / Tab 需要按光标所在结构分派），保证一个动作只有一个实现。
 */

import { baseKeymap, chainCommands, liftEmptyBlock, newlineInCode, splitBlock } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import type { Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';
import { goToNextCell } from 'prosemirror-tables';

import { createCoreRegistry } from '../commands/registry';
import { requireNodeType } from '../document/nodeTypes';

/**
 * 代码围栏前缀：``` / ~~~ + 可选语言，直到行尾。
 * 与 inputRules 里的 /\^```(lang)\s$/ 保持一致，但允许不带结尾空格。
 */
const FENCE_PREFIX = /^\s{0,3}(```+|~~~+)([A-Za-z0-9+#._-]*)$/;

/**
 * 在"单独一行 === 围栏前缀"时按 Enter，把该行转成代码块（Typora 习惯：行尾回车即可）。
 * 与"空格"触发的输入规则互补 —— 用户敲 ```python 后，按空格或按回车都能得到代码块。
 */
function fenceToCodeBlockOnEnter(schema: Schema): Command {
  return (state, dispatch) => {
    const selection = state.selection;
    if (!selection.empty) return false;
    const $from = selection.$from;
    const parent = $from.parent;
    // 只在普通段落、光标位于段尾、整段恰好是"围栏前缀"时触发，
    // 避免把正文中间或已带内容的行误吞成代码块。
    if (parent.type.name !== 'paragraph') return false;
    if ($from.parentOffset !== parent.content.size) return false;
    if (parent.textContent.length === 0) return false;
    const match = parent.textContent.match(FENCE_PREFIX);
    if (match === null) return false;

    if (dispatch) {
      dispatch(
        state.tr.setBlockType($from.before(), $from.after(), requireNodeType(schema, 'code_block'), {
          params: match[2] ?? '',
        }),
      );
    }
    return true;
  };
}

export function createEditorKeymap(schema: Schema): Plugin {
  const registry = createCoreRegistry(schema);
  const listItem = requireNodeType(schema, 'list_item');

  const bindings: Record<string, Command> = {
    ...registry.keymap(),

    // 上下文相关：代码内换行 → 列表项拆分 → 空块提升 → 普通拆分
    Enter: chainCommands(
      fenceToCodeBlockOnEnter(schema),
      newlineInCode,
      splitListItem(listItem),
      liftEmptyBlock,
      splitBlock,
    ),
    // 表格内 Tab 走单元格跳转，列表内 Tab 走层级调整
    Tab: chainCommands(goToNextCell(1), sinkListItem(listItem)),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(listItem)),
  };

  return keymap(bindings);
}

/** baseKeymap 必须最后加载：我们的自定义绑定优先级更高。 */
export function createBaseKeymap(): Plugin {
  return keymap(baseKeymap);
}
