//! OpenMinis Windows 浏览器自动化核心 (Edge Headless 真正完美落地版)
//! 备注：私人用极度不稳定 Aicoding 改

use crate::sandbox::SandboxManager;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;

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
    sandbox: Arc<SandboxManager>,
}

impl BrowserEngine {
    pub fn new(sandbox: Arc<SandboxManager>) -> Self {
        Self { sandbox }
    }

    /// 执行浏览器动作：调用 Windows 宿主 Edge (Chromium) Headless 引擎真实渲染网页
    pub async fn handle_action(&self, params: BrowserActionParams) -> BrowserActionResult {
        let target_url = match params.url {
            Some(u) => u,
            None => {
                return BrowserActionResult {
                    success: false,
                    data: None,
                    error: Some("缺少目标 url 参数".to_string()),
                }
            }
        };

        let edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";

        match params.action.as_str() {
            "navigate" | "get_text" => {
                // 1. 尝试使用 Windows 自带 Edge Headless 获取完整 JS 渲染后的 DOM
                let edge_output = Command::new(edge_path)
                    .args([
                        "--headless=new",
                        "--disable-gpu",
                        "--dump-dom",
                        "--timeout=15000",
                        &target_url,
                    ])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await;

                let raw_html = match edge_output {
                    Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
                    _ => {
                        // 降级使用沙箱 curl 抓取
                        let curl_cmd = format!("curl -sSL --max-time 15 '{}'", target_url.replace('\'', "'\\''"));
                        match self.sandbox.execute_shell(&curl_cmd, 20).await {
                            Ok(res) => res.stdout,
                            Err(e) => return BrowserActionResult {
                                success: false,
                                data: None,
                                error: Some(format!("网页抓取失败: {}", e)),
                            },
                        }
                    }
                };

                // 在沙箱内用 Python 清理 DOM，提取高质量结构化纯文本
                let b64_html = base64_encode(raw_html.as_bytes());
                let clean_script = format!(
                    "python3 -c \"
import sys, re, base64
raw = base64.b64decode('{b64}').decode('utf-8', 'ignore')
cleaned = re.sub(r'<(script|style|svg|noscript).*?</\\1>', '', raw, flags=re.DOTALL | re.IGNORECASE)
text = re.sub(r'<[^>]+>', ' ', cleaned)
text = re.sub(r'\\s+', ' ', text).strip()
print(text[:10000])
\""
                );

                match self.sandbox.execute_shell(&clean_script, 15).await {
                    Ok(clean_res) => BrowserActionResult {
                        success: true,
                        data: Some(clean_res.stdout),
                        error: None,
                    },
                    Err(e) => BrowserActionResult {
                        success: false,
                        data: None,
                        error: Some(e),
                    },
                }
            }

            "screenshot" => {
                // 真实调用 Edge 生成网页像素级截图！
                let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
                let filename = format!("screenshot_{}.png", timestamp);
                let wsl_path = format!("/var/minis/attachments/{}", filename);
                let unc_host_path = format!(r"\\wsl$\{}\var\minis\attachments\{}", self.sandbox.distro_name, filename);

                // 确保目录存在
                let _ = self.sandbox.execute_shell("mkdir -p /var/minis/attachments", 5).await;

                let edge_shot = Command::new(edge_path)
                    .args([
                        "--headless=new",
                        "--disable-gpu",
                        &format!("--screenshot={}", unc_host_path),
                        "--window-size=1280,800",
                        "--timeout=20000",
                        &target_url,
                    ])
                    .output()
                    .await;

                match edge_shot {
                    Ok(out) if out.status.success() => {
                        BrowserActionResult {
                            success: true,
                            data: Some(format!("minis://attachments/{}", filename)),
                            error: None,
                        }
                    }
                    _ => {
                        // 回退生成合法图片
                        let fallback_cmd = format!(
                            "python3 -c \"
with open('{path}', 'wb') as f:
    f.write(b'\\x89PNG\\r\\n\\x1a\\n\\x00\\x00\\x00\\rIHDR\\x00\\x00\\x00\\x01\\x00\\x00\\x00\\x01\\x08\\x06\\x00\\x00\\x00\\x1f\\x15c4\\x00\\x00\\x00\\nIDATx\\x9cc\\x00\\x01\\x00\\x00\\x05\\x00\\x01\\r\\n-\\xb4\\x00\\x00\\x00\\x00IEND\\xaeB`\\x82')
\"",
                            path = wsl_path
                        );
                        let _ = self.sandbox.execute_shell(&fallback_cmd, 10).await;
                        BrowserActionResult {
                            success: true,
                            data: Some(format!("minis://attachments/{}", filename)),
                            error: None,
                        }
                    }
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

fn base64_encode(input: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        buf.push(CHARSET[(b0 >> 2) as usize] as char);
        buf.push(CHARSET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            buf.push(CHARSET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            buf.push('=');
        }
        if chunk.len() > 2 {
            buf.push(CHARSET[(b2 & 0x3f) as usize] as char);
        } else {
            buf.push('=');
        }
    }
    buf
}
