use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn personal_api_request_command(request: personal_api::routes::LocalRequest, state: State<PersonalState>) -> Result<Value, String> {
  personal_api::routes::request(&state.store, request)
}
