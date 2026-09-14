import { describe, expect, it } from 'vitest';

import { parseMarkdown, serializeMarkdown } from '../src/markdown';
import { markdownSchema } from '../src/core/document/schema';
import { DocumentIndex } from '../src/services/search/DocumentIndex';
import { EditorState } from 'prosemirror-state';

/**
 * 性能基线测试。
 *
 * 关注两件事：
 *  1) 打开/保存（parse / serialize）随文档规模的增长是否可控；
 *  2) 输入路径（Transaction）是否与文档规模无关 —— 这是"大文档仍能流畅编辑"的关键指标。
 *
 * 阈值刻意放宽：CI 机器差异很大，这里只用于捕捉数量级的回归。
 */

interface Measurement {
  readonly label: string;
  readonly bytes: number;
  readonly parseMs: number;
  readonly serializeMs: number;
  readonly blocks: number;
}

function generateMarkdown(targetBytes: number): string {
  const chunk = [
    '## 章节标题',
    '',
    '这是一段用于性能测试的正文，包含 **粗体**、*斜体* 与 `行内代码`，长度适中以便统计。',
    '',
    '- 列表项一',
    '- 列表项二',
    '  - 嵌套列表项',
    '',
    '1. 有序项一',
    '2. 有序项二',
    '',
    '> 引用块内容，用来验证块级节点的解析开销。',
    '',
    '```typescript',
    'export function sum(values: number[]): number {',
    '  return values.reduce((acc, value) => acc + value, 0);',
    '}',
    '```',
    '',
    '| 列一 | 列二 | 列三 |',
    '| --- | --- | --- |',
    '| a | b | c |',
    '',
    '$E = mc^2$',
    '',
  ].join('\n');

  const parts: string[] = [];
  let size = 0;
  while (size < targetBytes) {
    parts.push(chunk);
    size += chunk.length;
  }
  return parts.join('\n');
}

function measure(label: string, targetBytes: number): Measurement {
  const markdown = generateMarkdown(targetBytes);
  const bytes = new TextEncoder().encode(markdown).length;

  const parseStart = performance.now();
  const doc = parseMarkdown(markdown);
  const parseMs = performance.now() - parseStart;

  const serializeStart = performance.now();
  const serialized = serializeMarkdown(doc);
  const serializeMs = performance.now() - serializeStart;

  // 往返必须稳定：否则性能优化没有意义
  expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);

  let blocks = 0;
  doc.forEach(() => {
    blocks += 1;
  });

  return { label, bytes, parseMs, serializeMs, blocks };
}

const SIZES: ReadonlyArray<{ label: string; kb: number }> = [
  { label: '100KB', kb: 100 },
  { label: '500KB', kb: 500 },
  { label: '1MB', kb: 1024 },
  { label: '5MB', kb: 5 * 1024 },
  { label: '10MB', kb: 10 * 1024 },
];

describe('大文档性能基线', () => {
  const results: Measurement[] = [];

  for (const size of SIZES) {
    it(`${size.label}：parse / serialize 在可接受范围内`, () => {
      const result = measure(size.label, size.kb * 1024);
      results.push(result);

      // 粗略基线：每 MB 解析 10s、序列化 10s 以内（防御数量级退化）
      const mb = result.bytes / (1024 * 1024);
      expect(result.parseMs).toBeLessThan(Math.max(5_000, mb * 10_000));
      expect(result.serializeMs).toBeLessThan(Math.max(5_000, mb * 10_000));
    }, 180_000);
  }

  it('1MB 文档：单次输入（Transaction）与文档规模无关', () => {
    const markdown = generateMarkdown(1024 * 1024);
    const doc = parseMarkdown(markdown);
    let state = EditorState.create({ schema: markdownSchema, doc, plugins: [] });

    const samples = 120;
    const start = performance.now();
    for (let i = 0; i < samples; i += 1) {
      const pos = 1 + ((i * 7919) % Math.max(1, state.doc.content.size - 2));
      state = state.apply(state.tr.insertText('x', pos));
    }
    const total = performance.now() - start;
    const perTransaction = total / samples;

    // 输入路径必须是常数级：这里取 20ms/次 作为回归阈值
    expect(perTransaction).toBeLessThan(20);
  }, 180_000);

  it('1MB 文档：查找索引构建与查询可控', () => {
    const markdown = generateMarkdown(1024 * 1024);
    const doc = parseMarkdown(markdown);

    const buildStart = performance.now();
    const index = DocumentIndex.build(doc);
    const buildMs = performance.now() - buildStart;

    const searchStart = performance.now();
    const matches = index.findAll('性能测试', false);
    const searchMs = performance.now() - searchStart;

    expect(matches.length).toBeGreaterThan(0);
    expect(buildMs).toBeLessThan(5_000);
    expect(searchMs).toBeLessThan(1_000);
  }, 180_000);

  it('输出基线数据（供 docs/PERFORMANCE.md 使用）', () => {
    for (const result of results) {
      const mb = (result.bytes / (1024 * 1024)).toFixed(2);
      // eslint-disable-next-line no-console
      console.log(
        `${result.label}: ${mb}MB / ${result.blocks} 块 → parse ${result.parseMs.toFixed(0)}ms, serialize ${result.serializeMs.toFixed(0)}ms`,
      );
    }
    expect(results.length).toBeGreaterThan(0);
  }, 180_000);
});
