# WinAICheck - Windows AI 环境一键诊断
# 使用方法: irm https://raw.githubusercontent.com/gugug168/WinAICheck/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Repo = "gugug168/WinAICheck"
$ExeName = "WinAICheck.exe"
$InstallDir = "$env:USERPROFILE\.winaicheck"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  WinAICheck - Windows AI 环境诊断工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 创建安装目录
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$ExePath = Join-Path $InstallDir $ExeName

# 获取最新版本下载链接
Write-Host "[1/3] 获取最新版本..." -ForegroundColor Yellow
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction Stop
    $Version = $Release.tag_name
    $Asset = $Release.assets | Where-Object { $_.name -eq $ExeName } | Select-Object -First 1

    if (-not $Asset) {
        Write-Host "[错误] 未找到 $ExeName 下载文件" -ForegroundColor Red
        Write-Host "请前往 https://github.com/$Repo/releases 手动下载" -ForegroundColor Yellow
        exit 1
    }

    $DownloadUrl = $Asset.browser_download_url
    Write-Host "       最新版本: $Version" -ForegroundColor Green
}
catch {
    Write-Host "[错误] 无法获取版本信息: $_" -ForegroundColor Red
    Write-Host "请检查网络连接，或前往 https://github.com/$Repo/releases 手动下载" -ForegroundColor Yellow
    exit 1
}

# 下载 exe
Write-Host "[2/3] 下载中..." -ForegroundColor Yellow
try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -ErrorAction Stop
    $ProgressPreference = 'Continue'
    $Size = [math]::Round((Get-Item $ExePath).Length / 1MB, 1)
    Write-Host "       已下载 ${Size}MB -> $ExePath" -ForegroundColor Green
}
catch {
    Write-Host "[错误] 下载失败: $_" -ForegroundColor Red
    exit 1
}

# 运行
Write-Host "[3/3] 启动 WinAICheck..." -ForegroundColor Yellow
Write-Host ""
& $ExePath @args
