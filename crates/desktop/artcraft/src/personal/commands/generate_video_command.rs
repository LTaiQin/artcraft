use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn generate_video_command(request: Value, app: AppHandle, state: State<PersonalState>) -> Value {
  state.enqueue(app, "video", request)
}
