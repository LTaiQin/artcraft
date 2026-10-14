use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn personal_save_settings_command(kind: String, config: personal_api::store::ProviderConfig, key: Option<String>, clear_key: Option<bool>, state: State<PersonalState>) -> Result<Value, String> {
  state.store.save_config(&kind, config, key, clear_key.unwrap_or(false))?;
  state.store.settings()
}
