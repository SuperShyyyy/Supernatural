# md-editer

桌面级 Markdown 查看与编辑器（目标体验接近 Typora）。

技术栈：TypeScript + HTML + CSS，编辑器内核 **ProseMirror**，不使用 Rust / WASM。

## 文档

- [技术选型与总体架构设计](docs/ARCHITECTURE.md)

## 当前进度

- [x] Phase 0 — Editor Layout / Zoom Prototype（四层约束布局 + 缩放系统验证）

## 运行

```bash
# Node 通过 nvm 提供
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm install
npm run dev     # Prototype：http://localhost:5173
npm run typecheck
```
