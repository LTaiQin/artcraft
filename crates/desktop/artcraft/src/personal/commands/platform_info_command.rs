use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn platform_info_command() -> Value {
  json!({"os_platform":std::env::consts::OS,"os_type":std::env::consts::OS,"platform":std::env::consts::OS})
}
