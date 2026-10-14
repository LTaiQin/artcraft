use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn storyteller_get_login_session_command() -> Value {
  personal_api::routes::user()
}
