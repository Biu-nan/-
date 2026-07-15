@echo off
setlocal
set USER_DATA_DIR=F:\yikuaborder-deploy\users\lance
set PORT=3001
set HOST=0.0.0.0
set CHROME_DEBUG_PORT=9223
echo ============================================
echo   一跨而境 - Lance
echo   监听: 0.0.0.0:3001
echo   局域网: http://本机IP:3001
echo   用户数据: users\lance
echo   Chrome调试端口: 9223
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
