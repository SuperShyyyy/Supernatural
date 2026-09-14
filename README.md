# md-editer

桌面级 Markdown 查看与编辑器（目标体验接近 Typora）。

技术栈：TypeScript + HTML + CSS，编辑器内核 **ProseMirror**，不使用 Rust / WASM。

## 文档

- [技术选型与总体架构设计](docs/ARCHITECTURE.md)

## 当前进度

- [x] Phase 0 — Editor Layout / Zoom Prototype（四层约束布局 + 缩放系统验证）`/prototype/index.html`
- [x] Phase 1 — 编辑器内核 + Markdown 基础节点 + Undo/Redo
- [x] Phase 2 — 图片 / 表格 / 链接 / KaTeX 公式 / Mermaid / 分割线
- [x] Phase 3 — 打开 / 保存 / 另存为 / 自动保存 / 最近文件
- [x] Phase 4 — 查找替换 / Markdown 快捷输入 / Command System / 菜单栏
- [x] Phase 5 — 缩放 / 深色模式 / 代码高亮 / 状态栏 / 大文档优化
- [x] Phase 6 — 性能基线测试（100KB → 10MB），见 [docs/PERFORMANCE.md](docs/PERFORMANCE.md)

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
npm test           # 往返一致性 / 编辑器冒烟 / 快捷输入 / 查找替换 / 性能基线
npm run build
```

## 打包与安装

```bash
npm run package              # 生成 build/md-editer（app + 零依赖服务器 + start.sh）
cd build/md-editer && ./start.sh   # 直接运行（默认 http://127.0.0.1:8321/）

# 安装到 /opt（需要 sudo 密码）
bash scripts/install-opt.sh
```

已放置的副本：`~/桌面/md-editer` + 桌面启动器 `~/桌面/md-editer.desktop`。
