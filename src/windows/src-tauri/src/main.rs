// Prevents console window on Windows
#![windows_subsystem = "windows"]

//! OpenMinis Windows Desktop Entry (完全审计加固版 + 调度驱动 + 一键沙箱初始化 + 自动拉取模型 + MCP + 模型组 Fallback + 用量统计 + 灵魂设定 + 技能系统 + 外部挂载)
//! 备注：Windows 测试版 (Experimental)

mod agent;
mod browser;
mod mcp;
mod memory;
mod model_groups;
mod mounts;
mod offloads;
mod sandbox;
mod scheduler;
mod session;
mod skills;
mod soul;
mod tools;
mod usage;

use agent::{AgentConfig, AgentEngine, ChatMessage};
use browser::BrowserEngine;
use mcp::{McpManager, McpServer};
use memory::{MemoryCategory, MemoryEntry, MemoryStore};
use model_groups::{FullModelGroupsState, ModelGroupManager};
use mounts::{MountManager, MountedFolderItem};
use offloads::WindowsOffload;
use sandbox::SandboxManager;
use scheduler::{CronScheduler, ScheduledTask};
use serde::{Deserialize, Serialize};
use session::SessionStore;
use skills::{SkillItem, SkillsManager};
use soul::{SoulConfig, SoulManager};
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
    soul: Arc<SoulManager>,
    skills: Arc<SkillsManager>,
    mounts: Arc<MountManager>,
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
        if !p.exists() {
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
fn abort_agent_turn(state: State<'_, AppState>) -> Result<(), String> {
    state.agent.abort();
    Ok(())
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
async fn get_sandbox_diagnostics(state: State<'_, AppState>) -> Result<sandbox::SandboxDiagnostics, String> {
    Ok(state.sandbox.get_diagnostics().await)
}

#[tauri::command]
async fn repair_sandbox(state: State<'_, AppState>) -> Result<String, String> {
    state.sandbox.repair_sandbox().await
}

#[tauri::command]
async fn reset_sandbox(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.sandbox.reset_sandbox(&app).await
}

#[tauri::command]
async fn open_sandbox_rootfs_dir(state: State<'_, AppState>) -> Result<(), String> {
    state.sandbox.open_rootfs_explorer()
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    let exe = std::env::current_exe().unwrap_or_default();
    let mut cmd = std::process::Command::new(exe);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let _ = cmd.spawn();
    app.exit(0);
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持以 http 或 https 开头的安全外部链接".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("rundll32.exe");
        cmd.args(["url.dll,FileProtocolHandler", &url]);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }
    Ok(())
}

#[tauri::command]
fn launch_installer_terminal() -> Result<(), String> {
    let script_content = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "    OpenMinis Windows WSL2 沙箱可视化初始化安装向导        " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$distroName = "OpenMinisSandbox"
$localAppData = [System.Environment]::GetFolderPath('LocalApplicationData')
$sandboxDir = Join-Path $localAppData "OpenMinis\sandbox"
$rootfsTar = Join-Path $sandboxDir "alpine-minirootfs.tar.gz"

if (!(Test-Path $sandboxDir)) {
    New-Item -ItemType Directory -Force -Path $sandboxDir | Out-Null
}

$mirrorUrl = "https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.21/releases/x86_64/alpine-minirootfs-3.21.3-x86_64.tar.gz"

Write-Host "[1/4] 正在从清华源高速下载 Alpine Linux 镜像..." -ForegroundColor Green
Write-Host "下载直链: $mirrorUrl" -ForegroundColor Gray
Write-Host "保存路径: $rootfsTar" -ForegroundColor Gray
Write-Host ""

Invoke-WebRequest -Uri $mirrorUrl -OutFile $rootfsTar

Write-Host ""
Write-Host "[2/4] 下载成功！正在解压并导入 WSL2 沙箱 ($distroName)..." -ForegroundColor Green
wsl --unregister $distroName 2>$null
wsl --import $distroName $sandboxDir $rootfsTar --version 2

Write-Host ""
Write-Host "[3/4] 正在配置安全隔离与工作区目录结构..." -ForegroundColor Green
$wslConf = @"
[automount]
enabled = false
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false

[network]
generateResolvConf = true
"@
$wslConf | wsl -d $distroName -u root -e tee /etc/wsl.conf | Out-Null

$setupSh = @"
mkdir -p /var/minis/workspace /var/minis/attachments /var/minis/offloads /var/minis/shared /var/minis/mounts /var/minis/skills
chmod 777 -R /var/minis
sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories
apk update && apk add --no-cache bash curl jq python3 py3-pip openssh-client sshpass
"@
$setupSh | wsl -d $distroName -u root -e sh | Out-Null

Write-Host ""
Write-Host "[4/4] 恭喜！OpenMinis 沙箱环境已全部安装就绪！" -ForegroundColor Cyan
Write-Host "请关闭本窗口，并在 OpenMinis 界面点击【我已完成安装，立即检测】或重启软件即可。" -ForegroundColor Yellow
Write-Host ""
Read-Host "按 Enter 回车键退出本窗口"
"#;

    let temp_dir = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".to_string());
    let script_path = std::path::Path::new(&temp_dir).join("init_openminis_sandbox.ps1");
    std::fs::write(&script_path, script_content).map_err(|e| format!("写入临时脚本失败: {}", e))?;

    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args([
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script_path.to_str().unwrap_or_default(),
    ]);

    let _ = cmd.spawn();
    Ok(())
}

#[tauri::command]
async fn fetch_provider_models(
    provider_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let url = format!("{}/models", provider_url.trim_end_matches('/'));
    let mut req = client.get(&url);
    if !api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key.trim()));
    }

    let resp = req.send().await.map_err(|e| format!("网络请求失败: {}", e))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("服务商返回错误 (HTTP {}): {}", resp.status(), err_text));
    }

    let val: serde_json::Value = resp.json().await.map_err(|e| format!("解析 JSON 响应失败: {}", e))?;
    let mut models = Vec::new();

    if let Some(arr) = val.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    } else if let Some(arr) = val.as_array() {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    }

    models.sort();
    models.dedup();

    if models.is_empty() {
        return Err("服务商返回的模型列表为空".to_string());
    }

    Ok(models)
}

// === 模型组与用量 (对标原版) ===

#[tauri::command]
fn get_usage_dashboard(state: State<'_, AppState>) -> Result<TotalUsageDashboard, String> {
    Ok(state.usage.get_dashboard_summary())
}

#[tauri::command]
fn get_model_groups_state(state: State<'_, AppState>) -> Result<FullModelGroupsState, String> {
    Ok(state.model_groups.get_state())
}

#[tauri::command]
fn save_model_groups_state(
    state: State<'_, AppState>,
    model_groups_state: FullModelGroupsState,
) -> Result<(), String> {
    state.model_groups.save_state(model_groups_state)
}

// === 灵魂人设设定 (SOUL.md) ===

#[tauri::command]
fn get_soul_config(state: State<'_, AppState>) -> Result<SoulConfig, String> {
    Ok(state.soul.get_soul())
}

#[tauri::command]
fn save_soul_config(state: State<'_, AppState>, config: SoulConfig) -> Result<(), String> {
    state.soul.save_soul(config)
}

// === 技能系统 (MinisSkills) ===

#[tauri::command]
fn list_skills(state: State<'_, AppState>) -> Result<Vec<SkillItem>, String> {
    Ok(state.skills.list_skills())
}

// === 外部目录挂载 (Mounted Folders) ===

#[tauri::command]
fn list_mounted_folders(state: State<'_, AppState>) -> Result<Vec<MountedFolderItem>, String> {
    Ok(state.mounts.list_mounts())
}

#[tauri::command]
async fn add_mounted_folder(
    state: State<'_, AppState>,
    host_path: String,
    mount_name: String,
) -> Result<MountedFolderItem, String> {
    state.mounts.add_mount(&host_path, &mount_name).await
}

#[tauri::command]
async fn remove_mounted_folder(
    state: State<'_, AppState>,
    mount_name: String,
) -> Result<(), String> {
    state.mounts.remove_mount(&mount_name).await
}

// === 宿主 Native Offloads ===

#[tauri::command]
fn send_native_notification(title: String, message: String) -> Result<(), String> {
    WindowsOffload::send_notification(&title, &message);
    Ok(())
}

#[tauri::command]
fn get_system_info() -> Result<serde_json::Value, String> {
    Ok(WindowsOffload::get_system_summary())
}

// === MCP 管理 ===

#[tauri::command]
fn list_mcp_servers(state: State<'_, AppState>) -> Result<Vec<McpServer>, String> {
    state.mcp.list_servers()
}

#[tauri::command]
fn add_mcp_server(state: State<'_, AppState>, server: McpServer) -> Result<(), String> {
    state.mcp.add_server(server)
}

#[tauri::command]
fn remove_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mcp.remove_server(&id)
}

#[tauri::command]
fn toggle_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mcp.toggle_server(&id)
}

// === 会话管理与恢复 ===

#[tauri::command]
fn list_sessions(state: State<'_, AppState>) -> Result<Vec<session::SessionSummary>, String> {
    state.sessions.list_sessions()
}

#[tauri::command]
fn get_session_messages(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ChatMessage>, String> {
    state.sessions.get_session_messages(&id)
}

#[tauri::command]
fn search_sessions(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<session::SessionSummary>, String> {
    state.sessions.search_sessions(&query)
}

#[tauri::command]
fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.delete_session(&id)
}

// === 定时任务调度器 ===

#[tauri::command]
fn list_tasks(state: State<'_, AppState>) -> Result<Vec<ScheduledTask>, String> {
    state.scheduler.list_tasks()
}

#[tauri::command]
fn add_task(state: State<'_, AppState>, task: ScheduledTask) -> Result<(), String> {
    state.scheduler.add_task(task)
}

#[tauri::command]
fn remove_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.remove_task(&id)
}

#[tauri::command]
fn toggle_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.toggle_task(&id)
}

// === 记忆系统 (1:1 原版) ===

#[tauri::command]
fn write_memory(
    state: State<'_, AppState>,
    category: String,
    content: String,
) -> Result<String, String> {
    let cat = match category.as_str() {
        "preference" => MemoryCategory::UserPreference,
        "project" => MemoryCategory::ProjectContext,
        "skill" => MemoryCategory::LearnedSkill,
        "todo" => MemoryCategory::ActionItem,
        _ => MemoryCategory::Fact,
    };
    state.memory.write_memory(cat, &content)
}

#[tauri::command]
fn search_memory(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<MemoryEntry>, String> {
    state.memory.search_memory(&query)
}

#[tauri::command]
fn get_today_memory(state: State<'_, AppState>) -> Result<String, String> {
    state.memory.get_today_memory()
}

#[tauri::command]
fn get_global_memory(state: State<'_, AppState>) -> Result<String, String> {
    state.memory.get_global_memory()
}

#[tauri::command]
fn save_global_memory(state: State<'_, AppState>, content: String) -> Result<(), String> {
    state.memory.save_global_memory(&content)
}

fn main() {
    let sandbox = Arc::new(SandboxManager::new());
    let browser = Arc::new(BrowserEngine::new(sandbox.clone()));
    let memory = Arc::new(MemoryStore::new());
    let usage = Arc::new(UsageTracker::new());
    let model_groups = Arc::new(ModelGroupManager::new());
    let soul = Arc::new(SoulManager::new());
    let skills = Arc::new(SkillsManager::new());
    let mounts = Arc::new(MountManager::new(sandbox.distro_name.clone()));
    let dispatcher = Arc::new(ToolDispatcher::new(sandbox.clone(), browser.clone(), memory.clone()));
    let agent = Arc::new(AgentEngine::new(
        dispatcher.clone(),
        usage.clone(),
        memory.clone(),
        soul.clone(),
        skills.clone(),
        mounts.clone(),
    ));
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
        soul,
        skills,
        mounts,
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
            abort_agent_turn,
            open_sandbox_dir,
            launch_interactive_terminal,
            terminate_sandbox,
            get_sandbox_diagnostics,
            repair_sandbox,
            reset_sandbox,
            open_sandbox_rootfs_dir,
            restart_app,
            open_external_url,
            launch_installer_terminal,
            fetch_provider_models,
            // 模型组与用量 (对标原版)
            get_usage_dashboard,
            get_model_groups_state,
            save_model_groups_state,
            // 灵魂与个性化人设
            get_soul_config,
            save_soul_config,
            // 技能扩展
            list_skills,
            // 外部目录挂载
            list_mounted_folders,
            add_mounted_folder,
            remove_mounted_folder,
            // Native Offloads
            send_native_notification,
            get_system_info,
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
            get_today_memory,
            get_global_memory,
            save_global_memory
        ])
        .run(tauri::generate_context!())
        .expect("启动 OpenMinis Windows 应用失败");
}
