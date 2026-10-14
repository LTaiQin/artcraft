use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn media_file_delete_command(request: Value, state: State<PersonalState>) -> Result<Value, String> {
  let token = request["media_file_token"].as_str().or_else(|| request["media_token"].as_str()).ok_or("缺少素材 ID")?;
  state.store.delete_asset(token)?;
  Ok(personal_api::success(json!({})))
}
