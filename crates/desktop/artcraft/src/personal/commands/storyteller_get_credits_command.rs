use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn storyteller_get_credits_command() -> Value {
  personal_api::success(json!({"success":true,"total_credits":0,"sum_total_credits":0,"free_credits":0,"maybe_loyalty_program":null,"credits":[],"credit_balance":0,"banked_credits":0,"monthly_credits":0}))
}
