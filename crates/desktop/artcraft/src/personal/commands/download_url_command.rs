use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn download_url_command(request: Value, state: State<'_, PersonalState>) -> Result<Value, String> {
  let path = super::super::files::download_path(&state.store, &request)?;
  let bytes = super::super::files::load(&state.store, personal_api::text(&request, "url")).await?;
  personal_api::store::atomic_write(&path, &bytes)?;
  Ok(personal_api::success(json!({})))
}
