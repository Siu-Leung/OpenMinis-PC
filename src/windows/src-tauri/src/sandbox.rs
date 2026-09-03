//! OpenMinis Windows WSL2 沙箱隔离层 (完全静默加固与全自动初始化版)
//! 备注：私人用极度不稳定 Aicoding 改

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const DEFAULT_DISTRO_NAME: &str = "OpenMinisSandbox";
const MAX_STDOUT_CHARS: usize = 12000;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

    /// 静默构造 Command (在 Windows 上彻底消除黑框窗口)
    fn silent_command(program: &str) -> Command {
        let mut cmd = Command::new(program);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    /// 检查 WSL 中是否已导入此沙箱镜像
    pub async fn check_sandbox_ready(&self) -> bool {
        let mut cmd = Self::silent_command("wsl");
        cmd.args(["--list", "--quiet"]);

        match cmd.output().await {
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

    /// 同步检查沙箱是否已就绪（供同步上下文快速检测）
    pub fn is_sandbox_ready_sync(&self) -> bool {
        let mut cmd = std::process::Command::new("wsl");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.args(["--list", "--quiet"]);
        if let Ok(out) = cmd.output() {
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
        } else {
            false
        }
    }

    /// 全自动一键初始化 WSL2 沙箱（无需用户打开 PowerShell 敲命令）
    pub async fn auto_initialize(&self, app: &AppHandle) -> Result<(), String> {
        let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 1, "text": "正在检查系统 WSL 环境...", "percent": 10 }));

        // 1. 检查 WSL 是否存在
        let mut wsl_cmd = Self::silent_command("wsl");
        wsl_cmd.arg("-l");
        let wsl_available = match wsl_cmd.output().await {
            Ok(_) => true,
            Err(_) => false,
        };

        if !wsl_available {
            let err = "系统未检测到 WSL 运行时。请在 Windows 搜索框输入 PowerShell 并右键【以管理员身份运行】，执行：wsl --install --no-distribution，然后重启电脑。";
            let _ = app.emit("sandbox-init-error", err);
            return Err(err.to_string());
        }

        // 2. 准备目录
        let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 2, "text": "正在准备本地沙箱存储目录...", "percent": 25 }));
        let base_dir = directories::ProjectDirs::from("com", "openminis", "OpenMinis")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from(r"C:\OpenMinis"));

        let sandbox_dir = base_dir.join("sandbox");
        let download_dir = base_dir.join("downloads");
        std::fs::create_dir_all(&sandbox_dir).ok();
        std::fs::create_dir_all(&download_dir).ok();

        let tar_path = download_dir.join("alpine-minirootfs-3.20.2-x86_64.tar.gz");

        // 3. 下载 Alpine Linux Minirootfs (国内多节点加速)
        if !tar_path.exists() || std::fs::metadata(&tar_path).map(|m| m.len()).unwrap_or(0) < 1_000_000 {
            let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 3, "text": "正在下载 Alpine Linux 精简沙箱镜像 (约 3.8MB，已启用国内镜像加速)...", "percent": 45 }));
            
            let mirror_urls = [
                "https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.20/releases/x86_64/alpine-minirootfs-3.20.2-x86_64.tar.gz",
                "https://mirrors.aliyun.com/alpine/v3.20/releases/x86_64/alpine-minirootfs-3.20.2-x86_64.tar.gz",
                "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-minirootfs-3.20.2-x86_64.tar.gz",
            ];

            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|e| e.to_string())?;

            let mut downloaded = false;
            let mut last_err = String::new();

            for url in &mirror_urls {
                match client.get(*url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(bytes) = resp.bytes().await {
                            if bytes.len() > 1_000_000 && std::fs::write(&tar_path, &bytes).is_ok() {
                                downloaded = true;
                                break;
                            }
                        }
                    }
                    Ok(resp) => {
                        last_err = format!("HTTP {}", resp.status());
                    }
                    Err(e) => {
                        last_err = e.to_string();
                    }
                }
            }

            if !downloaded {
                let err_msg = format!("下载 Alpine 沙箱镜像失败，请检查网络连接: {}", last_err);
                let _ = app.emit("sandbox-init-error", &err_msg);
                return Err(err_msg);
            }
        }

        // 4. 导入 WSL 实例 (清理残留目录)
        if !self.check_sandbox_ready().await {
            let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 4, "text": "正在导入沙箱实例到 WSL2...", "percent": 65 }));
            
            let _ = std::fs::remove_dir_all(&sandbox_dir);
            let _ = std::fs::create_dir_all(&sandbox_dir);

            let mut import_cmd = Self::silent_command("wsl");
            import_cmd.args([
                "--import",
                &self.distro_name,
                &sandbox_dir.to_string_lossy(),
                &tar_path.to_string_lossy(),
                "--version",
                "2",
            ]);
            let import_res = import_cmd.output().await.map_err(|e| format!("无法执行 wsl --import: {}", e))?;
            if !import_res.status.success() {
                // 尝试兼容模式 (不带 --version 2)
                let err = String::from_utf8_lossy(&import_res.stderr).to_string();
                let mut fallback_cmd = Self::silent_command("wsl");
                fallback_cmd.args([
                    "--import",
                    &self.distro_name,
                    &sandbox_dir.to_string_lossy(),
                    &tar_path.to_string_lossy(),
                ]);
                let fb_res = fallback_cmd.output().await.map_err(|e| format!("重试导入失败: {}", e))?;
                if !fb_res.status.success() {
                    let fb_err = String::from_utf8_lossy(&fb_res.stderr);
                    let final_err = format!("WSL 导入失败:\n{}\n{}", err.trim(), fb_err.trim());
                    let _ = app.emit("sandbox-init-error", &final_err);
                    return Err(final_err);
                }
            }
        }

        // 5. 注入安全隔离规则
        let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 5, "text": "正在注入零信任宿主磁盘隔离规则...", "percent": 80 }));
        let wsl_conf = "[automount]\nenabled = false\nmountFsTab = false\n\n[interop]\nenabled = false\nappendWindowsPath = false\n\n[network]\ngenerateResolvConf = true\n";
        let b64_conf = base64_encode(wsl_conf.as_bytes());
        let inject_cmd = format!("echo '{}' | base64 -d > /etc/wsl.conf", b64_conf);
        let _ = self.execute_raw_shell(&inject_cmd, 15).await;

        // 6. 配置沙箱内部工作目录与基础工具
        let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 6, "text": "正在安装 Python 与核心工具箱 (约需 10-20 秒)...", "percent": 90 }));
        let setup_cmd = r#"
mkdir -p /var/minis/workspace /var/minis/attachments /var/minis/shared /var/minis/offloads /var/minis/memory
chmod 000 /mnt 2>/dev/null || true
printf "nameserver 223.5.5.5\nnameserver 119.29.29.29\nnameserver 8.8.8.8\n" > /etc/resolv.conf
sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories 2>/dev/null || true
apk update
apk add --no-cache curl ca-certificates busybox python3 py3-pip bash jq openssh-client sshpass
pip install --break-system-packages beautifulsoup4 requests 2>/dev/null || true
"#;
        let _ = self.execute_raw_shell(setup_cmd, 180).await;

        // 7. 重启沙箱以激活安全策略
        self.terminate_sandbox().await;
        tokio::time::sleep(Duration::from_secs(2)).await;

        let _ = app.emit("sandbox-init-step", serde_json::json!({ "step": 7, "text": "沙箱配置就绪！", "percent": 100, "done": true }));
        Ok(())
    }

    /// 底层原始 Shell 进程执行（完全静默，无任何控制台黑框窗口）
    async fn execute_raw_shell(
        &self,
        command: &str,
        timeout_secs: u64,
    ) -> Result<(i32, String, String), String> {
        let mut cmd = Self::silent_command("wsl");
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
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);
                Ok((exit_code, stdout, stderr))
            }
            Ok(Err(e)) => Err(format!("命令执行错误: {}", e)),
            Err(_) => {
                let mut kill_cmd = Self::silent_command("wsl");
                kill_cmd.args(["-d", &self.distro_name, "-u", "root", "--exec", "killall", "-9", "/bin/sh"]);
                let _ = kill_cmd.output().await;
                Err(format!("命令执行超时 (超过 {} 秒)，已自动熔断终止", safe_timeout))
            }
        }
    }

    /// 在沙箱中执行 Shell 命令
    pub async fn execute_shell(
        &self,
        command: &str,
        timeout_secs: u64,
    ) -> Result<CommandOutput, String> {
        let trimmed = command.trim();
        if trimmed == "rm -rf /" || trimmed.starts_with("rm -rf /*") {
            return Err("安全审计拦截: 禁止对系统根目录执行破坏性删除".to_string());
        }

        let (exit_code, raw_stdout, stderr) = self.execute_raw_shell(command, timeout_secs).await?;

        let (final_stdout, offload_path) = if raw_stdout.chars().count() > MAX_STDOUT_CHARS {
            let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
            let offload_file = format!("/var/minis/offloads/output_{}.txt", timestamp);

            let b64 = base64_encode(raw_stdout.as_bytes());
            let write_cmd = format!(
                "mkdir -p /var/minis/offloads && echo '{}' | base64 -d > '{}'",
                b64, offload_file
            );
            let _ = self.execute_raw_shell(&write_cmd, 15).await;

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

    /// 读取沙箱文件
    pub async fn read_sandbox_file(&self, path: &str) -> Result<String, String> {
        let safe_path = path.replace('\'', "'\\''");
        let cmd = format!("cat -- '{}'", safe_path);
        let (exit_code, stdout, stderr) = self.execute_raw_shell(&cmd, 15).await?;
        if exit_code == 0 {
            Ok(stdout)
        } else {
            Err(format!("读取文件失败 (code {}): {}", exit_code, stderr))
        }
    }

    /// 写入沙箱文件数据 (流式写入与 UNC 宿主直写，突破任何命令行参数长度限制)
    pub async fn write_sandbox_bytes(&self, path: &str, data: &[u8], append: bool) -> Result<(), String> {
        // 方案 1: 尝试通过 Windows UNC 宿主文件系统直接秒级安全写入 (大文件零损耗)
        let clean_path = path.trim_start_matches("/var/minis/").replace('/', "\\");
        let unc_path = PathBuf::from(format!(r"\\wsl$\{}\var\minis\{}", self.distro_name, clean_path));
        
        if let Some(parent) = unc_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .append(append)
            .truncate(!append)
            .open(&unc_path)
        {
            use std::io::Write;
            if file.write_all(data).is_ok() {
                return Ok(());
            }
        }

        // 方案 2: 降级通过 stdin 管道流式写入 (绝不拼接在命令行，支持任意尺寸文件)
        let safe_path = path.replace('\'', "'\\''");
        let op = if append { ">>" } else { ">" };
        let sh_cmd = format!("mkdir -p \"$(dirname '{}')\" && cat {} '{}'", safe_path, op, safe_path);

        let mut cmd = Self::silent_command("wsl");
        cmd.args([
            "-d", &self.distro_name,
            "-u", "root",
            "--exec", "/bin/sh", "-c", &sh_cmd
        ]);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("启动写入管道子进程失败: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            stdin.write_all(data).await.map_err(|e| format!("向沙箱流式传输数据失败: {}", e))?;
            stdin.flush().await.map_err(|e| format!("刷新沙箱管道失败: {}", e))?;
        }

        let out = child.wait_with_output().await.map_err(|e| format!("等待写入结束失败: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!("写入沙箱文件失败: {}", String::from_utf8_lossy(&out.stderr)))
        }
    }

    /// 写入沙箱文本文件
    pub async fn write_sandbox_file(&self, path: &str, content: &str, append: bool) -> Result<(), String> {
        self.write_sandbox_bytes(path, content.as_bytes(), append).await
    }

    /// 唤起 Windows 原生交互式终端（此时正常显示终端窗口供输入 SSH 密码）
    pub fn launch_interactive_terminal(&self, init_cmd: Option<String>) -> Result<(), String> {
        if !self.is_sandbox_ready_sync() {
            return Err("WSL2 隔离沙箱尚未安装初始化，请先在主界面点击【一键全自动初始化】。".to_string());
        }

        let shell_arg = match init_cmd {
            Some(cmd) if !cmd.trim().is_empty() => {
                let sanitized = cmd.replace('\'', "'\\''");
                format!("{}; exec /bin/sh", sanitized)
            }
            _ => "exec /bin/sh".to_string(),
        };

        // 尝试唤起 Windows Terminal (wt.exe)
        let wt_result = std::process::Command::new("wt.exe")
            .args([
                "-w", "0",
                "--title", "OpenMinis Interactive Terminal",
                "wsl.exe", "-d", &self.distro_name, "-u", "root", "--", "/bin/sh", "-c", &shell_arg
            ])
            .spawn();

        if wt_result.is_err() {
            std::process::Command::new("cmd.exe")
                .args([
                    "/c", "start", "OpenMinis Interactive Terminal",
                    "wsl.exe", "-d", &self.distro_name, "-u", "root", "--", "/bin/sh", "-c", &shell_arg
                ])
                .spawn()
                .map_err(|e| format!("无法唤起交互终端: {}", e))?;
        }

        Ok(())
    }

    /// 在 Windows 文件资源管理器中打开沙箱目录
    pub fn open_in_explorer(&self, subpath: &str) -> Result<(), String> {
        let clean_path = subpath.trim_start_matches("/var/minis/").replace('/', "\\");
        let target_unc = format!(r"\\wsl$\{}\var\minis\{}", self.distro_name, clean_path);

        let mut cmd = std::process::Command::new("explorer.exe");
        cmd.arg(target_unc);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.spawn().map_err(|e| format!("无法打开资源管理器: {}", e))?;
        Ok(())
    }

    /// 关闭沙箱实例释放内存
    pub async fn terminate_sandbox(&self) {
        let mut cmd = Self::silent_command("wsl");
        cmd.args(["--terminate", &self.distro_name]);
        let _ = cmd.output().await;
    }
}

pub fn base64_encode(input: &[u8]) -> String {
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

pub fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut table = [-1i8; 256];
    let mut i = 0usize;
    while i < 26 { table[(b'A' + i as u8) as usize] = i as i8; i += 1; }
    i = 0;
    while i < 26 { table[(b'a' + i as u8) as usize] = (26 + i) as i8; i += 1; }
    i = 0;
    while i < 10 { table[(b'0' + i as u8) as usize] = (52 + i) as i8; i += 1; }
    table[b'+' as usize] = 62;
    table[b'/' as usize] = 63;

    let clean = input.trim().trim_end_matches('=');
    let mut out = Vec::with_capacity((clean.len() * 3) / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;

    for &b in clean.as_bytes() {
        let val = table[b as usize];
        if val < 0 { continue; }
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(out)
}
