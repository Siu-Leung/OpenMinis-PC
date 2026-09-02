//! OpenMinis Windows WSL2 沙箱隔离层
//! 备注：私人用极度不稳定 Aicoding 改

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

const DEFAULT_DISTRO_NAME: &str = "OpenMinisSandbox";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
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
                // 兼容 UTF-8 或 Windows 默认 UTF-16LE 输出
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

    /// 在沙箱中执行 Shell 命令
    pub async fn execute_shell(
        &self,
        command: &str,
        timeout_secs: u64,
    ) -> Result<CommandOutput, String> {
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

        let timeout_duration = Duration::from_secs(if timeout_secs == 0 { 60 } else { timeout_secs });

        let child = cmd.spawn().map_err(|e| format!("启动沙箱进程失败: {}", e))?;

        let wait_result = timeout(timeout_duration, child.wait_with_output()).await;

        match wait_result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                Ok(CommandOutput {
                    exit_code: output.status.code().unwrap_or(-1),
                    stdout,
                    stderr,
                })
            }
            Ok(Err(e)) => Err(format!("命令执行错误: {}", e)),
            Err(_) => Err(format!("命令执行超时 (超过 {} 秒)", timeout_secs)),
        }
    }

    /// 将沙箱内的路径（/var/minis/...）转为 WSL 读取命令
    pub async fn read_sandbox_file(&self, path: &str) -> Result<String, String> {
        let cmd = format!("cat {}", path);
        let out = self.execute_shell(&cmd, 10).await?;
        if out.exit_code == 0 {
            Ok(out.stdout)
        } else {
            Err(format!("读取文件失败 (code {}): {}", out.exit_code, out.stderr))
        }
    }

    /// 将文本写入沙箱内文件
    pub async fn write_sandbox_file(&self, path: &str, content: &str, append: bool) -> Result<(), String> {
        // 使用 base64 传输避免任何引号或特殊字符解析错误
        let b64 = base64_encode(content.as_bytes());
        let op = if append { ">>" } else { ">" };
        let cmd = format!(
            "mkdir -p \"$(dirname '{}')\" && echo '{}' | base64 -d {} '{}'",
            path, b64, op, path
        );
        let out = self.execute_shell(&cmd, 15).await?;
        if out.exit_code == 0 {
            Ok(())
        } else {
            Err(format!("写入文件失败: {}", out.stderr))
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
