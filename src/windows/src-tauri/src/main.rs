// Prevents console window on Windows
#![windows_subsystem = "windows"]

//! OpenMinis Windows Desktop Entry (完全审计加固版 + 调度驱动 + 一键沙箱初始化 + 自动拉取模型 + MCP + 模型组 Fallback + 用量统计 + 灵魂设定 + 技能系统 + 外部挂载)
//! 备注：Windows 测试版 (Experimental)

mod agent;
mod backup;
mod browser;
mod logs;
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

        let minis_home = sandbox::SandboxManager::get_minis_home();
        let host_target = if is_media { minis_home.join("attachments") } else { minis_home.join("workspace") };
        let _ = std::fs::create_dir_all(&host_target);
        let _ = std::fs::write(host_target.join(&clean_name), &bytes);

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

    let minis_home = sandbox::SandboxManager::get_minis_home();
    let host_target = if is_media { minis_home.join("attachments") } else { minis_home.join("workspace") };
    let _ = std::fs::create_dir_all(&host_target);
    let _ = std::fs::write(host_target.join(&clean_name), &bytes);

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
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
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
    let mut script_bytes = vec![0xEF, 0xBB, 0xBF];
    script_bytes.extend_from_slice(script_content.as_bytes());
    std::fs::write(&script_path, script_bytes).map_err(|e| format!("写入临时脚本失败: {}", e))?;

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
    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("服务商返回错误 (HTTP {}): {}", status, err_text));
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
fn list_sessions(state: State<'_, AppState>) -> Result<Vec<session::SessionRecord>, String> {
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
) -> Result<Vec<session::SessionRecord>, String> {
    state.sessions.search_sessions(&query)
}

#[tauri::command]
fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.delete_session(&id)
}

#[tauri::command]
fn rename_session(state: State<'_, AppState>, id: String, title: String) -> Result<(), String> {
    state.sessions.rename_session(&id, &title)
}

#[tauri::command]
async fn restart_sandbox(state: State<'_, AppState>) -> Result<sandbox::SandboxDiagnostics, String> {
    state.sandbox.restart_sandbox().await
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
    let script = r#"
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.FolderBrowserDialog
        $f.Description = "选择要挂载到沙箱的本地文件夹"
        $f.ShowNewFolderButton = $true
        if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $f.SelectedPath
        }
    "#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().map_err(|e| format!("打开文件夹选择器失败: {}", e))?;
    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path_str))
    }
}

#[tauri::command]
async fn read_image_data_url(path_or_url: String) -> Result<String, String> {
    if path_or_url.starts_with("data:image/") {
        return Ok(path_or_url);
    }
    let minis_home = sandbox::SandboxManager::get_minis_home();
    let clean = path_or_url
        .trim_start_matches("minis://")
        .trim_start_matches("/var/minis/")
        .trim_start_matches('\\')
        .trim_start_matches('/');

    let resolved_path = if clean.starts_with("attachments") {
        minis_home.join(clean)
    } else if clean.starts_with("workspace") {
        minis_home.join(clean)
    } else if clean.starts_with("shared") {
        minis_home.join(clean)
    } else {
        let p = std::path::PathBuf::from(&path_or_url);
        if p.exists() {
            p
        } else {
            minis_home.join("attachments").join(&clean)
        }
    };

    let (bytes, ext) = if resolved_path.exists() {
        let b = std::fs::read(&resolved_path)
            .map_err(|e| format!("读取图片失败: {}", e))?;
        let e = resolved_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("png")
            .to_lowercase();
        (b, e)
    } else {
        // 从 WSL 沙箱直接读取 (/var/minis/attachments/... 或 /var/minis/workspace/...)
        let wsl_subpath = if clean.starts_with("attachments") || clean.starts_with("workspace") || clean.starts_with("shared") {
            format!("/var/minis/{}", clean)
        } else {
            format!("/var/minis/attachments/{}", clean)
        };
        let mut cmd = std::process::Command::new("wsl");
        cmd.args(["-d", "OpenMinisSandbox", "-u", "root", "base64", "-w", "0", &wsl_subpath]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let out = cmd.output().map_err(|e| format!("执行 WSL 读取命令失败: {}", e))?;
        if !out.status.success() {
            return Err(format!("图片文件不存在: {} (宿主与沙箱均未找到)", clean));
        }
        let b64_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let decoded = sandbox::base64_decode(&b64_str)
            .map_err(|e| format!("Base64 解码沙箱图片失败: {}", e))?;

        // 写入宿主机缓存供后续秒开
        if let Some(parent) = resolved_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&resolved_path, &decoded);

        let e = clean.split('.').last().unwrap_or("png").to_lowercase();
        (decoded, e)
    };

    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };

    let b64 = sandbox::base64_encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

// === 日志系统 ===

#[tauri::command]
fn get_logs_summary() -> Result<logs::LogsSummary, String> {
    logs::list_logs()
}

#[tauri::command]
fn read_log_file(name: String) -> Result<String, String> {
    logs::read_log(&name)
}

#[tauri::command]
fn delete_all_logs() -> Result<(), String> {
    logs::delete_all_logs()
}

#[tauri::command]
async fn export_log_file(name: String, content: String) -> Result<String, String> {
    let script = format!(
        r#"
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.SaveFileDialog
        $f.Filter = "日志文件 (*.log;*.txt)|*.log;*.txt|所有文件 (*.*)|*.*"
        $f.FileName = "{}"
        $f.Title = "导出系统日志文件"
        if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
            Write-Output $f.FileName
        }}
    "#,
        name
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().map_err(|e| format!("打开保存对话框失败: {}", e))?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Err("用户取消了导出".to_string());
    }

    std::fs::write(&path, content).map_err(|e| format!("保存日志文件失败: {}", e))?;
    Ok(path)
}

// === 备份与恢复 ===

#[tauri::command]
async fn create_backup(options: backup::BackupOptions) -> Result<String, String> {
    backup::create_backup(options)
}

#[tauri::command]
async fn restore_backup(file_path: String) -> Result<backup::RestoreSummary, String> {
    backup::restore_backup(&file_path)
}

#[tauri::command]
async fn pick_backup_file() -> Result<Option<String>, String> {
    backup::pick_backup_file()
}

#[tauri::command]
async fn pick_save_backup_path() -> Result<Option<String>, String> {
    backup::pick_save_backup_path()
}

// === 模型实时测活 ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultimodalTestResult {
    pub supports_text: bool,
    pub supports_vision: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
async fn test_model_multimodal(
    provider_url: String,
    api_key: String,
    model: String,
) -> Result<MultimodalTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut clean_url = provider_url.trim().trim_end_matches('/').to_string();
    if !clean_url.ends_with("/v1") && !clean_url.contains("/v1/") {
        clean_url.push_str("/v1");
    }
    let url = format!("{}/chat/completions", clean_url);
    let start = std::time::Instant::now();

    // 1. 测试纯文本
    let text_body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "1" }],
        "max_tokens": 1
    });

    let mut req1 = client.post(&url);
    if !api_key.trim().is_empty() {
        req1 = req1.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let resp1 = req1.json(&text_body).send().await.map_err(|e| format!("文本测试请求失败: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;
    let s1 = resp1.status();
    let supports_text = s1.is_success() || s1.as_u16() == 429;

    // 2. 测试图片多模态 (1x1 transparent PNG)
    let tiny_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    let vision_body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": "hi" },
                { "type": "image_url", "image_url": { "url": tiny_png } }
            ]
        }],
        "max_tokens": 1
    });

    let mut req2 = client.post(&url);
    if !api_key.trim().is_empty() {
        req2 = req2.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let resp2 = req2.json(&vision_body).send().await;
    let supports_vision = match resp2 {
        Ok(r) => {
            let st = r.status();
            st.is_success() || st.as_u16() == 429
        }
        Err(_) => false,
    };

    Ok(MultimodalTestResult {
        supports_text,
        supports_vision,
        latency_ms: elapsed,
        error: if !supports_text { Some(format!("HTTP 状态: {}", s1)) } else { None },
    })
}

#[tauri::command]
async fn test_model_latency(
    provider_url: String,
    api_key: String,
    model: String,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut clean_url = provider_url.trim().trim_end_matches('/').to_string();
    if !clean_url.ends_with("/v1") && !clean_url.contains("/v1/") {
        clean_url.push_str("/v1");
    }
    let url = format!("{}/chat/completions", clean_url);
    let start = std::time::Instant::now();

    let mut req = client.post(&url);
    if !api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "hi" }],
        "max_tokens": 1
    });

    let resp = req.json(&body).send().await.map_err(|e| format!("请求失败: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;
    let status = resp.status();
    if status.is_success() || status.as_u16() == 400 || status.as_u16() == 429 {
        Ok(elapsed)
    } else {
        let err = resp.text().await.unwrap_or_default();
        Err(format!("HTTP {}: {}", status, err))
    }
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
            get_app_version,
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
            pick_folder,
            read_image_data_url,
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
            rename_session,
            restart_sandbox,
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
            save_global_memory,
            // 日志系统
            get_logs_summary,
            read_log_file,
            delete_all_logs,
            export_log_file,
            // 备份与恢复
            create_backup,
            restore_backup,
            pick_backup_file,
            pick_save_backup_path,
            // 实时测活
            test_model_latency,
            test_model_multimodal
        ])
        .run(tauri::generate_context!())
        .expect("启动 OpenMinis Windows 应用失败");
}
