//! DPAPI encryption on Windows, bound to the current Windows user.
use crate::Result;

#[cfg(windows)]
pub fn protect(bytes: &[u8]) -> Result<Vec<u8>> {
  transform(bytes, true)
}
#[cfg(windows)]
pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>> {
  transform(bytes, false)
}

#[cfg(windows)]
fn transform(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
  use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};
  use windows_sys::Win32::Foundation::LocalFree;
  let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
  let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
  // DPAPI owns the returned buffer; copy it before releasing it with LocalFree.
  unsafe {
    let ok = if encrypt { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output) } else { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output) };
    if ok == 0 {
      return Err("Windows 无法加密或解密 API Key，请使用保存它的 Windows 用户账号".into());
    }
    let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
    LocalFree(output.pbData as *mut std::ffi::c_void);
    Ok(result)
  }
}

// Linux is only used for development/fixture tests; the delivered build is Windows.
#[cfg(not(windows))]
pub fn protect(bytes: &[u8]) -> Result<Vec<u8>> {
  Ok(bytes.to_vec())
}
#[cfg(not(windows))]
pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>> {
  Ok(bytes.to_vec())
}
