//! OpenMinis Windows 供应商管理 (后端统一存储, 供前端加载 + Agent 工具读写)
//! 对标原版 ProviderConfigStore: 供应商是 Agent 可读写的持久化实体
//! 备注：Windows 测试版 (Experimental)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub id: String,
    pub name: String,
    pub provider_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    #[serde(default)]
    pub provider_type: Option<String>,
    #[serde(default)]
    pub auto_append_v1: Option<bool>,
    #[serde(default)]
    pub custom_user_agent: Option<String>,
    #[serde(default)]
    pub api_format: Option<String>,
    #[serde(default)]
    pub is_azure: Option<bool>,
    #[serde(default)]
    pub image_generation: Option<String>,
    #[serde(default)]
    pub latency_ms: Option<u64>,
}

/// 提供给 Agent 的供应商摘要 (不含 API Key, 避免泄露给模型)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSummary {
    pub id: String,
    pub name: String,
    pub provider_url: String,
    pub models: Vec<String>,
    pub provider_type: Option<String>,
    pub auto_append_v1: Option<bool>,
}

impl ProviderRecord {
    pub fn to_summary(&self) -> ProviderSummary {
        ProviderSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            provider_url: self.provider_url.clone(),
            models: self.models.clone(),
            provider_type: self.provider_type.clone(),
            auto_append_v1: self.auto_append_v1,
        }
    }
}

pub struct ProviderManager {
    storage_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl ProviderManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            storage_path: base.join("providers.json"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_providers(&self) -> Result<Vec<ProviderRecord>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        self.load_all_internal()
    }

    /// 仅供 Agent 查询: 返回脱敏摘要 (不含 API Key)
    pub fn list_provider_summaries(&self) -> Result<Vec<ProviderSummary>, String> {
        let providers = self.list_providers()?;
        Ok(providers.iter().map(|p| p.to_summary()).collect())
    }

    pub fn save_providers(&self, providers: Vec<ProviderRecord>) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        self.write_all_internal(&providers)
    }

    pub fn add_provider(&self, mut provider: ProviderRecord) -> Result<ProviderRecord, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut providers = self.load_all_internal()?;

        // 生成唯一 id
        if provider.id.trim().is_empty() {
            provider.id = uuid::Uuid::new_v4().to_string();
        }
        // 同名去重: 若已存在同名供应商则更新
        if let Some(pos) = providers.iter().position(|p| p.name == provider.name) {
            providers[pos] = provider.clone();
        } else {
            providers.push(provider.clone());
        }
        self.write_all_internal(&providers)?;
        Ok(provider)
    }

    pub fn remove_provider(&self, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut providers = self.load_all_internal()?;
        providers.retain(|p| p.id != id);
        self.write_all_internal(&providers)
    }

    fn load_all_internal(&self) -> Result<Vec<ProviderRecord>, String> {
        if !self.storage_path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.storage_path)
            .map_err(|e| format!("读取供应商存储失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析供应商存储失败: {}", e))
    }

    fn write_all_internal(&self, providers: &[ProviderRecord]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(providers)
            .map_err(|e| format!("序列化供应商失败: {}", e))?;
        std::fs::write(&self.storage_path, json)
            .map_err(|e| format!("写入供应商存储失败: {}", e))?;
        Ok(())
    }
}
