/**
 * 快捷键层。
 *
 * 只做"键 → Command"的映射，命令本身来自 prosemirror-commands / prosemirror-schema-list。
 * 使用 PM 的 `Mod-` 前缀统一 Mac(Cmd) 与 Windows/Linux(Ctrl)，避免平台分支散落各处。
 */

import { baseKeymap, chainCommands, liftEmptyBlock, newlineInCode, setBlockType, splitBlock, toggleMark, wrapIn } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { redo, undo } from 'prosemirror-history';
import type { NodeType, Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';

import { HEADING_LEVELS } from '../document/schema';
import { requireMarkType, requireNodeType } from '../document/nodeTypes';

export function createEditorKeymap(schema: Schema): Plugin {
  const heading: NodeType = requireNodeType(schema, 'heading');
  const paragraph = requireNodeType(schema, 'paragraph');
  const blockquote = requireNodeType(schema, 'blockquote');
  const codeBlock = requireNodeType(schema, 'code_block');
  const bulletList = requireNodeType(schema, 'bullet_list');
  const orderedList = requireNodeType(schema, 'ordered_list');
  const listItem = requireNodeType(schema, 'list_item');

  const bindings: Record<string, Command> = {
    'Mod-b': toggleMark(requireMarkType(schema, 'strong')),
    'Mod-i': toggleMark(requireMarkType(schema, 'em')),
    'Mod-e': toggleMark(requireMarkType(schema, 'code')),

    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,

    // 顺序很重要：代码内换行 → 列表项拆分 → 空块提升 → 普通拆分
    Enter: chainCommands(newlineInCode, splitListItem(listItem), liftEmptyBlock, splitBlock),
    Tab: sinkListItem(listItem),
    'Shift-Tab': liftListItem(listItem),

    'Mod-Shift-8': wrapInList(bulletList),
    'Mod-Shift-9': wrapInList(orderedList),
    'Mod-Shift-q': wrapIn(blockquote),
    'Mod-Alt-c': setBlockType(codeBlock),
    'Mod-0': setBlockType(paragraph),
  };

  for (const level of HEADING_LEVELS) {
    bindings[`Mod-${level}`] = setBlockType(heading, { level });
  }

  return keymap(bindings);
}

/** baseKeymap 必须最后加载：我们的自定义绑定优先级更高。 */
export function createBaseKeymap(): Plugin {
  return keymap(baseKeymap);
}
