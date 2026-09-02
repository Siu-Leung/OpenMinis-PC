//! OpenMinis Windows Agent Loop 核心逻辑 (完全加固与 System Prompt 注入版)
//! 备注：私人用极度不稳定 Aicoding 改

use crate::tools::ToolDispatcher;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const SYSTEM_PROMPT: &str = r#"You are OpenMinis, a capable AI assistant running on a Windows PC with an isolated Alpine Linux sandbox (WSL2, BusyBox ash).

Personality & Guidelines:
- Be direct, concise, and helpful. Prefer action over explanation.
- Don't perform — help. Skip the "Sure!" and "Happy to assist!" — just do the work.
- When a tool exists for an action, call it directly instead of describing what you plan to do.

Linux Sandbox Rules & Directories:
- Your commands execute inside an isolated Alpine Linux environment via BusyBox ash.
- Available directories:
  /var/minis/workspace/   — Working files (scripts, data, text).
  /var/minis/attachments/ — Media files (images, audio, downloads).
  /var/minis/offloads/    — Auto-saved large tool outputs.
  /var/minis/shared/      — Persistent storage.
- Tools available:
  - shell_execute: Execute any Linux shell command (python3, curl, apk add, etc.). Commands must not exceed 1000 chars; write to a file first if longer.
  - file_read: Read file contents from sandbox.
  - file_write: Write or overwrite file contents.
  - file_edit: Exact string replacement for targeted edits.
  - browser_use: Navigate and extract clean web content (get_text / navigate / screenshot).
- Shell is BusyBox ash (NOT bash): avoid complex bashisms like [[ ]], arrays, or globstar **.
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub provider_url: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub event_type: String, // "token" | "tool_start" | "tool_end" | "error"
    pub content: String,
}

pub struct AgentEngine {
    pub dispatcher: Arc<ToolDispatcher>,
    pub http_client: reqwest::Client,
}

impl AgentEngine {
    pub fn new(dispatcher: Arc<ToolDispatcher>) -> Self {
        Self {
            dispatcher,
            http_client: reqwest::Client::new(),
        }
    }

    /// 执行一轮 Agent 对话与工具调度 (带死循环探测与 System Prompt 注入)
    pub async fn run_turn_stream(
        &self,
        app: &AppHandle,
        config: &AgentConfig,
        mut history: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, String> {
        let tools_schema = self.get_tools_schema();

        // 1. 确保头部注入了系统级 System Prompt
        if history.is_empty() || history[0].role != "system" {
            let custom_sp = config.system_prompt.as_deref().unwrap_or(SYSTEM_PROMPT);
            history.insert(0, ChatMessage {
                role: "system".to_string(),
                content: custom_sp.to_string(),
                tool_calls: None,
                tool_call_id: None,
            });
        }

        // 2. 死循环探测器记录：(tool_name, arguments_hash) -> 连续重复次数
        let mut last_call_signature = String::new();
        let mut repeat_call_count = 0;

        for _ in 0..10 {
            let request_body = json!({
                "model": config.model,
                "messages": history,
                "tools": tools_schema,
                "stream": true,
                "temperature": 0.7
            });

            let resp = self
                .http_client
                .post(format!("{}/chat/completions", config.provider_url.trim_end_matches('/')))
                .header("Authorization", format!("Bearer {}", config.api_key))
                .header("Content-Type", "application/json")
                .json(&request_body)
                .send()
                .await
                .map_err(|e| format!("LLM API 请求失败: {}", e))?;

            if !resp.status().is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                let _ = app.emit("agent-stream", StreamEvent {
                    event_type: "error".to_string(),
                    content: format!("LLM 返回错误: {}", err_text),
                });
                return Err(format!("LLM 返回错误: {}", err_text));
            }

            let mut stream = resp.bytes_stream();
            let mut assistant_content = String::new();
            let mut tool_calls_map: std::collections::HashMap<usize, (String, String, String)> =
                std::collections::HashMap::new();

            let mut buffer = String::new();

            while let Some(item) = stream.next().await {
                let bytes = item.map_err(|e| format!("读取流数据中断: {}", e))?;
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim().to_string();
                    buffer.drain(..=pos);

                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }

                    if line == "data: [DONE]" {
                        break;
                    }

                    if let Some(json_str) = line.strip_prefix("data: ") {
                        if let Ok(val) = serde_json::from_str::<Value>(json_str) {
                            if let Some(choices) = val.get("choices").and_then(|v| v.as_array()) {
                                if let Some(delta) = choices.get(0).and_then(|c| c.get("delta")) {
                                    if let Some(chunk_text) = delta.get("content").and_then(|v| v.as_str()) {
                                        assistant_content.push_str(chunk_text);
                                        let _ = app.emit("agent-stream", StreamEvent {
                                            event_type: "token".to_string(),
                                            content: chunk_text.to_string(),
                                        });
                                    }

                                    if let Some(calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                                        for call in calls {
                                            let index = call.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                                            let entry = tool_calls_map.entry(index).or_insert((
                                                String::new(),
                                                String::new(),
                                                String::new(),
                                            ));

                                            if let Some(id) = call.get("id").and_then(|v| v.as_str()) {
                                                entry.0.push_str(id);
                                            }
                                            if let Some(func) = call.get("function") {
                                                if let Some(name) = func.get("name").and_then(|v| v.as_str()) {
                                                    entry.1.push_str(name);
                                                }
                                                if let Some(args) = func.get("arguments").and_then(|v| v.as_str()) {
                                                    entry.2.push_str(args);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let mut final_tool_calls = Vec::new();
            let mut sorted_indices: Vec<_> = tool_calls_map.keys().copied().collect();
            sorted_indices.sort();

            for idx in sorted_indices {
                if let Some((id, name, args)) = tool_calls_map.get(&idx) {
                    final_tool_calls.push(json!({
                        "id": id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": args
                        }
                    }));
                }
            }

            let tool_calls_val = if final_tool_calls.is_empty() {
                None
            } else {
                Some(Value::Array(final_tool_calls))
            };

            history.push(ChatMessage {
                role: "assistant".to_string(),
                content: assistant_content,
                tool_calls: tool_calls_val.clone(),
                tool_call_id: None,
            });

            if tool_calls_val.is_none() {
                break;
            }

            // 处理并执行工具调用
            if let Some(calls) = tool_calls_val.and_then(|v| v.as_array().cloned()) {
                for call in calls {
                    let call_id = call["id"].as_str().unwrap_or("").to_string();
                    let fn_name = call["function"]["name"].as_str().unwrap_or("");
                    let fn_args_str = call["function"]["arguments"].as_str().unwrap_or("{}");

                    // 3. 死循环探测与熔断拦截
                    let current_sig = format!("{}:{}", fn_name, fn_args_str);
                    if current_sig == last_call_signature {
                        repeat_call_count += 1;
                    } else {
                        last_call_signature = current_sig;
                        repeat_call_count = 1;
                    }

                    if repeat_call_count >= 3 {
                        let loop_err = "警告: 检测到同名参数工具发生死循环调用 (Tool Loop Detected)。已强制终止本轮重试，请更换指令思路。".to_string();
                        let _ = app.emit("agent-stream", StreamEvent {
                            event_type: "error".to_string(),
                            content: loop_err.clone(),
                        });
                        history.push(ChatMessage {
                            role: "tool".to_string(),
                            content: json!({ "error": loop_err }).to_string(),
                            tool_calls: None,
                            tool_call_id: Some(call_id),
                        });
                        return Ok(history);
                    }

                    let fn_args: Value = serde_json::from_str(fn_args_str).unwrap_or(json!({}));

                    let _ = app.emit("agent-stream", StreamEvent {
                        event_type: "tool_start".to_string(),
                        content: format!("正在调用工具: {} ...", fn_name),
                    });

                    let result = self.dispatcher.dispatch(fn_name, fn_args).await;

                    let _ = app.emit("agent-stream", StreamEvent {
                        event_type: "tool_end".to_string(),
                        content: format!("工具 {} 执行完毕", fn_name),
                    });

                    history.push(ChatMessage {
                        role: "tool".to_string(),
                        content: result.to_string(),
                        tool_calls: None,
                        tool_call_id: Some(call_id),
                    });
                }
            }
        }

        Ok(history)
    }

    fn get_tools_schema(&self) -> Value {
        json!([
            {
                "type": "function",
                "function": {
                    "name": "shell_execute",
                    "description": "在 Windows WSL2 Alpine 隔离沙箱中执行 Linux Shell 命令",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "待执行命令" },
                            "timeout": { "type": "integer", "description": "超时秒数 (默认60)" }
                        },
                        "required": ["command"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "file_read",
                    "description": "读取沙箱内指定路径文件",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "沙箱绝对路径 (如 /var/minis/...)" }
                        },
                        "required": ["path"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "file_write",
                    "description": "写入或覆盖沙箱文件",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "content": { "type": "string" },
                            "append": { "type": "boolean" }
                        },
                        "required": ["path", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "file_edit",
                    "description": "精准字符串替换沙箱文件局部内容",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "old_string": { "type": "string" },
                            "new_string": { "type": "string" }
                        },
                        "required": ["path", "old_string", "new_string"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "browser_use",
                    "description": "网页自动化：获取正文文本 (get_text/navigate) 或提取快照 (screenshot)",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "action": { "type": "string", "enum": ["navigate", "get_text", "screenshot"] },
                            "url": { "type": "string" }
                        },
                        "required": ["action"]
                    }
                }
            }
        ])
    }
}
