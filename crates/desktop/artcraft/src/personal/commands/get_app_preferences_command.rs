use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_app_preferences_command(state: State<PersonalState>) -> Result<Value, String> {
  Ok(json!({"preferences":state.store.preferences()?}))
}
