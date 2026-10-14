use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn estimate_audio_cost_command(request: Value) -> Value {
  let _ = request;
  personal_api::success(personal_api::catalog::cost())
}
