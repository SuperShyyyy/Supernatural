#!/usr/bin/env bash
# md-editer 启动脚本：起一个本地静态服务并打开浏览器。
# 只需要 Node（没有 Node 时自动退回 python3），不需要任何 npm 依赖。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8321}"
APP_DIR="$DIR/app"
URL="http://127.0.0.1:${PORT}/"

# nvm 安装的 Node 不在默认 PATH 里，这里补一次
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

PORT="$PORT" node "$DIR/serve.mjs" "$APP_DIR" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "md-editer 已启动: $URL"
echo "按 Ctrl+C 停止。"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"
