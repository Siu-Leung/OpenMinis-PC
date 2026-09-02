# OpenMinis for Windows (安全加固与完全审计版)

> **⚠️ 备注：私人用极度不稳定 Aicoding 改 (完全审计加固版)**  
> 本模块为 OpenMinis 针对 Windows 桌面端的全功能实现，已完成深度安全隔离审计与能力补全。

---

## 🛡️ 安全审计加固报告 (Security Audit)

1. **宿主硬盘完全隔离 (No Host Disk Leak)**：
   - 自动在沙箱 `/etc/wsl.conf` 中声明 `[automount] enabled = false`。沙箱内部无法探查、遍历或破坏 Windows 宿主盘（`/mnt/c`, `/mnt/d` 等）。
   - 禁用 WSL Interop，禁止沙箱通过命令反向调用宿主 `cmd.exe` 或 `powershell.exe`。
2. **命令注入与路径穿越防护 (Command Sanitizer)**：
   - `file_write` / `file_edit` 底层全量采用 Base64 管道传输，根除 Shell 特殊字符转义逃逸漏洞。
   - 增加路径黑名单审计拦截，任何指向 `/mnt/` 的操作将被直接拒绝。
3. **进程树生命周期管理 (Lifecycle & Resource Management)**：
   - 所有 Shell 调用增加 60 秒硬超时熔断与僵尸进程清理；
   - 支持从界面上一键释放 WSL2 内存占用（`terminate_sandbox`）。

---

## ✨ 核心特性

- **流式打字机响应 (SSE Streaming)**：Agent 回复实时逐字输出，思考过程与工具调用状态透明展示。
- **真机浏览器自动化 (Real Web Automation)**：通过沙箱 Python 引擎真正实现网页正文抓取（`get_text`）、URL 导航（`navigate`）与快照生成（`screenshot`）。
- **模型与配置本地持久化**：支持自定义 OpenAI、Claude 代理、DeepSeek 等任意兼容服务商，配置安全保存在本地。
- **可折叠沙箱即时终端**：内置交互式终端，随时直接与 Alpine Linux 隔离环境交互。

---

## 快速安装与运行

### 方式 A：直接下载安装包（最快）
前往 [GitHub Releases](https://github.com/Siu-Leung/OpenMinis/releases) 下载打好的安装包：
- **`OpenMinis_1.13.0_x64-setup.exe`**（标准安装向导）
- **`openminis-windows.exe`**（绿色免安装版）

### 方式 B：沙箱初始化脚本
首次使用前，在 Windows PowerShell 中运行：
```powershell
powershell -ExecutionPolicy Bypass -File src/windows/scripts/init_wsl_sandbox.ps1
```
脚本会自动下载 Alpine minirootfs、配置网络镜像源并写入安全隔离规则。
