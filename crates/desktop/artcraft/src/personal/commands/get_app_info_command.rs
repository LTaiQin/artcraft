use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_app_info_command(state: State<PersonalState>) -> Value {
  personal_api::success(json!({"artcraft_version":"0.42.1 Personal API","build_timestamp":option_env!("ARTCRAFT_BUILD_TIME").unwrap_or(""),"git_commit_id":option_env!("ARTCRAFT_GIT_SHA"),"storyteller_host":"https://personal.artcraft.local","os_platform":std::env::consts::OS,"os_version":"","artcraft_root_directory":state.store.root,"download_directory":dirs::download_dir()}))
}
