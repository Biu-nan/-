@echo off
chcp 65001 >nul
rem ============================================================
rem  纳物采购 · 每日发送到 ChatGPT「纳物采购助手」
rem  先重跑采集（纳物两店 + 店小秘三类），再上传最新表格并发送
rem  由 Windows 任务计划在每天 11:00 调用
rem ============================================================
cd /d F:\yikuaborder-deploy\nawu-fetch
set NODE_PATH=F:\yikuaborder-deploy\node_modules
set http_proxy=
set https_proxy=
set HTTP_PROXY=
set HTTPS_PROXY=
"C:\Users\User\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" awu-send-to-chatgpt.cjs >> F:\yikuaborder-deploy\nawu-fetch\send-task.log 2>&1
