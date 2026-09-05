# OpenMinis-PC

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20(x64)-0078D6.svg?logo=windows&logoColor=white)](#-下载与快速开始)
[![Release](https://img.shields.io/badge/Release-v1.13.0.26-brightgreen.svg?logo=github)](https://github.com/Siu-Leung/OpenMinis-PC/releases/tag/v1.13.0.26)
[![Build Status](https://img.shields.io/badge/CI-GitHub%20Actions%20Passed-success.svg?logo=githubactions&logoColor=white)](https://github.com/Siu-Leung/OpenMinis-PC/actions)

> **⚠️ 特别声明 / Disclaimer**  
> **备注：OpenMinis Windows 体验版**  
> 本项目为基于 [OpenMinis](https://github.com/OpenMinis/OpenMinis) 官方核心哲学针对 **Windows 桌面操作系统** 的全功能移植与深度加固版本，融合了 **Hermes Agent** 与 **AionUi (OpenClaw)** 的前沿设计，仅供个人技术研究与实验性探索使用。

---

## 🌟 什么是 OpenMinis-PC？

**你的桌面私有端侧 AI 智能体（Your private, on-device AI agent for Windows）。**

它绝不是又一个平庸的网页套壳聊天框，而是**真正给大模型一台电脑让它为你干活**：

OpenMinis-PC 将顶尖大模型（Claude、GPT-4o/5、DeepSeek-V3/R1、Gemini、Qwen 及本地 Ollama）接入原生 Windows 桌面体验。它自带一个**完全独立的 Alpine Linux 隔离沙箱**，让 Agent 拥有了真实的计算机操作能力——自主安装软件包、运行 Python/Shell 脚本、通过原生 Edge 浏览器自动化抓取网页、在模型故障时自动平滑回退、跨会话沉淀持久记忆，并支持 MCP 协议无缝扩展。

完全开源，零多余依赖，极度轻量。

---

## 🎯 核心功能特性 (What It Does)

| 核心维度 | 功能说明 |
| :--- | :--- |
| **自备任意模型 (BYOM)** | 支持添加任意 OpenAI 兼容供应商（DeepSeek、OpenAI、Claude、硅基流动、本地 Ollama 等），支持一键自动拉取模型列表。 |
| **真实 Linux 沙箱** | 基于 Windows 原生 WSL2 的轻量 Alpine Linux 沙箱，Agent 可自由 `apk add`、运行 Python、生成与处理文件。 |
| **模型组自动容灾 (Fallback)** | 1:1 对标原版 `Model Groups`：配置主力模型与备选队列，主模型遇到 429 限流或报错时毫秒级自动回退，对话永不中断。 |
| **深度思考模式 (Thinking)** | 原生支持 DeepSeek `reasoning_content` 与 OpenAI `reasoning_effort`，带思考计时与折叠卡片，支持 OFF/Low/Med/High 强度切换。 |
| **真机 Edge 浏览器自动化** | 深度调用系统自带 Microsoft Edge Headless，完整渲染复杂 SPA 单页应用，提取真实纯净正文，支持 1:1 高清网页截图。 |
| **原生终端与 SSH 运维** | 自动化脚本支持 `sshpass` 批量操作；需要交互输入密码或运行 Vim/Htop 时，一键无缝唤起系统级 Windows Terminal (`wt.exe`)。 |
| **真实 Token 用量统计** | 1:1 原版仪表盘：精确统计总输入 (含缓存)、输出 Token、缓存读取量与命中率，按模型展示历史消耗排行榜。 |
| **图文混排与多模态文件** | 支持从 Windows 资源管理器直接拖拽文件/图片进入窗口，支持 Ctrl+V 粘贴截图，支持文字与附件一同联合发送。 |
| **持久化记忆与跨会话回忆** | 每日日志 (`YYYY-MM-DD.md`) + 全局记忆 (`GLOBAL.md`) 双层穿透检索；会话完整独立存储，支持点击历史一键恢复对话。 |
| **MCP 扩展协议集成** | 支持管理 Stdio / SSE 外部 Model Context Protocol 服务器，外部工具自动注册并入 Agent 调度链。 |

---

## 💡 你可以用 OpenMinis-PC 做什么？

- **自动化网络深度研报**：让 Agent 自动使用 Edge 浏览器遍历多篇网页、分析提取数据、生成对比图表并保存至沙箱工作区。
- **批量服务器运维与排查**：让 Agent 编写运维脚本，通过内置 SSH 工具链批量连接 VPS 检查网络延迟、服务状态并汇总报告。
- **代码重构与本地测试**：直接拖入 Python、TypeScript 或 C++ 代码文件，让 Agent 在隔离沙箱中安全运行测试、排查 Bug 并输出修复后的文件。
- **24/7 无人值守自动化任务**：设定定时任务，每天早晨自动抓取关注的资讯并总结，夜间自动备份关键文件。
- **高复杂问题深度推演**：开启 High/Max 思考强度，调用 DeepSeek-R1 或 o3 等推理模型，展开完整思考链卡片查看推演全过程。

---

## 🛠️ 相比原版移动端与市面客户端的独家改进

### 1. 拒绝 Electron：极轻量的 Tauri v2 原生架构
* 安装包仅 **3.7MB**，单文件免安装版仅 **14.8MB**；
* 日常待机运行内存仅约 **40MB**（对比 Electron 动辄 300MB~600MB）；
* 彻底消除后台控制台黑框闪现（全量注入 `CREATE_NO_WINDOW`）。

### 2. 严苛的零信任沙箱安全隔离
* 沙箱 `/etc/wsl.conf` 强制禁用自动挂载与 Interop，**沙箱内彻底切断 `/mnt/c`、`/mnt/d` 等 Windows 宿主盘符**，杜绝误删或破坏宿主系统文件；
* 文件写入全量采用流式管道与 UNC 直写，根除命令行字符数截断限制；
* 引入并发调度互斥锁与单轮 20 次工具死循环熔断保护。

### 3. 1:1 原生 UI 界面与交互体验
* 彻底洗净廉价“AI 模板味”，采用原版纯黑（`#000000`）高质感底色；
* 去除所有大机器人头像，保留 Assistant 纯净左对齐排版与 User 原生气泡；
* 原版 `ToolCapsuleView` 极简单行胶囊与 `ChatInputBar` 原版经典向上发送键 (`arrow.up.circle.fill`)。

---

## 📦 下载与快速开始

### 1. 下载可执行文件 (GitHub Releases)

所有安装包均通过 GitHub Actions 自动化流水线安全构建：

👉 **[前往 GitHub Releases 查看与下载最新版本 (v1.13.0.26)](https://github.com/Siu-Leung/OpenMinis-PC/releases/tag/v1.13.0.26)**

| 安装包文件 | 大小 | 说明 | 快速直链 |
| :--- | :---: | :--- | :--- |
| **`OpenMinis_1.13.0.26_x64-setup.exe`** | **~3.8 MB** | **标准安装向导版（强烈推荐）** | [点击直接下载](https://github.com/Siu-Leung/OpenMinis-PC/releases/download/v1.13.0.26/OpenMinis_1.13.0.26_x64-setup.exe) |
| **`OpenMinis_1.13.0.26_x64_en-US.msi`** | **~5.5 MB** | Windows 原生 MSI 安装程序 | [点击直接下载](https://github.com/Siu-Leung/OpenMinis-PC/releases/download/v1.13.0.26/OpenMinis_1.13.0.26_x64_en-US.msi) |
| **`openminis-windows-v1.13.0.26.exe`** | **~15.1 MB** | 绿色单文件便携免安装版，双击即跑 | [点击直接下载](https://github.com/Siu-Leung/OpenMinis-PC/releases/download/v1.13.0.26/openminis-windows-v1.13.0.26.exe) |

### 2. 沙箱初始化 (仅首次使用)

- **方式 A（全自动，推荐）**：打开软件后，若顶部出现未配置提示，直接点击 **【一键全自动配置沙箱】**，软件会在后台自动拉取镜像并完成导入（约 20 秒）。
- **方式 B（手工配置）**：确保已启用 WSL2，在 Windows PowerShell 中执行：
  ```powershell
  powershell -ExecutionPolicy Bypass -File src/windows/scripts/init_wsl_sandbox.ps1
  ```

---

## 🙏 致谢与致敬 (Acknowledgements)

站在巨人的肩膀上，特别向以下优秀的开源先驱致以崇高的敬意与由衷感谢：

- **[OpenMinis](https://github.com/OpenMinis/OpenMinis)**（原作者团队及贡献者）：感谢创造了卓越的端侧 AI Agent 核心架构理念与克制优雅的设计范式。
- **[Nous Research](https://github.com/NousResearch/hermes-agent)**（Hermes Agent 团队）：感谢启发了跨会话回忆、自主学习持久记忆循环及优雅的交互规范。
- **[iOfficeAI Team](https://github.com/iOfficeAI/AionUi)**（AionUi / OpenClaw 团队）：感谢在多 Agent 协同、24/7 无人值守 Cron 调度与办公工具集成方面的宝贵开源探索。
- **[Tauri Apps Team](https://github.com/tauri-apps/tauri)**：感谢提供极致轻量、安全、高效的跨平台桌面应用开发底座。
- **[Alpine Linux](https://alpinelinux.org/) & [Microsoft WSL2](https://github.com/microsoft/WSL)**：感谢提供精简可靠的 Linux Minirootfs 与 Windows 原生轻量虚拟化技术。

---


## 开发与版本

- 当前版本：`v1.13.0.26`（OpenMinis Windows 体验版）
- [开发规则](DEVELOPMENT_RULES.md)
- [版本开发日志](docs/devlogs/README.md)
- [Windows 浏览器与小电视审计](docs/windows-browser-mini-tv-audit.md)

本项目遵循 **[GNU General Public License v3.0 (GPLv3)](LICENSE)** 开源协议。所有改动完全开源透明，尊重并严格传承上游所有开源组件之授权协议。
