use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn provider_list_command() -> Value {
  personal_api::success(json!({"providers":[{"provider":"artcraft","is_configured":true,"has_api_key":true}]}))
}
