@echo off
chcp 65001 >nul
echo 正在查找占用 3000 端口的进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo 正在结束 PID %%a
    taskkill /F /PID %%a
)
timeout /t 2 /nobreak >nul
cd /d F:\yikuaborder-deploy
echo 正在启动服务...
npm start
