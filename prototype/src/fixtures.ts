/** Prototype 的验证内容：刻意构造"最容易撑爆布局"的极端用例。 */

import { el } from './dom';

const LONG_TOKEN =
  'Supercalifragilisticexpialidocious'.repeat(3) +
  '_' +
  'https://example.com/a/very/long/url/that/must/wrap/instead/of/overflowing/the/content/column?query=1&query=2&query=3';

const COLUMNS = 18;
const ROWS = 8;

export function buildDemoContent(): HTMLElement[] {
  return [
    el('h1', { text: 'Editor Layout / Zoom Prototype' }),
    el('p', {
      text:
        '这个页面不含任何 Markdown 功能，只验证一件事：无论怎么缩放、怎么改变窗口宽度，' +
        '编辑器都不会因为某个元素而横向撑爆 viewport。右侧 HUD 实时给出逐层审计结果。',
    }),

    el('h2', { text: '1. 普通文本与超长不可断字符串' }),
    el('p', {
      text:
        '普通段落必须自动换行，并且宽度严格等于内容列宽度。下面是一段刻意加长的文本，用来观察 ' +
        '不同缩放级别下的每行字符数变化：视口足够宽时字符数保持稳定（列宽随字号等比放大），' +
        '视口不足时列宽被钉死在容器宽度，字符数变少但绝不溢出。',
    }),
    el('p', { className: 'md-long-token', text: LONG_TOKEN }),

    el('h2', { text: '2. 图片' }),
    buildFigure(4000, 900, '超宽图片 4000×900（等比收缩到列宽）', 210),
    el('p', { text: '上图原始尺寸 4000×900，实际渲染宽度必须等于内容列宽度，绝不产生横向滚动条。' }),
    buildFigure(240, 160, '小图 240×160', 24),
    el('p', { text: '小图必须按原始尺寸显示，不被拉伸成 100% 宽。' }),
    buildResizedFigure(),

    el('h2', { text: '3. 表格' }),
    el('p', { text: `下表 ${COLUMNS} 列、${ROWS} 行，单元格文本较长。窄视口下应在表格内部横向滚动，页面本身不滚动。` }),
    buildTable(),

    el('h2', { text: '4. 代码块' }),
    el('p', { text: '代码块保留原始换行，长行只在代码块内部横向滚动，不影响普通文本区域宽度。' }),
    buildCodeBlock(),

    el('h2', { text: '5. 引用与列表' }),
    buildQuoteAndLists(),

    el('h2', { text: '6. 数学公式（Phase 2 占位）' }),
    buildMath(),

    el('hr', {}),
    el('p', { text: '—— 内容结束 ——' }),
  ];
}

/** 压力测试内容：用于快速滚动 / 大文档体感验证。 */
export function buildStressContent(count: number): HTMLElement[] {
  const nodes: HTMLElement[] = [el('h2', { text: `压力测试：${count} 段落` })];
  for (let i = 0; i < count; i += 1) {
    nodes.push(
      el('p', {
        text: `${i + 1}. ` + '用于验证滚动与布局稳定性的段落文本，'.repeat(4),
      }),
    );
  }
  return nodes;
}

function svgDataUrl(width: number, height: number, label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" x2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},72%,62%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 55) % 360},72%,46%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<text x="50%" y="50%" fill="#ffffff" font-family="sans-serif" font-size="${Math.round(height / 7)}" ` +
    `text-anchor="middle" dominant-baseline="middle">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildFigure(width: number, height: number, caption: string, hue: number): HTMLElement {
  const img = el('img', {
    attrs: {
      src: svgDataUrl(width, height, `${width}×${height}`, hue),
      width: String(width),
      height: String(height),
      alt: caption,
      loading: 'lazy',
      decoding: 'async',
    },
  });
  return el('figure', {
    className: 'md-figure',
    children: [img, el('figcaption', { text: caption })],
  });
}

/** 模拟"用户把图片调整到 2400px 宽"——仍然必须被 max-inline-size 压回列宽内。 */
function buildResizedFigure(): HTMLElement {
  const img = el('img', {
    attrs: {
      src: svgDataUrl(2400, 600, '被用户放大到 2400px', 320),
      width: '2400',
      height: '600',
      alt: '用户调整过尺寸的图片',
    },
  });
  return el('figure', {
    className: 'md-figure',
    children: [img, el('figcaption', { text: '用户手动放大到 2400px 宽：仍被列宽约束' })],
  });
}

function buildTable(): HTMLElement {
  const head = el('tr', {
    children: Array.from({ length: COLUMNS }, (_, c) =>
      el('th', { text: `列 ${c + 1} 表头文本较长` }),
    ),
  });
  const body = Array.from({ length: ROWS }, (_, r) =>
    el('tr', {
      children: Array.from({ length: COLUMNS }, (_, c) =>
        el('td', { text: `单元格 ${r + 1}-${c + 1} 内容` }),
      ),
    }),
  );
  const table = el('table', { children: [el('thead', { children: [head] }), el('tbody', { children: body })] });
  return el('div', {
    className: 'md-table-scroll',
    attrs: { 'data-internal-scroll': '' },
    children: [table],
  });
}

function buildCodeBlock(): HTMLElement {
  const lines = [
    'function renderDocument(state: EditorState, viewport: Viewport): RenderResult {',
    `  // 这一行故意非常长，用来验证代码块只在自身内部横向滚动，而不会把整个编辑器顶宽：${'x'.repeat(160)}`,
    '  const layout = computeLayout(state.doc, viewport.constraints);',
    `  return { layout, blocks: layout.blocks.map((b) => b.render()), overflow: layout.overflowByBlock };`,
    '}',
    '',
    `const veryLongSingleLine = '${'const x = 1; '.repeat(30)}';`,
  ];
  const code = el('code', { text: lines.join('\n') });
  const pre = el('pre', { children: [code] });
  return el('div', {
    className: 'md-codeblock',
    attrs: { 'data-internal-scroll': '' },
    children: [el('span', { className: 'md-codeblock__lang', text: 'typescript' }), pre],
  });
}

function buildQuoteAndLists(): HTMLElement {
  return el('blockquote', {
    children: [
      el('p', { text: '引用块内部也必须有正确的宽度约束。' }),
      el('ul', {
        children: [
          el('li', { text: '无序列表项一，文本较长时会正常换行而不溢出容器边界。' }),
          el('li', {
            text: '无序列表项二（含嵌套）',
            children: [
              el('ul', {
                children: [
                  el('li', { text: '嵌套项 A' }),
                  el('li', { text: '嵌套项 B，同样受内容列宽度约束，不会顶宽。' }),
                ],
              }),
            ],
          }),
        ],
      }),
      el('ol', {
        children: [
          el('li', { text: '有序列表项一' }),
          el('li', { text: '有序列表项二' }),
        ],
      }),
    ],
  });
}

function buildMath(): HTMLElement {
  const formula =
    '\\int_{-\\infty}^{+\\infty} e^{-\\alpha x^{2}}\\,dx = \\sqrt{\\frac{\\pi}{\\alpha}} \\quad ' +
    '\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}} = \\frac{\\pi^{2}}{6} \\quad ' +
    '\\left(\\frac{\\partial^{2}}{\\partial x^{2}} + \\frac{\\partial^{2}}{\\partial y^{2}}\\right)\\varphi = 0';
  return el('div', {
    className: 'md-math',
    attrs: { 'data-internal-scroll': '' },
    children: [el('code', { className: 'md-math__body', text: `$$ ${formula} $$` })],
  });
}
