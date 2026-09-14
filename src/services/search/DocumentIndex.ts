import type { Node as PMNode } from 'prosemirror-model';

export interface TextMatch {
  readonly from: number;
  readonly to: number;
}

/**
 * 文档文本索引：把"文档树里的文字"摊平成 `text + 每字符对应的 doc 位置`。
 *
 * 为什么需要它：查找要在**文档坐标**里高亮和替换，而 `doc.textContent` 会丢掉
 * 位置信息。代价是 O(n) 构建 —— 所以索引只在查找面板打开、且文档变化后重建，
 * 平时不进入输入路径。
 */
export class DocumentIndex {
  readonly #text: string;
  /** positions[i] = text[i] 在文档中的位置 */
  readonly #positions: Int32Array;

  constructor(text: string, positions: Int32Array) {
    this.#text = text;
    this.#positions = positions;
  }

  get length(): number {
    return this.#text.length;
  }

  findAll(query: string, caseSensitive: boolean): TextMatch[] {
    if (query.length === 0) return [];

    const haystack = caseSensitive ? this.#text : this.#text.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches: TextMatch[] = [];

    let offset = haystack.indexOf(needle);
    while (offset !== -1) {
      const match = this.locate(offset, offset + needle.length);
      if (match !== null) matches.push(match);
      offset = haystack.indexOf(needle, offset + Math.max(1, needle.length));
    }

    return matches;
  }

  locate(startOffset: number, endOffset: number): TextMatch | null {
    const from = this.#positions[startOffset];
    const to = this.#positions[endOffset - 1];
    if (from === undefined || to === undefined) return null;
    return { from, to: to + 1 };
  }

  static build(doc: PMNode): DocumentIndex {
    const parts: string[] = [];
    const positions: number[] = [];

    let lastParent: PMNode | null = null;

    doc.descendants((node, pos, parent) => {
      if (!node.isText) return true;

      // 跨块时用 \n 分隔，避免"上一块末尾 + 下一块开头"被拼成假匹配
      if (parent !== null && lastParent !== null && parent !== lastParent) {
        parts.push('\n');
        positions.push(pos);
      }
      lastParent = parent;

      const text = node.text ?? '';
      parts.push(text);
      for (let i = 0; i < text.length; i += 1) positions.push(pos + i);

      return false;
    });

    return new DocumentIndex(parts.join(''), Int32Array.from(positions));
  }
}
