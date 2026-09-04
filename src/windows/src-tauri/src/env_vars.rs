//! OpenMinis Windows 环境变量管理 (注入沙箱 shell 执行)
//! 对标原版 EnvVarRepository / EnvironmentVariablesScreen.kt
//! 备注：Windows 测试版 (Experimental)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVarEntry {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub note: String,
}

pub struct EnvVarManager {
    storage_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl EnvVarManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            storage_path: base.join("env_vars.json"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_env_vars(&self) -> Result<Vec<EnvVarEntry>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        self.load_internal()
    }

    pub fn save_env_vars(&self, entries: Vec<EnvVarEntry>) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(&entries)
            .map_err(|e| format!("序列化环境变量失败: {}", e))?;
        std::fs::write(&self.storage_path, json)
            .map_err(|e| format!("写入环境变量失败: {}", e))?;
        Ok(())
    }

    /// 生成注入到沙箱 shell 的环境变量前缀 (export KEY='VALUE'; ...)
    pub fn build_inject_prefix(&self) -> String {
        let Ok(entries) = self.list_env_vars() else {
            return String::new();
        };
        let mut prefix = String::new();
        for e in entries {
            if e.key.trim().is_empty() {
                continue;
            }
            let safe_key = e.key.trim().replace('\'', "");
            let safe_val = e.value.replace('\'', "'\\''");
            prefix.push_str(&format!("export {}='{}'; ", safe_key, safe_val));
        }
        prefix
    }

    fn load_internal(&self) -> Result<Vec<EnvVarEntry>, String> {
        if !self.storage_path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.storage_path)
            .map_err(|e| format!("读取环境变量失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析环境变量失败: {}", e))
    }
}
