//! OpenMinis Windows 技能扩展管理 (MinisSkills 体系)
//! 备注：Windows 测试版 (Experimental)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
}

pub struct SkillsManager {
    skills_dir: PathBuf,
    config_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl SkillsManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        let skills_dir = base.join("skills");
        std::fs::create_dir_all(&skills_dir).ok();
        let s = Self {
            skills_dir,
            config_path: base.join("skills_config.json"),
            lock: Arc::new(Mutex::new(())),
        };
        s.ensure_sample_skills();
        s
    }

    pub fn list_skills(&self) -> Vec<SkillItem> {
        let _guard = match self.lock.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let mut list = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let skill_file = path.join("SKILL.md");
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let mut desc = format!("{} 扩展技能", name);
                    if skill_file.exists() {
                        if let Ok(content) = std::fs::read_to_string(&skill_file) {
                            for line in content.lines().take(15) {
                                let t = line.trim();
                                if t.starts_with("description:") {
                                    desc = t.trim_start_matches("description:").trim().trim_matches('"').trim_matches('\'').to_string();
                                    break;
                                } else if t.starts_with('#') && !t.to_lowercase().contains("skill") && !desc.starts_with("Use when") {
                                    desc = t.trim_start_matches('#').trim().to_string();
                                }
                            }
                        }
                    }
                    list.push(SkillItem {
                        id: name.clone(),
                        name,
                        description: desc,
                        path: path.to_string_lossy().to_string(),
                        enabled: true,
                    });
                }
            }
        }
        list
    }

    pub fn get_skills_summary(&self) -> String {
        let skills = self.list_skills();
        if skills.is_empty() {
            return String::new();
        }
        let mut out = String::from("\n\nAvailable Extensible Skills:\n");
        for s in skills {
            if s.enabled {
                out.push_str(&format!("- {}: {}\n", s.name, s.description));
            }
        }
        out.push_str("When a task matches an available skill, you can inspect /var/minis/skills/<name>/SKILL.md using file_read for instructions and tools.\n");
        out
    }

    fn ensure_sample_skills(&self) {
        let sample = self.skills_dir.join("web-research");
        if !sample.exists() {
            let _ = std::fs::create_dir_all(&sample);
            let skill_md = sample.join("SKILL.md");
            let _ = std::fs::write(&skill_md, r#"---
name: web-research
description: Deep web research, article scraping, and multi-source synthesis using browser_use.
---
# Web Research Skill
Use `browser_use` with action `get_text` or `navigate` to fetch web pages, analyze citations, and produce markdown reports into `/var/minis/workspace/`.
"#);
        }
    }
}
