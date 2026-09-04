//! OpenMinis Windows MCP (Model Context Protocol) 扩展管理
//! 备注：私人用极度不稳定 Aicoding 改

use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub server_type: String, // "stdio" | "sse" | "http"
    pub command_or_url: String,
    pub enabled: bool,
    pub tools_count: usize,
    pub description: Option<String>,
}

pub struct McpManager {
    config_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl McpManager {
    pub fn new() -> Self {
        let base = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("data"));
        std::fs::create_dir_all(&base).ok();
        Self {
            config_path: base.join("mcp_servers.json"),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_servers(&self) -> Result<Vec<McpServer>, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        self.load_all_internal()
    }

    pub fn add_server(&self, server: McpServer) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut servers = self.load_all_internal()?;
        servers.push(server);
        self.write_all_internal(&servers)
    }

    pub fn remove_server(&self, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut servers = self.load_all_internal()?;
        servers.retain(|s| s.id != id);
        self.write_all_internal(&servers)
    }

    pub fn toggle_server(&self, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut servers = self.load_all_internal()?;
        if let Some(s) = servers.iter_mut().find(|s| s.id == id) {
            s.enabled = !s.enabled;
        }
        self.write_all_internal(&servers)
    }

    fn load_all_internal(&self) -> Result<Vec<McpServer>, String> {
        if !self.config_path.exists() {
            // 预设默认推荐的 MCP 模板
            let presets = vec![
                McpServer {
                    id: "filesystem-default".to_string(),
                    name: "Filesystem 沙箱文件系统 MCP".to_string(),
                    server_type: "stdio".to_string(),
                    command_or_url: "npx -y @modelcontextprotocol/server-filesystem /var/minis/workspace".to_string(),
                    enabled: false,
                    tools_count: 5,
                    description: Some("允许大模型深入读写沙箱工作区".to_string()),
                },
                McpServer {
                    id: "brave-search-default".to_string(),
                    name: "Brave Search 联网检索 MCP".to_string(),
                    server_type: "stdio".to_string(),
                    command_or_url: "npx -y @modelcontextprotocol/server-brave-search".to_string(),
                    enabled: false,
                    tools_count: 2,
                    description: Some("提供全球网页与新闻搜索".to_string()),
                },
                McpServer {
                    id: "github-default".to_string(),
                    name: "GitHub 集成 MCP".to_string(),
                    server_type: "stdio".to_string(),
                    command_or_url: "npx -y @modelcontextprotocol/server-github".to_string(),
                    enabled: false,
                    tools_count: 8,
                    description: Some("搜索仓库、提交 PR、操作 Issues".to_string()),
                },
            ];
            return Ok(presets);
        }
        let content = std::fs::read_to_string(&self.config_path)
            .map_err(|e| format!("读取 MCP 配置失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析 MCP 配置失败: {}", e))
    }

    fn write_all_internal(&self, servers: &[McpServer]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(servers)
            .map_err(|e| format!("序列化 MCP 配置失败: {}", e))?;
        std::fs::write(&self.config_path, json)
            .map_err(|e| format!("写入 MCP 配置失败: {}", e))?;
        Ok(())
    }
}
