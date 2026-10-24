# 一跨而境工作台 - 一键彻底重启脚本
# 作用：强制释放 3000 端口并重新启动 npm start，确保代码修改后真正生效

$ErrorActionPreference = "SilentlyContinue"

Write-Host "正在查找占用 3000 端口的进程..." -ForegroundColor Cyan
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen
if ($conn) {
    $pids = $conn | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
        try {
            Stop-Process -Id $pid -Force
            Write-Host "已结束 PID $pid" -ForegroundColor Yellow
        } catch {
            Write-Host "无法结束 PID ${pid}: $_" -ForegroundColor Red
        }
    }
} else {
    Write-Host "3000 端口未被占用" -ForegroundColor Green
}

# 额外保险：也杀掉本目录相关的 node 进程（避免多个实例并存）
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*yikuaborder-deploy*" }
foreach ($p in $procs) {
    try {
        Stop-Process -Id $p.ProcessId -Force
        Write-Host "已结束相关 Node 进程 PID $($p.ProcessId)" -ForegroundColor Yellow
    } catch {
        Write-Host "无法结束 Node 进程 PID $($p.ProcessId): $_" -ForegroundColor Red
    }
}

Start-Sleep -Seconds 2

Write-Host "正在启动服务..." -ForegroundColor Cyan
Set-Location F:\yikuaborder-deploy
npm start
