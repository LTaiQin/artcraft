// The personal build uses the official frontend and Tauri window, with a local API backend.
#[cfg(not(feature = "personal-api"))]
include!("original_cloud.rs");

#[cfg(feature = "personal-api")]
mod personal;
#[cfg(feature = "personal-api")]
pub use personal::run;

#[cfg(feature = "personal-api")]
use personal::commands::{
  personal_get_settings_command::personal_get_settings_command, personal_save_settings_command::personal_save_settings_command, personal_api_request_command::personal_api_request_command, personal_download_to_path_command::personal_download_to_path_command, get_task_queue_command::get_task_queue_command, mark_task_as_dismissed_command::mark_task_as_dismissed_command, get_app_preferences_command::get_app_preferences_command, update_app_preferences_command::update_app_preferences_command, get_app_info_command::get_app_info_command, platform_info_command::platform_info_command, storyteller_get_login_session_command::storyteller_get_login_session_command, storyteller_get_credits_command::storyteller_get_credits_command, storyteller_get_subscription_command::storyteller_get_subscription_command, provider_list_command::provider_list_command, get_provider_order_command::get_provider_order_command, load_without_cors_command::load_without_cors_command,
  get_download_path_command::get_download_path_command, download_url_command::download_url_command, download_directory_reveal_command::download_directory_reveal_command, media_file_delete_command::media_file_delete_command, generate_image_command::generate_image_command, generate_video_command::generate_video_command, generate_audio_command::generate_audio_command, list_image_models_command::list_image_models_command, list_video_models_command::list_video_models_command, estimate_image_cost_command::estimate_image_cost_command, estimate_video_cost_command::estimate_video_cost_command, estimate_audio_cost_command::estimate_audio_cost_command, estimate_mesh_cost_command::estimate_mesh_cost_command, estimate_splat_cost_command::estimate_splat_cost_command, generate_mesh_command::generate_mesh_command, generate_splat_command::generate_splat_command, enqueue_image_bg_removal_command::enqueue_image_bg_removal_command, tasks_nuke_all_command::tasks_nuke_all_command,
};

// Keep command macro expansion at the crate root, matching the official host.
#[cfg(feature = "personal-api")]
fn personal_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
  tauri::generate_handler![personal_get_settings_command, personal_save_settings_command, personal_api_request_command, personal_download_to_path_command, get_task_queue_command, mark_task_as_dismissed_command, get_app_preferences_command, update_app_preferences_command, get_app_info_command, platform_info_command, storyteller_get_login_session_command, storyteller_get_credits_command, storyteller_get_subscription_command, provider_list_command, get_provider_order_command, load_without_cors_command, get_download_path_command, download_url_command, download_directory_reveal_command, media_file_delete_command, generate_image_command, generate_video_command, generate_audio_command, list_image_models_command, list_video_models_command, estimate_image_cost_command, estimate_video_cost_command, estimate_audio_cost_command, estimate_mesh_cost_command, estimate_splat_cost_command, generate_mesh_command, generate_splat_command, enqueue_image_bg_removal_command, tasks_nuke_all_command,]
}
