//! OpenMinis Windows 会话持久化与全文检索 (完全加固版)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::{Local, NaiveDateTime, TimeZone};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    #[serde(deserialize_with = "deserialize_timestamp_ms")]
    pub created_at: i64,
    #[serde(default, deserialize_with = "deserialize_optional_timestamp_ms")]
    pub updated_at: i64,
    pub message_count: usize,
    pub preview: String,
}

fn parse_timestamp_ms(value: &serde_json::Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(if number.abs() < 10_000_000_000 {
            number * 1000
        } else {
            number
        });
    }
    let text = value.as_str()?.trim();
    if let Ok(number) = text.parse::<i64>() {
        return Some(if number.abs() < 10_000_000_000 {
            number * 1000
        } else {
            number
        });
    }
    NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .ok()
        .and_then(|naive| Local.from_local_datetime(&naive).single())
        .map(|date| date.timestamp_millis())
}

fn deserialize_timestamp_ms<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    parse_timestamp_ms(&value).ok_or_else(|| serde::de::Error::custom("invalid session timestamp"))
}

fn deserialize_optional_timestamp_ms<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(parse_timestamp_ms(&value).unwrap_or_default())
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
            Some(existing) if Self::is_valid_session_id(existing) => existing.to_string(),
            Some(_) => return Err("会话 ID 非法".to_string()),
            None => uuid::Uuid::new_v4().to_string(),
        };

        let mut sessions = self.load_all_internal()?;
        let now = Local::now().timestamp_millis();
        let created_at = sessions
            .iter()
            .find(|session| session.id == id)
            .map(|session| session.created_at)
            .unwrap_or(now);
        let title = messages
            .iter()
            .find(|m| m.role == "user")
            .map(|m| m.content.chars().take(50).collect::<String>())
            .unwrap_or_else(|| "新会话".to_string());
        let preview = messages
            .iter()
            .find(|m| m.role == "assistant")
            .map(|m| m.content.chars().take(100).collect::<String>())
            .unwrap_or_default();

        let record = SessionRecord {
            id: id.clone(),
            title,
            created_at,
            updated_at: now,
            message_count: messages.len(),
            preview,
        };

        // 1. 保存完整消息到独立文件
        let msg_file = self.sessions_dir.join(format!("{}.json", id));
        let msg_json = serde_json::to_string_pretty(messages)
            .map_err(|e| format!("序列化完整会话消息失败: {}", e))?;
        Self::atomic_write(&msg_file, msg_json.as_bytes())
            .map_err(|e| format!("写入会话消息失败: {}", e))?;

        // 2. 更新索引
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
        if !Self::is_valid_session_id(id) {
            return Err("会话 ID 非法".to_string());
        }
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let msg_file = self.sessions_dir.join(format!("{}.json", id));
        if !msg_file.exists() {
            return Err("未找到该会话的历史消息文件".to_string());
        }
        let content =
            std::fs::read_to_string(&msg_file).map_err(|e| format!("读取会话消息失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析会话消息失败: {}", e))
    }

    /// 全文检索历史会话
    pub fn search_sessions(&self, query: &str) -> Result<Vec<SessionRecord>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let sessions = self.load_all_internal()?;
        let q = query.to_lowercase();
        Ok(sessions
            .into_iter()
            .filter(|s| {
                s.title.to_lowercase().contains(&q) || s.preview.to_lowercase().contains(&q)
            })
            .collect())
    }

    /// 列出所有会话
    pub fn list_sessions(&self) -> Result<Vec<SessionRecord>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        self.load_all_internal()
    }

    /// 重命名指定会话
    pub fn rename_session(&self, id: &str, new_title: &str) -> Result<(), String> {
        if !Self::is_valid_session_id(id) {
            return Err("会话 ID 非法".to_string());
        }
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
        if !Self::is_valid_session_id(id) {
            return Err("会话 ID 非法".to_string());
        }
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut sessions = self.load_all_internal()?;
        let target = sessions
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| "未找到目标会话".to_string())?;

        let new_id = uuid::Uuid::new_v4().to_string();
        let new_title = format!("{} (副本)", target.title);
        let now = Local::now().timestamp_millis();

        let new_record = SessionRecord {
            id: new_id.clone(),
            title: new_title,
            created_at: now,
            updated_at: now,
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
        if !Self::is_valid_session_id(id) {
            return Err("会话 ID 非法".to_string());
        }
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut sessions = self.load_all_internal()?;
        sessions.retain(|s| s.id != id);
        self.write_all_internal(&sessions)?;

        let msg_file = self.sessions_dir.join(format!("{}.json", id));
        let _ = std::fs::remove_file(msg_file);

        Ok(())
    }

    fn is_valid_session_id(id: &str) -> bool {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }

    fn load_all_internal(&self) -> Result<Vec<SessionRecord>, String> {
        if !self.db_path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.db_path)
            .map_err(|e| format!("读取会话存储失败: {}", e))?;
        let mut sessions: Vec<SessionRecord> =
            serde_json::from_str(&content).map_err(|e| format!("解析会话存储失败: {}", e))?;
        for session in &mut sessions {
            if session.updated_at <= 0 {
                session.updated_at = session.created_at;
            }
        }
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let mut seen = HashSet::new();
        sessions.retain(|session| seen.insert(session.id.clone()));
        Ok(sessions)
    }

    fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), std::io::Error> {
        let temp_path = path.with_extension(format!(
            "{}.tmp",
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or("data")
        ));
        std::fs::write(&temp_path, bytes)?;
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        std::fs::rename(temp_path, path)
    }

    fn write_all_internal(&self, sessions: &[SessionRecord]) -> Result<(), String> {
        let json =
            serde_json::to_string_pretty(sessions).map_err(|e| format!("序列化会话失败: {}", e))?;
        Self::atomic_write(&self.db_path, json.as_bytes())
            .map_err(|e| format!("提交会话存储失败: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_string_timestamp_deserializes_to_milliseconds() {
        let record: SessionRecord = serde_json::from_str(
            r#"{"id":"abc","title":"t","created_at":"2026-09-05 08:00:00","message_count":1,"preview":"p"}"#,
        ).unwrap();
        assert!(record.created_at > 1_000_000_000_000);
        assert_eq!(record.updated_at, 0);
    }

    #[test]
    fn numeric_seconds_are_normalized_to_milliseconds() {
        assert_eq!(
            parse_timestamp_ms(&json!(1_700_000_000)),
            Some(1_700_000_000_000)
        );
        assert_eq!(
            parse_timestamp_ms(&json!(1_700_000_000_000_i64)),
            Some(1_700_000_000_000)
        );
    }

    #[test]
    fn session_ids_reject_path_traversal() {
        assert!(SessionStore::is_valid_session_id("s_abc-123"));
        assert!(!SessionStore::is_valid_session_id("../sessions"));
        assert!(!SessionStore::is_valid_session_id("a/b"));
        assert!(!SessionStore::is_valid_session_id(""));
    }
}
