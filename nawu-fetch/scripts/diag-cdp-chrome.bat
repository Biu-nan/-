@echo off
chcp 65001 >nul
REM 诊断用：带日志启动 CDP Chrome，观察为何启动后自退
set "USER_DATA_DIR=F:\yikuaborder-deploy\.chrome-profile"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "LOGDIR=F:\yikuaborder-deploy\nawu-fetch\.tmp"

echo [%DATE% %TIME%] launching...
start "" "%CHROME_EXE%" --remote-debugging-port=9223 --user-data-dir="%USER_DATA_DIR%" --no-first-run --no-default-browser-check --enable-logging --v=1 --log-file="%LOGDIR%\chrome_debug.log" about:blank
echo [%DATE% %TIME%] launched, waiting...
timeout /t 25 /nobreak >nul
echo [%DATE% %TIME%] netstat:
netstat -ano | findstr ":9223"
echo [%DATE% %TIME%] chrome procs with 9223:
wmic process where "Name='chrome.exe'" get ProcessId,CommandLine /format:csv 2>nul | findstr "9223"
echo [%DATE% %TIME%] done.
exit /b 0
