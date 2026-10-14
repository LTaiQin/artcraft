use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_provider_order_command() -> Value {
  personal_api::success(json!({"providers":["artcraft"]}))
}
