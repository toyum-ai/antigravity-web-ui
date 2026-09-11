#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== 停止 Antigravity Web UI ==="
if command -v pm2 &>/dev/null; then
  pm2 stop antigravity-web-ui || true
  pm2 delete antigravity-web-ui || true
  pm2 save
fi
pkill -f "tools/antigravity-web-ui/server.js" || true
echo "服务已停止。"
