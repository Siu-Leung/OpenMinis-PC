// Prevents console window on Windows
#![windows_subsystem = "windows"]

//! OpenMinis Windows Desktop Entry (完全审计加固版 + 调度驱动 + 一键沙箱初始化 + 自动拉取模型 + MCP + 模型组 Fallback + 用量统计)
//! 备注：私人用极度不稳定 Aicoding 改

mod agent;
mod browser;
mod mcp;
mod memory;
mod model_groups;
mod sandbox;
mod scheduler;
mod session;
mod tools;
mod usage;

use agent::{AgentConfig, AgentEngine, ChatMessage};
use browser::BrowserEngine;
use mcp::{McpManager, McpServer};
use memory::{MemoryCategory, MemoryEntry, MemoryStore};
use model_groups::{FullModelGroupsState, ModelGroupManager};
use sandbox::SandboxManager;
use scheduler::{CronScheduler, ScheduledTask};
use serde::{Deserialize, Serialize};
use session::SessionStore;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tools::ToolDispatcher;
use usage::{TotalUsageDashboard, UsageTracker};

struct AppState {
    sandbox: Arc<SandboxManager>,
    dispatcher: Arc<ToolDispatcher>,
    agent: Arc<AgentEngine>,
    sessions: Arc<SessionStore>,
    scheduler: Arc<CronScheduler>,
    memory: Arc<MemoryStore>,
    mcp: Arc<McpManager>,
    usage: Arc<UsageTracker>,
    model_groups: Arc<ModelGroupManager>,
}

// === 沙箱与 Agent 命令 ===

#[tauri::command]
async fn check_sandbox_status(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.sandbox.check_sandbox_ready().await)
}

#[tauri::command]
async fn auto_initialize_sandbox(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.sandbox.auto_initialize(&app).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileImportResult {
    pub id: String,
    pub name: String,
    pub is_media: bool,
    pub size_str: String,
    pub data_url: String,
}

#[tauri::command]
async fn import_local_files_by_path(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<LocalFileImportResult>, String> {
    let mut results = Vec::new();

    for path_str in paths {
        let p = std::path::Path::new(&path_str);
        if !p.exists() || !p.is_file() {
            continue;
        }

        let file_name = p.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let ext = p.extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        let is_media = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg");

        let bytes = std::fs::read(p)
            .map_err(|e| format!("读取文件 {} 失败: {}", file_name, e))?;

        let size = bytes.len();
        let size_str = if size > 1024 * 1024 {
            format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
        } else {
            format!("{} KB", (size + 1023) / 1024)
        };

        let data_url = if is_media {
            let mime = match ext.as_str() {
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                _ => "image/png",
            };
            format!("data:{};base64,{}", mime, sandbox::base64_encode(&bytes))
        } else {
            String::new()
        };

        let clean_name = file_name.replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '-' && c != '_', "_");
        let target_dir = if is_media { "/var/minis/attachments" } else { "/var/minis/workspace" };
        let target_path = format!("{}/{}", target_dir, clean_name);
        let _ = state.sandbox.write_sandbox_bytes(&target_path, &bytes, false).await;

        results.push(LocalFileImportResult {
            id: uuid::Uuid::new_v4().to_string()[..8].to_string(),
            name: file_name,
            is_media,
            size_str,
            data_url,
        });
    }

    Ok(results)
}

#[tauri::command]
async fn upload_chat_attachment(
    state: State<'_, AppState>,
    name: String,
    base64_data: String,
    is_media: bool,
) -> Result<String, String> {
    let clean_name = name.replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '-' && c != '_', "_");
    let target_dir = if is_media { "/var/minis/attachments" } else { "/var/minis/workspace" };
    let target_path = format!("{}/{}", target_dir, clean_name);

    let raw_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let b64_clean = raw_b64.replace(['\r', '\n', ' '], "");
    let bytes = sandbox::base64_decode(&b64_clean).map_err(|e| format!("Base64 解码失败: {}", e))?;

    state.sandbox.write_sandbox_bytes(&target_path, &bytes, false).await?;

    let minis_url = format!("minis://{}/{}", if is_media { "attachments" } else { "workspace" }, clean_name);
    Ok(minis_url)
}

#[tauri::command]
async fn execute_sandbox_shell(
    state: State<'_, AppState>,
    cmd: String,
    timeout_secs: Option<u64>,
) -> Result<sandbox::CommandOutput, String> {
    state.sandbox.execute_shell(&cmd, timeout_secs.unwrap_or(60)).await
}

#[tauri::command]
async fn run_agent_turn(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AgentConfig,
    session_id: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<Vec<ChatMessage>, String> {
    let result = state.agent.run_turn_stream(&app, &config, messages).await;
    if let Ok(ref msgs) = result {
        if msgs.len() > 2 {
            let _ = state.sessions.save_session(session_id.as_deref(), msgs);
        }
    }
    result
}

#[tauri::command]
async fn launch_interactive_terminal(state: State<'_, AppState>, cmd: Option<String>) -> Result<(), String> {
    state.sandbox.launch_interactive_terminal(cmd)
}

#[tauri::command]
async fn open_sandbox_dir(state: State<'_, AppState>, subpath: Option<String>) -> Result<(), String> {
    state.sandbox.open_in_explorer(&subpath.unwrap_or_default())
}

#[tauri::command]
async fn terminate_sandbox(state: State<'_, AppState>) -> Result<(), String> {
    state.sandbox.terminate_sandbox().await;
    Ok(())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

// === 自动从供应商拉取可用模型列表 ===

#[tauri::command]
async fn fetch_provider_models(provider_url: String, api_key: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let base = provider_url.trim_end_matches('/');
    let primary_url = if base.ends_with("/v1") {
        format!("{}/models", base)
    } else {
        format!("{}/v1/models", base)
    };

    let mut req = client.get(&primary_url);
    if !api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key.trim()));
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                return parse_models_json(&json);
            }
        }
        _ => {
            let fallback_url = format!("{}/models", base);
            let mut req2 = client.get(&fallback_url);
            if !api_key.trim().is_empty() {
                req2 = req2.header("Authorization", format!("Bearer {}", api_key.trim()));
            }
            if let Ok(resp2) = req2.send().await {
                if resp2.status().is_success() {
                    if let Ok(json2) = resp2.json::<serde_json::Value>().await {
                        return parse_models_json(&json2);
                    }
                }
            }
        }
    }

    Err("未能从供应商获取到模型列表，请确认 Base URL 与 API Key 是否正确".to_string())
}

fn parse_models_json(json: &serde_json::Value) -> Result<Vec<String>, String> {
    let mut models = Vec::new();
    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        for m in data {
            if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                models.push(id.to_string());
            }
        }
    } else if let Some(data) = json.get("models").and_then(|d| d.as_array()) {
        for m in data {
            if let Some(id) = m.get("name").or(m.get("id")).and_then(|i| i.as_str()) {
                models.push(id.to_string());
            }
        }
    }

    models.sort();
    models.dedup();

    if models.is_empty() {
        Err("供应商返回数据中未包含有效模型 ID".to_string())
    } else {
        Ok(models)
    }
}

// === MCP (Model Context Protocol) 管理命令 ===

#[tauri::command]
async fn list_mcp_servers(state: State<'_, AppState>) -> Result<Vec<McpServer>, String> {
    state.mcp.list_servers()
}

#[tauri::command]
async fn add_mcp_server(state: State<'_, AppState>, server: McpServer) -> Result<(), String> {
    state.mcp.add_server(server)
}

#[tauri::command]
async fn remove_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mcp.remove_server(&id)
}

#[tauri::command]
async fn toggle_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mcp.toggle_server(&id)
}

// === Token 用量统计命令 (对标截图 1000143344) ===

#[tauri::command]
async fn get_usage_dashboard(state: State<'_, AppState>) -> Result<TotalUsageDashboard, String> {
    Ok(state.usage.get_dashboard_summary())
}

// === 模型组与 Defaults 管理命令 (对标截图 1000143328) ===

#[tauri::command]
async fn get_model_groups_state(state: State<'_, AppState>) -> Result<FullModelGroupsState, String> {
    Ok(state.model_groups.get_state())
}

#[tauri::command]
async fn save_model_groups_state(
    state: State<'_, AppState>,
    state_data: FullModelGroupsState,
) -> Result<(), String> {
    state.model_groups.save_state(state_data)
}

// === 会话管理命令 ===

#[tauri::command]
async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<session::SessionRecord>, String> {
    state.sessions.list_sessions()
}

#[tauri::command]
async fn get_session_messages(state: State<'_, AppState>, id: String) -> Result<Vec<ChatMessage>, String> {
    state.sessions.get_session_messages(&id)
}

#[tauri::command]
async fn search_sessions(state: State<'_, AppState>, query: String) -> Result<Vec<session::SessionRecord>, String> {
    state.sessions.search_sessions(&query)
}

#[tauri::command]
async fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.delete_session(&id)
}

// === 定时任务命令 ===

#[tauri::command]
async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<ScheduledTask>, String> {
    state.scheduler.list_tasks()
}

#[tauri::command]
async fn add_task(state: State<'_, AppState>, task: ScheduledTask) -> Result<(), String> {
    state.scheduler.add_task(task)
}

#[tauri::command]
async fn remove_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.remove_task(&id)
}

#[tauri::command]
async fn toggle_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.toggle_task(&id)
}

// === 记忆系统命令 ===

#[tauri::command]
async fn write_memory(
    state: State<'_, AppState>,
    category: MemoryCategory,
    content: String,
) -> Result<String, String> {
    state.memory.write_memory(category, &content)
}

#[tauri::command]
async fn search_memory(state: State<'_, AppState>, query: String) -> Result<Vec<MemoryEntry>, String> {
    state.memory.search_memory(&query)
}

#[tauri::command]
async fn get_today_memory(state: State<'_, AppState>) -> Result<String, String> {
    state.memory.get_today_memory()
}

fn main() {
    let sandbox = Arc::new(SandboxManager::new());
    let browser = Arc::new(BrowserEngine::new(sandbox.clone()));
    let memory = Arc::new(MemoryStore::new());
    let usage = Arc::new(UsageTracker::new());
    let model_groups = Arc::new(ModelGroupManager::new());
    let dispatcher = Arc::new(ToolDispatcher::new(sandbox.clone(), browser.clone(), memory.clone()));
    let agent = Arc::new(AgentEngine::new(dispatcher.clone(), usage.clone()));
    let sessions = Arc::new(SessionStore::new());
    let scheduler = Arc::new(CronScheduler::new());
    let mcp = Arc::new(McpManager::new());
    let _ = memory.ensure_global_exists();

    let cron_scheduler_clone = scheduler.clone();

    let app_state = AppState {
        sandbox,
        dispatcher,
        agent,
        sessions,
        scheduler,
        memory,
        mcp,
        usage,
        model_groups,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            let handle = app.handle().clone();
            let sched = cron_scheduler_clone;
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
                loop {
                    interval.tick().await;
                    if let Ok(due_tasks) = sched.check_due_tasks() {
                        for task in due_tasks {
                            let _ = sched.mark_run(&task.id);
                            let _ = handle.emit("scheduled-task-trigger", task);
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 沙箱与 Agent
            check_sandbox_status,
            auto_initialize_sandbox,
            upload_chat_attachment,
            import_local_files_by_path,
            execute_sandbox_shell,
            run_agent_turn,
            open_sandbox_dir,
            launch_interactive_terminal,
            terminate_sandbox,
            restart_app,
            fetch_provider_models,
            // 模型组与用量 (对标原版)
            get_usage_dashboard,
            get_model_groups_state,
            save_model_groups_state,
            // MCP 管理
            list_mcp_servers,
            add_mcp_server,
            remove_mcp_server,
            toggle_mcp_server,
            // 会话管理与恢复
            list_sessions,
            get_session_messages,
            search_sessions,
            delete_session,
            // 定时任务
            list_tasks,
            add_task,
            remove_task,
            toggle_task,
            // 记忆系统
            write_memory,
            search_memory,
            get_today_memory
        ])
        .run(tauri::generate_context!())
        .expect("启动 OpenMinis Windows 应用失败");
}
