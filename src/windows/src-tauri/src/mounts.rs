//! OpenMinis Windows 外部宿主目录挂载管理 (Mounted Folders via WSL2 drvfs)
//! 备注：Windows 测试版 (Experimental)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::process::Command;

#[cfg(target_os = "windows")]
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
        Self {
            config_path: base.join("mounted_folders.json"),
            distro_name,
            lock: Arc::new(Mutex::new(())),
        }
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
