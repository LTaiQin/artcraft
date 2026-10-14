use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn load_without_cors_command(url: String, state: State<'_, PersonalState>) -> Result<tauri::ipc::Response, String> {
  Ok(tauri::ipc::Response::new(super::super::files::load(&state.store, &url).await?))
}
