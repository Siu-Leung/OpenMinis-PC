//! OpenMinis Windows 工具调用分发器 (加固审计与 Native Offload 版)
//! 备注：Windows 测试版 (Experimental)

use crate::browser::{BrowserActionParams, BrowserEngine};
use crate::memory::{MemoryCategory, MemoryStore};
use crate::offloads::WindowsOffload;
use crate::providers::{ProviderManager, ProviderRecord};
use crate::sandbox::SandboxManager;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ToolDispatcher {
    pub sandbox: Arc<SandboxManager>,
    pub browser: Arc<BrowserEngine>,
    pub memory: Arc<MemoryStore>,
    pub providers: Arc<ProviderManager>,
}

impl ToolDispatcher {
    pub fn new(sandbox: Arc<SandboxManager>, browser: Arc<BrowserEngine>, memory: Arc<MemoryStore>, providers: Arc<ProviderManager>) -> Self {
        Self { sandbox, browser, memory, providers }
    }

    /// 分发执行 LLM 的 Tool Call
    pub async fn dispatch(&self, tool_name: &str, arguments: Value) -> Value {
        match tool_name {
            "shell_execute" => {
                let cmd = arguments.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let timeout_secs = arguments.get("timeout").and_then(|v| v.as_u64()).unwrap_or(60);

                match self.sandbox.execute_shell(cmd, timeout_secs).await {
                    Ok(res) => json!({
                        "exit_code": res.exit_code,
                        "stdout": res.stdout,
                        "stderr": res.stderr,
                        "offload_path": res.offload_path,
                    }),
                    Err(err) => json!({
                        "error": err,
                        "exit_code": -1
                    }),
                }
            }

            "file_read" => {
                let path = arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
                match self.sandbox.read_sandbox_file(path).await {
                    Ok(content) => {
                        let truncated = if content.chars().count() > 15000 {
                            let head: String = content.chars().take(15000).collect();
                            format!("{}\n\n... [文件内容过长已截断，仅显示前 15000 字符]", head)
                        } else {
                            content
                        };
                        json!({
                            "path": path,
                            "content": truncated
                        })
                    }
                    Err(err) => json!({
                        "error": err
                    }),
                }
            }

            "file_write" => {
                let path = arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let content = arguments.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let append = arguments.get("append").and_then(|v| v.as_bool()).unwrap_or(false);

                match self.sandbox.write_sandbox_file(path, content, append).await {
                    Ok(_) => json!({
                        "success": true,
                        "path": path,
                        "minis_url": format!("minis://{}", path.trim_start_matches("/var/minis/"))
                    }),
                    Err(err) => json!({
                        "error": err
                    }),
                }
            }

            "file_edit" => {
                let path = arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let old_str = arguments.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let new_str = arguments.get("new_string").and_then(|v| v.as_str()).unwrap_or("");

                match self.sandbox.read_sandbox_file(path).await {
                    Ok(content) => {
                        if !content.contains(old_str) {
                            return json!({ "error": "old_string 在目标文件中未找到" });
                        }
                        let replaced = content.replacen(old_str, new_str, 1);
                        match self.sandbox.write_sandbox_file(path, &replaced, false).await {
                            Ok(_) => json!({ "success": true, "path": path }),
                            Err(e) => json!({ "error": e }),
                        }
                    }
                    Err(e) => json!({ "error": e }),
                }
            }

            "browser_use" => {
                let action = arguments.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let url = arguments.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                let selector = arguments.get("selector").and_then(|v| v.as_str()).map(|s| s.to_string());
                let text = arguments.get("text").and_then(|v| v.as_str()).map(|s| s.to_string());
                let script = arguments.get("script").and_then(|v| v.as_str()).map(|s| s.to_string());

                let params = BrowserActionParams {
                    action,
                    url,
                    selector,
                    text,
                    script,
                };
                let res = self.browser.handle_action(params).await;
                json!({
                    "success": res.success,
                    "data": res.data,
                    "error": res.error
                })
            }

            "open_terminal" => {
                let init_cmd = arguments.get("command").and_then(|v| v.as_str()).map(|s| s.to_string());
                match self.sandbox.launch_interactive_terminal(init_cmd) {
                    Ok(_) => json!({ "success": true, "message": "已成功唤起独立交互终端窗口" }),
                    Err(e) => json!({ "error": e }),
                }
            }

            "memory_write" => {
                let category = arguments.get("category").and_then(|v| v.as_str()).unwrap_or("fact");
                let content = arguments.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let cat = match category {
                    "preference" => MemoryCategory::UserPreference,
                    "project" => MemoryCategory::ProjectContext,
                    "skill" => MemoryCategory::LearnedSkill,
                    "todo" => MemoryCategory::ActionItem,
                    _ => MemoryCategory::Fact,
                };
                match self.memory.write_memory(cat, content) {
                    Ok(id) => json!({ "success": true, "id": id }),
                    Err(e) => json!({ "error": e }),
                }
            }

            "memory_search" => {
                let query = arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
                match self.memory.search_memory(query) {
                    Ok(results) => json!({ "results": results }),
                    Err(e) => json!({ "error": e }),
                }
            }

            // --- Windows Native Offloads ---
            "clipboard_read" => {
                let mut cmd = std::process::Command::new("powershell.exe");
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000);
                }
                cmd.args(["-NoProfile", "-Command", "Get-Clipboard"]);
                match cmd.output() {
                    Ok(out) => json!({ "clipboard_text": String::from_utf8_lossy(&out.stdout).trim() }),
                    Err(e) => json!({ "error": format!("读取剪贴板失败: {}", e) }),
                }
            }

            "clipboard_write" => {
                let text = arguments.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let mut cmd = std::process::Command::new("powershell.exe");
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000);
                }
                let clean = text.replace('\'', "''");
                cmd.args(["-NoProfile", "-Command", &format!("Set-Clipboard -Value '{}'", clean)]);
                match cmd.output() {
                    Ok(_) => json!({ "success": true, "message": "已写入 Windows 剪贴板" }),
                    Err(e) => json!({ "error": format!("写入剪贴板失败: {}", e) }),
                }
            }

            "system_notification" => {
                let title = arguments.get("title").and_then(|v| v.as_str()).unwrap_or("OpenMinis 通知");
                let message = arguments.get("message").and_then(|v| v.as_str()).unwrap_or("");
                WindowsOffload::send_notification(title, message);
                json!({ "success": true, "message": "已触发 Windows 原生通知" })
            }

            "system_info" => {
                let summary = WindowsOffload::get_system_summary();
                json!({ "success": true, "system_info": summary })
            }

            "win_open" => {
                let target = arguments.get("url").or(arguments.get("path")).and_then(|v| v.as_str()).unwrap_or("");
                if target.contains('&') || target.contains('|') || target.contains(';') || target.contains('`') || target.contains('$') || target.contains('\n') {
                    return json!({ "error": "安全拦截: 目标参数包含非法命令控制字符" });
                }

                if target.starts_with("http://") || target.starts_with("https://") {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = std::process::Command::new("rundll32.exe")
                            .args(["url.dll,FileProtocolHandler", target])
                            .spawn();
                    }
                    json!({ "opened": target })
                } else {
                    json!({ "error": "win_open 仅支持安全打开以 http:// 或 https:// 开头的网络链接" })
                }
            }

            // --- 供应商管理 (Agent 可读写) ---
            "list_providers" => {
                match self.providers.list_provider_summaries() {
                    Ok(summaries) => json!({
                        "success": true,
                        "providers": summaries,
                        "count": summaries.len(),
                    }),
                    Err(e) => json!({ "error": e }),
                }
            }

            "add_provider" => {
                let name = arguments.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let provider_url = arguments.get("provider_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let api_key = arguments.get("api_key").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let models = arguments
                    .get("models")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|m| m.as_str().map(|s| s.to_string())).collect::<Vec<_>>())
                    .unwrap_or_default();
                let auto_append_v1 = arguments.get("auto_append_v1").and_then(|v| v.as_bool());

                if name.trim().is_empty() {
                    return json!({ "error": "供应商名称不能为空" });
                }
                if provider_url.trim().is_empty() {
                    return json!({ "error": "供应商 API 地址不能为空" });
                }

                let record = ProviderRecord {
                    id: String::new(),
                    name,
                    provider_url,
                    api_key,
                    models,
                    provider_type: None,
                    auto_append_v1,
                    custom_user_agent: None,
                    api_format: None,
                    is_azure: None,
                    image_generation: None,
                    latency_ms: None,
                };

                match self.providers.add_provider(record) {
                    Ok(saved) => json!({
                        "success": true,
                        "provider": saved.to_summary(),
                        "message": "供应商已添加",
                    }),
                    Err(e) => json!({ "error": e }),
                }
            }

            unknown => json!({
                "error": format!("未实现的工具: {}", unknown)
            }),
        }
    }
}
