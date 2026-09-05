# OpenMinis-PC 可靠进化报告

> 审计基线：`v1.13.0.30` / commit `30e48b7ac4b775b92083cdc83bacbb6a81be0457`
> 审计日期：2026-09-06
> 依据：当前代码、已通过的 GitHub Actions、用户运行日志、官方 OpenMinis Android/iOS 实现

## 1. 结论

OpenMinis-PC 的正确定位是“模型无关的 Windows 本地行动层”，而不是普通聊天客户端。WSL2 隔离、BYOM、工具调用、持久记忆和本地资产构成了可持续方向。

当前项目已经具备可发布产品的骨架，但还不具备“零信任”“完整 MCP”“完整浏览器自动化”或“1:1 官方体验”的工程事实。下一阶段必须先建立可信底座，再扩大能力面。

建议主线：

```
可信与可验证 -> 稳定执行 -> Windows 原生能力 -> 可复用资产
```

## 2. 两份蓝图裁决

### 2.1 `OpenMinis-PC-Optimization-Blueprint.md`

可采纳：

- Preflight Doctor。
- 前端状态分层、流式批处理和长会话虚拟化。
- 持久 Edge + CDP 自动化。
- 任务栏进度、Toast、全局唤醒和 Explorer 集成。
- 沙箱快照作为实验模式。

需修正：

- 沙箱 daemon 应优先考虑 localhost TCP；当前沙箱关闭 Windows interop，命名管道并非自然通道。
- UI Automation 应作为语义优先、截图兜底的互补模式，不能承诺 100% 精准。
- DPAPI 只适合当前 Windows 用户的静态凭据，不适合直接作为跨机器备份格式。
- `.30` 已删除截图写入的 `\\wsl$` 首选路径，因此“继续加固 UNC 直写”已过期。

不可采信：

- 0% CPU、5-15ms、100% 精准、与记事本相同能耗等数字没有基准测试。
- 四周完成 Doctor、状态重构、daemon、CDP、UI Automation、JIT 和 Dreamer 缺乏工作量依据。
- “绝对安全”和“宿主毫发无损”不是可证明承诺。

### 2.2 `OPENMINIS_PC_EVOLUTION_BLUEPRINT.md`

这份文档的风险排序和阶段化方法更可靠，应作为主骨架，但必须更新：

- 基线应从 `.29` 更新为 `.30`。
- Rust 测试当前为 13 个，不是 7 个；前端测试仍为 0。
- `App.tsx` 在本轮修改前为 4925 行，判断成立。
- 项目已有手动更新检查，但没有签名 Tauri updater；“无 updater”应理解为无应用内自动更新。
- 截图 UNC 阻塞已在 `.30` 修复。
- 发布节奏是否周更属于产品决策，不应阻碍安全 hotfix 和用户明确要求的测试版本。

## 3. 当前事实矩阵

| 领域 | 当前事实 | 证据 | 裁决 |
|---|---|---|---|
| Provider 凭据 | `api_key` 明文写入 `providers.json` | `providers.rs:10-15, 123-127`（`.30`） | P0 |
| 前端凭据 | 完整 Provider 曾写入 WebView `localStorage` | `App.tsx:515-518, 1446-1465`（`.30`） | P0 |
| 环境变量 | key/value 明文写入 `env_vars.json` | `env_vars.rs:9-15, 39-44`（`.30`） | P0 |
| 剪贴板 | Agent 可直接调用宿主 `Get-Clipboard` | `tools.rs:163-175`; schema `agent.rs:842-851` | P0，需要授权边界 |
| Provider 写入 | Agent 可直接新增含 API Key 的 Provider | `tools.rs:225-277`; schema `agent.rs:893+` | P0，需要确认制 |
| CSP | `csp` 为 `null` | `tauri.conf.json:25-27` | P0/P1 |
| Capabilities | 无 capabilities 文件 | `src/windows/src-tauri` 文件审计 | P0/P1 |
| MCP | 仅配置 CRUD 和静态 `tools_count`；无协议客户端、无 Agent 注册 | `mcp.rs:10-112`; `agent.rs/tools.rs` 无 MCP 调度引用 | 宣称必须降级 |
| 浏览器 | Edge Headless 支持 DOM 抓取和截图；非持久会话、无 click/type/CDP | `browser.rs:41-224` | 能力真实但有限 |
| iframe | 内置预览仍使用 iframe，受站点 X-Frame/CSP 限制 | `App.tsx` browser window | P1/P2 结构改造 |
| 截图卡顿 | `.30` 已取消 `\\wsl$` 写入并加入 Edge/WSL 超时与日志 | `.30` commit `30e48b7` | 已缓解，待用户验证 |
| 会话 | 毫秒时间、updated_at、ID 验证、原子写、去重已实现 | `.29` + CI | 已建立回归基线 |
| 测试 | Rust 13 个；前端 0 个 | 源码计数 | P1 |
| 前端体量 | `App.tsx` 4925 行（`.30`） | 源码行数 | P1 |
| 更新 | 可检查 GitHub Release 并跳转下载；无签名自动 updater | `App.tsx:4046-4124` | 描述需准确 |
| 备份 | options 有 providers/env/password/encrypted，但实际未备份或恢复这些项 | `backup.rs:7-20, 101-223, 225-319` | P0 误导 |

## 4. 风险与优先级

### P0：可信底座

1. Provider 和环境变量使用 Windows DPAPI Current User 加密，旧明文自动迁移。
2. 清除前端 Provider `localStorage` 明文副本。
3. 为剪贴板读取、Agent 新增 Provider、未来宿主命令建立显式确认协议。
4. 修复或禁用虚假的 secret 备份选项；跨机器备份必须使用独立密码派生密钥，不能复制 DPAPI 密文冒充可恢复。
5. 配置非空 CSP 和最小 Tauri capabilities，并以真实图片、附件、更新检查回归测试为验收。
6. README 对 MCP、浏览器、性能和“1:1”只陈述可验证能力。

### P1：质量与稳定性

1. 历史 Bug 建立回归测试：会话、fallback、scheduler、路径、URL 清洗、截图媒体绑定。
2. 新增前端测试基础，先覆盖版本比较、消息聚合、队列和 Provider 迁移。
3. 将 `App.tsx` 拆为 UI、Session、Agent Runtime 三个状态边界；不以“换 Zustand”作为完成标准。
4. 流式更新改为 requestAnimationFrame/自适应批处理，Markdown 保持稳定前缀与实时尾部。
5. 长会话采用测量型虚拟列表，先验证代码块、图片、动态高度和贴底行为。

### P2：Windows 与浏览器能力

1. Preflight Doctor：WSL 安装、虚拟化、发行版状态、磁盘空间、Edge 路径和代理诊断。
2. Edge 路径通过注册表/系统查找动态探测，不硬编码管理员目录。
3. 持久 Edge user-data-dir + CDP 会话，补齐 navigate/click/type/scroll/wait/screenshot。
4. 小电脑显示同一持久浏览器会话的真实快照，允许用户接管登录或验证码。
5. 托盘、全局快捷键、任务栏进度、Toast 和窗口状态逐项实现并测试。
6. 建立 Windows UTF-8、中文路径、长路径、DPI、多屏和 Defender 测试矩阵。

### P3：执行层与资产

1. 沙箱常驻 RPC daemon，先测量冷启动和长任务故障率，再决定复杂度。
2. 沙箱快照/回滚；宿主变更使用独立确认与审计，不承诺通用原子提交。
3. Recipe 工作流、技能包导入导出、本地 API。
4. MCP：实现 stdio 客户端并动态注册工具，或继续明确标为“配置预览”。

### 实验区

- UI Automation：语义优先，截图兜底。
- JIT 微应用：只在明确任务场景中启用沙箱化组件。
- Dreamer：默认关闭，用户显式授权，可查看输入、产物和资源预算。

## 5. 验收门槛

每个发布版本必须满足：

- 功能代码、版本字段、README 和开发日志一致。
- 新行为有聚焦测试；历史 Bug 不以人工记忆作为唯一防线。
- `npm run build` 通过。
- GitHub Actions `cargo test --locked` 通过。
- Tauri Windows 安装包构建通过。
- Release tag 指向经过验证的 commit。
- setup EXE、MSI、portable EXE 三个资产存在且名称正确。
- 未完成能力在文档中明确标记，不以路线图冒充实现。

## 6. 本轮实施：v1.13.0.31

范围：凭据静态存储止血。

- 新增统一加密 envelope。
- Windows 使用 DPAPI Current User 加密 Provider 与环境变量数据。
- 读取旧明文 JSON 后自动迁移并重写。
- 前端成功迁移后删除 Provider localStorage 明文副本。
- 环境变量名限制为 `[A-Za-z_][A-Za-z0-9_]*`，阻止 shell 语法注入。
- 增加 envelope、旧格式迁移、非法版本、真实 Windows DPAPI round-trip 和 env key 测试。
- 使用 Windows 原子替换写入加密文件。

限制：

- DPAPI 密文绑定当前 Windows 用户，不支持跨用户或跨机器直接恢复。
- 现有备份模块的 secret/密码选项仍需单独重构，在完成前不得声称已备份 Provider/API Key/环境变量。
- 本轮不同时引入 CSP、capabilities、权限确认、CDP 或前端状态重构，避免把多个高风险迁移捆绑在一个版本。
