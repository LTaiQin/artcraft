use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn download_directory_reveal_command(app: AppHandle, state: State<PersonalState>) -> Result<(), String> {
  use tauri_plugin_opener::OpenerExt;
  let dir = state.store.preferences()?["preferred_download_directory"]["custom"].as_str().map(std::path::PathBuf::from).or_else(dirs::download_dir).unwrap_or_else(|| state.store.root.join("downloads"));
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  app.opener().open_path(dir.to_string_lossy().as_ref(), None::<&str>).map_err(|e| e.to_string())
}
