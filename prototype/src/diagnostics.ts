/**
 * 布局审计：把"任何元素都不能把横向滚动抛给上层"变成可执行的断言。
 *
 * 两类检查：
 *  1) 逐层检查 scrollWidth - clientWidth：
 *     - policy 'none'      → 该层不允许任何横向溢出（Viewport / App / Editor Viewport / Content）
 *     - policy 'internal'  → 该层允许内部滚动（代码块 / 表格 / 公式），只记录不判定
 *  2) 全局扫描：内容列里是否存在比内容列更宽的元素
 *     （排除 [data-internal-scroll] 内部的元素——它们的宽度由内部滚动容器兜住）
 */

import { el } from './dom';

/** 允许 1px 的子像素误差，避免缩放带来的小数宽度误报。 */
const SUBPIXEL_TOLERANCE = 1;

export type OverflowPolicy = 'none' | 'internal';

export interface AuditTarget {
  readonly id: string;
  readonly label: string;
  readonly el: HTMLElement;
  readonly policy: OverflowPolicy;
}

export interface AuditResult {
  readonly id: string;
  readonly label: string;
  readonly policy: OverflowPolicy;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly overflowPx: number;
  readonly ok: boolean;
}

export interface AuditReport {
  readonly results: readonly AuditResult[];
  readonly violators: readonly string[];
  readonly ok: boolean;
}

export function audit(targets: readonly AuditTarget[], content: HTMLElement): AuditReport {
  const results = targets.map<AuditResult>((target) => {
    const clientWidth = target.el.clientWidth;
    const scrollWidth = target.el.scrollWidth;
    const overflowPx = Math.max(0, scrollWidth - clientWidth);
    return {
      id: target.id,
      label: target.label,
      policy: target.policy,
      clientWidth,
      scrollWidth,
      overflowPx,
      ok: target.policy === 'internal' ? true : overflowPx <= SUBPIXEL_TOLERANCE,
    };
  });

  const violators = findOversizedElements(content);
  return {
    results,
    violators,
    ok: results.every((r) => r.ok) && violators.length === 0,
  };
}

function findOversizedElements(content: HTMLElement): readonly string[] {
  const limit = content.clientWidth + SUBPIXEL_TOLERANCE;
  const found: string[] = [];

  for (const node of content.querySelectorAll<HTMLElement>('*')) {
    // 内部滚动容器的子树允许超出（它们的溢出已被自身消化）
    if (node.closest('[data-internal-scroll]') !== null) continue;
    const width = node.getBoundingClientRect().width;
    if (width > limit) {
      found.push(`${describe(node)} ${Math.round(width)}px > 列宽 ${Math.round(content.clientWidth)}px`);
    }
  }

  return found.slice(0, 8);
}

function describe(node: HTMLElement): string {
  const cls = node.className.length > 0 ? `.${node.className.split(' ')[0]}` : '';
  return `${node.tagName.toLowerCase()}${cls}`;
}

export interface AuditView {
  readonly badge: HTMLElement;
  readonly rows: HTMLElement;
  readonly violators: HTMLElement;
}

export function renderReport(report: AuditReport, view: AuditView): void {
  view.badge.textContent = report.ok ? 'PASS' : `FAIL`;
  view.badge.dataset['ok'] = String(report.ok);

  view.rows.replaceChildren(
    ...report.results.map((result) =>
      el('tr', {
        className: 'hud__row',
        attrs: { 'data-ok': String(result.ok) },
        children: [
          el('td', { text: result.label }),
          el('td', { text: String(Math.round(result.clientWidth)) }),
          el('td', { text: String(Math.round(result.scrollWidth)) }),
          el('td', { text: result.policy === 'internal' ? `${Math.round(result.overflowPx)} (内部)` : String(Math.round(result.overflowPx)) }),
          el('td', { text: result.policy === 'internal' ? 'auto' : 'hidden' }),
        ],
      }),
    ),
  );

  if (report.violators.length === 0) {
    view.violators.replaceChildren(
      el('div', { className: 'hud__ok', text: '✓ 内容列内没有元素超出列宽' }),
    );
    return;
  }

  view.violators.replaceChildren(
    el('div', { text: `✗ ${report.violators.length} 处越界：` }),
    ...report.violators.map((text) => el('div', { text: `· ${text}` })),
  );
}
