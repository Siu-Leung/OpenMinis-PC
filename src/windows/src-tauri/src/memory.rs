//! OpenMinis Windows 持久化记忆系统 (跨天动态感知与全库检索加固版)
//! 备注：Windows 测试版 (Experimental)

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub timestamp: String,
    pub category: MemoryCategory,
    pub content: String,
    pub source_file: String,
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
    pub memory_dir: PathBuf,
    pub global_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        let memory_dir = base.join("memory");
        std::fs::create_dir_all(&memory_dir).ok();

        Self {
            memory_dir,
            global_path: base.join("GLOBAL.md"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// 动态计算当日记忆日志路径（杜绝跨午夜运行时日期锁死在昨天的 Bug）
    fn get_daily_path(&self) -> PathBuf {
        let today = Local::now().format("%Y-%m-%d").to_string();
        self.memory_dir.join(format!("{}.md", today))
    }

    /// 写入一条记忆
    pub fn write_memory(&self, category: MemoryCategory, content: &str) -> Result<String, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;

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
            "<!-- {} {} -->\n## {} ({}): {}\n{}\n\n",
            timestamp, id, category_str, id, 
            content.lines().next().unwrap_or(""),
            content
        );

        let target_file = self.get_daily_path();
        let mut file_content = std::fs::read_to_string(&target_file).unwrap_or_default();
        file_content.push_str(&entry);
        std::fs::write(&target_file, file_content)
            .map_err(|e| format!("写入记忆失败: {}", e))?;

        Ok(id)
    }

    /// 全文检索记忆：深度扫描全部历史日常记忆库与 GLOBAL.md 全局记忆
    pub fn search_memory(&self, query: &str) -> Result<Vec<MemoryEntry>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let q = query.to_lowercase();
        let mut results = Vec::new();

        // 1. 扫描 memory/ 目录下所有的历史日期记录
        if let Ok(entries) = std::fs::read_dir(&self.memory_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        for block in content.split("\n\n") {
                            let trimmed = block.trim();
                            if !trimmed.is_empty() && trimmed.to_lowercase().contains(&q) {
                                results.push(MemoryEntry {
                                    id: filename.clone(),
                                    timestamp: filename.replace(".md", ""),
                                    category: MemoryCategory::Fact,
                                    content: trimmed.to_string(),
                                    source_file: filename.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // 2. 扫描 GLOBAL.md 全局持久记忆
        if self.global_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&self.global_path) {
                if content.to_lowercase().contains(&q) {
                    results.push(MemoryEntry {
                        id: "GLOBAL".to_string(),
                        timestamp: "Global".to_string(),
                        category: MemoryCategory::UserPreference,
                        content: content.trim().to_string(),
                        source_file: "GLOBAL.md".to_string(),
                    });
                }
            }
        }

        Ok(results)
    }

    /// 获取今日全部记忆
    pub fn get_today_memory(&self) -> Result<String, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let path = self.get_daily_path();
        if !path.exists() {
            return Ok("今日暂无记录".to_string());
        }
        std::fs::read_to_string(&path).map_err(|e| format!("读取记忆失败: {}", e))
    }

    /// 获取全局记忆 (GLOBAL.md)
    pub fn get_global_memory(&self) -> Result<String, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        if !self.global_path.exists() {
            return Ok("# Global Memory\n\n<!-- 跨会话长期持久化偏好与关键事实 -->\n".to_string());
        }
        std::fs::read_to_string(&self.global_path).map_err(|e| format!("读取全局记忆失败: {}", e))
    }

    /// 保存全局记忆 (GLOBAL.md)
    pub fn save_global_memory(&self, content: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        std::fs::write(&self.global_path, content)
            .map_err(|e| format!("写入全局记忆失败: {}", e))
    }

    /// 初始化确保全局记忆文件存在
    pub fn ensure_global_exists(&self) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        if !self.global_path.exists() {
            let _ = std::fs::write(&self.global_path, "# Global Memory\n\n<!-- 跨会话长期持久化偏好与关键事实 -->\n");
        }
        Ok(())
    }

    /// 获取 1:1 对标原版的记忆自动注入片段 (GLOBAL.md + 最近 3 天日志)
    pub fn get_recent_memories_fragment(&self) -> String {
        let mut fragment = String::new();

        // 1. GLOBAL.md 全局记忆
        if self.global_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&self.global_path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() && trimmed != "# Global Memory" {
                    fragment.push_str("\n\nGlobal memory (GLOBAL.md — user-maintained facts & preferences):\n");
                    fragment.push_str(trimmed);
                    fragment.push('\n');
                }
            }
        }

        // 2. 最近 3 天历史日志
        let mut daily_files: Vec<PathBuf> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.memory_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) == Some("md") {
                    daily_files.push(p);
                }
            }
        }
        daily_files.sort();
        daily_files.reverse(); // 从最新到最旧

        let recent_3: Vec<_> = daily_files.into_iter().take(3).collect();
        if !recent_3.is_empty() {
            fragment.push_str("\nRecent memories (auto-injected from daily logs):\n");
            for file_path in recent_3 {
                let filename = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if let Ok(content) = std::fs::read_to_string(&file_path) {
                    let lines: Vec<&str> = content.lines().take(100).collect();
                    if !lines.is_empty() {
                        fragment.push_str(&format!("--- Daily log ({}) ---\n", filename));
                        fragment.push_str(&lines.join("\n"));
                        fragment.push('\n');
                    }
                }
            }
        }

        fragment
    }
}
