//! OpenMinis Windows 会话持久化与全文检索 (借鉴 Hermes FTS5 session search)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub message_count: usize,
    pub preview: String,
}

pub struct SessionStore {
    db_path: PathBuf,
    _lock: Arc<Mutex<()>>,
}

impl SessionStore {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            db_path: base.join("sessions.json"),
            _lock: Arc::new(Mutex::new(())),
        }
    }

    /// 保存一轮对话到会话存储
    pub fn save_session(&self, messages: &[super::ChatMessage]) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let title = messages.iter()
            .find(|m| m.role == "user")
            .map(|m| m.content.chars().take(50).collect::<String>())
            .unwrap_or_else(|| "Untitled".to_string());
        let preview = messages.iter()
            .find(|m| m.role == "assistant")
            .map(|m| m.content.chars().take(100).collect::<String>())
            .unwrap_or_default();

        let record = SessionRecord {
            id: id.clone(),
            title,
            created_at: now,
            message_count: messages.len(),
            preview,
        };

        let mut sessions = self.load_all()?;
        sessions.insert(0, record);
        // 保留最近 200 条
        sessions.truncate(200);
        self.write_all(&sessions)?;
        Ok(id)
    }

    /// 全文检索历史会话 (借鉴 Hermes 的 cross-session recall)
    pub fn search_sessions(&self, query: &str) -> Result<Vec<SessionRecord>, String> {
        let sessions = self.load_all()?;
        let q = query.to_lowercase();
        Ok(sessions.into_iter()
            .filter(|s| s.title.to_lowercase().contains(&q) || s.preview.to_lowercase().contains(&q))
            .collect())
    }

    /// 列出所有会话
    pub fn list_sessions(&self) -> Result<Vec<SessionRecord>, String> {
        self.load_all()
    }

    /// 删除指定会话
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.load_all()?;
        sessions.retain(|s| s.id != id);
        self.write_all(&sessions)
    }

    fn load_all(&self) -> Result<Vec<SessionRecord>, String> {
        if !self.db_path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.db_path)
            .map_err(|e| format!("读取会话存储失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| Vec::new())
    }

    fn write_all(&self, sessions: &[SessionRecord]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(sessions)
            .map_err(|e| format!("序列化会话失败: {}", e))?;
        std::fs::write(&self.db_path, json)
            .map_err(|e| format!("写入会话存储失败: {}", e))?;
        Ok(())
    }
}
