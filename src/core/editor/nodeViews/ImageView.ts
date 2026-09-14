import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

const MIN_WIDTH = 40;

/**
 * 图片 NodeView：负责"调整尺寸"这个交互。
 *
 * 尺寸写回节点 attrs（而不是只改 DOM style），这样 Undo/Redo、序列化、
 * 重新渲染三者看到的是同一份状态。
 * 布局上永远受 `max-inline-size: 100%` 约束（见 styles/blocks.css），
 * 所以拖动再大也不会撑破编辑区。
 */
export function createImageView(node: PMNode, view: EditorView, getPos: () => number | undefined) {
  let current = node;

  const dom = document.createElement('span');
  dom.className = 'md-image';

  const img = document.createElement('img');
  const handle = document.createElement('span');
  handle.className = 'md-image__handle';
  handle.contentEditable = 'false';
  handle.title = '拖动调整宽度';

  dom.append(img, handle);
  sync();

  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let nextWidth = 0;

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = img.getBoundingClientRect().width || MIN_WIDTH;
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    nextWidth = Math.max(MIN_WIDTH, Math.round(startWidth + event.clientX - startX));
    img.style.width = `${nextWidth}px`;
  });

  handle.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width: nextWidth }),
    );
  });

  function sync(): void {
    const src = String(current.attrs['src'] ?? '');
    const alt = String(current.attrs['alt'] ?? '');
    if (img.getAttribute('src') !== src) img.src = src;
    if (img.alt !== alt) img.alt = alt;
    const width = current.attrs['width'];
    img.style.width = typeof width === 'number' && width > 0 ? `${width}px` : '';
  }

  return {
    dom,
    update(next: PMNode): boolean {
      if (next.type !== current.type) return false;
      current = next;
      sync();
      return true;
    },
    // 拖动期间吞掉事件，避免 ProseMirror 把它当成选区操作
    stopEvent: () => dragging,
    ignoreMutation: () => true,
  };
}
