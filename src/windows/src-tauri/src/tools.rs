//! OpenMinis Windows 工具调用分发器 (加固审计版)
//! 备注：私人用极度不稳定 Aicoding 改

use crate::browser::{BrowserActionParams, BrowserEngine};
use crate::memory::{MemoryCategory, MemoryStore};
use crate::sandbox::SandboxManager;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ToolDispatcher {
    pub sandbox: Arc<SandboxManager>,
    pub browser: Arc<BrowserEngine>,
    pub memory: Arc<MemoryStore>,
}

impl ToolDispatcher {
    pub fn new(sandbox: Arc<SandboxManager>, browser: Arc<BrowserEngine>, memory: Arc<MemoryStore>) -> Self {
        Self { sandbox, browser, memory }
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
                        // 防止大文件撑爆上下文
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

            "win_open" => {
                let target = arguments.get("url").or(arguments.get("path")).and_then(|v| v.as_str()).unwrap_or("");
                // 安全审计加固：禁止任何包含管道、重定向、子命令执行的危险字符
                if target.contains('&') || target.contains('|') || target.contains(';') || target.contains('`') || target.contains('$') || target.contains('\n') {
                    return json!({ "error": "安全拦截: 目标参数包含非法命令控制字符" });
                }

                // 仅放行安全的 http / https 链接，使用 rundll32 直接交由系统外壳打开，杜绝 cmd /c 命令注入
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

            unknown => json!({
                "error": format!("未实现的工具: {}", unknown)
            }),
        }
    }
}
