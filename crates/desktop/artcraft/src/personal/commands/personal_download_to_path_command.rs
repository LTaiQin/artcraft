use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn personal_download_to_path_command(url: String, path: String, state: State<'_, PersonalState>) -> Result<(), String> {
  let bytes = super::super::files::load(&state.store, &url).await?;
  personal_api::store::atomic_write(std::path::Path::new(&path), &bytes)
}
