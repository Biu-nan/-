# 一跨而境 · 局域网访问修复（管理员权限部分）
# 作用：把本机有线网络设为"专用/私有"，并放行 3000 端口入站，使同局域网设备可访问工作台。
try {
    $target = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq '192.168.1.105' } | Select-Object -First 1
    if ($target) {
        Set-NetConnectionProfile -InterfaceIndex $target.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
        Write-Host ("[OK] 网络 '" + $target.InterfaceAlias + "' 已设为专用(Private)")
    } else {
        Write-Host "[WARN] 未找到 192.168.1.105 网卡，跳过网络类别设置"
    }
} catch {
    Write-Host ("[WARN] 设置网络类别失败: " + $_.Exception.Message)
}

try {
    New-NetFirewallRule -DisplayName "YKJ LAN 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -ErrorAction Stop
    Write-Host "[OK] 已放行 TCP 3000 入站(专用网络)"
} catch {
    Write-Host ("[INFO] 规则可能已存在: " + $_.Exception.Message)
}

Write-Host ""
Write-Host "=== 修复完成 ==="
Write-Host "其他设备浏览器打开: http://192.168.1.105:3000"
Read-Host "按 Enter 关闭此窗口"
