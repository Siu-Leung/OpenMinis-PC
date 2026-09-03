# OpenMinis for Windows

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20(x64)-0078D6.svg?logo=windows&logoColor=white)](#-下载与安装使用)
[![Release](https://img.shields.io/badge/Release-v1.13.0.3-brightgreen.svg?logo=github)](https://github.com/Siu-Leung/OpenMinis/releases/tag/v1.13.0.3)
[![Build Status](https://img.shields.io/badge/CI-GitHub%20Actions%20Passed-success.svg?logo=githubactions&logoColor=white)](https://github.com/Siu-Leung/OpenMinis/actions)

> **⚠️ 声明 / Disclaimer**  
> **备注：私人用极度不稳定 Aicoding 改**  
> 本项目为基于 [OpenMinis](https://github.com/OpenMinis/OpenMinis) 官方核心哲学针对 **Windows 桌面操作系统** 的全功能移植与深度加固版本，融合了 **Hermes Agent** 与 **AionUi (OpenClaw)** 的前沿设计，仅供个人技术研究与实验性探索使用。

---

## 💡 为什么做 Windows 移植版？

原版 OpenMinis 是一款卓越的移动端 AI Agent，但很多重度开发者和运维人员的大量高频工作（复杂脚本编写、多网页比对、数据批量分析、远端服务器批量运维）发生在 **Windows 电脑桌面** 上。

市面上的桌面 AI 往往要么只是一个套壳网页，要么采用 Electron 动辄占用几百兆内存；而本移植版追求 **极致轻量、零侵入、原生性能与真机 Linux 操控能力**。

---

## 🛠️ 我们改了什么？(核心改动一览)

### 1. 架构彻底桌面化：拒绝 Electron，采用 Tauri v2 + WSL2 Alpine
* **轻量客户端**：基于 **Tauri v2 (Rust 2021 + React 18 + Tailwind CSS)**，安装包仅 **3.5MB**，单文件免安装绿色版仅 **13.8MB**，日常待机内存仅约 **40MB**。
* **真机沙箱**：告别重型虚拟机或受限模拟器，底层直接调度 Windows 原生自带的 **WSL2**，采用仅 3.8MB 的 **Alpine Linux minirootfs**，开箱享有纯正的 BusyBox ash、Python3 及原生 `apk add` 包管理生态。

### 2. 浏览器自动化真机化：利用 Edge Headless 真实动态渲染
* 抛弃了粗糙的静态正则解析，直接深度集成 Windows 宿主预装的 **Microsoft Edge Headless (`msedge.exe --headless=new`)**。
* **DOM 真实抓取**：完整执行现代单页应用（React / Vue / SPA）的 JavaScript，提取真正渲染后的纯净正文文本。
* **1:1 像素级高清截图**：支持对目标网页生成像素级高清渲染截图，自动写入沙箱 `minis://attachments/` 供对话中直接预览。

### 3. 原生终端与 SSH 交互打通
* 支持非交互自动化运维（预装 `openssh-client` 与 `sshpass`）与 **真实 PTY 交互终端** 双轨制。
* 新增 `open_terminal` 工具，一键唤起 Windows 原生 **Windows Terminal (`wt.exe`)**，完美支持 SSH 手动输入密码、指纹校验以及全屏 Vim、Htop 操控。

---

## ✨ 新增了哪些重磅功能？(借鉴 Hermes & AionUi)

参考了顶级开源 Agent **NousResearch Hermes Agent** 与 **AionUi (OpenClaw)** 的工程实践，新融入了 3 大智能核心：

| 新增特性 | 借鉴灵感 | 功能落地说明 |
| :--- | :--- | :--- |
| **📜 跨会话历史检索与对话恢复** | **Hermes Agent**<br>*(Cross-session recall)* | 会话完整上下文独立存储于 `sessions/{id}.json`。侧边栏历史抽屉支持关键词秒级搜索历史会话；**点击任意历史记录，一键恢复该会话全部消息并继续对话**。 |
| **⏰ 24/7 后台自动化定时任务** | **Hermes Cron**<br>+ **AionUi 自动化** | 支持 Once、Daily、Weekdays、Custom 定时任务；后台启动 **30 秒异步守护协程驱动**，到点自动唤醒 Agent 执行预设 Prompt，带同一分钟防重复触发机制。 |
| **🧠 自主学习持久化记忆系统** | **Hermes Agent**<br>*(Self-improving memory)* | Agent 拥有 `memory_write` 与 `memory_search` 原生工具；每日日志 (`YYYY-MM-DD.md`) + 全局记忆 (`GLOBAL.md`) 双层存储；**检索时全库穿透扫描**，彻底修复跨午夜日期锁死问题。 |
| **📂 沙箱数据无缝互通** | Windows 桌面体验优化 | 侧边栏新增「浏览沙箱文件」按钮，直接调起 Windows 资源管理器直达 `\\wsl$\OpenMinisSandbox\var\minis`，直观查看导出的文件、图表与截图。 |

---

## 🛡️ 安全审计与深度加固报告

经过专业子角色红队视角审计，本版本完成了高标准的安全性加固：

1. **零信任宿主磁盘物理隔离 (Zero Host Leak)**：
   - 自动在沙箱 `/etc/wsl.conf` 中注入 `[automount] enabled = false` 和 `[interop] enabled = false`；
   - **沙箱内部彻底阻断 `/mnt/c`、`/mnt/d` 等 Windows 宿主盘符挂载**，严禁 Agent 越权访问宿主文件；禁止反向调用 Windows 宿主可执行程序。
2. **命令注入漏洞根治**：
   - 全面重构 `win_open` 工具，严密拦截 `|`、`&`、`;`、`$`、反引号等元字符，改用 Windows 原生 `rundll32 url.dll` 调起默认浏览器，根除命令逃逸。
   - 文件操作（`file_write` / `file_edit`）底层全量使用 Base64 数据管道写入，避免单双引号破坏 Shell 语法。
3. **上下文防撑爆与大输出截断 (Offloads)**：
   - 当 Shell 命令产生超长输出（超过 12,000 字符）时，自动截取首尾保护上下文，中间完整内容归档保存至 `/var/minis/offloads/output_xxx.txt` 并透传结构化路径。
4. **Agent 互斥并发锁与死循环熔断**：
   - 引入 `execution_lock` 调度锁，防止多任务或并发请求导致 Token 串流打架；
   - 内置死循环探测器：单工具同参数重复 3 次自动熔断，全局单轮设 20 次安全上限，并在返回前补齐 Assistant 消息，严格符合 OpenAI / Anthropic 时序协议规范。
5. **双重硬超时防假死**：
   - 沙箱命令 60 秒硬超时；Edge Headless 20s/25s 外层硬超时，遇死循环网页自动强杀。

---

## 📦 下载与安装使用

### 1. 直接下载打包好的可执行文件

所有产物均由 GitHub Actions 自动化编译通过：

👉 **[前往 GitHub Releases 查看与下载最新版本 (v1.13.0.3)](https://github.com/Siu-Leung/OpenMinis/releases/tag/v1.13.0.3)**

| 安装包文件 | 大小 | 说明 | 快速直链 |
| :--- | :---: | :--- | :--- |
| **`OpenMinis_1.13.0.3_x64-setup.exe`** | **~3.6 MB** | **标准安装向导版（强烈推荐）** | [点击直接下载](https://github.com/Siu-Leung/OpenMinis/releases/download/v1.13.0.3/OpenMinis_1.13.0.3_x64-setup.exe) |
| **`OpenMinis_1.13.0.3_x64_en-US.msi`** | **~5.3 MB** | Windows 原生 MSI 安装程序 | [点击直接下载](https://github.com/Siu-Leung/OpenMinis/releases/download/v1.13.0.3/OpenMinis_1.13.0.3_x64_en-US.msi) |
| **`openminis-windows-v1.13.0.3.exe`** | **~14.5 MB** | 绿色单文件便携免安装版，双击即跑 | [点击直接下载](https://github.com/Siu-Leung/OpenMinis/releases/download/v1.13.0.3/openminis-windows-v1.13.0.3.exe) |

### 2. 沙箱环境初始化 (仅首次运行需要)

首次使用前，确保已开启 WSL2（若未开启，在管理员终端执行 `wsl --install --no-distribution`），然后在 PowerShell 中执行自带的沙箱配置脚本：
```powershell
powershell -ExecutionPolicy Bypass -File src/windows/scripts/init_wsl_sandbox.ps1
```

### 3. 从源码本地构建
```powershell
cd src/windows
npm install
npm run tauri build
```

---

## 🙏 致谢与致敬 (Acknowledgements)

站在巨人的肩膀上，特别向以下优秀的开源先驱致以崇高的敬意与由衷感谢：

- **[OpenMinis](https://github.com/OpenMinis/OpenMinis)**（原作者团队及贡献者）：  
  感谢创造了如此优秀的移动端端侧 Agent 理念与架构范式，奠定了本项目的核心灵魂。
- **[Nous Research](https://github.com/NousResearch/hermes-agent)**（Hermes Agent 团队）：  
  感谢 Hermes Agent 带来的灵感与启发，本项目借鉴了其 FTS5 跨会话回忆、自主学习持久记忆循环及优雅的终端设计。
- **[iOfficeAI Team](https://github.com/iOfficeAI/AionUi)**（AionUi / OpenClaw 团队）：  
  感谢 AionUi 团队在多 Agent 协同、24/7 无人值守 Cron 自动化调度及办公助理集成方面的优秀开源探索。
- **[Tauri Apps Team](https://github.com/tauri-apps/tauri)**：  
  感谢 Tauri 提供的高性能、安全且极致轻量的 Rust 桌面应用开发框架。
- **[Alpine Linux](https://alpinelinux.org/) & [Microsoft WSL2](https://github.com/microsoft/WSL)**：  
  感谢提供极度精简安全的 Linux Minirootfs 与 Windows 原生虚拟化技术底座。

---

## 📜 许可证 (License)

本项目遵循 **[GNU General Public License v3.0 (GPLv3)](LICENSE)** 开源协议。
所有的改动均保持完全开源透明，尊重并传承上游所有开源组件之授权协议。
