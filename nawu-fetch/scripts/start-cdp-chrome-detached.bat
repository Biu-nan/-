@echo off
REM 以独立进程树启动 ChatGPT 专用 Chrome（CDP 9223），不杀任何现有 Chrome
REM 由 nawu-fetch 管线前置环境拉起使用
chcp 65001 >nul
set "USER_DATA_DIR=F:\yikuaborder-deploy\.chrome-profile"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"

netstat -ano | findstr ":9223 " | findstr LISTENING >nul
if not errorlevel 1 (
  echo port 9223 already LISTENING, skip launch.
  exit /b 0
)

echo launching Chrome with CDP 9223 ...
start "" "%CHROME_EXE%" --remote-debugging-port=9223 --user-data-dir="%USER_DATA_DIR%" --no-first-run --no-default-browser-check --start-maximized https://chatgpt.com/
echo launched.
exit /b 0
