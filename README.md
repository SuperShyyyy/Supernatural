# Supernatural

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

### 浏览器 / 网页版（零依赖）

```bash
npm run package              # 生成 build/supernatural（app + 零依赖服务器 + start.sh）
cd build/supernatural && ./start.sh   # 直接运行（默认 http://127.0.0.1:8321/）
bash scripts/install-opt.sh        # 安装到 /opt（需 sudo）
```

### 桌面应用（Electron 原生窗口）

编辑器核心（src/core、src/markdown）完全不依赖 Electron；Electron 外壳只是宿主，
通过 `ElectronAdapter`（`FileSystemAdapter` 接口）读写真实文件，原生菜单把动作转发给同一份命令注册表。

```bash
npm run electron            # 先打包再启动原生窗口（开发期）
npm run electron:dist       # 用 electron-builder 产出可分发包
                            #   → dist-electron/Supernatural-<ver>.AppImage（Linux）
                            #   → dist-electron/linux-unpacked/（解包目录）
```

产物：

- `/opt/supernatural/Supernatural.AppImage` — 双击即用的桌面应用（真实文件读写、最近文件、原生菜单）
- `~/桌面/Supernatural.AppImage` + 启动器 `~/桌面/supernatural.desktop`（指向 /opt 的 AppImage）

> Electron 二进制下载走国内镜像（`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）以加速安装。
