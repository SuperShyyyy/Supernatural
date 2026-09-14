# 性能基线（Phase 6）

测试命令：`npx vitest run test/performance.test.ts`
测试环境：本机 Node v24 / vitest（node 环境，不含浏览器渲染）
测试文档：混合结构（标题 / 段落 / 行内标记 / 有序无序列表 / 引用 / 代码块 / 表格 / 行内公式）

## 1. 打开与保存（parse / serialize）

| 目标规模 | 实际字节 | 块数 | parse | serialize |
|---|---|---|---|---|
| 100 KB | 0.15 MB | 2 632 | 60 ms | 17 ms |
| 500 KB | 0.76 MB | 13 136 | 205 ms | 56 ms |
| 1 MB | 1.56 MB | 26 888 | 293 ms | 72 ms |
| 5 MB | 7.80 MB | 134 440 | 1 445 ms | 270 ms |
| 10 MB | 15.61 MB | 268 872 | 2 878 ms | 530 ms |

（"目标规模"按字符数生成，中文按 UTF-8 占 3 字节，因此实际字节数偏大。）

结论：

- **线性增长，无超线性退化**：10 MB 的解析约 2.8s，属于"打开时一次性可接受"的范围。
- **序列化比解析快 3–5 倍**，说明自动保存（debounce 800ms + 空闲帧）不会成为瓶颈。
- parse / serialize 都**不进入输入路径**，它们只在"打开文件 / 保存 / 切换源码模式"时执行。

## 2. 输入路径（Transaction）

在 1.56 MB / 26 888 块的文档上连续执行 120 次"在随机位置插入一个字符"：

- 平均 **< 20ms / 次**（测试断言阈值 20ms，实测远低于此）
- 关键性质：`tr.insertText` 只产生一个 `ReplaceStep`，ProseMirror 只 patch 受影响的 DOM 区间，
  因此**单次输入开销与文档规模无关**（不会随文档变大而变慢）。

## 3. 查找

1.56 MB 文档：索引构建 < 5s（断言阈值），单次查询 < 1s（断言阈值）。
索引只在查找面板打开时构建，且只在 `docChanged` 时重建，查询输入有 120ms 防抖。

## 4. 已落实的性能策略

| 策略 | 位置 |
|---|---|
| 输入路径不序列化，只发"脏"信号 | `core/editor/createEditor.ts` 的 `onChange` |
| 自动保存：debounce + `requestIdleCallback` | `services/autosave/AutosaveService.ts` |
| 代码高亮：动态 import + LRU 缓存 + 超长块跳过 | `core/editor/nodeViews/CodeBlockView.ts` |
| Mermaid：动态 import，首屏不加载 | `core/editor/nodeViews/DiagramView.ts` |
| KaTeX：同步渲染但只渲染公式本身，失败回退源码 | `core/editor/nodeViews/MathView.ts` |
| 图片：`loading=lazy` + `decoding=async` | `core/editor/nodeViews/ImageView.ts` |
| 查找索引：仅在 `docChanged` 时重建 | `core/editor/search.ts` |
| 布局：四层约束 + `min(em, 100%)`，缩放不触发重排风暴 | `styles/layout.css` |

## 5. 已知限制 / 后续可做

- **超大文档（>5MB）仍会一次性构建整棵文档树**：下一步可做分块解析 + 惰性节点（把屏幕外区块替换为占位节点，滚动到时再展开）。
- **没有视口虚拟化**：ProseMirror 需要 DOM 真实存在才能保证光标与选区正确，
  强行虚拟化会破坏编辑体验；更合适的路线是"屏幕外折叠"而不是"移除 DOM"。
- 语法高亮目前对每个代码块整体计算（有缓存）；可在块级引入 IntersectionObserver 只算可见块。
