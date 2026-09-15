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
import { TextSelection, type Command, type Plugin } from 'prosemirror-state';
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
  const codeBlock = requireNodeType(schema, 'code_block');
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
      const params = match[2] ?? '';
      // 用"空代码块"整体替换该段落：既设置 params，也把围栏文本 ``` / ~~~java 清掉，
      // 否则这些字符会残留成代码块的第一行内容（旧实现只 setBlockType 未删除文字）。
      const tr = state.tr.replaceWith(
        $from.before(),
        $from.after(),
        codeBlock.create({ params }),
      );
      // 光标放入新代码块内部，用户按 Enter 后即可直接输入代码
      tr.setSelection(TextSelection.near(tr.doc.resolve($from.before() + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** 代码块内缩进宽度：Tab 插入两个空格（与 Markdown 代码块的常见习惯一致）。 */
const CODE_INDENT = '  ';

/**
 * 代码块内的删除（对齐 Typora 手感）：
 *
 *  - 代码块非空：只删光标前/后的一个字符，**绝不因为删空就连块一起删掉**。
 *    之前这里没人接管，浏览器默认行为会把"刚删空的空代码块"直接吃掉，
 *    于是"输入 w 再删掉 w → 整个代码块消失"。
 *  - 代码块为空：才允许删除整块（退回普通段落）——即用户显式按下删除键的场景。
 *  - 光标在块首且块非空：交回默认 joinBackward，与上一块合并（Typora 行为）。
 */
function deleteInCodeBlock(schema: Schema, direction: 'backward' | 'forward'): Command {
  return (state, dispatch) => {
    const selection = state.selection;
    if (!selection.empty) return false; // 有选区：交给默认删除
    const $from = selection.$from;
    if ($from.parent.type.spec.code !== true) return false;

    if ($from.parent.content.size === 0) {
      if (dispatch) {
        dispatch(state.tr.setBlockType($from.before(), $from.after(), requireNodeType(schema, 'paragraph')));
      }
      return true;
    }

    if (direction === 'backward') {
      if ($from.pos <= $from.start()) return false; // 块首：交给 joinBackward
      if (dispatch) dispatch(state.tr.delete($from.pos - 1, $from.pos));
      return true;
    }
    if ($from.pos >= $from.end()) return false; // 块尾：交给默认
    if (dispatch) dispatch(state.tr.delete($from.pos, $from.pos + 1));
    return true;
  };
}

/**
 * 代码块内 Tab / Shift-Tab：缩进与反缩进。
 * 必须接管，否则 ProseMirror 不处理时浏览器会执行默认行为——把焦点移到
 * 下一个可聚焦元素（就是下一个代码块的语言输入框 / 复制按钮），看起来像"跳到别的代码块"。
 */
function tabInCode(): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from;
    if ($from.parent.type.spec.code !== true) return false;
    if (dispatch) {
      dispatch(state.tr.insertText(CODE_INDENT, state.selection.from, state.selection.to));
    }
    return true;
  };
}

function untabInCode(): Command {
  return (state, dispatch) => {
    const selection = state.selection;
    if (!selection.empty) return false;
    const $from = selection.$from;
    if ($from.parent.type.spec.code !== true) return false;

    const text = $from.parent.textContent;
    let remove = 0;
    for (let i = $from.parentOffset - 1; i >= 0 && remove < CODE_INDENT.length; i -= 1) {
      if (text[i] === ' ') remove += 1;
      else break;
    }
    // 没有缩进可删时也要吞掉按键，避免浏览器把焦点移走
    if (remove === 0) return true;
    if (dispatch) dispatch(state.tr.delete($from.pos - remove, $from.pos));
    return true;
  };
}

/**
 * Mod-Enter：从代码块跳到它后面的新段落。
 * 代码块内 Enter 永远是"换行"，所以当代码块是最后一块时，需要一个显式的
 * "退出代码块、在后面继续写"的快捷键（否则光标永远出不去）。
 */
function exitCodeBlock(schema: Schema): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from;
    if ($from.parent.type.spec.code !== true) return false;
    const paragraph = requireNodeType(schema, 'paragraph');
    const after = $from.after();
    if (dispatch) {
      const tr = state.tr.insert(after, paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
      dispatch(tr.scrollIntoView());
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
    // 代码块内删除：非空只删字符，空块才删整块
    Backspace: chainCommands(deleteInCodeBlock(schema, 'backward')),
    Delete: chainCommands(deleteInCodeBlock(schema, 'forward')),
    // 代码块内的 Tab 优先：tabInCode() 只在 code 节点生效，不影响表格与列表
    // 注意：这里是调用工厂拿到 Command，不能直接传工厂本身
    Tab: chainCommands(tabInCode(), goToNextCell(1), sinkListItem(listItem)),
    'Shift-Tab': chainCommands(untabInCode(), goToNextCell(-1), liftListItem(listItem)),
    // 退出代码块，在其后新建段落继续写
    'Mod-Enter': exitCodeBlock(schema),
  };

  return keymap(bindings);
}

/** baseKeymap 必须最后加载：我们的自定义绑定优先级更高。 */
export function createBaseKeymap(): Plugin {
  return keymap(baseKeymap);
}
