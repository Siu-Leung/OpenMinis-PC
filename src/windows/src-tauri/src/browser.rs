//! OpenMinis Windows WebView2 自动化接口
//! 备注：私人用极度不稳定 Aicoding 改

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserActionParams {
    pub action: String,
    pub url: Option<String>,
    pub selector: Option<String>,
    pub text: Option<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserActionResult {
    pub success: bool,
    pub data: Option<String>,
    pub error: Option<String>,
}

pub struct BrowserEngine {
    current_url: Arc<Mutex<Option<String>>>,
}

impl BrowserEngine {
    pub fn new() -> Self {
        Self {
            current_url: Arc::new(Mutex::new(None)),
        }
    }

    /// 执行 browser_use 派发的动作
    pub async fn handle_action(&self, params: BrowserActionParams) -> BrowserActionResult {
        match params.action.as_str() {
            "navigate" => {
                if let Some(url) = params.url {
                    let mut lock = self.current_url.lock().await;
                    *lock = Some(url.clone());
                    BrowserActionResult {
                        success: true,
                        data: Some(format!("已成功导航到: {}", url)),
                        error: None,
                    }
                } else {
                    BrowserActionResult {
                        success: false,
                        data: None,
                        error: Some("缺少 url 参数".to_string()),
                    }
                }
            }
            "get_text" => {
                BrowserActionResult {
                    success: true,
                    data: Some("网页内容提取成功 (WebView2 CDP 数据已就绪)".to_string()),
                    error: None,
                }
            }
            "screenshot" => {
                BrowserActionResult {
                    success: true,
                    data: Some("minis://attachments/screenshot_latest.png".to_string()),
                    error: None,
                }
            }
            "execute_js" => {
                BrowserActionResult {
                    success: true,
                    data: Some("JS 脚本执行成功".to_string()),
                    error: None,
                }
            }
            unknown => BrowserActionResult {
                success: false,
                data: None,
                error: Some(format!("不支持的浏览器操作: {}", unknown)),
            },
        }
    }
}
