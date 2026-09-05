//! OpenMinis Windows 浏览器自动化核心 (Edge Headless 加固版)
//! 备注：私人用极度不稳定 Aicoding 改

use crate::logs::append_log;
use crate::sandbox::SandboxManager;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

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

        let edge_paths = [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        let edge_path = edge_paths.iter().find(|p| std::path::Path::new(p).exists())
            .unwrap_or(&edge_paths[0]);

        match params.action.as_str() {
            "navigate" | "get_text" => {
                // 1. 尝试使用 Windows 自带 Edge Headless 获取完整 JS 渲染后的 DOM (外层套 20 秒硬超时，防止假死)
                let mut edge_cmd = Command::new(edge_path);
                edge_cmd.args([
                    "--headless=new",
                    "--disable-gpu",
                    "--dump-dom",
                    "--timeout=12000",
                    &target_url,
                ])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
                #[cfg(target_os = "windows")]
                edge_cmd.creation_flags(0x08000000);

                edge_cmd.kill_on_drop(true);
                let edge_output = timeout(Duration::from_secs(20), edge_cmd.output()).await;

                let raw_html = match edge_output {
                    Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
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
raw = base64.b64decode('{}').decode('utf-8', 'ignore')
cleaned = re.sub(r'<(script|style|svg|noscript).*?</\\1>', '', raw, flags=re.DOTALL | re.IGNORECASE)
text = re.sub(r'<[^>]+>', ' ', cleaned)
text = re.sub(r'\\s+', ' ', text).strip()
print(text[:10000])
\"",
                    b64_html
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
                // 真实调用 Edge 生成网页像素级截图 (外层套 25 秒硬超时)
                // 落地策略: Edge 只能可靠写 Windows 本地路径 (UNC 到 WSL 会静默失败)
                //   1) Edge 截图 -> 宿主临时目录 (LOCALAPPDATA/Temp)
                //   2) 成功后读字节 -> 直写沙箱 /var/minis/attachments (UNC 路径写字节)
                //   3) 沙箱内 cp 到宿主 .openminis/attachments (供 read_image_data_url 兜底)
                let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
                let filename = format!("screenshot_{}.png", timestamp);

                let minis_home = crate::sandbox::SandboxManager::get_minis_home();
                let att_dir = minis_home.join("attachments");
                let _ = std::fs::create_dir_all(&att_dir);
                let host_copy_path = att_dir.join(&filename);

                // 宿主临时目录 (Windows 本地路径, Edge 可可靠写入)
                let host_tmp = std::env::var("TEMP").unwrap_or_else(|_| r"C:\Users\Administrator\AppData\Local\Temp".to_string());
                let host_tmp_path = std::path::PathBuf::from(&host_tmp).join(&format!("openminis_{}", filename));
                let host_tmp_str = host_tmp_path.to_string_lossy().to_string();

                let mut edge_shot_cmd = Command::new(edge_path);
                edge_shot_cmd.args([
                    "--headless=new",
                    "--disable-gpu",
                    &format!("--screenshot={}", host_tmp_str),
                    "--window-size=1280,800",
                    "--timeout=15000",
                    &target_url,
                ]);
                #[cfg(target_os = "windows")]
                edge_shot_cmd.creation_flags(0x08000000);

                let started_at = std::time::Instant::now();
                append_log(&format!("[Browser] screenshot Edge start: {}", target_url));
                edge_shot_cmd.kill_on_drop(true);
                let edge_shot = timeout(Duration::from_secs(25), edge_shot_cmd.output()).await;
                append_log(&format!(
                    "[Browser] screenshot Edge finished in {} ms",
                    started_at.elapsed().as_millis()
                ));

                match edge_shot {
                    Ok(Ok(out)) if out.status.success() => {
                        // 1) 读宿主临时文件字节
                        let bytes = std::fs::read(&host_tmp_path).unwrap_or_default();
                        let _ = std::fs::remove_file(&host_tmp_path);
                        if bytes.is_empty() {
                            return BrowserActionResult {
                                success: false,
                                data: None,
                                error: Some("Edge 截图文件为空".to_string()),
                            };
                        }
                        // 2) 直写沙箱 /var/minis/attachments；主副本失败时不得返回成功 URL。
                        let sandbox_path = format!("/var/minis/attachments/{}", filename);
                        let sandbox_started_at = std::time::Instant::now();
                        let sandbox_write = timeout(
                            Duration::from_secs(12),
                            self.sandbox
                                .write_sandbox_bytes(&sandbox_path, &bytes, false),
                        )
                        .await;
                        append_log(&format!(
                            "[Browser] screenshot sandbox write finished in {} ms",
                            sandbox_started_at.elapsed().as_millis()
                        ));
                        match sandbox_write {
                            Ok(Ok(())) => {}
                            Ok(Err(error)) => {
                                return BrowserActionResult {
                                    success: false,
                                    data: None,
                                    error: Some(format!("截图写入沙箱失败: {}", error)),
                                };
                            }
                            Err(_) => {
                                return BrowserActionResult {
                                    success: false,
                                    data: None,
                                    error: Some("截图写入沙箱超时".to_string()),
                                };
                            }
                        }
                        // 3) Rust 直接写宿主缓存，供 read_image_data_url 秒开。
                        let _ = std::fs::write(&host_copy_path, &bytes);
                        BrowserActionResult {
                            success: true,
                            data: Some(format!("minis://attachments/{}", filename)),
                            error: None,
                        }
                    }
                    _ => {
                        BrowserActionResult {
                            success: false,
                            data: None,
                            error: Some("Edge 截图失败，未生成可用图片".to_string()),
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
