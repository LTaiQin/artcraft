use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_download_path_command(request: Value, state: State<PersonalState>) -> Result<Value, String> {
  let path = super::super::files::download_path(&state.store, &request)?;
  Ok(json!({"filename":path.file_name().and_then(|s|s.to_str()),"path":path}))
}
