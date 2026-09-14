# md-editer

桌面级 Markdown 查看与编辑器（目标体验接近 Typora）。

技术栈：TypeScript + HTML + CSS，编辑器内核 **ProseMirror**，不使用 Rust / WASM。

## 文档

- [技术选型与总体架构设计](docs/ARCHITECTURE.md)

## 当前进度

- [x] Phase 0 — Editor Layout / Zoom Prototype（四层约束布局 + 缩放系统验证）`/prototype/index.html`
- [x] Phase 1 — 编辑器内核 + Markdown 基础节点 + Undo/Redo

### Phase 1 已具备

- Document Model：语义节点（heading / paragraph / 列表 / 引用 / code / code_block / hr），
  标记偏好存 attrs（bullet / order / tight / fence params），往返幂等由测试锁住
- Markdown：parser（markdown-it token 流 → Doc）、serializer（Doc → Markdown）
- 编辑器：ProseMirror（history + keymap），Live Preview（所见即渲染结果）
- 快捷键：`Mod+B/I/E`、`` `Mod+1..6` ``、`Mod+0`、`Mod+Shift+8/9`、`Tab`/`Shift+Tab`、
  `Mod+Z`/`Mod+Shift+Z`、`Mod+S`（保存）、`Mod+Shift+S`（另存为）
- 文件：FileSystemAdapter 抽象 + 临时 LocalStorageAdapter，输入停止 800ms 后自动保存
- 状态栏：字符 / 词 / 块统计

## 运行

```bash
# Node 通过 nvm 提供
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm install
npm run dev        # 应用：http://127.0.0.1:5173  Prototype：/prototype/index.html
npm run typecheck
npm test           # Markdown 往返一致性测试
npm run build
```
