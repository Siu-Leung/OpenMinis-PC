//! OpenMinis Windows 持久化记忆系统 (借鉴 Hermes Agent 自我改进记忆循环)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub timestamp: String,
    pub category: MemoryCategory,
    pub content: String,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryCategory {
    UserPreference,   // 用户偏好与习惯
    ProjectContext,   // 项目上下文
    LearnedSkill,     // 从经验中学习到的技能
    ActionItem,       // 待办事项
    Fact,             // 关键事实
}

pub struct MemoryStore {
    daily_path: PathBuf,
    global_path: PathBuf,
    _lock: Arc<Mutex<()>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        let memory_dir = base.join("memory");
        std::fs::create_dir_all(&memory_dir).ok();

        let today = Local::now().format("%Y-%m-%d").to_string();
        Self {
            daily_path: memory_dir.join(format!("{}.md", today)),
            global_path: base.join("GLOBAL.md"),
            _lock: Arc::new(Mutex::new(())),
        }
    }

    /// 写入一条记忆 (借鉴 Hermes 的 agent-curated memory with periodic nudges)
    pub fn write_memory(&self, category: MemoryCategory, content: &str) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let category_str = match category {
            MemoryCategory::UserPreference => "用户偏好",
            MemoryCategory::ProjectContext => "项目上下文",
            MemoryCategory::LearnedSkill => "学习到的技能",
            MemoryCategory::ActionItem => "待办事项",
            MemoryCategory::Fact => "关键事实",
        };

        let entry = format!(
            "<!-- {} {} -->\n## {} ({}): {}\n{}\n",
            timestamp, id, category_str, id, 
            content.split('\n').take(1).collect::<Vec<_>>().join(""),
            content
        );

        // 追加到当日日志
        let mut file_content = std::fs::read_to_string(&self.daily_path).unwrap_or_default();
        file_content.push_str(&entry);
        std::fs::write(&self.daily_path, file_content)
            .map_err(|e| format!("写入记忆失败: {}", e))?;

        Ok(id)
    }

    /// 全文检索记忆 (借鉴 Hermes 的 FTS5 cross-session recall)
    pub fn search_memory(&self, query: &str) -> Result<Vec<MemoryEntry>, String> {
        let content = std::fs::read_to_string(&self.daily_path).unwrap_or_default();
        let q = query.to_lowercase();
        let mut results = Vec::new();

        // 简单的全文检索：按段落分割，匹配关键词
        for block in content.split("\n\n") {
            if block.to_lowercase().contains(&q) {
                // 提取时间戳和内容
                let id = block.lines()
                    .next()
                    .and_then(|l| l.split_whitespace().last())
                    .unwrap_or("").to_string();
                results.push(MemoryEntry {
                    id,
                    timestamp: block.lines().next().unwrap_or("").to_string(),
                    category: MemoryCategory::Fact,
                    content: block.to_string(),
                    pinned: false,
                });
            }
        }

        Ok(results)
    }

    /// 获取今日全部记忆
    pub fn get_today_memory(&self) -> Result<String, String> {
        std::fs::read_to_string(&self.daily_path)
            .map_err(|e| format!("读取记忆失败: {}", e))
    }

    /// 获取全局记忆 (GLOBAL.md)
    pub fn get_global_memory(&self) -> Result<String, String> {
        std::fs::read_to_string(&self.global_path)
            .map_err(|e| format!("读取全局记忆失败: {}", e))
    }

    /// 初始化全局记忆文件
    pub fn ensure_global_exists(&self) -> Result<(), String> {
        if !self.global_path.exists() {
            std::fs::write(&self.global_path, "# Global Memory\n\n<!-- 持久化全局偏好与约定 -->\n")
                .map_err(|e| format!("初始化全局记忆失败: {}", e))?;
        }
        Ok(())
    }
}
