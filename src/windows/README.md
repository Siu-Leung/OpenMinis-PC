# OpenMinis for Windows (Experimental)

> **备注：私人用极度不稳定 Aicoding 改**  
> 本模块为 OpenMinis 针对 Windows 桌面操作系统的实验性移植实现。

---

## 架构设计

在 Windows 上，OpenMinis 保持了移动端的核心哲学：**本地轻量沙箱 + AI Agent 电脑操控**。

- **宿主应用层**：基于 **Tauri v2 (Rust + React/TypeScript + Tailwind CSS)**，内存占用极低（~40MB），秒级启动。
- **沙箱隔离层**：基于 **WSL2 (Windows Subsystem for Linux 2)**，自动挂载与运行隔离的 **Alpine Linux** 精简实例。
  - 保留完整的 `apk add` 包管理能力与 Python、BusyBox ash 运行时。
  - 数据双向映射：Windows 宿主本地目录与 WSL2 内的 `/var/minis/` 互通。
- **浏览器自动化**：基于 **Microsoft Edge WebView2**，通过 CDP (Chrome DevTools Protocol) 提供原生的无头网页抓取、交互与渲染能力。
- **系统工具层**：提供 Windows 平台的原生桥梁（剪贴板、Toast 通知、任务计划、文件打开等）。

---

## 快速上手与运行

### 1. 前置准备
- Windows 10 (2004+) 或 Windows 11，已启用 WSL2 功能：
  ```powershell
  wsl --install --no-distribution
  ```
- 安装 [Node.js (>= 18)](https://nodejs.org/) 与 [Rust 工具链](https://rustup.rs/)。

### 2. 初始化 Alpine WSL2 沙箱环境
运行项目自带的一键初始化脚本（下载 Alpine minirootfs 并自动导入为专属的 `OpenMinisSandbox` 实例）：
```powershell
cd src/windows
powershell -ExecutionPolicy Bypass -File scripts/init_wsl_sandbox.ps1
```

### 3. 安装依赖并启动调试
```powershell
npm install
npm run tauri dev
```

### 4. 生产构建打包
```powershell
npm run tauri build
```
生成单文件安装包位于 `src-tauri/target/release/bundle/`。

---

## 免责声明
本代码仓库及 Windows 改版代码由 AI 辅助修改，标注为：**私人用极度不稳定 Aicoding 改**。仅供技术调研与个人本地测试使用，切勿直接用于关键生产环境。
