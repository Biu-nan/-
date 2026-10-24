@echo off
:: 一跨而境 · 局域网访问一键修复
:: 双击本文件 -> 弹出 UAC -> 点"是" -> 自动放行 3000 端口
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0fix-lan-access.ps1\"'"
