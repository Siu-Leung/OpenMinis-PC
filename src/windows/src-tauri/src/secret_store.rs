use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

const STORAGE_VERSION: u32 = 1;
const PROTECTION_KIND: &str = "windows-dpapi-current-user";

#[derive(Debug, Serialize, Deserialize)]
struct SecretEnvelope {
    version: u32,
    protection: String,
    ciphertext: String,
}

pub fn encode_protected<T, F>(value: &T, protect: F) -> Result<String, String>
where
    T: Serialize,
    F: FnOnce(&[u8]) -> Result<Vec<u8>, String>,
{
    let plaintext =
        serde_json::to_vec(value).map_err(|error| format!("序列化凭据失败: {}", error))?;
    let ciphertext = protect(&plaintext)?;
    serde_json::to_string_pretty(&SecretEnvelope {
        version: STORAGE_VERSION,
        protection: PROTECTION_KIND.to_string(),
        ciphertext: hex_encode(&ciphertext),
    })
    .map_err(|error| format!("序列化加密凭据失败: {}", error))
}

pub fn decode_protected_or_legacy<T, F>(content: &str, unprotect: F) -> Result<(T, bool), String>
where
    T: DeserializeOwned,
    F: FnOnce(&[u8]) -> Result<Vec<u8>, String>,
{
    if let Ok(envelope) = serde_json::from_str::<SecretEnvelope>(content) {
        if envelope.version != STORAGE_VERSION {
            return Err(format!("不支持的凭据存储版本: {}", envelope.version));
        }
        if envelope.protection != PROTECTION_KIND {
            return Err(format!("不支持的凭据保护方式: {}", envelope.protection));
        }
        let ciphertext = hex_decode(&envelope.ciphertext)?;
        let plaintext = unprotect(&ciphertext)?;
        let value = serde_json::from_slice(&plaintext)
            .map_err(|error| format!("解析解密凭据失败: {}", error))?;
        return Ok((value, false));
    }

    let value = serde_json::from_str(content)
        .map_err(|error| format!("解析旧版明文凭据失败: {}", error))?;
    Ok((value, true))
}

fn hex_encode(input: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(input.len() * 2);
    for byte in input {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode(input: &str) -> Result<Vec<u8>, String> {
    if input.len() % 2 != 0 {
        return Err("加密凭据编码长度无效".to_string());
    }
    input
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = hex_value(pair[0])?;
            let low = hex_value(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_value(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err("加密凭据包含无效十六进制字符".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn dpapi_transform(
    input: &[u8],
    transform: impl FnOnce(
        *const windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
        *mut windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
    ) -> windows::core::Result<()>,
) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB;

    let input_len = u32::try_from(input.len()).map_err(|_| "凭据数据过大".to_string())?;
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input_len,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    transform(&input_blob, &mut output_blob)
        .map_err(|error| format!("Windows DPAPI 操作失败: {}", error))?;
    if output_blob.pbData.is_null() {
        return Err("Windows DPAPI 未返回数据".to_string());
    }

    let output = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        let _ = LocalFree(HLOCAL(output_blob.pbData as *mut std::ffi::c_void));
    }
    Ok(output)
}

#[cfg(target_os = "windows")]
pub fn protect_for_current_user(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN};

    dpapi_transform(plaintext, |input, output| unsafe {
        CryptProtectData(
            input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            output,
        )
    })
}

#[cfg(target_os = "windows")]
pub fn unprotect_for_current_user(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN};

    dpapi_transform(ciphertext, |input, output| unsafe {
        CryptUnprotectData(
            input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            output,
        )
    })
}

#[cfg(not(target_os = "windows"))]
pub fn protect_for_current_user(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台不支持 Windows DPAPI".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn unprotect_for_current_user(_ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台不支持 Windows DPAPI".to_string())
}

#[cfg(target_os = "windows")]
pub fn atomic_write(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temp_path = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    if let Err(error) = std::fs::write(&temp_path, data) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }
    let temp_wide: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            PCWSTR(temp_wide.as_ptr()),
            PCWSTR(path_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(std::io::Error::new(std::io::ErrorKind::Other, error));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn atomic_write(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    let temp_path = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    if let Err(error) = std::fs::write(&temp_path, data) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }
    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn xor(input: &[u8]) -> Result<Vec<u8>, String> {
        Ok(input.iter().map(|byte| byte ^ 0x5a).collect())
    }

    #[test]
    fn protected_envelope_hides_plaintext_and_round_trips() {
        let source = json!({"api_key": "top-secret", "name": "provider"});
        let encoded = encode_protected(&source, xor).unwrap();

        assert!(!encoded.contains("top-secret"));
        assert!(encoded.contains(PROTECTION_KIND));

        let (decoded, migrated) =
            decode_protected_or_legacy::<serde_json::Value, _>(&encoded, xor).unwrap();
        assert_eq!(decoded, source);
        assert!(!migrated);
    }

    #[test]
    fn legacy_json_is_returned_for_migration() {
        let legacy = r#"[{"key":"TOKEN","value":"legacy-secret"}]"#;
        let (decoded, migrated) =
            decode_protected_or_legacy::<serde_json::Value, _>(legacy, xor).unwrap();

        assert_eq!(decoded[0]["value"], "legacy-secret");
        assert!(migrated);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_dpapi_round_trips_for_current_user() {
        let plaintext = b"openminis-dpapi-test-secret";
        let ciphertext = protect_for_current_user(plaintext).unwrap();

        assert_ne!(ciphertext, plaintext);
        assert_eq!(unprotect_for_current_user(&ciphertext).unwrap(), plaintext);
    }

    #[test]
    fn unsupported_envelope_version_is_rejected() {
        let encoded = serde_json::to_string(&SecretEnvelope {
            version: STORAGE_VERSION + 1,
            protection: PROTECTION_KIND.to_string(),
            ciphertext: "00".to_string(),
        })
        .unwrap();

        let error = decode_protected_or_legacy::<serde_json::Value, _>(&encoded, xor).unwrap_err();
        assert!(error.contains("不支持的凭据存储版本"));
    }
}
