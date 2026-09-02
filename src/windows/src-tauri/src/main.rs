// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! OpenMinis Windows Desktop Entry (完全审计加固版)
//! 备注：私人用极度不稳定 Aicoding 改

mod agent;
mod browser;
mod sandbox;
mod tools;

use agent::{AgentConfig, AgentEngine, ChatMessage};
use browser::BrowserEngine;
use sandbox::SandboxManager;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tools::ToolDispatcher;

struct AppState {
    sandbox: Arc<SandboxManager>,
    dispatcher: Arc<ToolDispatcher>,
    agent: Arc<AgentEngine>,
}

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
    messages: Vec<ChatMessage>,
) -> Result<Vec<ChatMessage>, String> {
    state.agent.run_turn_stream(&app, &config, messages).await
}

#[tauri::command]
async fn terminate_sandbox(state: State<'_, AppState>) -> Result<(), String> {
    state.sandbox.terminate_sandbox().await;
    Ok(())
}

fn main() {
    let sandbox = Arc::new(SandboxManager::new());
    let browser = Arc::new(BrowserEngine::new(sandbox.clone()));
    let dispatcher = Arc::new(ToolDispatcher::new(sandbox.clone(), browser.clone()));
    let agent = Arc::new(AgentEngine::new(dispatcher.clone()));

    let app_state = AppState {
        sandbox,
        dispatcher,
        agent,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            check_sandbox_status,
            execute_sandbox_shell,
            run_agent_turn,
            terminate_sandbox
        ])
        .run(tauri::generate_context!())
        .expect("启动 OpenMinis Windows 应用失败");
}
