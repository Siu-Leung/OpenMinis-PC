//! OpenMinis Windows 日志系统 (对标原版)
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFileInfo {
    pub name: String,
    pub size_bytes: u64,
    pub display_size: String,
    pub date_str: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogsSummary {
    pub enabled: bool,
    pub total_size_bytes: u64,
    pub total_size_display: String,
    pub files: Vec<LogFileInfo>,
}

pub fn get_logs_dir() -> PathBuf {
    let minis_home = crate::sandbox::SandboxManager::get_minis_home();
    let dir = minis_home.join("logs");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

pub fn append_log(message: &str) {
    let dir = get_logs_dir();
    let today = Local::now().format("%Y-%m-%d").to_string();
    let log_file = dir.join(format!("minis-{}.log", today));

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let line = format!("[{}] {}\n", timestamp, message);

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_file) {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn list_logs() -> Result<LogsSummary, String> {
    let dir = get_logs_dir();
    let mut files = Vec::new();
    let mut total_bytes: u64 = 0;

    // 确保至少存在今天的日志文件
    let today = Local::now().format("%Y-%m-%d").to_string();
    let today_file = dir.join(format!("minis-{}.log", today));
    if !today_file.exists() {
        append_log("OpenMinis 系统日志记录已就绪。");
    }

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if name.starts_with("minis-") && name.ends_with(".log") {
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    total_bytes += size;

                    let date_str = name
                        .trim_start_matches("minis-")
                        .trim_end_matches(".log")
                        .to_string();

                    files.push(LogFileInfo {
                        name,
                        size_bytes: size,
                        display_size: format_bytes(size),
                        date_str,
                    });
                }
            }
        }
    }

    // 按日期倒序排列（最新在前）
    files.sort_by(|a, b| b.name.cmp(&a.name));

    Ok(LogsSummary {
        enabled: true,
        total_size_bytes: total_bytes,
        total_size_display: format_bytes(total_bytes),
        files,
    })
}

pub fn read_log(name: &str) -> Result<String, String> {
    let dir = get_logs_dir();
    let file_path = dir.join(name);
    if !file_path.exists() {
        return Err("日志文件不存在".to_string());
    }
    let mut f = File::open(file_path).map_err(|e| format!("打开失败: {}", e))?;
    let mut content = String::new();
    f.read_to_string(&mut content).map_err(|e| format!("读取失败: {}", e))?;
    Ok(content)
}

pub fn delete_all_logs() -> Result<(), String> {
    let dir = get_logs_dir();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let _ = fs::remove_file(path);
            }
        }
    }
    append_log("已清空所有历史日志文件。");
    Ok(())
}
