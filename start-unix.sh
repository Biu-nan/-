#!/bin/bash
export HOST=0.0.0.0
export PORT=3000
echo "============================================"
echo "  一跨而境 - 本地服务器"
echo "  监听: 0.0.0.0:3000"
echo "  局域网访问: http://本机IP:3000"
echo "  按 Ctrl+C 停止"
echo "============================================"
node dist/src/server.js
