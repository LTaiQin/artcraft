use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_task_queue_command(state: State<PersonalState>) -> Result<Value, String> {
  super::super::runtime::local_queue(&state)
}
