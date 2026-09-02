//! OpenMinis Windows Agent Loop 核心逻辑
//! 备注：私人用极度不稳定 Aicoding 改

use crate::tools::ToolDispatcher;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

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

    /// 执行一轮 Agent 对话与工具调度
    pub async fn run_turn(
        &self,
        config: &AgentConfig,
        mut history: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, String> {
        let tools_schema = self.get_tools_schema();

        // 最多允许连续执行 10 轮工具调用循环
        for _ in 0..10 {
            let request_body = json!({
                "model": config.model,
                "messages": history,
                "tools": tools_schema,
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
                return Err(format!("LLM 返回错误: {}", err_text));
            }

            let resp_json: Value = resp
                .json()
                .await
                .map_err(|e| format!("解析 LLM 响应 JSON 失败: {}", e))?;

            let choice = &resp_json["choices"][0]["message"];
            let content = choice["content"].as_str().unwrap_or("").to_string();
            let tool_calls = choice.get("tool_calls").cloned();

            history.push(ChatMessage {
                role: "assistant".to_string(),
                content: content.clone(),
                tool_calls: tool_calls.clone(),
                tool_call_id: None,
            });

            // 如果没有工具调用，对话结束
            if tool_calls.is_none() || tool_calls.as_ref().unwrap().as_array().map_or(true, |a| a.is_empty()) {
                break;
            }

            // 处理工具调用
            if let Some(calls) = tool_calls.as_ref().and_then(|v| v.as_array()) {
                for call in calls {
                    let call_id = call["id"].as_str().unwrap_or("").to_string();
                    let fn_name = call["function"]["name"].as_str().unwrap_or("");
                    let fn_args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
                    let fn_args: Value = serde_json::from_str(fn_args_str).unwrap_or(json!({}));

                    // 执行工具
                    let result = self.dispatcher.dispatch(fn_name, fn_args).await;

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
                    "description": "在 Windows WSL2 Alpine 隔离沙箱环境中执行命令",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "待执行的 Linux 命令" },
                            "timeout": { "type": "integer", "description": "超时时间（秒）" }
                        },
                        "required": ["command"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "file_read",
                    "description": "读取沙箱文件系统的文件",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "绝对路径 (如 /var/minis/...)" }
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
                    "description": "精确替换沙箱文件的局部文本",
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
                    "description": "通过 WebView2 执行网页自动化操作",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "action": { "type": "string", "enum": ["navigate", "get_text", "screenshot", "execute_js"] },
                            "url": { "type": "string" }
                        },
                        "required": ["action"]
                    }
                }
            }
        ])
    }
}
