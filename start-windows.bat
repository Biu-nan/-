@echo off
setlocal
set HOST=0.0.0.0
set PORT=3000
echo ============================================
echo   一跨而境 - 本地服务器
echo   监听: 0.0.0.0:3000
echo   局域网访问: http://本机IP:3000
echo   按 Ctrl+C 停止
echo ============================================
echo.
node dist\src\server.js
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [启动失败] 请检查:
  echo   1. Node.js 是否已安装 (node --version)
  echo   2. 是否已运行 npm install --production
  echo   3. dist\src\server.js 是否存在
  pause
)
pause
