/** Markdown 层对外的唯一入口：编辑器核心只依赖这两个函数。 */

export { parseMarkdown } from './parser/parser';
export { serializeMarkdown } from './serializer/serializer';
