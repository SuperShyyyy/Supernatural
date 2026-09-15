# Markdown Editor — 技术选型与总体架构设计

> 状态：Draft v1（待确认）
> 目标：桌面级、Typora 体验的 Markdown 编辑器；TypeScript + HTML + CSS；不使用 Rust / WASM。

---

## 0. 一句话结论

**编辑器内核选 ProseMirror**（直接使用 `prosemirror-*` 官方包，不套 TipTap 外壳）。
理由不是它最流行，而是它是唯一同时满足下列硬约束的方案：

1. **Schema 化的 Document Model**（不是字符串、不是 HTML）
2. **Transaction / Step 机制** → 编辑只做局部 DOM patch，天然满足"不重新 parse 整个文档"
3. **Decoration 机制** → Live Preview（隐藏标记语法）与"语义化文档模型"可以共存
4. **History 与 Transaction 同源** → Undo/Redo 不会与光标、序列化互相破坏
5. 官方生态覆盖：input rules、keymap、tables、gapcursor、dropcursor、collab

CodeMirror 6 只用于**代码块内部编辑**（Phase 5+ 可选），不作为主内核。
KaTeX 用于数学公式，markdown-it 作为 **Markdown 词法/语法分析器**（只在"打开/导入"时全量跑一次）。

---

## 1. 候选方案对比

| 维度 | ProseMirror | TipTap | Lexical | CodeMirror 6 |
|---|---|---|---|---|
| 文档模型 | Schema + Node/Mark，强约束 | 同左（封装层） | 扁平 Node 树，约束弱 | 纯文本行 + 装饰 |
| 增量更新 | Transaction/Step + 局部 patch | 同左 | Reconciler | 视口虚拟化 |
| Live Preview | Decoration 一等公民 | 同左 | 需自建 | 只能靠 replace decoration，光标穿越困难 |
| 自定义节点（表格/图片/公式） | 成熟 | 成熟 | 需自建，生态少 | 不适合 |
| Markdown 序列化 | 自己写，可控 | 自己写 | 自己写 | 天然（就是文本） |
| 大文档 | 1MB 内很好；10MB 需策略 | 同左 | 好 | 最好 |
| 光标/选择/IME | 非常成熟 | 同左 | 较新，边界多 | 非常成熟 |
| 与 React 绑定 | 无绑定（适合自绘 UI） | 强绑定 | 强绑定 | 无 |

### 为什么不选 CodeMirror 6 作为主内核

CM6 是最强的**源码编辑器**：视口虚拟化、大文档性能最好。
但 Typora 体验的本质是"**语义节点 + 实时渲染**"。在纯文本内核上做 Live Preview：

- 只能用 replace decoration 把 `**bold**` 换成 `<strong>` widget；
- 光标进入该区间时必须"拆掉" widget 回到源码，出现**闪烁与跳变**；
- 表格、图片、数学公式这类"结构节点"无法用文本区间优雅表达；
- 选区语义变成"字符串区间"而不是"文档节点"，命令实现会退化为一堆正则。

⇒ 它会把"编辑体验第一"变成"修 bug 第一"。

### 为什么不选 Lexical

Lexical 设计优秀、性能好，但它是 **React 优先 + 协作优先** 的内核：

- Node 模型比 ProseMirror Schema 宽松，Markdown 双向转换的"合法性"需要大量自校验；
- 表格 / Markdown 序列化生态不成熟，需要自己造（等于自己造内核的一部分）；
- 我们要求"编辑器核心不依赖 UI 框架"，Lexical 的最佳实践反过来。

### 为什么不选 TipTap

TipTap 就是 ProseMirror 的封装。它带来开发便利，但也带来：

- 抽象泄漏（需要同时理解 TipTap 概念与底层 PM 概念）；
- 对 transaction、decoration、plugin 的精细控制被包了一层；
- 本项目需要精细控制"Markdown 语义 ↔ PM 节点"的双向映射与性能路径。

⇒ **直接用 ProseMirror 官方包**，把 TipTap 省下的时间投入到 Markdown 与性能上。
（TipTap 依赖的底层包就是 `prosemirror-*`，未来若需要可平滑迁移。）

### 源码模式（Source Mode）

提供可切换的 Source Mode，内部用 **CodeMirror 6** 承载纯 Markdown 文本：

- 切换时：`PM Doc → Markdown Serializer → CM6`；反向：`CM6 → Parser → PM Doc`
- 这只在"模式切换"这一刻发生一次全量解析，不进入输入热路径。

---

## 2. 分层架构

```text
Application (app/)                 启动、窗口/主题/配置装配
   |
   +-- File System (filesystem/)   FileSystemAdapter 抽象（Browser / Electron / Tauri）
   +-- Services (services/)        autosave / search / export / zoom / theme
   |
   +-- Editor Core (core/)
   |     document/   Schema、NodeSpec、MarkSpec、Document Model 约束
   |     editor/     EditorState / EditorView / Plugin 装配
   |     history/    undo-redo（基于 prosemirror-history + 我们的 boundary 策略）
   |     commands/   命令（bold / heading / list / table ...），与快捷键解耦
   |     selection/  选区语义、光标位置持久化
   |
   +-- Markdown (markdown/)
   |     parser/      markdown-it tokens -> PM Doc
   |     serializer/  PM Doc -> Markdown 文本
   |     extensions/  GFM / 公式 / Mermaid / 脚注 ...
   |
   +-- Editor Extensions (editor/)
   |     components/  NodeView（图片、代码块、表格、公式、Mermaid）
   |     plugins/     input rules、keymap、live preview decorations、placeholder
   |     extensions/  按节点聚合的扩展单元
   |
   +-- UI (ui/)       toolbar / menus / dialogs / statusbar（极简，克制）
   +-- Styles (styles/) tokens / layout / content / blocks / themes
```

**铁律**

- UI 组件**永远不直接修改 Markdown 字符串**，只能 dispatch Command / Transaction。
- 编辑器核心**不直接依赖** Electron / Tauri / Node API，只依赖 `FileSystemAdapter`。
- Markdown 全量 parse **只发生在**：打开文件、粘贴外部 Markdown、切换 Source Mode。

---

## 3. 数据流与 Document Model

### 3.1 数据流

```text
打开/导入：  Markdown ──parse(一次性)──► Document Model ──► EditorState ──► EditorView
编辑：       User Input ──► Transaction(Steps) ──► EditorState' ──► 局部 DOM patch
                                   │
                                   ├──► History（自动，同源 step）
                                   ├──► Autosave（debounce + idle，序列化离线执行）
                                   └──► Decoration 增量映射（不重新 parse）
保存：       Document Model ──serialize──► Markdown ──► FileSystemAdapter
```

### 3.2 文档模型：**语义模型**（markers 作为属性，不作为可见文本）

两种路线：

- **A. 源码保留型**：文档里真的存 `# `、`**` 这些字符，用 decoration 隐藏。
  优点：序列化 = 拼接文本，往返无损。
  缺点：**选区里带着标记**——用户选中、删除、退格、IME 组合输入、双击选词时行为诡异。
- **B. 语义型（采用）**：`heading{level}`、`strong` mark、`bullet_list`，标记偏好存进 attrs
  （如 `bullet: '-' | '*' | '+'`、`fence: '```' | '~~~'`、`tight: boolean`、`setext: boolean`）。

**选 B 的原因**：需求里"输入体验 / 光标与选择行为"排在前两位。A 方案为了无损往返牺牲了最核心的手感，
而 B 的往返损耗可以通过 **attrs 记录标记偏好 + 规范化测试 + code/html/front-matter 走 raw 通道** 压到接近零。

> 补充：对必须逐字节保真的区块（fenced code、HTML block、front matter、未知扩展语法），
> 统一使用 `raw: string` 属性存储原文，序列化时原样输出。这样"重新打开后内容完全保持"。

### 3.3 Markdown ↔ Doc

- **Parser**：`markdown-it`（CommonMark + GFM 插件）产出 token 流 → 我们自己的
  `TokenBuilder` 映射为 PM Node。选择 token 流而不是 mdast，是因为 token 更接近源码结构、
  便于处理 raw 保真，且 markdown-it 性能好。
- **Serializer**：我们自己的 `MarkdownSerializer`（节点 → 文本规则），规则与 Schema 同目录演进。
- **往返契约**：`markdown → doc → markdown` 的差异必须 **idempotent**（第二次序列化结果 === 第一次）。
  用 golden file 测试锁住（Phase 1 起就有）。

---

## 4. 性能策略

| 问题 | 策略 |
|---|---|
| 每字符全量 parse | 禁止。全量 parse 只在打开/导入/粘贴/切模式 |
| 全量 DOM 重建 | 禁止。PM 的 `dispatchTransaction` 只 patch 受影响区间 |
| Decoration 全量重算 | 用 `DecorationSet.map()` 增量映射；只有受影响区块重算 |
| 代码高亮 | 只高亮**视口附近**区块（IntersectionObserver + LRU 缓存），离开视口降级为纯文本 |
| 数学公式 | 异步 KaTeX + 占位符固定尺寸（避免抖动）+ 结果缓存 |
| 图片 | 预先写入 `width/height` 或 `aspect-ratio`，避免加载完成后 reflow |
| Mermaid | 显式渲染（点击/可见时），不自动全量渲染 |
| 强制同步布局 | 读（`getBoundingClientRect`）与写分离，统一在 rAF 中批处理；ResizeObserver 只写 CSS 变量 |
| 滚动 | 原生容器滚动，滚动监听 rAF 节流；滚动期间不做 DOM 结构变更 |
| 超大文档（5–10MB） | ① 分块加载/分块解析 ② 屏幕外区块 `content-visibility: auto` + `contain-intrinsic-size`（带开关，默认对代码块启用）③ 序列化移出输入路径（idle / Worker，Phase 6） |
| 序列化 | 输入路径不序列化；autosave 走 debounce(800ms) + `requestIdleCallback`，并记录 dirty block 便于后续增量 |

**目标基线**：1MB 文档 —— 连续输入 P95 < 16ms/字符，滚动稳定 60fps，Ctrl+A / Undo / Redo 无明显卡顿。

---

## 5. Zoom / Layout System（本 Prototype 要验证的核心）

### 5.1 四层约束模型

```text
Viewport (html/body)                 overflow:hidden  —— 应用外壳，永不允许页面级滚动
   ↓
Editor Viewport (.editor-viewport)   overflow-y:auto / overflow-x:hidden —— 唯一垂直滚动容器
   ↓
Content Column (.editor-content)     min(内容最大宽度, 100%) + margin-inline:auto —— 唯一决定文本行宽
   ↓
Block (.md-block)                    max-inline-size:100%; min-inline-size:0
   ↓  （可滚动块自己负责内部横向滚动）
Code / Table wrapper                 overflow-x:auto
Image                                max-inline-size:100%; block-size:auto
```

**overflow 责任分配（关键）**

| 层 | 横向 overflow 责任 | 说明 |
|---|---|---|
| Viewport | `hidden` | 应用外壳，永不出现页面级横滚 |
| Editor Viewport | `hidden` | 纵向唯一滚动容器；横向永远不滚 |
| Content Column | 无（被上一层裁掉） | 宽度由 `min(em 上限, 100%)` 决定 |
| Code Block | `auto`（内部滚动） | 长代码行只在自己内部滚 |
| Table Wrapper | `auto`（内部滚动） | 极宽表格只在自己内部滚 |
| Image | 收缩（`max-inline-size:100%`） | 不产生滚动，直接缩到不超过列宽 |
| 普通文本 | 换行（`overflow-wrap`） | 不产生滚动 |

⇒ **任何元素都不允许把横向滚动"向上抛"给 Editor Viewport。**

### 5.2 Zoom 模型

```text
Browser/OS DPR  ──►（不参与计算，渲染器原生处理 DPI）
App UI Scale    ──► --ui-scale：toolbar/菜单，固定 px，不随编辑器缩放
Editor Zoom     ──► --editor-zoom：只作用于 .editor-content 的 font-size
Content Layout  ──► 所有内部尺寸用 em/ch/rem(相对 content) → 整体等比
列宽            ──► min(var(--content-max) /*em，随缩放变大*/, 100% /*px，视口硬上限*/)
```

- **不使用 `zoom`**：`zoom` 会让 `getBoundingClientRect()` 返回缩放后的坐标，
  直接污染 ProseMirror 的 `coordsAtPos/posAtCoords`、光标定位、NodeView 命中测试、sticky 定位。
- **不使用 `transform: scale()`**：同样破坏坐标映射，且文本发虚、命中区域与视觉不重合，
  对 contenteditable 光标是灾难。
- **采用 font-metric 缩放**：只改 `.editor-content` 的 `font-size`，内部全部用 `em/ch/%`。
  布局数学始终停留在 CSS px，坐标系统一，PM 无需任何补偿。

### 5.3 为什么"放大后不会比屏幕还大"

内容列宽是 **`min()` 双约束**：

```css
.editor-content {
  inline-size: 100%;                                  /* 跟随父容器内容盒 */
  max-inline-size: min(var(--content-max), 100%);     /* 理想 em 宽度 vs 视口硬上限，取小 */
  min-inline-size: min(var(--content-min), 100%);     /* 极窄窗口下也不溢出 */
  margin-inline: auto;
}
```

- 视口足够宽 → 用 em 理想宽度，**文字与行宽一起放大**（保持每行字符数，Typora 手感）。
- 视口不够宽 → `100%` 生效，列宽被钉死在"容器内容盒宽度"，**缩放再大也不会溢出**，
  代价只是每行字符数变少——这是正确且唯一可接受的退化方式。
- 所有块级元素 `max-inline-size: 100%` + `min-inline-size: 0`，图片 `max-inline-size:100%`，
  因此**没有任何子元素能把列宽顶开**。

---

## 6. 开发阶段

| Phase | 内容 |
|---|---|
| **Phase 0（本次）** | Layout / Zoom Prototype：验证四层约束、6 种缩放、窗口缩放、超长文本/超宽图/超宽表/超长代码 |
| Phase 1 | 工程初始化 + PM 内核 + 基础节点（heading/paragraph/strong/em/code/code_block/list/quote）+ Undo/Redo |
| Phase 2 | 图片、表格、链接、数学公式、Mermaid、分割线 |
| Phase 3 | 打开/保存/Save As/自动保存/最近文件（FileSystemAdapter） |
| Phase 4 | 查找替换、快捷键体系、Markdown 快捷输入、Command System |
| Phase 5 | Zoom 接入、Dark Mode、主题、状态栏、字数统计、大文档优化 |
| Phase 6 | 性能专项测试（100KB → 10MB）与回归 |

---

## 7. 代码质量基线

- TypeScript `strict: true`，`noUncheckedIndexedAccess`，禁止 `any`（必要时 `unknown` + 收窄）
- 目录按上面的分层；单文件职责单一；禁止在 `main.ts` / `App.tsx` 里堆逻辑
- 注释解释 **why**，不解释 **what**
- 每个 Phase 结束：typecheck → lint → test → 手工编辑体验走查 → 总结 → 才进入下一阶段
- 每个阶段一次 git commit（仓库：https://github.com/SuperShyyyy/Supernatural）
