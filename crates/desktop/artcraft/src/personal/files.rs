use personal_api::{providers, Store, Result};
use std::path::{Path, PathBuf};
use serde_json::Value;

pub async fn load(store: &Store, url: &str) -> Result<Vec<u8>> {
  if let Some(asset) = store.assets()?.iter().find(|a| store.asset_url(a) == url) {
    return std::fs::read(store.path(asset)).map_err(|e| e.to_string());
  }
  if url.starts_with("asset:") || url.contains("asset.localhost") {
    return Err("本地素材不存在".into());
  }
  providers::download(url).await
}
pub fn download_path(store: &Store, request: &Value) -> Result<PathBuf> {
  let url = request["url"].as_str().ok_or("没有下载地址")?;
  let asset = store.assets()?.into_iter().find(|a| store.asset_url(a) == url);
  let name = asset.map(|a| a.name).unwrap_or_else(|| url::Url::parse(url).ok().and_then(|u| u.path_segments().and_then(|mut s| s.next_back()).map(str::to_owned)).unwrap_or_else(|| "ArtCraft-download.bin".into()));
  let name = Path::new(&name).file_name().and_then(|s| s.to_str()).unwrap_or("ArtCraft-download.bin");
  let preferences = store.preferences()?;
  let folder = request["directory"].as_str().map(PathBuf::from).or_else(|| preferences["preferred_download_directory"]["custom"].as_str().map(PathBuf::from)).or_else(dirs::download_dir).unwrap_or_else(|| store.root.join("downloads"));
  std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
  let path = folder.join(name);
  if !path.exists() {
    return Ok(path);
  }
  let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("ArtCraft");
  let ext = Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("bin");
  Ok(folder.join(format!("{stem}-{}.{ext}", personal_api::id("download"))))
}
