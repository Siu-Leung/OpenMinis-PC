//! OpenMinis Windows 定时任务调度 (借鉴 Hermes Cron & AionUi 24/7 Automation)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::{Local, Datelike, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub time: String,          // "HH:MM" 格式
    pub repeat: TaskRepeat,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub days: Vec<String>,     // 仅 repeat=custom: ["mon","wed","fri"]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskRepeat {
    Once,
    Daily,
    Weekdays,
    Custom,
}

pub struct CronScheduler {
    tasks_path: PathBuf,
    _lock: Arc<Mutex<()>>,
}

impl CronScheduler {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            tasks_path: base.join("scheduled_tasks.json"),
            _lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn add_task(&self, task: ScheduledTask) -> Result<(), String> {
        let mut tasks = self.load_all()?;
        tasks.push(task);
        self.write_all(&tasks)
    }

    pub fn remove_task(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.load_all()?;
        tasks.retain(|t| t.id != id);
        self.write_all(&tasks)
    }

    pub fn toggle_task(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.load_all()?;
        if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
            t.enabled = !t.enabled;
        }
        self.write_all(&tasks)
    }

    pub fn list_tasks(&self) -> Result<Vec<ScheduledTask>, String> {
        self.load_all()
    }

    /// 检查当前时间是否有任务需要触发
    pub fn check_due_tasks(&self) -> Result<Vec<ScheduledTask>, String> {
        let now = Local::now();
        let now_str = format!("{:02}:{:02}", now.hour(), now.minute());
        let weekday = now.weekday();
        let tasks = self.load_all()?;

        Ok(tasks.into_iter()
            .filter(|t| {
                if !t.enabled { return false; }
                if t.time != now_str { return false; }

                match t.repeat {
                    TaskRepeat::Daily => true,
                    TaskRepeat::Weekdays => weekday != Weekday::Sat && weekday != Weekday::Sun,
                    TaskRepeat::Once => true,
                    TaskRepeat::Custom => {
                        let day_str = match weekday {
                            Weekday::Mon => "mon", Weekday::Tue => "tue", Weekday::Wed => "wed",
                            Weekday::Thu => "thu", Weekday::Fri => "fri", Weekday::Sat => "sat",
                            Weekday::Sun => "sun",
                        };
                        t.days.iter().any(|d| d == day_str)
                    }
                }
            })
            .collect())
    }

    /// 标记任务已执行
    pub fn mark_run(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.load_all()?;
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
            t.last_run = Some(now);
            if matches!(t.repeat, TaskRepeat::Once) {
                t.enabled = false;
            }
        }
        self.write_all(&tasks)
    }

    fn load_all(&self) -> Result<Vec<ScheduledTask>, String> {
        if !self.tasks_path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.tasks_path)
            .map_err(|e| format!("读取定时任务失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| Vec::new())
    }

    fn write_all(&self, tasks: &[ScheduledTask]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(tasks)
            .map_err(|e| format!("序列化任务失败: {}", e))?;
        std::fs::write(&self.tasks_path, json)
            .map_err(|e| format!("写入任务存储失败: {}", e))?;
        Ok(())
    }
}
