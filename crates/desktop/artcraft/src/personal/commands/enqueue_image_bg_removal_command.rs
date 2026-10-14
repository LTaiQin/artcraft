use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn enqueue_image_bg_removal_command(mut request: Value, app: AppHandle, state: State<PersonalState>) -> Value {
  use base64::{engine::general_purpose::STANDARD, Engine};
  if let Some(data) = request["base64_image"].as_str() {
    let b64 = data.split_once(',').map(|(_, b)| b).unwrap_or(data);
    let result = STANDARD.decode(b64).map_err(|e| e.to_string()).and_then(|bytes| state.store.add_asset(&bytes, "Background-reference.png", "image", "image/png", "upload", json!({})));
    match result {
      Ok(asset) => {
        request["image_media_tokens"] = json!([asset.token]);
      },
      Err(message) => return personal_api::failure(message),
    }
  } else if let Some(token) = request["image_media_token"].as_str() {
    request["image_media_tokens"] = json!([token]);
  }
  request["prompt"] = json!("Remove the background completely and preserve the foreground subject with its original appearance and details. Return a transparent PNG.");
  request["background"] = json!("transparent");
  request["personal_action"] = json!("remove_background");
  state.enqueue(app, "image", request)
}
