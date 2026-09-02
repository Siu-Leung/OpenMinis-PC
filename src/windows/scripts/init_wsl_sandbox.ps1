# OpenMinis - Windows WSL2 Alpine Sandbox Initializer
# 备注：私人用极度不稳定 Aicoding 改

[CmdletBinding()]
param (
    [string]$DistroName = "OpenMinisSandbox",
    [string]$AlpineVersion = "3.20.2",
    [string]$Arch = "x86_64"
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  OpenMinis Windows WSL2 沙箱初始化向导  " -ForegroundColor Cyan
Write-Host "  (私人用极度不稳定 Aicoding 改)        " -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Cyan

# 1. 检查 WSL 可用性
Write-Host "`n[1/5] 检查系统 WSL 环境..." -ForegroundColor Green
$wslCheck = wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning "未检测到已就绪的 WSL2 环境。请确保在 Windows 终端中运行：wsl --install --no-distribution 并重启计算机。"
    exit 1
}

# 2. 准备工作目录
$baseDir = Join-Path $env:LOCALAPPDATA "OpenMinis"
$sandboxDir = Join-Path $baseDir "sandbox"
$dataDir = Join-Path $baseDir "data"
$downloadDir = Join-Path $baseDir "downloads"

New-Item -ItemType Directory -Force -Path $sandboxDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

Write-Host "数据目录: $dataDir"
Write-Host "沙箱路径: $sandboxDir"

# 3. 检查沙箱实例是否已存在
$existingDistros = wsl --list --quiet 2>$null
if ($existingDistros -match $DistroName) {
    Write-Host "`n[2/5] 沙箱实例 '$DistroName' 已存在，跳过重新导入。" -ForegroundColor Yellow
} else {
    Write-Host "`n[2/5] 下载 Alpine Linux Minirootfs ($AlpineVersion - $Arch)..." -ForegroundColor Green
    $fileName = "alpine-minirootfs-$AlpineVersion-$Arch.tar.gz"
    $downloadUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/$Arch/$fileName"
    $tarPath = Join-Path $downloadDir $fileName

    if (-not (Test-Path $tarPath)) {
        Write-Host "正在从 $downloadUrl 下载..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tarPath
    }

    Write-Host "`n[3/5] 正在向 WSL2 导入沙箱实例 '$DistroName'..." -ForegroundColor Green
    wsl --import $DistroName $sandboxDir $tarPath --version 2
    if ($LASTEXITCODE -ne 0) {
        Write-Error "WSL 导入失败，退出代码: $LASTEXITCODE"
        exit 1
    }
}

# 4. 初始化 Alpine 内部目录与基础环境
Write-Host "`n[4/5] 配置 Alpine 沙箱内部环境与挂载点..." -ForegroundColor Green
$initCommands = @'
mkdir -p /var/minis/workspace /var/minis/attachments /var/minis/shared /var/minis/offloads /var/minis/memory
sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories 2>/dev/null || true
echo "nameserver 1.1.1.1" > /etc/resolv.conf
apk update && apk add --no-cache curl ca-certificates busybox python3 py3-pip bash
'@

wsl -d $DistroName -u root --exec /bin/sh -c $initCommands

# 5. 验证安装
Write-Host "`n[5/5] 验证沙箱执行环境..." -ForegroundColor Green
$verifyOutput = wsl -d $DistroName -u root --exec /bin/sh -c "cat /etc/os-release | grep PRETTY_NAME"
Write-Host "沙箱系统信息: $verifyOutput" -ForegroundColor Cyan

Write-Host "`n[✓] OpenMinis Windows 沙箱初始化完成！" -ForegroundColor Green
Write-Host "可以在终端中运行: wsl -d $DistroName 进入沙箱交互。"
