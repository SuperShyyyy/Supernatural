# md-editer

Typora 风格的 Markdown 编辑器（TypeScript + ProseMirror，无 Rust / WASM）。

## 运行

```bash
./start.sh
```

脚本会启动本地静态服务（默认 http://127.0.0.1:8321/）并尝试用系统默认浏览器打开。
需要 Node（或 python3），不需要安装任何依赖。

自定义端口：`PORT=9000 ./start.sh`

## 说明

- `app/` —— 应用本体（构建产物，纯前端）
- `serve.mjs` —— 零依赖静态服务器
- `start.sh` —— 启动入口
- 文档默认自动保存在浏览器本地；用「文件 → 另存为 / 打开」可读写真实 `.md` 文件
  （Chrome / Edge 等支持 File System Access API，其他浏览器降级为下载与文件选择框）

## 快捷键

| 功能 | 快捷键 |
| --- | --- |
| 粗体 / 斜体 / 行内代码 | `Ctrl/Cmd + B / I / E` |
| 标题 1–6 / 正文 | `Ctrl/Cmd + 1–6 / 0` |
| 无序 / 有序列表 | `Ctrl/Cmd + Shift + 8 / 9` |
| 引用 / 代码块 | `Ctrl/Cmd + Shift + Q` / `Ctrl/Cmd + Alt + C` |
| 链接 / 图片 / 表格 / 公式 | `Ctrl/Cmd + K` / `Alt + I` / `Alt + T` / `Alt + M` |
| 查找 / 替换 | `Ctrl/Cmd + F / H` |
| 保存 / 另存为 | `Ctrl/Cmd + S / Shift + S` |
| 缩放 +/-/重置 | `Ctrl/Cmd + + / - / 0` |
| Markdown 快捷输入 | `# `、`- `、`1. `、`> `、` ``` `、`---`、`**文本**` |
