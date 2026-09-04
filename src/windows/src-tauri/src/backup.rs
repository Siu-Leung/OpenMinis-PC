//! OpenMinis Windows 备份与恢复 (.minisbak)
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupOptions {
    pub include_chats: bool,
    pub include_shared: bool,
    pub include_skills: bool,
    pub include_memory: bool,
    pub include_providers: bool,
    pub include_mcp: bool,
    pub include_env: bool,
    pub is_encrypted: bool,
    pub password: Option<String>,
    pub destination_path: Option<String>,
    pub max_file_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: String,
    pub format: String,
    pub created_at: String,
    pub include_chats: bool,
    pub include_shared: bool,
    pub include_skills: bool,
    pub include_memory: bool,
    pub include_providers: bool,
    pub include_mcp: bool,
    pub include_env: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreSummary {
    pub success: bool,
    pub message: String,
    pub restored_categories: Vec<String>,
}

pub fn pick_backup_file() -> Result<Option<String>, String> {
    let script = r#"
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.OpenFileDialog
        $f.Filter = "Minis 备份文件 (*.minisbak;*.zip)|*.minisbak;*.zip|所有文件 (*.*)|*.*"
        $f.Title = "从文件或云盘中选择备份文件"
        if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $f.FileName
        }
    "#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().map_err(|e| format!("打开选择器失败: {}", e))?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

pub fn pick_save_backup_path() -> Result<Option<String>, String> {
    let today = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let def_name = format!("minis-backup-{}.minisbak", today);
    let script = format!(
        r#"
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.SaveFileDialog
        $f.Filter = "Minis 备份文件 (*.minisbak)|*.minisbak"
        $f.FileName = "{}"
        $f.Title = "保存备份文件"
        if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
            Write-Output $f.FileName
        }}
    "#,
        def_name
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
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

pub fn create_backup(options: BackupOptions) -> Result<String, String> {
    let minis_home = crate::sandbox::SandboxManager::get_minis_home();
    let temp_root = std::env::temp_dir().join(format!("minisbak_{}", uuid::Uuid::new_v4()));
    let temp_staging = temp_root.join("content");
    fs::create_dir_all(&temp_staging).map_err(|e| format!("创建临时工作区失败: {}", e))?;

    let manifest = BackupManifest {
        version: "1.13.11".to_string(),
        format: "minisbak/1".to_string(),
        created_at: Local::now().to_rfc3339(),
        include_chats: options.include_chats,
        include_shared: options.include_shared,
        include_skills: options.include_skills,
        include_memory: options.include_memory,
        include_providers: options.include_providers,
        include_mcp: options.include_mcp,
        include_env: options.include_env,
    };

    let manifest_json = serde_json::to_string_pretty(&manifest).unwrap_or_default();
    fs::write(temp_staging.join("manifest.json"), manifest_json).ok();

    // 1. 备份记忆与灵魂
    if options.include_memory {
        let mem_dest = temp_staging.join("memory");
        fs::create_dir_all(&mem_dest).ok();
        let soul_src = minis_home.join("SOUL.md");
        if soul_src.exists() {
            fs::copy(&soul_src, mem_dest.join("SOUL.md")).ok();
        }
        let global_src = minis_home.join("memory").join("GLOBAL.md");
        if global_src.exists() {
            fs::copy(&global_src, mem_dest.join("GLOBAL.md")).ok();
        }
    }

    // 2. 备份技能
    if options.include_skills {
        let skills_src = minis_home.join("skills");
        if skills_src.exists() {
            copy_dir_all(&skills_src, &temp_staging.join("skills")).ok();
        }
    }

    // 3. 备份共享文件
    if options.include_shared {
        let shared_src = minis_home.join("shared");
        if shared_src.exists() {
            copy_dir_all(&shared_src, &temp_staging.join("shared")).ok();
        }
    }

    // 4. 备份对话与会话数据
    if options.include_chats {
        let app_data = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        let sess_src = app_data.join("sessions");
        if sess_src.exists() {
            copy_dir_all(&sess_src, &temp_staging.join("sessions")).ok();
        }
        let db_src = app_data.join("sessions_db.json");
        if db_src.exists() {
            fs::copy(&db_src, temp_staging.join("sessions_db.json")).ok();
        }
    }

    // 5. 备份模型组
    let app_data = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("data"));
    let mg_src = app_data.join("model_groups.json");
    if mg_src.exists() {
        fs::copy(&mg_src, temp_staging.join("model_groups.json")).ok();
    }

    // 6. 确定目标输出路径
    let target_file = if let Some(dest) = options.destination_path {
        PathBuf::from(dest)
    } else {
        let doc_dir = dirs_or_home();
        let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
        doc_dir.join(format!("minis_backup_{}.minisbak", timestamp))
    };

    if let Some(parent) = target_file.parent() {
        fs::create_dir_all(parent).ok();
    }

    // 7. 使用系统内置 tar 或 Compress-Archive 生成 .minisbak (zip 格式)
    let staging_str = temp_staging.to_string_lossy();
    let target_str = target_file.to_string_lossy();

    let ps_compress = format!(
        "Compress-Archive -Path '{}/*' -DestinationPath '{}' -Force",
        staging_str.replace('\'', "''"),
        target_str.replace('\'', "''")
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_compress]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let res = cmd.output();

    // 清理临时目录
    let _ = fs::remove_dir_all(&temp_root);

    match res {
        Ok(out) if out.status.success() => {
            crate::logs::append_log(&format!("已成功创建备份文件: {}", target_file.display()));
            Ok(target_file.to_string_lossy().to_string())
        }
        Ok(out) => {
            let err_msg = String::from_utf8_lossy(&out.stderr);
            Err(format!("打包备份文件失败: {}", err_msg))
        }
        Err(e) => Err(format!("调用压缩工具失败: {}", e)),
    }
}

pub fn restore_backup(file_path: &str) -> Result<RestoreSummary, String> {
    let src = Path::new(file_path);
    if !src.exists() {
        return Err("所选备份文件不存在".to_string());
    }

    let temp_root = std::env::temp_dir().join(format!("minisrestore_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_root).map_err(|e| format!("创建临时解包目录失败: {}", e))?;

    // 解包
    let src_str = src.to_string_lossy();
    let dest_str = temp_root.to_string_lossy();
    let ps_expand = format!(
        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        src_str.replace('\'', "''"),
        dest_str.replace('\'', "''")
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_expand]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let res = cmd.output().map_err(|e| format!("解压进程启动失败: {}", e))?;
    if !res.status.success() {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(format!("解压备份失败: {}", String::from_utf8_lossy(&res.stderr)));
    }

    let mut restored = Vec::new();
    let minis_home = crate::sandbox::SandboxManager::get_minis_home();

    // 1. 恢复 memory
    let mem_dir = temp_root.join("memory");
    if mem_dir.exists() {
        if let Ok(entries) = fs::read_dir(&mem_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Some(fname) = p.file_name() {
                    let dest = minis_home.join(fname);
                    fs::copy(&p, dest).ok();
                }
            }
        }
        restored.push("记忆与灵魂".to_string());
    }

    // 2. 恢复 skills
    let skills_dir = temp_root.join("skills");
    if skills_dir.exists() {
        copy_dir_all(&skills_dir, &minis_home.join("skills")).ok();
        restored.push("技能扩展".to_string());
    }

    // 3. 恢复 shared
    let shared_dir = temp_root.join("shared");
    if shared_dir.exists() {
        copy_dir_all(&shared_dir, &minis_home.join("shared")).ok();
        restored.push("共享文件".to_string());
    }

    // 4. 恢复 sessions
    let app_data = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("data"));
    let sess_dir = temp_root.join("sessions");
    if sess_dir.exists() {
        copy_dir_all(&sess_dir, &app_data.join("sessions")).ok();
        restored.push("历史对话".to_string());
    }
    let db_src = temp_root.join("sessions_db.json");
    if db_src.exists() {
        fs::copy(&db_src, app_data.join("sessions_db.json")).ok();
    }

    // 5. 恢复 model groups
    let mg_src = temp_root.join("model_groups.json");
    if mg_src.exists() {
        fs::copy(&mg_src, app_data.join("model_groups.json")).ok();
        restored.push("模型分组".to_string());
    }

    // 清理
    let _ = fs::remove_dir_all(&temp_root);

    crate::logs::append_log(&format!("已从备份文件恢复: {}", file_path));

    Ok(RestoreSummary {
        success: true,
        message: "数据恢复成功完成！".to_string(),
        restored_categories: restored,
    })
}

fn dirs_or_home() -> PathBuf {
    if let Ok(prof) = std::env::var("USERPROFILE") {
        PathBuf::from(prof).join("Documents")
    } else {
        PathBuf::from("C:\\Users\\Administrator\\Documents")
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}
