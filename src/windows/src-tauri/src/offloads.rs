//! OpenMinis Windows 原生 Native Offload 体系 (剪贴板、系统通知、系统指标)
//! 备注：Windows 测试版 (Experimental)

use serde_json::{json, Value};

pub struct WindowsOffload;

impl WindowsOffload {
    /// 触发 Windows 原生 Toast 消息通知
    pub fn send_notification(title: &str, message: &str) {
        let clean_title = title.replace('\'', "''").replace('"', "");
        let clean_msg = message.replace('\'', "''").replace('"', "");
        let ps_script = format!(
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; \
             $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \
             $textNodes = $template.GetElementsByTagName('text'); \
             $textNodes.Item(0).AppendChild($template.CreateTextNode('{}')) > $null; \
             $textNodes.Item(1).AppendChild($template.CreateTextNode('{}')) > $null; \
             $toast = [Windows.UI.Notifications.ToastNotification]::new($template); \
             [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenMinis').Show($toast);",
            clean_title, clean_msg
        );

        let mut cmd = std::process::Command::new("powershell.exe");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.args(["-NoProfile", "-Command", &ps_script]);
        let _ = cmd.spawn();
    }

    /// 获取宿主系统信息
    pub fn get_system_summary() -> Value {
        let num_cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        json!({
            "os": "Windows",
            "arch": std::env::consts::ARCH,
            "cpu_cores": num_cpus,
        })
    }
}
