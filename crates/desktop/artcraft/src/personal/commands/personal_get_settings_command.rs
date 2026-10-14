use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn personal_get_settings_command(state: State<PersonalState>) -> Result<Value, String> {
  state.store.settings()
}
