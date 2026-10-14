use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn generate_audio_command(request: Value, app: AppHandle, state: State<PersonalState>) -> Value {
  state.enqueue(app, "audio", request)
}
