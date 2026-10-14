use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn update_app_preferences_command(request: Value, state: State<PersonalState>) -> Result<Value, String> {
  let mut patch = json!({});
  let preference = personal_api::text(&request, "preference");
  patch[preference] = request["value"].clone();
  state.store.update_preferences(patch)?;
  Ok(json!({"success":true}))
}
