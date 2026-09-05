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
        validate_entries(&entries)?;
        self.write_internal(&entries)
    }

    /// 生成注入到沙箱 shell 的环境变量前缀 (export KEY='VALUE'; ...)
    pub fn build_inject_prefix(&self) -> String {
        let Ok(entries) = self.list_env_vars() else {
            return String::new();
        };
        let mut prefix = String::new();
        for e in entries {
            if !is_valid_env_key(&e.key) {
                continue;
            }
            let safe_key = &e.key;
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
        let (entries, legacy) = crate::secret_store::decode_protected_or_legacy(
            &content,
            crate::secret_store::unprotect_for_current_user,
        )?;
        if legacy {
            self.write_internal(&entries)?;
        }
        Ok(entries)
    }

    fn write_internal(&self, entries: &[EnvVarEntry]) -> Result<(), String> {
        let json = crate::secret_store::encode_protected(
            &entries,
            crate::secret_store::protect_for_current_user,
        )?;
        crate::secret_store::atomic_write(&self.storage_path, json.as_bytes())
            .map_err(|e| format!("写入环境变量失败: {}", e))
    }
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn validate_entries(entries: &[EnvVarEntry]) -> Result<(), String> {
    if let Some(entry) = entries.iter().find(|entry| !is_valid_env_key(&entry.key)) {
        return Err(format!("环境变量名无效: {}", entry.key));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shell_syntax_in_environment_variable_names() {
        let entries = vec![EnvVarEntry {
            key: "TOKEN; touch /tmp/pwned".to_string(),
            value: "secret".to_string(),
            note: String::new(),
        }];

        assert!(validate_entries(&entries).is_err());
        assert!(is_valid_env_key("OPENMINIS_TOKEN"));
        assert!(!is_valid_env_key(" OPENMINIS_TOKEN"));
        assert!(!is_valid_env_key("OPENMINIS_TOKEN "));
        assert!(!is_valid_env_key("1TOKEN"));
    }
}
