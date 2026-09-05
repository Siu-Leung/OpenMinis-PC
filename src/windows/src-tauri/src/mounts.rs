//! OpenMinis Windows 外部宿主目录挂载管理 (Mounted Folders via WSL2 drvfs)
//! 备注：OpenMinis Windows 体验版

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::process::Command;

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountedFolderItem {
    pub id: String,
    pub name: String,
    pub host_path: String,
    pub sandbox_mount_path: String,
    pub is_mounted: bool,
}

/// 自动检测最佳的宿主 Minis 根存储目录（优先寻找非系统盘 D:, E:, F:...）
pub fn detect_or_create_default_minis_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let sys_drive = std::env::var("SystemDrive")
            .unwrap_or_else(|_| "C:".to_string())
            .to_uppercase();

        // 优先在非系统盘根目录创建 Minis 目录 (如 D:\Minis, E:\Minis)
        for letter in ['D', 'E', 'F', 'G', 'H', 'P', 'W'] {
            let drive_root = format!("{}:\\", letter);
            if !drive_root.starts_with(&sys_drive) && Path::new(&drive_root).exists() {
                let target = Path::new(&drive_root).join("Minis");
                let _ = std::fs::create_dir_all(&target);
                return target;
            }
        }
    }
    // 单分区保底使用 C:\Minis
    let fallback = PathBuf::from(r"C:\Minis");
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

pub fn pick_folder_dialog() -> Result<Option<String>, String> {
    let script = r#"
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = "选择要挂载进 Minis 沙箱的宿主文件夹"
        $dialog.ShowNewFolderButton = $true
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dialog.SelectedPath
        }
    "#;
    let mut cmd = std::process::Command::new("powershell");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);

    let output = cmd.output().map_err(|e| format!("唤起文件夹选择器失败: {}", e))?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

pub struct MountManager {
    config_path: PathBuf,
    distro_name: String,
    lock: Arc<Mutex<()>>,
}

impl MountManager {
    pub fn new(distro_name: String) -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        let mgr = Self {
            config_path: base.join("mounted_folders.json"),
            distro_name,
            lock: Arc::new(Mutex::new(())),
        };
        // 确保默认非系统盘 Minis 目录已就绪
        let _ = detect_or_create_default_minis_dir();
        mgr
    }

    pub fn list_mounts(&self) -> Vec<MountedFolderItem> {
        let _guard = match self.lock.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        if !self.config_path.exists() {
            return Vec::new();
        }
        let content = match std::fs::read_to_string(&self.config_path) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        serde_json::from_str(&content).unwrap_or_default()
    }

    pub async fn add_mount(&self, host_path: &str, mount_name: &str) -> Result<MountedFolderItem, String> {
        let clean_name = mount_name.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "_");
        let sandbox_target = format!("/var/minis/mounts/{}", clean_name);

        let mut mkdir_cmd = Command::new("wsl");
        #[cfg(target_os = "windows")]
        mkdir_cmd.creation_flags(CREATE_NO_WINDOW);
        mkdir_cmd.args(["-d", &self.distro_name, "-u", "root", "-e", "mkdir", "-p", &sandbox_target]);
        let _ = mkdir_cmd.output().await;

        let mut mount_cmd = Command::new("wsl");
        #[cfg(target_os = "windows")]
        mount_cmd.creation_flags(CREATE_NO_WINDOW);
        mount_cmd.args(["-d", &self.distro_name, "-u", "root", "-e", "mount", "-t", "drvfs", host_path, &sandbox_target]);
        let out = mount_cmd.output().await.map_err(|e| format!("挂载失败: {}", e))?;

        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            return Err(format!("挂载失败: {}", err));
        }

        let item = MountedFolderItem {
            id: uuid::Uuid::new_v4().to_string()[..8].to_string(),
            name: clean_name,
            host_path: host_path.to_string(),
            sandbox_mount_path: sandbox_target,
            is_mounted: true,
        };

        let mut list = self.list_mounts();
        list.retain(|m| m.name != item.name);
        list.push(item.clone());

        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(&self.config_path, json);
        }

        Ok(item)
    }

    pub async fn remove_mount(&self, name: &str) -> Result<(), String> {
        let sandbox_target = format!("/var/minis/mounts/{}", name);
        let mut umount_cmd = Command::new("wsl");
        #[cfg(target_os = "windows")]
        umount_cmd.creation_flags(CREATE_NO_WINDOW);
        umount_cmd.args(["-d", &self.distro_name, "-u", "root", "-e", "umount", &sandbox_target]);
        let _ = umount_cmd.output().await;

        let mut list = self.list_mounts();
        list.retain(|m| m.name != name);

        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(&self.config_path, json);
        }
        Ok(())
    }
}
