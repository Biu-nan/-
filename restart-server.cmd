@echo off
chcp 65001 >nul
echo 正在查找占用 3000 端口的进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo 正在结束 PID %%a
    taskkill /F /PID %%a
)
timeout /t 2 /nobreak >nul
REM 2026-10-29 生产/开发隔离：代码从 run 目录（锁定 master）加载，数据/配置根仍是 deploy
echo 正在从生产运行目录启动服务 (F:\yikuaborder-run)...
call "F:\yikuaborder-run\start-windows-run.bat"
