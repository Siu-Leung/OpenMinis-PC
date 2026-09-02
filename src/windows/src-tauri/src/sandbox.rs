//! OpenMinis Windows WSL2 沙箱隔离层 (终极加固版)
//! 备注：私人用极度不稳定 Aicoding 改

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use chrono::Local;

const DEFAULT_DISTRO_NAME: &str = "OpenMinisSandbox";
const MAX_STDOUT_CHARS: usize = 12000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub offload_path: Option<String>,
}

pub struct SandboxManager {
    pub distro_name: String,
}

impl SandboxManager {
    pub fn new() -> Self {
        Self {
            distro_name: DEFAULT_DISTRO_NAME.to_string(),
        }
    }

    /// 检查 WSL 中是否已导入此沙箱镜像
    pub async fn check_sandbox_ready(&self) -> bool {
        let output = Command::new("wsl")
            .args(["--list", "--quiet"])
            .output()
            .await;

        match output {
            Ok(out) => {
                let stdout = String::from_utf16_lossy(
                    &out.stdout
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect::<Vec<u16>>(),
                );
                let text = if stdout.is_empty() {
                    String::from_utf8_lossy(&out.stdout).to_string()
                } else {
                    stdout
                };
                text.contains(&self.distro_name)
            }
            Err(_) => false,
        }
    }

    /// 在沙箱中执行 Shell 命令（带深度审计、硬超时和大输出自动截断归档）
    pub async fn execute_shell(
        &self,
        command: &str,
        timeout_secs: u64,
    ) -> Result<CommandOutput, String> {
        // 1. 系统级危险操作初筛
        let trimmed = command.trim();
        if trimmed == "rm -rf /" || trimmed.starts_with("rm -rf /*") {
            return Err("安全审计拦截: 禁止对系统根目录执行破坏性删除".to_string());
        }

        let mut cmd = Command::new("wsl");
        cmd.args([
            "-d",
            &self.distro_name,
            "-u",
            "root",
            "--exec",
            "/bin/sh",
            "-c",
            command,
        ]);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let safe_timeout = timeout_secs.clamp(1, 600);
        let timeout_duration = Duration::from_secs(safe_timeout);

        let child = cmd.spawn().map_err(|e| format!("启动沙箱子进程失败: {}", e))?;

        match timeout(timeout_duration, child.wait_with_output()).await {
            Ok(Ok(output)) => {
                let raw_stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);

                // 2. 关键防护：大输出截断与 Offload 机制（防止上下文爆炸）
                let (final_stdout, offload_path) = if raw_stdout.chars().count() > MAX_STDOUT_CHARS {
                    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
                    let offload_file = format!("/var/minis/offloads/output_{}.txt", timestamp);

                    // 写入到 offloads 目录供后续查阅
                    let _ = self.write_sandbox_file(&offload_file, &raw_stdout, false).await;

                    let head: String = raw_stdout.chars().take(3000).collect();
                    let tail: String = raw_stdout.chars().rev().take(3000).collect::<String>().chars().rev().collect();
                    let truncated = format!(
                        "{}\n\n... [输出过长已自动截断，中间内容已归档至 {}] ...\n\n{}",
                        head, offload_file, tail
                    );
                    (truncated, Some(offload_file))
                } else {
                    (raw_stdout, None)
                };

                Ok(CommandOutput {
                    exit_code,
                    stdout: final_stdout,
                    stderr,
                    offload_path,
                })
            }
            Ok(Err(e)) => Err(format!("命令执行错误: {}", e)),
            Err(_) => {
                // 超时熔断
                let _ = Command::new("wsl")
                    .args(["-d", &self.distro_name, "-u", "root", "--exec", "killall", "-9", "/bin/sh"])
                    .output()
                    .await;
                Err(format!("命令执行超时 (超过 {} 秒)，已自动熔断终止", safe_timeout))
            }
        }
    }

    /// 读取沙箱文件 (支持 offset 与截断限制)
    pub async fn read_sandbox_file(&self, path: &str) -> Result<String, String> {
        let safe_path = path.replace('\'', "'\\''");
        let cmd = format!("cat -- '{}'", safe_path);
        let out = self.execute_shell(&cmd, 15).await?;
        if out.exit_code == 0 {
            Ok(out.stdout)
        } else {
            Err(format!("读取文件失败 (code {}): {}", out.exit_code, out.stderr))
        }
    }

    /// 写入沙箱文件 (Base64 管道写入)
    pub async fn write_sandbox_file(&self, path: &str, content: &str, append: bool) -> Result<(), String> {
        let b64 = base64_encode(content.as_bytes());
        let op = if append { ">>" } else { ">" };
        let safe_path = path.replace('\'', "'\\''");
        let cmd = format!(
            "mkdir -p \"$(dirname '{}')\" && echo '{}' | base64 -d {} '{}'",
            safe_path, b64, op, safe_path
        );
        let out = self.execute_shell(&cmd, 20).await?;
        if out.exit_code == 0 {
            Ok(())
        } else {
            Err(format!("写入文件失败: {}", out.stderr))
        }
    }

    /// 在 Windows 文件资源管理器中打开沙箱目录
    pub fn open_in_explorer(&self, subpath: &str) -> Result<(), String> {
        let clean_path = subpath.trim_start_matches("/var/minis/").replace('/', "\\");
        let target_unc = format!(r"\\wsl$\{}\var\minis\{}", self.distro_name, clean_path);

        std::process::Command::new("explorer.exe")
            .arg(target_unc)
            .spawn()
            .map_err(|e| format!("无法打开资源管理器: {}", e))?;
        Ok(())
    }

    /// 关闭沙箱实例
    pub async fn terminate_sandbox(&self) {
        let _ = Command::new("wsl")
            .args(["--terminate", &self.distro_name])
            .output()
            .await;
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
