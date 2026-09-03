//! OpenMinis Windows 模型分组与回退系统 (纯净开箱版)
//! 备注：私人用极度不稳定 Aicoding 改

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelGroupItem {
    pub id: String,
    pub name: String,
    pub is_primary: bool,
    pub fallback_models: Vec<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultsConfig {
    pub default_primary_group: String,
    pub default_sub_model: String,
    pub voice_input: String,
    pub voice_output: String,
    pub vision_input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLoopModelEntry {
    pub id: String,
    pub name: String,
    pub is_group: bool,
    pub model_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullModelGroupsState {
    pub groups: Vec<ModelGroupItem>,
    pub defaults: DefaultsConfig,
    pub agent_loop_models: Vec<AgentLoopModelEntry>,
}

pub struct ModelGroupManager {
    storage_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl ModelGroupManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            storage_path: base.join("model_groups.json"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn get_state(&self) -> FullModelGroupsState {
        let Ok(_guard) = self.lock.lock() else {
            return Self::empty_state();
        };
        self.load_internal()
    }

    pub fn save_state(&self, state: FullModelGroupsState) -> Result<(), String> {
        let Ok(_guard) = self.lock.lock() else {
            return Err("获取锁失败".to_string());
        };
        let json = serde_json::to_string_pretty(&state)
            .map_err(|e| format!("序列化模型组失败: {}", e))?;
        std::fs::write(&self.storage_path, json)
            .map_err(|e| format!("写入模型组存储失败: {}", e))?;
        Ok(())
    }

    fn empty_state() -> FullModelGroupsState {
        FullModelGroupsState {
            groups: Vec::new(),
            defaults: DefaultsConfig {
                default_primary_group: "无".to_string(),
                default_sub_model: "无".to_string(),
                voice_input: "无".to_string(),
                voice_output: "无".to_string(),
                vision_input: "无".to_string(),
            },
            agent_loop_models: Vec::new(),
        }
    }

    fn load_internal(&self) -> FullModelGroupsState {
        if !self.storage_path.exists() {
            return Self::empty_state();
        }
        let Ok(content) = std::fs::read_to_string(&self.storage_path) else {
            return Self::empty_state();
        };
        serde_json::from_str(&content).unwrap_or_else(|_| Self::empty_state())
    }
}
