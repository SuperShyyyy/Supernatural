/**
 * markdown-it-texmath 没有自带类型声明，而它在本项目里只用于**解析**
 * （产出 math_inline / math_block token），渲染由 KaTeX 完成，
 * 因此这里只声明我们真正用到的最小面。
 */
declare module 'markdown-it-texmath' {
  import type MarkdownIt from 'markdown-it';

  export interface TexmathOptions {
    engine?: unknown;
    delimiters?: string | string[];
    outerSpace?: boolean;
    katexOptions?: Record<string, unknown>;
  }

  const texmath: (md: MarkdownIt, options?: TexmathOptions) => void;
  export default texmath;
}
