// The personal build uses the official frontend and Tauri window, with a local API backend.
#[cfg(not(feature = "personal-api"))]
include!("original_cloud.rs");

#[cfg(feature = "personal-api")]
mod personal;
#[cfg(feature = "personal-api")]
pub use personal::run;
