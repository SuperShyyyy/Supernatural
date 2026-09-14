import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';

import { HEADING_LEVELS } from '../document/schema';
import { requireMarkType, requireNodeType } from '../document/nodeTypes';
import { applyLink, insertHorizontalRule, insertImage, insertMathBlock, insertTable } from './insert';

export interface CommandDefinition {
  readonly id: string;
  readonly title: string;
  /** ProseMirror 键位语法，Mod- 自动适配 Cmd / Ctrl */
  readonly keys?: readonly string[];
  readonly command: Command;
}

/**
 * 命令注册表：快捷键、菜单栏、未来可能的命令面板共用同一份定义。
 *
 * 好处是"一个动作只有一个实现"，不会出现菜单点了和快捷键按了行为不一致的情况。
 */
export class CommandRegistry {
  readonly #definitions = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    this.#definitions.set(definition.id, definition);
  }

  get(id: string): CommandDefinition | undefined {
    return this.#definitions.get(id);
  }

  all(): readonly CommandDefinition[] {
    return [...this.#definitions.values()];
  }

  keymap(): Record<string, Command> {
    const bindings: Record<string, Command> = {};
    for (const definition of this.#definitions.values()) {
      for (const key of definition.keys ?? []) {
        bindings[key] = definition.command;
      }
    }
    return bindings;
  }
}

/** 从 UI（菜单栏）执行命令：先聚焦编辑器，否则命令可能作用到错误的选区上。 */
export function runCommand(view: EditorView, registry: CommandRegistry, id: string): boolean {
  const definition = registry.get(id);
  if (definition === undefined) return false;
  view.focus();
  return definition.command(view.state, view.dispatch, view);
}

export function createCoreRegistry(schema: Schema): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register({
    id: 'format.strong',
    title: '粗体',
    keys: ['Mod-b'],
    command: toggleMark(requireMarkType(schema, 'strong')),
  });
  registry.register({
    id: 'format.em',
    title: '斜体',
    keys: ['Mod-i'],
    command: toggleMark(requireMarkType(schema, 'em')),
  });
  registry.register({
    id: 'format.code',
    title: '行内代码',
    keys: ['Mod-e'],
    command: toggleMark(requireMarkType(schema, 'code')),
  });
  registry.register({ id: 'format.link', title: '链接', keys: ['Mod-k'], command: applyLink });

  const heading = requireNodeType(schema, 'heading');
  for (const level of HEADING_LEVELS) {
    registry.register({
      id: `format.heading${level}`,
      title: `标题 ${level}`,
      keys: [`Mod-${level}`],
      command: setBlockType(heading, { level }),
    });
  }

  const listItem = requireNodeType(schema, 'list_item');
  registry.register({
    id: 'format.paragraph',
    title: '正文',
    keys: ['Mod-0'],
    command: setBlockType(requireNodeType(schema, 'paragraph')),
  });
  registry.register({
    id: 'format.bulletList',
    title: '无序列表',
    keys: ['Mod-Shift-8'],
    command: wrapInList(requireNodeType(schema, 'bullet_list')),
  });
  registry.register({
    id: 'format.orderedList',
    title: '有序列表',
    keys: ['Mod-Shift-9'],
    command: wrapInList(requireNodeType(schema, 'ordered_list')),
  });
  registry.register({
    id: 'format.blockquote',
    title: '引用',
    keys: ['Mod-Shift-q'],
    command: wrapIn(requireNodeType(schema, 'blockquote')),
  });
  registry.register({
    id: 'format.codeBlock',
    title: '代码块',
    keys: ['Mod-Alt-c'],
    command: setBlockType(requireNodeType(schema, 'code_block')),
  });
  registry.register({
    id: 'format.indent',
    title: '增加缩进',
    command: sinkListItem(listItem),
  });
  registry.register({
    id: 'format.outdent',
    title: '减少缩进',
    command: liftListItem(listItem),
  });

  registry.register({
    id: 'insert.image',
    title: '图片',
    keys: ['Mod-Alt-i'],
    command: insertImage,
  });
  registry.register({
    id: 'insert.table',
    title: '表格',
    keys: ['Mod-Alt-t'],
    command: insertTable,
  });
  registry.register({
    id: 'insert.math',
    title: '数学公式',
    keys: ['Mod-Alt-m'],
    command: insertMathBlock,
  });
  registry.register({
    id: 'insert.horizontalRule',
    title: '分割线',
    command: insertHorizontalRule,
  });

  registry.register({ id: 'history.undo', title: '撤销', keys: ['Mod-z'], command: undo });
  registry.register({
    id: 'history.redo',
    title: '重做',
    keys: ['Mod-y', 'Shift-Mod-z'],
    command: redo,
  });

  return registry;
}
