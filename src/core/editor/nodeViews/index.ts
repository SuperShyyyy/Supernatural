import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeViewConstructor } from 'prosemirror-view';
import { TableView } from 'prosemirror-tables';

import { createDiagramView } from './DiagramView';
import { createImageView } from './ImageView';
import { createMathView } from './MathView';

const TABLE_CELL_MIN_WIDTH = 60;

/**
 * NodeView 注册表。
 *
 * 只有"需要交互或需要外部渲染"的节点才用 NodeView；
 * 纯结构节点（标题、列表、引用）交给 ProseMirror 直接渲染，少一层复杂度、
 * 也少一层性能开销。
 */
export function createNodeViews(): Record<string, NodeViewConstructor> {
  return {
    image: (node: PMNode, view: EditorView, getPos) => createImageView(node, view, getPos),
    math_inline: (node: PMNode) => createMathView(node, false),
    math_block: (node: PMNode) => createMathView(node, true),
    diagram: (node: PMNode) => createDiagramView(node),
    // TableView 提供列宽拖拽能力，配合 columnResizing() 插件使用
    table: (node: PMNode) => new TableView(node, TABLE_CELL_MIN_WIDTH),
  };
}
