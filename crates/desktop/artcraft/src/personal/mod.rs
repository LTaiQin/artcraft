mod commands;
mod files;
mod runtime;

use runtime::PersonalState;
use personal_api::Store;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use commands::personal_get_settings_command::personal_get_settings_command;
use commands::personal_save_settings_command::personal_save_settings_command;
use commands::personal_api_request_command::personal_api_request_command;
use commands::personal_download_to_path_command::personal_download_to_path_command;
use commands::get_task_queue_command::get_task_queue_command;
use commands::mark_task_as_dismissed_command::mark_task_as_dismissed_command;
use commands::get_app_preferences_command::get_app_preferences_command;
use commands::update_app_preferences_command::update_app_preferences_command;
use commands::get_app_info_command::get_app_info_command;
use commands::platform_info_command::platform_info_command;
use commands::storyteller_get_login_session_command::storyteller_get_login_session_command;
use commands::storyteller_get_credits_command::storyteller_get_credits_command;
use commands::storyteller_get_subscription_command::storyteller_get_subscription_command;
use commands::provider_list_command::provider_list_command;
use commands::get_provider_order_command::get_provider_order_command;
use commands::load_without_cors_command::load_without_cors_command;
use commands::get_download_path_command::get_download_path_command;
use commands::download_url_command::download_url_command;
use commands::download_directory_reveal_command::download_directory_reveal_command;
use commands::media_file_delete_command::media_file_delete_command;
use commands::generate_image_command::generate_image_command;
use commands::generate_video_command::generate_video_command;
use commands::generate_audio_command::generate_audio_command;
use commands::list_image_models_command::list_image_models_command;
use commands::list_video_models_command::list_video_models_command;
use commands::estimate_image_cost_command::estimate_image_cost_command;
use commands::estimate_video_cost_command::estimate_video_cost_command;
use commands::estimate_audio_cost_command::estimate_audio_cost_command;
use commands::estimate_mesh_cost_command::estimate_mesh_cost_command;
use commands::estimate_splat_cost_command::estimate_splat_cost_command;
use commands::generate_mesh_command::generate_mesh_command;
use commands::generate_splat_command::generate_splat_command;
use commands::enqueue_image_bg_removal_command::enqueue_image_bg_removal_command;

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_upload::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_log::Builder::default().build())
    .setup(|app| {
      let root = std::env::var_os("ARTCRAFT_PERSONAL_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?);
      let store = Store::open(root).map_err(std::io::Error::other)?;
      let state = PersonalState::new(store);
      app.manage(state.clone());
      // Match the official Tauri main window, including its custom Windows controls.
      let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).title("ArtCraft").resizable(true).fullscreen(false).background_color(tauri::window::Color(0, 0, 0, 0)).enable_clipboard_access().inner_size(1440.0, 900.0);
      #[cfg(windows)]
      let builder = builder.decorations(false);
      #[cfg(target_os = "macos")]
      let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).accept_first_mouse(true);
      builder.build()?;
      state.resume(app.handle());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![personal_get_settings_command, personal_save_settings_command, personal_api_request_command, personal_download_to_path_command, get_task_queue_command, mark_task_as_dismissed_command, get_app_preferences_command, update_app_preferences_command, get_app_info_command, platform_info_command, storyteller_get_login_session_command, storyteller_get_credits_command, storyteller_get_subscription_command, provider_list_command, get_provider_order_command, load_without_cors_command, get_download_path_command, download_url_command, download_directory_reveal_command, media_file_delete_command, generate_image_command, generate_video_command, generate_audio_command, list_image_models_command, list_video_models_command, estimate_image_cost_command, estimate_video_cost_command, estimate_audio_cost_command, estimate_mesh_cost_command, estimate_splat_cost_command, generate_mesh_command, generate_splat_command, enqueue_image_bg_removal_command,])
    .run(tauri::generate_context!("tauri.conf.json"))
    .expect("error while running ArtCraft Personal API");
}
