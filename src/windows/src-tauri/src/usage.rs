//! OpenMinis Windows 真实 Token 用量统计跟踪器 (对标截图 1000143344/1000143345)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SingleUsageRecord {
    pub timestamp: i64,
    pub model_id: String,
    pub provider_id: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelUsageSummary {
    pub model_id: String,
    pub provider_id: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    pub display_input: String,
    pub display_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotalUsageDashboard {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_tokens: u64,
    pub cache_hit_rate_pct: f64,
    pub display_total_input: String,
    pub display_total_output: String,
    pub display_cached_read: String,
    pub display_hit_rate: String,
    pub model_rankings: Vec<ModelUsageSummary>,
}

pub struct UsageTracker {
    storage_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl UsageTracker {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            storage_path: base.join("token_usage.json"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// 记录一次大模型交互的 Token 消耗
    pub fn record_usage(
        &self,
        model_id: &str,
        provider_id: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        cached_tokens: u64,
    ) {
        let Ok(_guard) = self.lock.lock() else { return };
        let mut records = self.load_internal();
        records.push(SingleUsageRecord {
            timestamp: Local::now().timestamp(),
            model_id: model_id.to_string(),
            provider_id: provider_id.to_string(),
            prompt_tokens,
            completion_tokens,
            cached_tokens,
        });

        // 写入本地持久化
        if let Ok(json) = serde_json::to_string_pretty(&records) {
            let _ = std::fs::write(&self.storage_path, json);
        }
    }

    /// 获取仪表盘汇总数据 (1:1 原版用量算法)
    pub fn get_dashboard_summary(&self) -> TotalUsageDashboard {
        let Ok(_guard) = self.lock.lock() else {
            return Self::empty_dashboard();
        };
        let records = self.load_internal();

        let mut total_input: u64 = 0;
        let mut total_output: u64 = 0;
        let mut total_cached: u64 = 0;

        let mut model_map: HashMap<String, (String, u64, u64, u64)> = HashMap::new();

        for r in records {
            total_input += r.prompt_tokens;
            total_output += r.completion_tokens;
            total_cached += r.cached_tokens;

            let entry = model_map.entry(r.model_id.clone()).or_insert((r.provider_id.clone(), 0, 0, 0));
            entry.1 += r.prompt_tokens;
            entry.2 += r.completion_tokens;
            entry.3 += r.cached_tokens;
        }

        let hit_rate = if total_input > 0 {
            (total_cached as f64 / total_input as f64) * 100.0
        } else {
            0.0
        };

        let mut model_rankings: Vec<ModelUsageSummary> = model_map
            .into_iter()
            .map(|(model_id, (provider_id, p_tokens, c_tokens, cached))| ModelUsageSummary {
                model_id,
                provider_id,
                prompt_tokens: p_tokens,
                completion_tokens: c_tokens,
                cached_tokens: cached,
                display_input: format_token_count(p_tokens),
                display_output: format_token_count(c_tokens),
            })
            .collect();

        // 按消耗量从大到小排序
        model_rankings.sort_by(|a, b| b.prompt_tokens.cmp(&a.prompt_tokens));

        TotalUsageDashboard {
            total_input_tokens: total_input,
            total_output_tokens: total_output,
            total_cached_tokens: total_cached,
            cache_hit_rate_pct: hit_rate,
            display_total_input: format_token_count(total_input),
            display_total_output: format_token_count(total_output),
            display_cached_read: format_token_count(total_cached),
            display_hit_rate: format!("{:.1}%", hit_rate),
            model_rankings,
        }
    }

    fn empty_dashboard() -> TotalUsageDashboard {
        TotalUsageDashboard {
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cached_tokens: 0,
            cache_hit_rate_pct: 0.0,
            display_total_input: "0".to_string(),
            display_total_output: "0".to_string(),
            display_cached_read: "0".to_string(),
            display_hit_rate: "0.0%".to_string(),
            model_rankings: Vec::new(),
        }
    }

    fn load_internal(&self) -> Vec<SingleUsageRecord> {
        if !self.storage_path.exists() {
            return Vec::new();
        }
        let Ok(content) = std::fs::read_to_string(&self.storage_path) else {
            return Vec::new();
        };
        serde_json::from_str(&content).unwrap_or_default()
    }
}

/// 格式化为与原版截图完全一致的 1601.3M / 571.7k 样式
fn format_token_count(tokens: u64) -> String {
    if tokens >= 1_000_000_000 {
        format!("{:.1}B", tokens as f64 / 1_000_000_000.0)
    } else if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}k", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}
