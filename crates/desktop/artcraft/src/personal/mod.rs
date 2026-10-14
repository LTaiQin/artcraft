pub(crate) mod commands;
mod files;
mod runtime;

use runtime::PersonalState;
use personal_api::Store;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub fn run() {
  startup_note("starting_runtime");
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_upload::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_log::Builder::default().build())
    .setup(|app| {
      startup_note("setup_started");
      let root = std::env::var_os("ARTCRAFT_PERSONAL_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?);
      let store = Store::open(root).map_err(std::io::Error::other)?;
      startup_note("local_store_ready");
      let state = PersonalState::new(store);
      app.manage(state.clone());
      // Match the official Tauri main window, including its custom Windows controls.
      let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).title("ArtCraft").resizable(true).fullscreen(false).background_color(tauri::window::Color(0, 0, 0, 0)).enable_clipboard_access().inner_size(1440.0, 900.0);
      #[cfg(windows)]
      let builder = builder.decorations(false);
      #[cfg(target_os = "macos")]
      let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).accept_first_mouse(true);
      startup_note("creating_window");
      let builder = if let Ok(args) = std::env::var("ARTCRAFT_ACCEPTANCE_BROWSER_ARGS") { builder.additional_browser_args(&args) } else { builder };
      builder.build()?;
      startup_note("window_created");
      state.resume(app.handle());
      Ok(())
    })
    .invoke_handler(crate::personal_handler())
    .run(tauri::generate_context!("tauri.conf.json"))
    .expect("error while running ArtCraft Personal API");
}

fn startup_note(message: &str) {
  log::info!("ArtCraft startup: {message}");
  if let Some(path) = std::env::var_os("ARTCRAFT_ACCEPTANCE_LOG") {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
      let _ = writeln!(file, "{message}");
    }
  }
}
