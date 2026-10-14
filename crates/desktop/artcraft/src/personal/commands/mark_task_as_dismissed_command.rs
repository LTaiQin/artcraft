use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn mark_task_as_dismissed_command(request: Value, state: State<PersonalState>) -> Result<Value, String> {
  state.store.dismiss(personal_api::text(&request, "task"))?;
  Ok(personal_api::success(json!({})))
}
