param(
    [string]$ZipPath = "$env:USERPROFILE\Downloads\Anna_Phase1A_Source_Pack.zip",
    [string]$Destination = "F:\Lance的数据库\90_Backlog\upgrade_v1_0\source_docs"
)

$ErrorActionPreference = "Stop"

$expectedFiles = @(
    "写个五年后自己的一封信.md",
    "2026年度计划.md",
    "SOURCE_AUTHORITY.md"
)

if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw "未找到来源包：$ZipPath"
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null

# 清理目标目录中同名旧文件，避免把旧版本误判为本次交接成功
foreach ($name in $expectedFiles) {
    $target = Join-Path $Destination $name
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Force
    }
}

Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force

$missing = @()
$manifest = @()

foreach ($name in $expectedFiles) {
    $path = Join-Path $Destination $name

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $missing += $name
        continue
    }

    $item = Get-Item -LiteralPath $path
    $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256

    $manifest += [PSCustomObject]@{
        file_name   = $item.Name
        local_path  = $item.FullName
        sha256      = $hash.Hash
        size_bytes  = $item.Length
        modified_at = $item.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ssK")
        read_status = "VERIFIED"
    }
}

if ($missing.Count -gt 0) {
    throw "解压后仍缺少文件：$($missing -join ', ')"
}

$manifestPath = Join-Path $Destination "SOURCE_HANDOFF_MANIFEST.csv"
$manifest | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8

Write-Host ""
Write-Host "SOURCE_HANDOFF_VERIFIED" -ForegroundColor Green
Write-Host "来源目录：$Destination"
Write-Host "Manifest：$manifestPath"
Write-Host ""
$manifest | Format-Table -AutoSize
