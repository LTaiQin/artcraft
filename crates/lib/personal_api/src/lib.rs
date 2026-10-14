//! Local adapters for the official ArtCraft desktop frontend.
//! Provider credentials never travel to the original ArtCraft service.
pub mod catalog;
pub mod providers;
pub mod routes;
pub mod store;
pub mod vault;

pub use store::{Asset, Job, Store};
use serde_json::{json, Value};

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_FILE: usize = 512 * 1024 * 1024;

pub fn now() -> String {
  chrono::Utc::now().to_rfc3339()
}
pub fn id(prefix: &str) -> String {
  format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}
pub fn success(payload: Value) -> Value {
  json!({"status":"success", "payload":payload})
}
pub fn failure(message: impl ToString) -> Value {
  json!({"status":"bad_request", "error_type":"bad_input", "error_message":message.to_string()})
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
  value[key].as_str().unwrap_or("")
}
pub fn strings(value: &Value, key: &str) -> Vec<String> {
  value[key].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}
