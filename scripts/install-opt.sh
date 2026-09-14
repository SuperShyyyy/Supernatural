#!/usr/bin/env bash
# 把打包产物安装到 /opt/md-editer（需要 sudo 权限）。
# 用法：bash scripts/install-opt.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$DIR/../build/md-editer"
TARGET="/opt/md-editer"

if [ ! -d "$SRC" ]; then
  echo "未找到打包产物，请先运行：npm run package" >&2
  exit 1
fi

echo "安装到 $TARGET ..."
sudo rm -rf "$TARGET"
sudo cp -r "$SRC" "$TARGET"
sudo chown -R root:root "$TARGET"
sudo chmod -R a+rX "$TARGET"

# 桌面启动器（中文环境桌面目录为 ~/桌面，英文环境为 ~/Desktop）
DESKTOP_DIR="$HOME/桌面"
[ -d "$DESKTOP_DIR" ] || DESKTOP_DIR="$HOME/Desktop"

if [ -d "$DESKTOP_DIR" ]; then
  cat > "$DESKTOP_DIR/md-editer.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=md-editer
Comment=Typora 风格的 Markdown 编辑器
Exec=$TARGET/start.sh
Path=$TARGET
Terminal=false
Categories=Office;TextEditor;
EOF
  chmod +x "$DESKTOP_DIR/md-editer.desktop" 2>/dev/null || true
  echo "桌面启动器：$DESKTOP_DIR/md-editer.desktop"
fi

echo "完成。运行：$TARGET/start.sh"
