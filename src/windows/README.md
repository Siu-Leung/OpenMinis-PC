# OpenMinis-PC for Windows (完全加固与 1:1 原生复刻版)

> **⚠️ 备注：私人用极度不稳定 Aicoding 改 (完全审计加固版)**  
> 本模块为 OpenMinis 针对 Windows 桌面端的全功能实现，已完成深度安全隔离审计、1:1 原版 UI 复刻与高级特性对齐。

---

## 🛡️ 安全审计加固报告 (Security Audit)

1. **宿主硬盘完全物理隔离 (No Host Disk Leak)**：
   - 沙箱 `/etc/wsl.conf` 中强制注入 `[automount] enabled = false` 与 `[interop] enabled = false`。沙箱内部彻底阻断 `/mnt/c`、`/mnt/d` 等 Windows 宿主盘，严禁遍历或误删宿主系统文件。
   - 禁用 WSL Interop，禁止沙箱反向调用宿主 `cmd.exe` 或 `powershell.exe`。
2. **命令注入与路径穿越防护 (Command Sanitizer)**：
   - 修复 `win_open` 命令注入漏洞，全面拦截管道与控制字符，改用 Windows 原生 `rundll32` 安全调起。
   - `file_write` / `file_edit` 底层采用流式管道写入与 UNC 直写，突破命令行长度截断限制，支持大文件安全落盘。
3. **防假死与并发保护**：
   - 所有 Shell 调用设置 60 秒硬超时熔断与进程树清理；
   - Edge Headless 外层套用 20s/25s Tokio 异步硬超时；
   - 引入 Agent 并发调度互斥锁，多任务请求排队，彻底消除 Token 串流乱序。

---

## ✨ 核心特性 (v1.13.0.5)

- **1:1 原版 UI 与设置中心**：纯黑 `#000000` 高级底色，Grouped 卡片式设置导航（管理提供商、模型组、Token用量、MCP、记忆系统、共享文件夹）。
- **模型组自动容灾回退 (Model Groups Fallback)**：配置 Primary 主力组与备选回退队列，主模型遇故障/限流自动毫秒级切换备选模型，对话绝不中断。
- **真实 Token 用量仪表盘 (Usage Dashboard)**：总输入 (含缓存)、输出 Token、缓存读取量、命中率及各模型消耗排行统计。
- **深度思考模式 (Thinking / Reasoning)**：流式解析 `reasoning_content` 与 `<think>`，折叠卡片展示思考链，支持 OFF/Low/Med/High 强度调节。
- **图文混排与原生拖拽**：打通 Windows Explorer 原生文件与图片拖拽，支持与文本一同联合发送，支持 Ctrl+V 截图粘贴。
- **真机 Edge 浏览器自动化**：基于 Edge Headless (`--dump-dom` 与 `--screenshot`)，支持复杂 SPA 页面动态渲染与 1:1 像素级高清截图。
- **原生终端与 SSH 交互**：支持非交互式自动化运维与一键唤起 Windows Terminal (`wt.exe`) 独立 PTY 终端。
- **MCP 扩展管理**：支持集成 Stdio / SSE 外部 MCP 服务与注册工具。

---

## 📦 快速下载与运行

### 方式 A：直接下载安装包（最推荐）
前往 [GitHub Releases (v1.13.0.5)](https://github.com/Siu-Leung/OpenMinis-PC/releases/tag/v1.13.0.5) 下载打好的安装包：
- **`OpenMinis_1.13.0.5_x64-setup.exe`**（标准安装向导版）
- **`OpenMinis_1.13.0.5_x64_en-US.msi`**（Windows 原生 MSI 包）
- **`openminis-windows-v1.13.0.5.exe`**（绿色免安装单文件版）

### 方式 B：沙箱环境配置
软件内置了一键全自动配置向导。首次打开若检测到沙箱未配置，点击顶部提示条的 **【一键全自动配置沙箱】** 即可。
如需手工配置，可在 PowerShell 中运行：
```powershell
powershell -ExecutionPolicy Bypass -File src/windows/scripts/init_wsl_sandbox.ps1
```
