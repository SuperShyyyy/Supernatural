import './styles/tokens.css';
import './styles/layout.css';
import './styles/content.css';
import './styles/blocks.css';
import './styles/ui.css';

import { el, q, rafThrottle } from './dom';
import { audit, renderReport, type AuditReport, type AuditTarget } from './diagnostics';
import { buildDemoContent, buildStressContent } from './fixtures';
import { ZOOM_LEVELS, ZoomController, loadZoom, saveZoom } from './zoom';

const app = q('#app');
const viewport = q('#editor-viewport');
const content = q('#editor-content');

const zoomSelect = q<HTMLSelectElement>('#zoom-select');
const viewportRange = q<HTMLInputElement>('#viewport-range');
const viewportValue = q<HTMLOutputElement>('#viewport-value');
const statViewport = q('#stat-viewport');
const statContent = q('#stat-content');
const statMax = q('#stat-max');
const statCpl = q('#stat-cpl');
const statDpr = q('#stat-dpr');

const auditView = {
  badge: q('#hud-badge'),
  rows: q('#audit-rows'),
  violators: q('#audit-violators'),
};

const stressRoot = el('div', { attrs: { 'data-stress': '' } });

/* ---------------- 内容 ---------------- */

content.append(...buildDemoContent(), stressRoot);

/* ---------------- 缩放 ---------------- */

const zoom = new ZoomController(document.documentElement, loadZoom());

for (const level of ZOOM_LEVELS) {
  zoomSelect.append(el('option', { text: `${level}%`, attrs: { value: String(level) } }));
}

function syncZoomUi(level: number): void {
  zoomSelect.value = String(level);
  q('#zoom-reset').textContent = `${level}%`;
}

zoom.onChange((level) => {
  syncZoomUi(level);
  saveZoom(level);
  scheduleMeasure();
});
syncZoomUi(zoom.level);

q('#zoom-in').addEventListener('click', () => zoom.step(1));
q('#zoom-out').addEventListener('click', () => zoom.step(-1));
q('#zoom-reset').addEventListener('click', () => zoom.reset());
zoomSelect.addEventListener('change', () => zoom.set(Number(zoomSelect.value)));

window.addEventListener('keydown', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  switch (event.key) {
    case '+':
    case '=':
      event.preventDefault();
      zoom.step(1);
      break;
    case '-':
    case '_':
      event.preventDefault();
      zoom.step(-1);
      break;
    case '0':
      event.preventDefault();
      zoom.reset();
      break;
    default:
      break;
  }
});

/* ---------------- 模拟视口宽度 ---------------- */

function applySimulatedViewport(width: number): void {
  // 滑到最大值时恢复"不限制"，等价于真实窗口宽度
  if (width >= Number(viewportRange.max)) {
    app.style.removeProperty('--sim-viewport');
    viewportValue.textContent = '不限制';
    return;
  }
  app.style.setProperty('--sim-viewport', `${width}px`);
  viewportValue.textContent = `${width}px`;
}

viewportRange.addEventListener('input', () => applySimulatedViewport(Number(viewportRange.value)));
applySimulatedViewport(Number(viewportRange.value));

/* ---------------- 主题 ---------------- */

const themeToggle = q('#theme-toggle');
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset['theme'] = next;
  themeToggle.textContent = next === 'dark' ? 'Light' : 'Dark';
});

/* ---------------- 压力测试 ---------------- */

q('#stress-add').addEventListener('click', () => {
  const started = performance.now();
  stressRoot.append(...buildStressContent(5000));
  const cost = Math.round(performance.now() - started);
  stressRoot.prepend(el('p', { text: `注入 5000 段落耗时 ${cost}ms（仅测 DOM 构建，不含布局）` }));
  scheduleMeasure();
});

q('#stress-clear').addEventListener('click', () => {
  stressRoot.replaceChildren();
  scheduleMeasure();
});

/* ---------------- 度量与审计 ---------------- */

function collectTargets(): AuditTarget[] {
  const staticTargets: AuditTarget[] = [
    { id: 'html', label: 'html', el: document.documentElement, policy: 'none' },
    { id: 'body', label: 'body', el: document.body, policy: 'none' },
    { id: 'app', label: '.app', el: app, policy: 'none' },
    { id: 'viewport', label: '.editor-viewport', el: viewport, policy: 'none' },
    { id: 'content', label: '.editor-content', el: content, policy: 'none' },
  ];
  const scrollers: AuditTarget[] = [
    ...content.querySelectorAll<HTMLElement>('[data-internal-scroll]'),
  ].map((scroller, index) => ({
    id: `scroller-${index}`,
    label: scroller.className || scroller.tagName.toLowerCase(),
    el: scroller,
    policy: 'internal' as const,
  }));
  return [...staticTargets, ...scrollers];
}

function measureCharWidthPx(target: HTMLElement): number {
  const style = getComputedStyle(target);
  const canvas = document.createElement('canvas').getContext('2d');
  if (canvas === null) return parseFloat(style.fontSize) * 0.5;
  canvas.font = `${style.fontSize} ${style.fontFamily}`;
  return canvas.measureText('abcdefghijklmnopqrstuvwxyz').width / 26;
}

function runMeasure(): void {
  const charWidth = measureCharWidthPx(content);
  const maxInlineSize = getComputedStyle(content).maxInlineSize;

  statViewport.textContent = `${Math.round(viewport.clientWidth)}px`;
  statContent.textContent = `${Math.round(content.clientWidth)}px`;
  statMax.textContent = maxInlineSize;
  statCpl.textContent = charWidth > 0 ? String(Math.round(content.clientWidth / charWidth)) : '–';
  statDpr.textContent = String(window.devicePixelRatio);

  const report: AuditReport = audit(collectTargets(), content);
  renderReport(report, auditView);
}

const scheduleMeasure = rafThrottle(runMeasure);

new ResizeObserver(scheduleMeasure).observe(viewport);
new ResizeObserver(scheduleMeasure).observe(content);
window.addEventListener('resize', scheduleMeasure);
for (const image of content.querySelectorAll('img')) {
  image.addEventListener('load', scheduleMeasure, { once: true });
}
document.fonts?.ready.then(scheduleMeasure).catch(() => undefined);

runMeasure();
