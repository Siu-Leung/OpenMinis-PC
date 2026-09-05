//! OpenMinis Windows 技能扩展管理 (MinisSkills 体系 - 沙箱与宿主双向同步版)
//! 备注：OpenMinis Windows 体验版

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
    distro_name: String,
    lock: Arc<Mutex<()>>,
}

impl SkillsManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        let skills_dir = base.join("skills");
        std::fs::create_dir_all(&skills_dir).ok();
        Self {
            skills_dir,
            distro_name: "OpenMinisSandbox".to_string(),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// 从 SKILL.md 提取技能描述
    fn parse_skill_desc(content: &str, default_desc: &str) -> String {
        for line in content.lines().take(25) {
            let t = line.trim();
            if t.starts_with("description:") {
                let d = t.trim_start_matches("description:").trim().trim_matches('"').trim_matches('\'').to_string();
                if !d.is_empty() {
                    return d;
                }
            } else if t.starts_with('#') && !t.to_lowercase().contains("skill") {
                let d = t.trim_start_matches('#').trim().to_string();
                if !d.is_empty() {
                    return d;
                }
            }
        }
        default_desc.to_string()
    }

    /// 全量扫描技能：同时读取沙箱 /var/minis/skills 与宿主机本地 skills 目录
    pub fn list_skills(&self) -> Vec<SkillItem> {
        let _guard = match self.lock.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };

        let mut map: std::collections::HashMap<String, SkillItem> = std::collections::HashMap::new();

        // 1. 优先扫描 WSL2 沙箱内部技能目录 (UNC: \\wsl$\OpenMinisSandbox\var\minis\skills)
        let wsl_unc_skills = PathBuf::from(format!(r"\\wsl$\{}\var\minis\skills", self.distro_name));
        if wsl_unc_skills.exists() {
            if let Ok(entries) = std::fs::read_dir(&wsl_unc_skills) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let skill_file = p.join("SKILL.md");
                        let default_desc = format!("{} 沙箱扩展技能", name);
                        let desc = if skill_file.exists() {
                            std::fs::read_to_string(&skill_file)
                                .map(|c| Self::parse_skill_desc(&c, &default_desc))
                                .unwrap_or(default_desc)
                        } else {
                            default_desc
                        };
                        map.insert(name.clone(), SkillItem {
                            id: name.clone(),
                            name,
                            description: desc,
                            path: format!("/var/minis/skills/{}", p.file_name().unwrap_or_default().to_string_lossy()),
                            enabled: true,
                        });
                    }
                }
            }
        }

        // 2. 如果 UNC 未扫到沙箱技能，通过 wsl 命令直接探测 /var/minis/skills/*/SKILL.md
        if map.is_empty() {
            let mut cmd = std::process::Command::new("wsl");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.args([
                "-d", &self.distro_name, "-u", "root",
                "--", "/bin/sh", "-c",
                "for d in /var/minis/skills/*; do if [ -d \"$d\" ]; then n=$(basename \"$d\"); desc=$(grep -m 1 '^description:' \"$d/SKILL.md\" 2>/dev/null | cut -d: -f2-); echo \"$n|||$desc\"; fi; done"
            ]);
            if let Ok(out) = cmd.output() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split("|||").collect();
                    if !parts.is_empty() {
                        let name = parts[0].trim().to_string();
                        if !name.is_empty() && name != "*" {
                            let raw_desc = if parts.len() > 1 { parts[1].trim().trim_matches('"').trim_matches('\'') } else { "" };
                            let desc = if raw_desc.is_empty() { format!("{} 沙箱技能", name) } else { raw_desc.to_string() };
                            map.insert(name.clone(), SkillItem {
                                id: name.clone(),
                                name: name.clone(),
                                description: desc,
                                path: format!("/var/minis/skills/{}", name),
                                enabled: true,
                            });
                        }
                    }
                }
            }
        }

        // 3. 补充扫描 Windows 宿主机本地技能目录 (AppData)
        if let Ok(entries) = std::fs::read_dir(&self.skills_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if !map.contains_key(&name) {
                        let skill_file = p.join("SKILL.md");
                        let default_desc = format!("{} 本地扩展技能", name);
                        let desc = if skill_file.exists() {
                            std::fs::read_to_string(&skill_file)
                                .map(|c| Self::parse_skill_desc(&c, &default_desc))
                                .unwrap_or(default_desc)
                        } else {
                            default_desc
                        };
                        map.insert(name.clone(), SkillItem {
                            id: name.clone(),
                            name,
                            description: desc,
                            path: p.to_string_lossy().to_string(),
                            enabled: true,
                        });
                    }
                }
            }
        }

        let mut list: Vec<SkillItem> = map.into_values().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
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
}
