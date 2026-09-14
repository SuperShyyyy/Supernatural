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

export function createEditorKeymap(schema: Schema): Plugin {
  const registry = createCoreRegistry(schema);
  const listItem = requireNodeType(schema, 'list_item');

  const bindings: Record<string, Command> = {
    ...registry.keymap(),

    // 上下文相关：代码内换行 → 列表项拆分 → 空块提升 → 普通拆分
    Enter: chainCommands(newlineInCode, splitListItem(listItem), liftEmptyBlock, splitBlock),
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
