use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn storyteller_get_subscription_command() -> Value {
  personal_api::success(json!({"success":true,"subscriptions":[],"active_subscriptions":[],"maybe_subscription":null,"maybe_loyalty_program":null}))
}
