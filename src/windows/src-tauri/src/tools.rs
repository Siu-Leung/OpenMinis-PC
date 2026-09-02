//! OpenMinis Windows 工具调用分发器
//! 备注：私人用极度不稳定 Aicoding 改

use crate::browser::{BrowserActionParams, BrowserEngine};
use crate::sandbox::SandboxManager;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ToolDispatcher {
    pub sandbox: Arc<SandboxManager>,
    pub browser: Arc<BrowserEngine>,
}

impl ToolDispatcher {
    pub fn new(sandbox: Arc<SandboxManager>, browser: Arc<BrowserEngine>) -> Self {
        Self { sandbox, browser }
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
                    Ok(content) => json!({
                        "path": path,
                        "content": content
                    }),
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

            "win_open" => {
                let target = arguments.get("url").or(arguments.get("path")).and_then(|v| v.as_str()).unwrap_or("");
                #[cfg(target_os = "windows")]
                {
                    let _ = std::process::Command::new("cmd").args(["/c", "start", "", target]).spawn();
                }
                json!({ "opened": target })
            }

            unknown => json!({
                "error": format!("未实现的工具: {}", unknown)
            }),
        }
    }
}
