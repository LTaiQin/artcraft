use crate::{id, now, vault, Result, MAX_FILE};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::BTreeMap,
  fs,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};
use url::Url;

#[derive(Clone)]
pub struct Store {
  pub root: PathBuf,
  state: Arc<Mutex<Data>>,
  keys: Arc<Mutex<BTreeMap<String, String>>>,
}
#[derive(Serialize, Deserialize, Clone)]
struct Data {
  #[serde(default)]
  configs: BTreeMap<String, ProviderConfig>,
  #[serde(default)]
  assets: Vec<Asset>,
  #[serde(default)]
  jobs: Vec<Job>,
  #[serde(default = "default_preferences")]
  preferences: Value,
}
impl Default for Data {
  fn default() -> Self {
    Self { configs: BTreeMap::new(), assets: Vec::new(), jobs: Vec::new(), preferences: default_preferences() }
  }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
  pub base_url: String,
  pub model: String,
  #[serde(default = "json_format")]
  pub edit_format: String,
  #[serde(default = "default_voice")]
  pub voice: String,
  #[serde(default = "default_language")]
  pub language: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Asset {
  pub token: String,
  pub file: String,
  pub name: String,
  pub kind: String,
  pub mime: String,
  pub created_at: String,
  pub origin: String,
  #[serde(default)]
  pub metadata: Value,
  #[serde(default)]
  pub deleted: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Job {
  pub id: String,
  pub kind: String,
  pub model: String,
  pub request: Value,
  pub status: String,
  pub created_at: String,
  pub updated_at: String,
  #[serde(default)]
  pub provider_id: Option<String>,
  #[serde(default)]
  pub result_ids: Vec<String>,
  #[serde(default)]
  pub output_url: Option<String>,
  #[serde(default)]
  pub message: Option<String>,
  #[serde(default)]
  pub dismissed: bool,
  pub config: ProviderConfig,
}

impl Store {
  pub fn open(root: PathBuf) -> Result<Self> {
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    let mut data: Data = read_json(&root.join("library.json"))?.unwrap_or_default();
    if !data.preferences.is_object() {
      data.preferences = default_preferences();
    }
    for (kind, config) in defaults() {
      data.configs.entry(kind).or_insert(config);
    }
    // Never resubmit a possibly accepted, billable request after restart.
    for job in &mut data.jobs {
      if ["pending", "submitting", "running"].contains(&job.status.as_str()) && job.provider_id.is_none() {
        job.status = "failed".into();
        job.message = Some("上次请求中断，服务商可能已经接受；请先检查服务商记录，避免重复计费".into());
      }
    }
    let keys_path = root.join("keys.dpapi");
    let keys = if keys_path.exists() {
      let bytes = fs::read(keys_path).map_err(|e| e.to_string())?;
      serde_json::from_slice(&vault::unprotect(&bytes)?).map_err(|_| "密钥文件损坏".to_string())?
    } else {
      BTreeMap::new()
    };
    let store = Self { root, state: Arc::new(Mutex::new(data)), keys: Arc::new(Mutex::new(keys)) };
    store.flush()?;
    Ok(store)
  }
  pub fn settings(&self) -> Result<Value> {
    let data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    let keys = self.keys.lock().map_err(|_| "本地密钥忙碌")?;
    let mut configs = serde_json::to_value(&data.configs).map_err(|e| e.to_string())?;
    for (kind, config) in configs.as_object_mut().unwrap() {
      config["hasKey"] = json!(keys.get(kind).is_some_and(|k| !k.is_empty()));
    }
    Ok(configs)
  }
  pub fn save_config(&self, kind: &str, config: ProviderConfig, key: Option<String>, clear_key: bool) -> Result<()> {
    if !["image", "video", "audio"].contains(&kind) {
      return Err("服务类型无效".into());
    }
    validate_base(&config.base_url)?;
    if config.model.trim().is_empty() || config.model.len() > 200 {
      return Err("请输入有效模型 ID".into());
    }
    if !["json", "multipart"].contains(&config.edit_format.as_str()) {
      return Err("图片编辑协议无效".into());
    }
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    let mut keys = self.keys.lock().map_err(|_| "本地密钥忙碌")?;
    let changed_origin = data.configs.get(kind).is_some_and(|old| api_origin(&old.base_url) != api_origin(&config.base_url));
    let supplied = key.filter(|k| !k.trim().is_empty());
    if clear_key || changed_origin {
      keys.remove(kind);
    }
    if let Some(key) = supplied {
      keys.insert(kind.into(), key.trim().into());
    }
    data.configs.insert(kind.into(), config);
    let encrypted = vault::protect(&serde_json::to_vec(&*keys).map_err(|e| e.to_string())?)?;
    atomic_write(&self.root.join("keys.dpapi"), &encrypted)?;
    self.write_data(&data)
  }
  pub fn config(&self, kind: &str) -> Result<ProviderConfig> {
    self.state.lock().map_err(|_| "本地状态忙碌")?.configs.get(kind).cloned().ok_or_else(|| "没有配置这种服务".into())
  }
  pub fn key_for(&self, kind: &str, config: &ProviderConfig) -> Result<String> {
    let current = self.config(kind)?;
    if api_origin(&current.base_url) != api_origin(&config.base_url) {
      return Err("任务使用原来的 API 地址，请恢复对应配置再继续查询；不会把新密钥发送给旧服务".into());
    }
    self.keys.lock().map_err(|_| "本地密钥忙碌")?.get(kind).cloned().filter(|s| !s.is_empty()).ok_or_else(|| "请在 Settings → Personal APIs 中填写 API Key".into())
  }
  pub fn add_asset(&self, bytes: &[u8], name: &str, kind: &str, mime: &str, origin: &str, metadata: Value) -> Result<Asset> {
    if bytes.is_empty() || bytes.len() > MAX_FILE {
      return Err("文件为空或超过 512 MB".into());
    }
    let token = id("mf");
    let extension = extension_for(name, kind, mime);
    let file = format!("{token}.{extension}");
    atomic_write(&self.root.join("assets").join(&file), bytes)?;
    let asset = Asset { token, file, name: name.chars().take(180).collect(), kind: kind.into(), mime: mime.into(), created_at: now(), origin: origin.into(), metadata, deleted: false };
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    data.assets.push(asset.clone());
    self.write_data(&data)?;
    Ok(asset)
  }
  pub fn asset(&self, token: &str) -> Result<Asset> {
    self.state.lock().map_err(|_| "本地状态忙碌")?.assets.iter().find(|a| a.token == token && !a.deleted).cloned().ok_or_else(|| "素材不存在或已删除".into())
  }
  pub fn assets(&self) -> Result<Vec<Asset>> {
    Ok(self.state.lock().map_err(|_| "本地状态忙碌")?.assets.iter().filter(|a| !a.deleted).cloned().collect())
  }
  pub fn path(&self, asset: &Asset) -> PathBuf {
    self.root.join("assets").join(&asset.file)
  }
  pub fn asset_url(&self, asset: &Asset) -> String {
    let path = self.path(asset).to_string_lossy().to_string();
    let encoded: String = url::form_urlencoded::byte_serialize(path.as_bytes()).collect();
    #[cfg(windows)]
    let prefix = "http://asset.localhost/";
    #[cfg(not(windows))]
    let prefix = "asset://localhost/";
    format!("{prefix}{}", encoded.replace('+', "%20"))
  }
  pub fn data_url(&self, token: &str, kind: &str) -> Result<String> {
    let asset = self.asset(token)?;
    if asset.kind != kind {
      return Err(format!("参考素材必须为 {kind}"));
    }
    let bytes = fs::read(self.path(&asset)).map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", asset.mime, STANDARD.encode(bytes)))
  }
  pub fn patch_asset(&self, token: &str, name: Option<&str>, metadata: Value) -> Result<()> {
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    let asset = data.assets.iter_mut().find(|a| a.token == token && !a.deleted).ok_or("素材不存在")?;
    if let Some(name) = name {
      asset.name = name.chars().take(180).collect();
    }
    if let Some(values) = metadata.as_object() {
      if !asset.metadata.is_object() {
        asset.metadata = json!({});
      }
      for (key, value) in values {
        asset.metadata[key] = value.clone();
      }
    }
    self.write_data(&data)
  }
  pub fn replace_scene(&self, token: &str, bytes: &[u8]) -> Result<Asset> {
    let asset = self.asset(token)?;
    if asset.kind != "scene" || bytes.len() > MAX_FILE {
      return Err("场景文件无效".into());
    }
    serde_json::from_slice::<Value>(bytes).map_err(|_| "场景 JSON 无效")?;
    let path = self.path(&asset);
    std::fs::copy(&path, path.with_extension("previous.json")).map_err(|e| e.to_string())?;
    atomic_write(&path, bytes)?;
    Ok(asset)
  }
  pub fn delete_asset(&self, token: &str) -> Result<()> {
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    let asset = data.assets.iter_mut().find(|a| a.token == token).ok_or("素材不存在")?;
    // Soft deletion preserves scene references and accepted cloud jobs.
    asset.deleted = true;
    self.write_data(&data)
  }
  pub fn push_job(&self, job: Job) -> Result<()> {
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    if let Some(token) = job.request["idempotency_token"].as_str().filter(|s| !s.is_empty()) {
      if data.jobs.iter().any(|j| j.request["idempotency_token"].as_str() == Some(token)) {
        return Err("这个生成请求已经记录，请查看任务列表".into());
      }
    }
    data.jobs.push(job);
    self.write_data(&data)
  }
  pub fn update_job(&self, job: &Job) -> Result<()> {
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    let target = data.jobs.iter_mut().find(|j| j.id == job.id).ok_or("任务不存在")?;
    let dismissed = target.dismissed;
    *target = job.clone();
    target.dismissed |= dismissed;
    self.write_data(&data)
  }
  pub fn jobs(&self) -> Result<Vec<Job>> {
    Ok(self.state.lock().map_err(|_| "本地状态忙碌")?.jobs.clone())
  }
  pub fn dismiss(&self, job_id: &str) -> Result<()> {
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    if let Some(job) = data.jobs.iter_mut().find(|j| j.id == job_id) {
      job.dismissed = true;
    }
    self.write_data(&data)
  }
  pub fn preferences(&self) -> Result<Value> {
    Ok(self.state.lock().map_err(|_| "本地状态忙碌")?.preferences.clone())
  }
  pub fn update_preferences(&self, patch: Value) -> Result<Value> {
    let mut data = self.state.lock().map_err(|_| "本地状态忙碌")?;
    if let Some(values) = patch.as_object() {
      for (k, v) in values {
        data.preferences[k] = v.clone();
      }
    }
    self.write_data(&data)?;
    Ok(data.preferences.clone())
  }
  fn flush(&self) -> Result<()> {
    self.write_data(&*self.state.lock().map_err(|_| "本地状态忙碌")?)
  }
  fn write_data(&self, data: &Data) -> Result<()> {
    atomic_write(&self.root.join("library.json"), &serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?)
  }
}

pub fn default_preferences() -> Value {
  json!({"preferred_download_directory":{"system":"downloads"},"preferred_download_filename":"artcraft_convention","auto_download":false,"play_sounds":true})
}
fn defaults() -> BTreeMap<String, ProviderConfig> {
  [("image", "https://api.openai.com/v1", "gpt-image-2.5-sunburst"), ("video", "https://ark.cn-beijing.volces.com/api/v3", "doubao-seedance-2-5-260628"), ("audio", "https://dashscope.aliyuncs.com/api/v1", "qwen3-tts-flash")].into_iter().map(|(kind, base, model)| (kind.into(), ProviderConfig { base_url: base.into(), model: model.into(), edit_format: json_format(), voice: default_voice(), language: default_language() })).collect()
}
fn json_format() -> String {
  "json".into()
}
fn default_voice() -> String {
  "Cherry".into()
}
fn default_language() -> String {
  "Chinese".into()
}
pub fn validate_base(base: &str) -> Result<()> {
  let url = Url::parse(base).map_err(|_| "API 地址无效")?;
  if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
    return Err("API 地址不能包含账号、密码、查询参数或片段".into());
  }
  if url.scheme() != "https" && !(url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))) {
    return Err("API 地址需要 HTTPS；本机测试可使用 loopback HTTP".into());
  }
  Ok(())
}
fn api_origin(base: &str) -> Option<String> {
  Url::parse(base).ok().map(|u| u.origin().ascii_serialization())
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
  let temp = path.with_extension(format!("{}.tmp", id("write")));
  {
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      file.set_permissions(fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
  }
  // std::fs::rename replaces the target atomically on Windows and Unix.
  fs::rename(&temp, path).map_err(|e| e.to_string())
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
  if !path.exists() {
    return Ok(None);
  }
  let bytes = fs::read(path).map_err(|e| e.to_string())?;
  serde_json::from_slice(&bytes).map(Some).map_err(|_| format!("本地数据文件损坏：{}；请保留文件并恢复备份", path.display()))
}
fn extension_for(name: &str, kind: &str, mime: &str) -> String {
  let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
  if ["png", "jpg", "jpeg", "webp", "mp4", "mov", "wav", "mp3", "m4a", "glb", "gltf", "spz", "splat", "bvh", "pmx", "json", "ron"].contains(&ext.as_str()) {
    return ext;
  }
  match (kind, mime) {
    (_, "image/jpeg") => "jpg",
    ("image", _) => "png",
    ("video", _) => "mp4",
    ("audio", _) => "wav",
    ("scene", _) => "json",
    _ => "glb",
  }
  .into()
}
