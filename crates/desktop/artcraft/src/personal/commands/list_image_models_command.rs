use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn list_image_models_command(state: State<PersonalState>) -> Result<Value, String> {
  Ok(personal_api::success(personal_api::catalog::models(&state.store, "image")?))
}
