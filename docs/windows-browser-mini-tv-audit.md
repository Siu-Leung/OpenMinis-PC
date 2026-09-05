# OpenMinis-PC 浏览器 / 小电视 / 图片支持审计

日期：2026-09-05

## 结论

1. 聊天界面已经支持发图，链路是通的。
2. Windows 版的 `browser_use` 和左下角 `Minis Computer` 目前没有完全对齐。
3. 这个不同步不是单纯“浏览器没跑”，而是前端把 `browser_use` 统一当成浏览器预览态，但 `tool_end` 返回的内容有时是文本、有时是截图路径，`MinisComputer` 又只会在浏览器模式下展示截图预览。

## 聊天发图已经可用

当前聊天输入区支持三种发图入口：
- `+` 选择文件 / 图片
- 直接粘贴剪贴板图片
- 拖拽文件到窗口

对应代码：
- [App.tsx:1321-1345](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:1321)
- [App.tsx:2181-2207](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:2181)
- [App.tsx:2240-2243](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:2240)

发送时，图片会进入 `attachments`，再写入用户消息的 `images` 字段：
- [App.tsx:1371-1388](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:1371)

后端会把 `images` 转成 OpenAI 兼容的 `image_url` 多模态内容：
- [agent.rs:879-910](/var/minis/workspace/OpenMinis-PC/src/windows/src-tauri/src/agent.rs:879)

消息渲染也已经支持直接显示用户上传图片：
- [App.tsx:1954-1958](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:1954)
- [App.tsx:2070-2072](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:2070)

结论：聊天发图不是缺失功能，已经接通。

## Windows 浏览器能力和原版的差距

原版移动端的浏览器动作枚举很完整，包含：
- `navigate`
- `screenshot`
- `click`
- `type`
- `scroll`
- `get_page_info`
- `execute_js`
- `find_elements`
- `hover`
- `get_readable`
- `set_user_agent`
- `set_viewport`
- `get_backbone`
- `fetch`
- `new_tab`
- `close_tab`
- `list_tabs`
- `get_cookies`
- `set_cookies`
- `scroll_and_collect`
- `wait_for_dom_stable`

原版动作定义：
- [BrowserUseActions.swift:5-27](/var/minis/workspace/OpenMinis-upstream/src/ios/Agent/BrowserUse/BrowserUseActions.swift:5)
- [BrowserAction.kt:6-28](/var/minis/workspace/OpenMinis-upstream/src/android/app/src/main/java/com/openminis/app/browser/BrowserAction.kt:6)

Windows 版目前在工具 schema 里只暴露了三个动作：
- `navigate`
- `get_text`
- `screenshot`

对应代码：
- [agent.rs:753-765](/var/minis/workspace/OpenMinis-PC/src/windows/src-tauri/src/agent.rs:753)

Windows 版后端实现也确实只处理这三类：
- [browser.rs:61-205](/var/minis/workspace/OpenMinis-PC/src/windows/src-tauri/src/browser.rs:61)

这说明 Windows 版不是原版浏览器的等价移植，而是“Edge headless + 文本提取 + 截图回传”的轻量方案。

## 小电视为什么会“对不上”

左下角 `Minis Computer` 的状态来源，是 `agent-stream` 事件里的 `tool_start` / `tool_end`。

前端在 `tool_start` 时，只要工具名是 `browser_use`，就会直接切到浏览器模式：
- [App.tsx:1001-1087](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:1001)

在 `tool_end` 时，前端只会把 `parsed.output` 写进 `outputSnippet`，如果里面是截图路径才补 `previewImageUrl`：
- [App.tsx:1088-1101](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx:1088)

但 `MinisComputer` 的浏览器分支只渲染：
- `previewDataUrl`
- 或者加载中的 spinner

它没有在浏览器模式里显示 `outputSnippet`：
- [MinisComputer.tsx:144-167](/var/minis/workspace/OpenMinis-PC/src/windows/src/components/MinisComputer.tsx:144)

所以会出现这个现象：
- `navigate` / `get_text` 实际已经返回文本
- 但小电视仍然停在“正在后台渲染网页画面...”
- 因为它在等截图预览，而不是显示文本结果

这就是你说的“浏览器调用和左下角小电视窗口对不上”的根因。

## 现在的状态分类

### 已对齐
- 聊天发图
- 截图结果在小电视里回显
- `browser_use` 的基本调用链

### 半对齐
- `navigate` / `get_text`
- 这类动作有结果，但小电视当前只按“截图模式”画面展示

### 明显缺口
- 原版完整浏览器动作集
- 持久 tab 管理
- cookie / viewport / backbone / fetch / execute_js / scroll_and_collect 等高级浏览器动作

## 我建议的方案

### 方案 A：先修 UI 对齐，保留当前 Edge headless 方案
适合你现在这版 Windows 项目。

建议改法：
1. `tool_end` 如果是 `browser_use`，且 `outputSnippet` 有内容但没有 `previewImageUrl`，就在小电视浏览器模式里显示文本。
2. 给 `computerState` 增加一个更明确的浏览器结果类型，例如 `browserResultMode: text | screenshot`。
3. 不要再让浏览器模式只认截图。

这样改动小，能最快消掉“对不上”的错觉。

### 方案 B：做成原版那种完整浏览器能力
适合你后面要追求功能等价。

建议方向：
1. 做持久浏览器 tab 池
2. 把 `click/type/scroll/execute_js/get_cookies/set_cookies` 补齐
3. 浏览器预览和工具结果分离

这条路更像原版，但工作量明显更大。

我建议先走方案 A，把 UI 和实际结果对齐，再决定要不要补齐完整浏览器动作集。

## 相关源码索引

- [App.tsx](/var/minis/workspace/OpenMinis-PC/src/windows/src/App.tsx)
- [MinisComputer.tsx](/var/minis/workspace/OpenMinis-PC/src/windows/src/components/MinisComputer.tsx)
- [agent.rs](/var/minis/workspace/OpenMinis-PC/src/windows/src-tauri/src/agent.rs)
- [browser.rs](/var/minis/workspace/OpenMinis-PC/src/windows/src-tauri/src/browser.rs)
- [BrowserUseActions.swift](/var/minis/workspace/OpenMinis-upstream/src/ios/Agent/BrowserUse/BrowserUseActions.swift)
- [BrowserAction.kt](/var/minis/workspace/OpenMinis-upstream/src/android/app/src/main/java/com/openminis/app/browser/BrowserAction.kt)
