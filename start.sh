#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== 启动 Antigravity Web UI (局域网控制台) ==="

if command -v pm2 &>/dev/null; then
  pm2 start "$DIR/ecosystem.config.cjs"
  pm2 save
  echo "服务已通过 PM2 成功启动并守护运行！"
  pm2 status antigravity-web-ui
else
  nohup node server.js > /var/log/antigravity-web-ui.log 2>&1 &
  echo "服务已在后台启动，PID: $!"
fi

echo ""
echo "局域网访问地址:"
ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | while read -r ip; do
  if [ "$ip" != "127.0.0.1" ]; then
    echo "  👉 http://${ip}:3999"
  fi
done
echo "=============================================="
