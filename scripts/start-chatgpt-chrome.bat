@echo off
REM 启动 ChatGPT 专用 Chrome（带 --remote-debugging-port=9223 CDP）
REM 双击本文件即可；后台一直跑，不关本窗口 Chrome 就不会掉。
chcp 65001 >nul
setlocal
set "USER_DATA_DIR=F:\yikuaborder-deploy\.chrome-profile"
set "CDP_PORT=9223"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"

echo [1/3] 杀掉旧的不带 CDP 端口的 chrome.exe（保留带 --remote-debugging-port 的）...
for /f "tokens=*" %%P in ('tasklist /FI "IMAGENAME eq chrome.exe" /NH 2^>nul') do (
  for /f "tokens=2" %%I in ("%%P") do (
    rem 查命令行，看是否含 --remote-debugging-port
    wmic process where "ProcessId=%%I" get CommandLine /format:list 2>nul | findstr /I "remote-debugging-port" >nul
    if errorlevel 1 (
      rem 没有任何 chrome 带 CDP，跳过；否则杀旧
      echo   kill PID=%%I
      taskkill /F /PID %%I >nul 2>&1
    )
  )
)

echo [2/3] 检测 9223 端口...
netstat -ano | findstr ":%CDP_PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo   port %CDP_PORT% already LISTENING，浏览器无需重启。
  goto :ready
)

echo [3/3] 启动新 Chrome（--remote-debugging-port=%CDP_PORT%）...
start "" "%CHROME_EXE%" --remote-debugging-port=%CDP_PORT% --user-data-dir="%USER_DATA_DIR%" --no-first-run --no-default-browser-check --start-maximized https://chatgpt.com/

:ready
echo.
echo ✅ 完成。浏览器打开 ChatGPT 后，工作台（localhost:3000）可继续批量上架。
echo    不关本窗口，Chrome 就一直保持 9223 监听。
endlocal
pause