@echo off
setlocal
REM ============================================================
REM  一跨而境 - 生产运行启动（代码锁定在独立 run 目录）
REM  代码: 本脚本所在目录（git worktree, 跟踪 master）——只放代码
REM  数据: F:\yikuaborder-deploy（PROJECT_ROOT/USER_DATA_DIR，单一真相）
REM  规则: 更新版本 = 在本目录 git merge --ff-only <分支或tag> 后重启本脚本
REM ============================================================
set "RUN_DIR=%~dp0"
if "%RUN_DIR:~-1%"=="\" set "RUN_DIR=%RUN_DIR:~0,-1%"
set "DATA_DIR=F:\yikuaborder-deploy"

REM 防呆护栏：源码副本（deploy 里那份）不允许直接启动生产
if /I not "%RUN_DIR%"=="F:\yikuaborder-run" (
  echo [提示] 你点的是源码副本：%RUN_DIR%\start-windows-run.bat
  echo        生产启动请双击: F:\yikuaborder-run\start-windows-run.bat
  pause
  exit /b 1
)
set HOST=0.0.0.0
set PORT=3000

set CODE_BRANCH=unknown
set CODE_COMMIT=unknown
for /f "usebackq delims=" %%i in (`git -C "%RUN_DIR%" rev-parse --abbrev-ref HEAD 2^>nul`) do set CODE_BRANCH=%%i
for /f "usebackq delims=" %%i in (`git -C "%RUN_DIR%" rev-parse --short HEAD 2^>nul`) do set CODE_COMMIT=%%i

echo ============================================
echo   一跨而境 - 本地服务器（生产运行目录）
echo   代码: %RUN_DIR%
echo   版本: %CODE_BRANCH% @ %CODE_COMMIT%
echo   数据: %DATA_DIR%
echo   监听: 0.0.0.0:%PORT%  (局域网: http://本机IP:%PORT%)
echo   按 Ctrl+C 停止
echo ============================================
echo   启动后可用 http://localhost:3000/api/version 核对版本
echo ============================================
echo.

cd /d "%DATA_DIR%"
node "%RUN_DIR%\dist\src\server.js"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [启动失败] 请检查:
  echo   1. Node.js 是否已安装 (node --version)
  echo   2. %RUN_DIR%\node_modules 是否存在 (首次需 robocopy 或 npm install)
  echo   3. %RUN_DIR%\dist\src\server.js 是否存在
  pause
)
pause
