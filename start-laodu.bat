@echo off
setlocal
set USER_DATA_DIR=F:\yikuaborder-deploy\users\laodu
set PORT=3002
set HOST=0.0.0.0
set CHROME_DEBUG_PORT=9224
echo ============================================
echo   一跨而境 - 老杜
echo   监听: 0.0.0.0:3002
echo   局域网: http://本机IP:3002
echo   用户数据: users\laodu
echo   Chrome调试端口: 9224
echo   按 Ctrl+C 停止
echo ============================================
echo.
node dist\src\server.js
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [启动失败]
  pause
)
pause
