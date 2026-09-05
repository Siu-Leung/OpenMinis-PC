//! OpenMinis Windows Agent Loop 核心逻辑 (模型组 Fallback 自动回退 + 记忆/技能自动注入 + 中断停止版)
//! 备注：Windows 测试版 (Experimental)

use crate::mounts::MountManager;
use crate::skills::SkillsManager;
use crate::soul::SoulManager;
use crate::tools::ToolDispatcher;
use crate::usage::UsageTracker;
use crate::logs::append_log;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const SYSTEM_PROMPT: &str = r#"You are Minis, a capable, direct, and pragmatic AI assistant running on a PC with an isolated, fully functional Linux sandbox (Alpine Linux via WSL2, BusyBox ash).

Personality & Philosophy (from SOUL.md):
- Don't perform — help. Skip the "Sure!", "Happy to assist!", and polite preamble — just do the work.
- Have a stance. It's fine to disagree, prefer one approach over another, find some things elegant and others wasteful.
- Act first, ask second. If you can look it up, inspect it, or test it via shell, do it directly. Come back with concrete answers and reproducible results, not questions.
- Prefer action over explanation. When a user asks you to write code, create files, download assets, or inspect something, call the corresponding tools immediately instead of describing what you plan to do.

Linux Sandbox Environment & Working Directories:
- Your commands execute inside an Alpine Linux environment via BusyBox ash.
- CRITICAL: This is a PURE LINUX sandbox. It has NO Windows binaries. Do NOT attempt to execute `powershell.exe`, `cmd.exe`, `explorer.exe`, `rundll32.exe`, or any other Windows commands inside shell_execute — Windows interop is disabled for strict security isolation.
- To interact with the host Windows OS, use the dedicated native tools: `win_open`, `clipboard_write`, `system_notification`.
- Directory Structure:
  /var/minis/workspace/   — Working files (scripts, source code, data files, configs).
  /var/minis/attachments/ — Media files (images, audio, video, charts, downloads).
  /var/minis/offloads/    — Auto-saved large tool outputs and dumps.
  /var/minis/shared/      — Persistent cross-session project storage.
  /var/minis/memory/      — Persistent memory storage (GLOBAL.md & daily logs).
  /var/minis/mounts/      — Mounted host folders (e.g. /var/minis/mounts/Minis).
- Tooling Guidelines:
  - Python: Many PyPI wheels fail on musl aarch64/x86. Always prefer Alpine native packages: `apk add py3-numpy py3-pandas py3-matplotlib py3-pillow py3-requests py3-scipy`. Only use pip for pure-Python packages.
  - Matplotlib: You MUST call `import matplotlib; matplotlib.use('Agg')` BEFORE importing `pyplot` — there is no X11/Wayland display server in the sandbox.
  - Background processes: Must redirect stdout/stderr to avoid SIGPIPE: `python3 -m http.server 8080 > /dev/null 2>&1 &`.

Unified Media & Output Syntax:
- The minis:// URL scheme connects sandbox files to the app preview system. Non-ASCII characters (Chinese, spaces, emoji) in filenames MUST be percent-encoded.
- Inline media rendering via `![desc](minis://...)`:
  - Images: ![chart](minis://attachments/chart.png)   → inline image preview with lightbox.
  - Audio:  ![audio](minis://attachments/sound.mp3)   → inline interactive audio player (.mp3/.wav/.m4a/.ogg).
  - Video:  ![clip](minis://attachments/demo.mp4)     → inline interactive video player (.mp4/.mov/.webm).
  - Documents / Code: Use standard Markdown links: [filename](minis://workspace/file.py).

Memory & Continuous Learning:
- memory_write: Persist important facts, project conventions, user preferences, and reusable knowledge.
- memory_search: Recall historical context by keyword before starting unfamiliar tasks.
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FallbackModelTarget {
    pub model: String,
    pub provider_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub session_id: Option<String>,
    pub provider_id: Option<String>,
    pub provider_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub auto_append_v1: Option<bool>, // 是否自动追加 /v1 后缀 (对标原版 appendV1Suffix)
    pub fallback_models: Option<Vec<String>>, // 模型组回退队列
    #[serde(default)]
    pub fallback_targets: Option<Vec<FallbackModelTarget>>, // 带有专属凭证的多提供商回退队列
    pub system_prompt: Option<String>,
    pub thinking_level: Option<String>,      // "off" | "low" | "medium" | "high" | "max"
    pub thinking_budget: Option<u32>,
    #[serde(default)]
    pub context_limit_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub event_type: String, // "status" | "thinking" | "token" | "tool_start" | "tool_end" | "fallback" | "error" | "stopped"
    pub content: String,
}

pub struct AgentEngine {
    pub dispatcher: Arc<ToolDispatcher>,
    pub usage_tracker: Arc<UsageTracker>,
    pub memory: Arc<crate::memory::MemoryStore>,
    pub soul: Arc<SoulManager>,
    pub skills: Arc<SkillsManager>,
    pub mounts: Arc<MountManager>,
    pub http_client: reqwest::Client,
    pub execution_lock: Arc<tokio::sync::Mutex<()>>,
    pub abort_flag: Arc<AtomicBool>,
}

impl AgentEngine {
    pub fn new(
        dispatcher: Arc<ToolDispatcher>,
        usage_tracker: Arc<UsageTracker>,
        memory: Arc<crate::memory::MemoryStore>,
        soul: Arc<SoulManager>,
        skills: Arc<SkillsManager>,
        mounts: Arc<MountManager>,
    ) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            dispatcher,
            usage_tracker,
            memory,
            soul,
            skills,
            mounts,
            http_client,
            execution_lock: Arc::new(tokio::sync::Mutex::new(())),
            abort_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// 中断当前正在生成的 Agent 会话
    pub fn abort(&self) {
        self.abort_flag.store(true, Ordering::SeqCst);
    }

    /// 动态组装包含人设 (SOUL.md)、全局记忆 (GLOBAL.md)、近 3 天日志与技能清单的完整 System Prompt
    fn assemble_system_prompt(&self, custom_sp: Option<&str>) -> String {
        let mut prompt = String::new();

        let soul_cfg = self.soul.get_soul();
        if soul_cfg.active && !soul_cfg.instruction.trim().is_empty() {
            prompt.push_str(&soul_cfg.instruction);
            prompt.push_str("\n\n");
        }

        let base = custom_sp.unwrap_or(SYSTEM_PROMPT);
        prompt.push_str(base);

        let memory_frag = self.memory.get_recent_memories_fragment();
        if !memory_frag.is_empty() {
            prompt.push_str(&memory_frag);
        }

        let skills_frag = self.skills.get_skills_summary();
        if !skills_frag.is_empty() {
            prompt.push_str(&skills_frag);
        }

        let mounts = self.mounts.list_mounts();
        if !mounts.is_empty() {
            prompt.push_str("\n\nMounted Windows Host Folders (accessible in sandbox at /var/minis/mounts/):\n");
            for m in mounts {
                prompt.push_str(&format!("- {} -> {} (host: {})\n", m.name, m.sandbox_mount_path, m.host_path));
            }
        }

        prompt
    }

    /// 执行一轮 Agent 对话与工具调度 (带模型组 Fallback 自动容灾回退 + 快速中断机制)
    pub async fn run_turn_stream(
        &self,
        app: &AppHandle,
        config: &AgentConfig,
        mut history: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, String> {
        let _guard = self.execution_lock.lock().await;
        self.abort_flag.store(false, Ordering::SeqCst);

        let tools_schema = self.get_tools_schema();

        // 1. 动态注入组装 System Prompt (记忆 + 技能 + 人设)
        let full_sp = self.assemble_system_prompt(config.system_prompt.as_deref());
        if history.is_empty() || history[0].role != "system" {
            history.insert(0, ChatMessage {
                role: "system".to_string(),
                content: full_sp,
                thinking: None,
                thinking_duration: None,
                tool_calls: None,
                tool_call_id: None,
                images: None,
                files: None,
            });
        } else {
            history[0].content = full_sp;
        }

        let mut candidate_targets = Vec::new();
        if !config.model.trim().is_empty() {
            candidate_targets.push((
                config.model.clone(),
                config.provider_url.clone(),
                config.api_key.clone(),
            ));
        }

        if let Some(ref targets) = config.fallback_targets {
            for t in targets {
                if !candidate_targets.iter().any(|c| c.0 == t.model) && !t.model.trim().is_empty() {
                    candidate_targets.push((
                        t.model.clone(),
                        t.provider_url.clone().unwrap_or_else(|| config.provider_url.clone()),
                        t.api_key.clone().unwrap_or_else(|| config.api_key.clone()),
                    ));
                }
            }
        }

        if let Some(ref fallbacks) = config.fallback_models {
            for m in fallbacks {
                if !candidate_targets.iter().any(|c| &c.0 == m) && !m.trim().is_empty() {
                    candidate_targets.push((
                        m.clone(),
                        config.provider_url.clone(),
                        config.api_key.clone(),
                    ));
                }
            }
        }

        let mut last_call_signature = String::new();
        let mut repeat_call_count = 0;
        let max_total_tool_calls = 20usize;
        let mut total_tool_calls = 0usize;

        for _ in 0..10 {
            if self.abort_flag.load(Ordering::SeqCst) {
                let _ = app.emit("agent-stream", StreamEvent {
                    event_type: "stopped".to_string(),
                    content: "用户已手动停止生成。".to_string(),
                });
                break;
            }

            let mut stream_success = false;
            let mut last_error_msg = String::new();

            let mut assistant_content = String::new();
            let mut assistant_thinking = String::new();
            let mut tool_calls_map: std::collections::HashMap<usize, (String, String, String)> =
                std::collections::HashMap::new();
            let mut turn_start_time = Instant::now();

            for (idx, (try_model, try_url, try_key)) in candidate_targets.iter().enumerate() {
                if self.abort_flag.load(Ordering::SeqCst) {
                    break;
                }

                if idx > 0 {
                    append_log(&format!("[Agent] 主模型故障，回退至: {}", try_model));
                    let _ = app.emit("agent-stream", StreamEvent {
                        event_type: "fallback".to_string(),
                        content: format!("⚠️ 主模型遇到故障，已自动平滑回退至组内模型: {}", try_model),
                    });
                }

                // 端点规范化 (对标原版 effectiveBaseURL: 先 trimEnd('/') 再判断是否追加 /v1)
                let mut target_endpoint = try_url.trim().trim_end_matches('/').to_string();
                if !target_endpoint.ends_with("/chat/completions") {
                    if config.auto_append_v1.unwrap_or(true) && !target_endpoint.ends_with("/v1") {
                        target_endpoint.push_str("/v1");
                    }
                    target_endpoint.push_str("/chat/completions");
                }

                let mut request_map = serde_json::Map::new();
                request_map.insert("model".to_string(), json!(try_model));
                let request_history = Self::limit_history(&history, config.context_limit_tokens);
                request_map.insert("messages".to_string(), json!(Self::format_history_for_llm(&request_history)));
                request_map.insert("tools".to_string(), tools_schema.clone());
                request_map.insert("stream".to_string(), json!(true));
                request_map.insert("stream_options".to_string(), json!({ "include_usage": true }));

                let is_o_series = try_model.starts_with("o1") || try_model.starts_with("o3") || try_model.contains("/o1") || try_model.contains("/o3");
                if !is_o_series {
                    request_map.insert("temperature".to_string(), json!(0.7));
                }

                let thinking_mode = config.thinking_level.as_deref().unwrap_or("high");
                if thinking_mode != "off" {
                    let effort = match thinking_mode {
                        "low" => "low",
                        "medium" => "medium",
                        _ => "high",
                    };
                    if is_o_series || try_model.contains("reason") || try_model.contains("r1") {
                        request_map.insert("reasoning_effort".to_string(), json!(effort));
                    }
                    if target_endpoint.contains("anthropic") {
                        let budget = config.thinking_budget.unwrap_or(match thinking_mode {
                            "low" => 1024,
                            "medium" => 4096,
                            "max" => 16384,
                            _ => 8192,
                        });
                        request_map.insert("thinking".to_string(), json!({ "type": "enabled", "budget_tokens": budget }));
                    }
                }

                let request_body = Value::Object(request_map);

                let _ = app.emit("agent-stream", StreamEvent {
                    event_type: "status".to_string(),
                    content: "connecting".to_string(),
                });

                let send_res = self
                    .http_client
                    .post(&target_endpoint)
                    .header("Authorization", format!("Bearer {}", try_key))
                    .header("Content-Type", "application/json")
                    .json(&request_body)
                    .send()
                    .await;

                let resp = match send_res {
                    Ok(r) if r.status().is_success() => r,
                    Ok(err_resp) => {
                        let status_code = err_resp.status().as_u16();
                        let err_text = err_resp.text().await.unwrap_or_default();
                        last_error_msg = format!("HTTP {}: {}", status_code, extract_llm_error(&err_text));
                        continue;
                    }
                    Err(e) => {
                        last_error_msg = format!("网络连接异常: {}", e);
                        continue;
                    }
                };

                let mut stream = resp.bytes_stream();
                assistant_content.clear();
                assistant_thinking.clear();
                tool_calls_map.clear();
                turn_start_time = Instant::now();
                let mut is_in_thinking_phase = false;
                let mut buffer = String::new();
                let mut done = false;
                let mut read_failed = false;

                while !done {
                    if self.abort_flag.load(Ordering::SeqCst) {
                        let _ = app.emit("agent-stream", StreamEvent {
                            event_type: "stopped".to_string(),
                            content: "已中止当前生成".to_string(),
                        });
                        break;
                    }

                    let item = match stream.next().await {
                        Some(Ok(bytes)) => bytes,
                        Some(Err(e)) => {
                            last_error_msg = format!("流式传输异常中断: {}", e);
                            read_failed = true;
                            break;
                        }
                        None => break,
                    };
                    buffer.push_str(&String::from_utf8_lossy(&item));

                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer.drain(..=pos);

                        if line.is_empty() || line.starts_with(':') {
                            continue;
                        }

                        if line == "data: [DONE]" {
                            done = true;
                            break;
                        }

                        if let Some(json_str) = line.strip_prefix("data: ") {
                            if let Ok(val) = serde_json::from_str::<Value>(json_str) {
                                if let Some(usage) = val.get("usage") {
                                    let p_tok = usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                    let c_tok = usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                    let cached = usage
                                        .get("prompt_tokens_details")
                                        .and_then(|d| d.get("cached_tokens"))
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0);

                                    if p_tok > 0 || c_tok > 0 {
                                        self.usage_tracker.record_usage(
                                            config.session_id.as_deref().unwrap_or("default"),
                                            try_model,
                                            config.provider_id.as_deref().unwrap_or("OPENAI"),
                                            p_tok,
                                            c_tok,
                                            cached,
                                        );
                                    }
                                }

                                if let Some(choices) = val.get("choices").and_then(|v| v.as_array()) {
                                    if let Some(delta) = choices.get(0).and_then(|c| c.get("delta")) {
                                        if let Some(reasoning_chunk) = delta
                                            .get("reasoning_content")
                                            .or_else(|| delta.get("reasoning"))
                                            .or_else(|| delta.get("thought"))
                                            .or_else(|| delta.get("thinking"))
                                            .and_then(|v| v.as_str())
                                        {
                                            if !is_in_thinking_phase {
                                                is_in_thinking_phase = true;
                                                let _ = app.emit("agent-stream", StreamEvent {
                                                    event_type: "status".to_string(),
                                                    content: "thinking".to_string(),
                                                });
                                            }
                                            assistant_thinking.push_str(reasoning_chunk);
                                            let _ = app.emit("agent-stream", StreamEvent {
                                                event_type: "thinking".to_string(),
                                                content: reasoning_chunk.to_string(),
                                            });
                                        }

                                        if let Some(chunk_text) = delta.get("content").and_then(|v| v.as_str()) {
                                            if is_in_thinking_phase {
                                                is_in_thinking_phase = false;
                                                let _ = app.emit("agent-stream", StreamEvent {
                                                    event_type: "status".to_string(),
                                                    content: "answering".to_string(),
                                                });
                                            }
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

                if !read_failed {
                    stream_success = true;
                    break;
                }
            }

            if self.abort_flag.load(Ordering::SeqCst) {
                history.push(ChatMessage {
                    role: "assistant".to_string(),
                    content: assistant_content,
                    thinking: if assistant_thinking.is_empty() { None } else { Some(assistant_thinking) },
                    thinking_duration: Some(turn_start_time.elapsed().as_secs_f64()),
                    tool_calls: None,
                    tool_call_id: None,
                    images: None,
                    files: None,
                });
                return Ok(history);
            }

            if !stream_success {
                let err_msg = format!("所有备选模型均调用失败: {}", last_error_msg);
                append_log(&format!("[Agent] 模型调用失败: {}", err_msg));
                let _ = app.emit("agent-stream", StreamEvent {
                    event_type: "error".to_string(),
                    content: err_msg.clone(),
                });
                return Err(err_msg);
            }

            if assistant_thinking.is_empty() && assistant_content.contains("<think>") {
                if let Some(start) = assistant_content.find("<think>") {
                    if let Some(end) = assistant_content.find("</think>") {
                        let think_part = &assistant_content[start + 7..end];
                        assistant_thinking = think_part.trim().to_string();
                        assistant_content = assistant_content[end + 8..].trim().to_string();
                    }
                }
            }

            let thinking_duration = if !assistant_thinking.is_empty() {
                Some(turn_start_time.elapsed().as_secs_f64())
            } else {
                None
            };

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
                thinking: if assistant_thinking.is_empty() { None } else { Some(assistant_thinking) },
                thinking_duration,
                tool_calls: tool_calls_val.clone(),
                tool_call_id: None,
                images: None,
                files: None,
            });

            if tool_calls_val.is_none() {
                break;
            }

            // 执行工具调用
            if let Some(calls) = tool_calls_val.and_then(|v| v.as_array().cloned()) {
                for call in calls {
                    if self.abort_flag.load(Ordering::SeqCst) {
                        break;
                    }

                    let call_id = call["id"].as_str().unwrap_or("").to_string();
                    let fn_name = call["function"]["name"].as_str().unwrap_or("");
                    let fn_args_str = call["function"]["arguments"].as_str().unwrap_or("{}");

                    total_tool_calls += 1;
                    if total_tool_calls > max_total_tool_calls {
                        let limit_err = "已达工具调用安全上限 (20次)，已自动终止。".to_string();
                        let _ = app.emit("agent-stream", StreamEvent {
                            event_type: "error".to_string(),
                            content: limit_err.clone(),
                        });
                        history.push(ChatMessage {
                            role: "tool".to_string(),
                            content: json!({ "error": limit_err }).to_string(),
                            thinking: None,
                            thinking_duration: None,
                            tool_calls: None,
                            tool_call_id: Some(call_id),
                            images: None,
                            files: None,
                        });
                        return Ok(history);
                    }

                    let current_sig = format!("{}:{}", fn_name, fn_args_str);
                    if current_sig == last_call_signature {
                        repeat_call_count += 1;
                    } else {
                        last_call_signature = current_sig;
                        repeat_call_count = 1;
                    }

                    if repeat_call_count >= 3 {
                        let loop_err = "警告: 检测到同名参数工具死循环 (Tool Loop Detected)。已强制终止。".to_string();
                        let _ = app.emit("agent-stream", StreamEvent {
                            event_type: "error".to_string(),
                            content: loop_err.clone(),
                        });
                        history.push(ChatMessage {
                            role: "tool".to_string(),
                            content: json!({ "error": loop_err }).to_string(),
                            thinking: None,
                            thinking_duration: None,
                            tool_calls: None,
                            tool_call_id: Some(call_id),
                            images: None,
                            files: None,
                        });
                        return Ok(history);
                    }

                    let fn_args: Value = serde_json::from_str(fn_args_str).unwrap_or(json!({}));

                    // 参数清洗: 剥掉模型误带的 @url:`...` / `...` 包装 (Hermes 上下文标注混入工具参数)
                    let fn_args = sanitize_tool_args(fn_args);

                    // 携带工具参数 JSON, 前端据此驱动 Minis Computer 画中画小电脑 (真实 URL/命令)
                    let _ = app.emit("agent-stream", StreamEvent {
                        event_type: "tool_start".to_string(),
                        content: json!({ "tool": fn_name, "args": fn_args }).to_string(),
                    });
                    append_log(&format!("[Tool] 调用 {} 参数: {}", fn_name, fn_args_str));

                    let result = self.dispatcher.dispatch(fn_name, fn_args.clone()).await;

                    // Send a concise human-readable result to the live UI while
                    // keeping the complete structured result in chat history.
                    let result_str = result.to_string();
                    let explicit_success = result.get("success").and_then(Value::as_bool);
                    let exit_failed = result
                        .get("exit_code")
                        .and_then(Value::as_i64)
                        .map(|code| code != 0)
                        .unwrap_or(false);
                    let has_error = match result.get("error") {
                        Some(Value::Null) | None => false,
                        Some(Value::String(message)) => !message.trim().is_empty(),
                        Some(_) => true,
                    };
                    let failed = explicit_success == Some(false)
                        || exit_failed
                        || (explicit_success.is_none() && has_error);
                    let display_keys: &[&str] = if failed {
                        &["error", "stderr", "data", "stdout", "message"]
                    } else {
                        &["data", "stdout", "message", "stderr", "error"]
                    };
                    let display_result = display_keys
                        .iter()
                        .filter_map(|key| result.get(*key).and_then(Value::as_str))
                        .find(|value| !value.trim().is_empty())
                        .unwrap_or(&result_str);
                    let snippet = if display_result.chars().count() > 800 {
                        format!("{}...", display_result.chars().take(800).collect::<String>())
                    } else {
                        display_result.to_string()
                    };
                    let _ = app.emit("agent-stream", StreamEvent {
                        event_type: "tool_end".to_string(),
                        content: json!({ "tool": fn_name, "output": snippet, "success": !failed }).to_string(),
                    });

                    history.push(ChatMessage {
                        role: "tool".to_string(),
                        content: result.to_string(),
                        thinking: None,
                        thinking_duration: None,
                        tool_calls: None,
                        tool_call_id: Some(call_id),
                        images: None,
                        files: None,
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
                    "name": "open_terminal",
                    "description": "为需要人机交互输入的任务唤起独立终端窗口 (如交互式 SSH 登录、输入密码、运行 top/htop/vi 等)",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "在终端中预先运行或初始化的命令 (如 ssh root@x.x.x.x)" }
                        }
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
            },
            {
                "type": "function",
                "function": {
                    "name": "memory_write",
                    "description": "将重要事实、用户偏好、项目上下文或学到的技能持久化保存，供跨会话回忆",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "category": { "type": "string", "enum": ["preference", "project", "skill", "todo", "fact"] },
                            "content": { "type": "string" }
                        },
                        "required": ["category", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "memory_search",
                    "description": "按关键词检索历史记忆，在开始新任务前回忆过往上下文",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string" }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "clipboard_read",
                    "description": "读取宿主 Windows 系统剪贴板内容",
                    "parameters": {
                        "type": "object",
                        "properties": {}
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "clipboard_write",
                    "description": "将指定文本写入宿主 Windows 系统剪贴板",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": { "type": "string", "description": "待写入文本" }
                        },
                        "required": ["text"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "system_notification",
                    "description": "向宿主 Windows 桌面弹出一条原生系统消息通知",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string", "description": "通知标题" },
                            "message": { "type": "string", "description": "通知消息内容" }
                        },
                        "required": ["title", "message"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "system_info",
                    "description": "查询宿主 Windows 系统硬件与运行环境概要",
                    "parameters": {
                        "type": "object",
                        "properties": {}
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "list_providers",
                    "description": "查询已添加的 AI 供应商列表（名称、API 地址、模型，不含 API Key）",
                    "parameters": {
                        "type": "object",
                        "properties": {}
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "add_provider",
                    "description": "添加一个新的 AI 供应商（OpenAI 兼容接口），含名称、API 地址、API Key 与模型列表",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "供应商显示名称，如 \"DeepSeek\"" },
                            "provider_url": { "type": "string", "description": "API 基础地址，如 https://api.deepseek.com 或 https://api.openai.com/v1" },
                            "api_key": { "type": "string", "description": "API 密钥" },
                            "models": { "type": "array", "items": { "type": "string" }, "description": "模型 ID 列表，如 [\"deepseek-chat\", \"deepseek-reasoner\"]" },
                            "auto_append_v1": { "type": "boolean", "description": "是否自动追加 /v1 后缀（默认 true）" }
                        },
                        "required": ["name", "provider_url", "api_key"]
                    }
                }
            }
        ])
    }

    fn limit_history(history: &[ChatMessage], limit_tokens: Option<u32>) -> Vec<ChatMessage> {
        let Some(limit_tokens) = limit_tokens.filter(|value| *value > 0) else {
            return history.to_vec();
        };
        let byte_budget = (limit_tokens as usize).saturating_mul(4);
        let has_system = history.first().is_some_and(|message| message.role == "system");
        let system = has_system.then(|| history[0].clone());
        let mut kept = Vec::new();
        let mut used = system.as_ref().map(|message| message.content.len()).unwrap_or(0);

        for (reverse_index, message) in history.iter().rev().enumerate() {
            if has_system && reverse_index == history.len().saturating_sub(1) {
                continue;
            }
            let cost = message.content.len()
                + message.thinking.as_ref().map(|value| value.len()).unwrap_or(0)
                + 64;
            if !kept.is_empty() && used.saturating_add(cost) > byte_budget {
                break;
            }
            kept.push(message.clone());
            used = used.saturating_add(cost);
        }

        kept.reverse();
        while kept.first().is_some_and(|message| message.role == "tool") {
            kept.remove(0);
        }
        if let Some(system) = system {
            let mut result = Vec::with_capacity(kept.len() + 1);
            result.push(system);
            result.extend(kept);
            result
        } else {
            kept
        }
    }

    pub fn format_history_for_llm(history: &[ChatMessage]) -> Vec<Value> {
        let mut out = Vec::new();
        for msg in history {
            let mut obj = serde_json::Map::new();
            obj.insert("role".to_string(), json!(msg.role));

            if msg.role == "user" && msg.images.as_ref().map_or(false, |imgs| !imgs.is_empty()) {
                let mut parts = Vec::new();
                if !msg.content.trim().is_empty() {
                    parts.push(json!({
                        "type": "text",
                        "text": msg.content
                    }));
                }
                if let Some(ref imgs) = msg.images {
                    for img in imgs {
                        let image_url = if img.starts_with("data:image/") || img.starts_with("http") {
                            img.clone()
                        } else {
                            let minis_home = crate::sandbox::SandboxManager::get_minis_home();
                            let clean = img.trim_start_matches("minis://attachments/").trim_start_matches("/var/minis/attachments/");
                            let local_p = minis_home.join("attachments").join(clean);
                            if let Ok(bytes) = std::fs::read(&local_p) {
                                format!("data:image/png;base64,{}", crate::sandbox::base64_encode(&bytes))
                            } else {
                                img.clone()
                            }
                        };
                        parts.push(json!({
                            "type": "image_url",
                            "image_url": { "url": image_url }
                        }));
                    }
                }
                obj.insert("content".to_string(), Value::Array(parts));
            } else {
                obj.insert("content".to_string(), json!(msg.content));
            }

            if let Some(ref tc) = msg.tool_calls {
                obj.insert("tool_calls".to_string(), json!(tc));
            }
            if let Some(ref tcid) = msg.tool_call_id {
                obj.insert("tool_call_id".to_string(), json!(tcid));
            }

            out.push(Value::Object(obj));
        }
        out
    }
}

/// 从 LLM 返回的原始错误 JSON 中提取友好的人类可读错误信息
/// 处理 OpenAI/Anthropic/中转网关等常见错误格式, 提取 message 字段
#[cfg(test)]
mod tests {
    use super::*;

    fn message(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
            thinking: None,
            thinking_duration: None,
            tool_calls: None,
            tool_call_id: None,
            images: None,
            files: None,
        }
    }

    #[test]
    fn limited_history_keeps_system_and_newest_complete_messages() {
        let history = vec![
            message("system", "rules"),
            message("user", &"a".repeat(80)),
            message("assistant", &"b".repeat(80)),
            message("user", "latest question"),
        ];

        let limited = AgentEngine::limit_history(&history, Some(32));

        assert_eq!(limited.first().map(|m| m.role.as_str()), Some("system"));
        assert_eq!(limited.last().map(|m| m.content.as_str()), Some("latest question"));
        assert!(limited.len() < history.len());
    }

    #[test]
    fn limited_history_does_not_start_with_orphaned_tool_message() {
        let history = vec![
            message("system", "rules"),
            message("assistant", &"a".repeat(80)),
            message("tool", "old tool result"),
            message("user", "latest question"),
        ];

        let limited = AgentEngine::limit_history(&history, Some(32));
        assert_ne!(limited.get(1).map(|m| m.role.as_str()), Some("tool"));
    }

    #[test]
    fn unlimited_history_keeps_every_message() {
        let history = vec![message("system", "rules"), message("user", "hello")];
        assert_eq!(AgentEngine::limit_history(&history, None).len(), history.len());
    }
}

fn extract_llm_error(err_text: &str) -> String {
    // 尝试解析 JSON 错误体, 提取 message / error.message 字段
    if let Ok(val) = serde_json::from_str::<Value>(err_text) {
        // 常见格式: {"error": {"message": "..."}}
        if let Some(msg) = val.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            return msg.to_string();
        }
        // 格式: {"message": "..."}
        if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
        // 格式: {"error": "..."}
        if let Some(msg) = val.get("error").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
        // 格式: {"detail": "..."}
        if let Some(msg) = val.get("detail").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }

    // 非 JSON: 截断原始文本, 避免超长错误刷屏
    let trimmed = err_text.trim();
    if trimmed.chars().count() > 300 {
        format!("{}...", trimmed.chars().take(300).collect::<String>())
    } else if trimmed.is_empty() {
        "未知错误".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 清洗工具参数: 剥掉模型误带入的 `@url:\`...\`` / 反引号包装
/// (Hermes 上下文注入的 URL 标注被模型误抄进 shell 命令与工具参数)
fn sanitize_tool_args(args: Value) -> Value {
    fn clean_str(s: &str) -> String {
        let mut out = s.trim().to_string();
        // 剥掉 @url: 前缀 (无论大小写)
        if let Some(idx) = out.find("url:") {
            let prefix_end = idx + 4;
            let before = &out[..idx];
            // 只在 @url: 前缀时剥离 (避免误伤正文中的 "url:")
            if before.trim_end().ends_with('@') {
                out = out[prefix_end..].trim_start().to_string();
            }
        }
        // 剥掉外层反引号
        if out.starts_with('`') && out.ends_with('`') && out.len() >= 2 {
            out = out[1..out.len() - 1].to_string();
        }
        // 再剥一次可能残留的 @url: (双重包装)
        if let Some(idx) = out.find("url:") {
            let before = &out[..idx];
            if before.trim_end().ends_with('@') {
                out = out[idx + 4..].trim_start().to_string();
            }
        }
        if out.starts_with('`') && out.ends_with('`') && out.len() >= 2 {
            out = out[1..out.len() - 1].to_string();
        }
        out
    }

    match args {
        Value::String(s) => Value::String(clean_str(&s)),
        Value::Array(arr) => Value::Array(arr.into_iter().map(sanitize_tool_args).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, sanitize_tool_args(v)))
                .collect(),
        ),
        other => other,
    }
}
