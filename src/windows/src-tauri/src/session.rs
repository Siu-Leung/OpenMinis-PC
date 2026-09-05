//! OpenMinis Windows 会话持久化与全文检索 (完全加固版)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
    sessions_dir: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl SessionStore {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        let sessions_dir = base.join("sessions");
        std::fs::create_dir_all(&sessions_dir).ok();
        Self {
            db_path: base.join("sessions.json"),
            sessions_dir,
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// 保存会话：索引存入 sessions.json，完整消息存入 sessions/{id}.json
    pub fn save_session(
        &self,
        session_id: Option<&str>,
        messages: &[super::ChatMessage],
    ) -> Result<String, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;

        let id = match session_id {
            Some(existing) if !existing.trim().is_empty() => existing.to_string(),
            _ => uuid::Uuid::new_v4().to_string()[..8].to_string(),
        };

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let title = messages.iter()
            .find(|m| m.role == "user")
            .map(|m| m.content.chars().take(50).collect::<String>())
            .unwrap_or_else(|| "新会话".to_string());
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

        // 1. 保存完整消息到独立文件
        let msg_file = self.sessions_dir.join(format!("{}.json", id));
        let msg_json = serde_json::to_string_pretty(messages)
            .map_err(|e| format!("序列化完整会话消息失败: {}", e))?;
        std::fs::write(&msg_file, msg_json)
            .map_err(|e| format!("写入会话消息失败: {}", e))?;

        // 2. 更新索引
        let mut sessions = self.load_all_internal()?;
        // 若已存在则更新，不存在则头部插入
        if let Some(pos) = sessions.iter().position(|s| s.id == id) {
            sessions[pos] = record;
        } else {
            sessions.insert(0, record);
        }
        sessions.truncate(200);
        self.write_all_internal(&sessions)?;

        Ok(id)
    }

    /// 加载指定会话的全部历史消息 (支持在前端一键恢复对话)
    pub fn get_session_messages(&self, id: &str) -> Result<Vec<super::ChatMessage>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let msg_file = self.sessions_dir.join(format!("{}.json", id));
        if !msg_file.exists() {
            return Err("未找到该会话的历史消息文件".to_string());
        }
        let content = std::fs::read_to_string(&msg_file)
            .map_err(|e| format!("读取会话消息失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析会话消息失败: {}", e))
    }

    /// 全文检索历史会话
    pub fn search_sessions(&self, query: &str) -> Result<Vec<SessionRecord>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let sessions = self.load_all_internal()?;
        let q = query.to_lowercase();
        Ok(sessions.into_iter()
            .filter(|s| s.title.to_lowercase().contains(&q) || s.preview.to_lowercase().contains(&q))
            .collect())
    }

    /// 列出所有会话
    pub fn list_sessions(&self) -> Result<Vec<SessionRecord>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        self.load_all_internal()
    }

    /// 重命名指定会话
    pub fn rename_session(&self, id: &str, new_title: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut sessions = self.load_all_internal()?;
        if let Some(s) = sessions.iter_mut().find(|s| s.id == id) {
            s.title = new_title.to_string();
        }
        self.write_all_internal(&sessions)?;
        Ok(())
    }

    /// 克隆/复制会话副本 (1:1 原版 Duplicate)
    pub fn duplicate_session(&self, id: &str) -> Result<SessionRecord, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut sessions = self.load_all_internal()?;
        let target = sessions.iter().find(|s| s.id == id).cloned()
            .ok_or_else(|| "未找到目标会话".to_string())?;

        let new_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let new_title = format!("{} (副本)", target.title);
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let new_record = SessionRecord {
            id: new_id.clone(),
            title: new_title,
            created_at: now,
            message_count: target.message_count,
            preview: target.preview,
        };

        // 复制历史消息文件
        let src_file = self.sessions_dir.join(format!("{}.json", id));
        let dst_file = self.sessions_dir.join(format!("{}.json", new_id));
        if src_file.exists() {
            let _ = std::fs::copy(&src_file, &dst_file);
        }

        sessions.insert(0, new_record.clone());
        self.write_all_internal(&sessions)?;

        Ok(new_record)
    }

    /// 删除指定会话
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut sessions = self.load_all_internal()?;
        sessions.retain(|s| s.id != id);
        self.write_all_internal(&sessions)?;

        let msg_file = self.sessions_dir.join(format!("{}.json", id));
        let _ = std::fs::remove_file(msg_file);

        Ok(())
    }

    fn load_all_internal(&self) -> Result<Vec<SessionRecord>, String> {
        if !self.db_path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.db_path)
            .map_err(|e| format!("读取会话存储失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析会话存储失败: {}", e))
    }

    fn write_all_internal(&self, sessions: &[SessionRecord]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(sessions)
            .map_err(|e| format!("序列化会话失败: {}", e))?;
        std::fs::write(&self.db_path, json)
            .map_err(|e| format!("写入会话存储失败: {}", e))?;
        Ok(())
    }
}
