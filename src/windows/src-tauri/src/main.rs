// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! OpenMinis Windows Desktop Entry (完全审计加固版 + 调度驱动与完整会话恢复)
//! 备注：私人用极度不稳定 Aicoding 改

mod agent;
mod browser;
mod memory;
mod sandbox;
mod scheduler;
mod session;
mod tools;

use agent::{AgentConfig, AgentEngine, ChatMessage};
use browser::BrowserEngine;
use memory::{MemoryCategory, MemoryEntry, MemoryStore};
use sandbox::SandboxManager;
use scheduler::{CronScheduler, ScheduledTask};
use session::SessionStore;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tools::ToolDispatcher;

struct AppState {
    sandbox: Arc<SandboxManager>,
    dispatcher: Arc<ToolDispatcher>,
    agent: Arc<AgentEngine>,
    sessions: Arc<SessionStore>,
    scheduler: Arc<CronScheduler>,
    memory: Arc<MemoryStore>,
}

// === 沙箱与 Agent 命令 ===

#[tauri::command]
async fn check_sandbox_status(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.sandbox.check_sandbox_ready().await)
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
    // 自动保存会话正文与索引
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

// === 会话管理命令 (Hermes 跨会话恢复与全文检索) ===

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

// === 定时任务命令 (Hermes Cron 24/7 automation) ===

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

// === 记忆系统命令 (Hermes agent-curated memory) ===

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
    let dispatcher = Arc::new(ToolDispatcher::new(sandbox.clone(), browser.clone(), memory.clone()));
    let agent = Arc::new(AgentEngine::new(dispatcher.clone()));
    let sessions = Arc::new(SessionStore::new());
    let scheduler = Arc::new(CronScheduler::new());
    let _ = memory.ensure_global_exists();

    let cron_scheduler_clone = scheduler.clone();

    let app_state = AppState {
        sandbox,
        dispatcher,
        agent,
        sessions,
        scheduler,
        memory,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            // 启动后台定时任务轮询协程 (每 30 秒轮询检查一次是否有任务到期)
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
            execute_sandbox_shell,
            run_agent_turn,
            open_sandbox_dir,
            launch_interactive_terminal,
            terminate_sandbox,
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
