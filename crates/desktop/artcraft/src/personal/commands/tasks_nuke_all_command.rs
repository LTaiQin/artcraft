use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub fn tasks_nuke_all_command(state: State<PersonalState>) -> Result<Value, String> {
  // Clear the visible queue, retaining accepted cloud IDs and local media.
  for job in state.store.jobs()? {
    state.store.dismiss(&job.id)?;
  }
  Ok(personal_api::success(json!({})))
}
