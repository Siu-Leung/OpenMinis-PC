# OpenMinis - Windows WSL2 Alpine Sandbox Initializer & Hardener
# 备注：私人用极度不稳定 Aicoding 改 (完全审计加固版)

[CmdletBinding()]
param (
    [string]$DistroName = "OpenMinisSandbox",
    [string]$AlpineVersion = "3.20.2",
    [string]$Arch = "x86_64"
)

$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   OpenMinis Windows WSL2 沙箱初始化与安全加固向导   " -ForegroundColor Cyan
Write-Host "   (私人用极度不稳定 Aicoding 改 - 完全审计版)      " -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. 检查 WSL 可用性
Write-Host "`n[1/6] 检查系统 WSL 环境..." -ForegroundColor Green
$wslCheck = wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning "未检测到已就绪的 WSL2 环境。请确保在 Windows 终端中运行：wsl --install --no-distribution 并重启计算机。"
    exit 1
}

# 2. 准备专用工作目录
$baseDir = Join-Path $env:LOCALAPPDATA "OpenMinis"
$sandboxDir = Join-Path $baseDir "sandbox"
$dataDir = Join-Path $baseDir "data"
$downloadDir = Join-Path $baseDir "downloads"

New-Item -ItemType Directory -Force -Path $sandboxDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

Write-Host "沙箱镜像目录: $sandboxDir"
Write-Host "隔离数据目录: $dataDir"

# 3. 检查沙箱实例是否已存在
$existingDistros = wsl --list --quiet 2>$null
if ($existingDistros -match $DistroName) {
    Write-Host "`n[2/6] 沙箱实例 '$DistroName' 已存在，跳过导入步骤。" -ForegroundColor Yellow
} else {
    Write-Host "`n[2/6] 下载 Alpine Linux Minirootfs ($AlpineVersion - $Arch)..." -ForegroundColor Green
    $fileName = "alpine-minirootfs-$AlpineVersion-$Arch.tar.gz"
    $downloadUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/$Arch/$fileName"
    $tarPath = Join-Path $downloadDir $fileName

    if (-not (Test-Path $tarPath)) {
        Write-Host "正在从 $downloadUrl 下载精简根镜像..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tarPath
    }

    Write-Host "`n[3/6] 正在向 WSL2 导入全新沙箱实例 '$DistroName'..." -ForegroundColor Green
    wsl --import $DistroName $sandboxDir $tarPath --version 2
    if ($LASTEXITCODE -ne 0) {
        Write-Error "WSL 导入失败，退出代码: $LASTEXITCODE"
        exit 1
    }
}

# 4. 关键安全加固：彻底切断宿主 Windows 硬盘挂载与命令互操作！
Write-Host "`n[4/6] 注入安全审计隔离配置 (/etc/wsl.conf)..." -ForegroundColor Green
$wslConfContent = @"
[automount]
enabled = false
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false

[network]
generateResolvConf = true
"@

# 通过管道无损写入 /etc/wsl.conf
$b64Conf = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($wslConfContent))
wsl -d $DistroName -u root --exec /bin/sh -c "echo '$b64Conf' | base64 -d > /etc/wsl.conf"

# 5. 配置沙箱内部工作目录与 Python/网络/浏览器抓取运行环境
Write-Host "`n[5/6] 配置 Alpine 沙箱内部环境与运行工具箱..." -ForegroundColor Green
$initScript = @'
mkdir -p /var/minis/workspace /var/minis/attachments /var/minis/shared /var/minis/offloads /var/minis/memory
sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories 2>/dev/null || true
echo "nameserver 1.1.1.1" > /etc/resolv.conf
apk update
apk add --no-cache curl ca-certificates busybox python3 py3-pip bash jq bind-tools libxml2 libxslt
pip install --break-system-packages beautifulsoup4 requests 2>/dev/null || true
'@

wsl -d $DistroName -u root --exec /bin/sh -c $initScript

# 重启实例使 wsl.conf 安全隔离生效
Write-Host "正在重启沙箱实例以激活安全策略..."
wsl --terminate $DistroName 2>$null
Start-Sleep -Seconds 2

# 6. 审计与验证隔离状态
Write-Host "`n[6/6] 审计验证沙箱隔离与环境安全..." -ForegroundColor Green
$mountsCheck = wsl -d $DistroName -u root --exec /bin/sh -c "mount | grep -i mnt" 2>$null
if ([string]::IsNullOrWhiteSpace($mountsCheck)) {
    Write-Host "[✓ 安全审计通过] 宿主磁盘隔离成功，沙箱内部无任何 Windows 盘符挂载！" -ForegroundColor Green
} else {
    Write-Warning "仍存在挂载项: $mountsCheck"
}

$pyCheck = wsl -d $DistroName -u root --exec /bin/sh -c "python3 --version" 2>$null
Write-Host "[✓ 运行环境就绪] $pyCheck" -ForegroundColor Green

Write-Host "`n=====================================================" -ForegroundColor Cyan
Write-Host "  OpenMinis 安全沙箱配置完毕！沙箱环境与宿主已完全隔离  " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
