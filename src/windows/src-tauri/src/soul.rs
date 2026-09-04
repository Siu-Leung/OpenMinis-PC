//! OpenMinis Windows 灵魂与个性化人设系统 (SOUL.md)
//! 备注：Windows 测试版 (Experimental)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulConfig {
    pub name: String,
    pub instruction: String,
    pub active: bool,
}

pub struct SoulManager {
    soul_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl SoulManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            soul_path: base.join("SOUL.md"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn get_soul(&self) -> SoulConfig {
        let _guard = match self.lock.lock() {
            Ok(g) => g,
            Err(_) => return Self::default_soul(),
        };
        if !self.soul_path.exists() {
            return Self::default_soul();
        }
        let content = match std::fs::read_to_string(&self.soul_path) {
            Ok(c) => c,
            Err(_) => return Self::default_soul(),
        };
        SoulConfig {
            name: "Minis".to_string(),
            instruction: content,
            active: true,
        }
    }

    pub fn save_soul(&self, config: SoulConfig) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        std::fs::write(&self.soul_path, config.instruction)
            .map_err(|e| format!("写入 SOUL.md 失败: {}", e))
    }

    pub fn default_soul() -> SoulConfig {
        SoulConfig {
            name: "Minis".to_string(),
            instruction: "You are Minis, a capable private AI agent running directly on a Windows PC with an isolated Alpine Linux sandbox (WSL2).\n\nPersonality & Tone:\n- Be concise, direct, helpful, and take action using available tools.\n- Avoid unnecessary preamble. Directly perform the requested tasks.\n- When a tool exists for an action, call it directly instead of describing what you plan to do.\n- Work safely in the sandbox workspace at /var/minis/workspace/.".to_string(),
            active: true,
        }
    }
}
