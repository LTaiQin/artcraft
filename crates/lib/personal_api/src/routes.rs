//! Compatibility for the original frontend's session, library and job API contracts.
//! These routes run in-process through Tauri IPC; no HTTP server or account is needed.
use crate::{catalog, text, Asset, Job, Result, Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

#[derive(Deserialize, Serialize)]
pub struct LocalRequest {
  pub url: String,
  #[serde(default = "get")]
  pub method: String,
  #[serde(default)]
  pub body: Value,
  #[serde(default)]
  pub files: Vec<UploadFile>,
}
#[derive(Deserialize, Serialize)]
pub struct UploadFile {
  pub field: String,
  pub name: String,
  pub mime: String,
  pub base64: String,
}
fn get() -> String {
  "GET".into()
}

pub fn request(store: &Store, req: LocalRequest) -> Result<Value> {
  let url = Url::parse(&req.url).map_err(|_| "本地 API 地址无效")?;
  let path = url.path();
  let query = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
  if path == "/v1/session" {
    return Ok(json!({"success":true,"logged_in":true,"user":user()}));
  }
  if path == "/v1/session_token" {
    return Ok(json!({"success":true,"session_token":"local-desktop"}));
  }
  if path.contains("active_subscriptions") {
    return Ok(json!({"success":true,"active_subscriptions":[],"maybe_loyalty_program":null}));
  }
  if path.ends_with("/profile") {
    return Ok(json!({"success":true,"user":user()}));
  }
  if let Some(kind) = path.strip_prefix("/v1/omni_gen/models/") {
    return catalog::models(store, kind);
  }
  if path.starts_with("/v1/omni_gen/cost/") {
    return Ok(catalog::cost());
  }
  if path == "/v1/jobs/session" || path == "/v1/jobs/batch" {
    let jobs = store.jobs()?.into_iter().filter(|j| !j.dismissed).rev().map(|j| job_json(store, &j)).collect::<Vec<_>>();
    return Ok(json!({"success":true,"jobs":jobs,"job_states":jobs}));
  }
  if let Some(token) = path.strip_prefix("/v1/jobs/job/") {
    if req.method == "DELETE" {
      store.dismiss(token)?;
      return Ok(json!({"success":true}));
    }
    let job = store.jobs()?.into_iter().find(|j| j.id == token).ok_or("任务不存在")?;
    return Ok(json!({"success":true,"state":job_json(store,&job)}));
  }
  if path.starts_with("/v1/media_files/upload/") || path == "/v1/image_studio/scene_snapshot" {
    let file = req.files.into_iter().find(|f| ["file", "snapshot", "screenshot"].contains(&f.field.as_str())).ok_or("未收到上传文件")?;
    let bytes = STANDARD.decode(&file.base64).map_err(|_| "上传文件编码无效")?;
    let ext = std::path::Path::new(&file.name).extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let kind = if path.contains("scene_snapshot") || file.mime.starts_with("image/") {
      "image"
    } else if path.contains("new_scene") || path.contains("saved_scene") {
      "scene"
    } else if file.mime.starts_with("audio/") || path.ends_with("/audio") {
      "audio"
    } else if file.mime.starts_with("video/") || path.ends_with("/new_video") {
      "video"
    } else if ["bvh", "fbx"].contains(&ext.as_str()) {
      "animation"
    } else if ["pmx", "pmx2", "mmd"].contains(&ext.as_str()) {
      "character"
    } else if path.ends_with("/spz") {
      "splat"
    } else {
      "prop"
    };
    let mime = if file.mime.is_empty() {
      match kind {
        "scene" => "application/json",
        "prop" => "model/gltf-binary",
        _ => "application/octet-stream",
      }
      .into()
    } else {
      file.mime
    };
    let asset = if let Some(token) = path.strip_prefix("/v1/media_files/upload/saved_scene/") {
      store.replace_scene(token, &bytes)?
    } else {
      let name = req.body["maybe_title"].as_str().unwrap_or(&file.name);
      store.add_asset(&bytes, name, kind, &mime, "upload", req.body.clone())?
    };
    return Ok(json!({"success":true,"media_file_token":asset.token,"scene_snapshot_media_file_token":asset.token,"media_file":media_json(store,&asset),"cdn_url":store.asset_url(&asset)}));
  }
  if let Some(token) = path.strip_prefix("/v1/media_files/rename/") {
    store.patch_asset(token, Some(text(&req.body, "name")), json!({}))?;
    return Ok(json!({"success":true}));
  }
  if let Some(token) = path.strip_prefix("/v1/media_files/cover_image/") {
    store.asset(text(&req.body, "cover_image_media_file_token"))?;
    store.patch_asset(token, None, json!({"cover_token":req.body["cover_image_media_file_token"]}))?;
    return Ok(json!({"success":true}));
  }
  if path.starts_with("/v1/media_files/visibility/") {
    return Err("本地素材只保存在当前电脑。请使用 Download 导出后分享文件".into());
  }
  if let Some(token) = path.strip_prefix("/v1/media_files/file/") {
    if req.method == "DELETE" {
      store.delete_asset(token)?;
      return Ok(json!({"success":true}));
    }
    return Ok(json!({"success":true,"media_file":media_json(store,&store.asset(token)?)}));
  }
  if path == "/v1/media_files/batch" {
    let tokens = url.query_pairs().filter(|(k, _)| k == "tokens").map(|(_, v)| v.into_owned()).collect::<Vec<_>>();
    let files = tokens.iter().filter_map(|t| store.asset(t).ok()).map(|a| media_json(store, &a)).collect::<Vec<_>>();
    return Ok(json!({"success":true,"media_files":files}));
  }
  if let Some(token) = path.strip_prefix("/v1/media_files/batch/") {
    let files = store.assets()?.iter().filter(|a| a.metadata["job_id"].as_str() == Some(token)).map(|a| media_json(store, a)).collect::<Vec<_>>();
    return Ok(json!({"success":true,"results":files}));
  }
  if path.starts_with("/v1/media_files/list") || path.starts_with("/v1/media_files/search_") || path == "/v1/media_files/mesh/list" || path == "/v1/media_files/splat/list" {
    let mut files = if path.contains("featured") { Vec::new() } else { store.assets()? };
    let classes = query("filter_media_classes").or_else(|| query("filter_engine_categories")).unwrap_or_default();
    let types = query("filter_media_type").unwrap_or_default();
    let term = query("search_term").unwrap_or_default().to_lowercase();
    let include_uploads = query("include_user_uploads").as_deref() != Some("false");
    let uploads_only = query("user_uploads_only").as_deref() == Some("true");
    files.retain(|a| (classes.is_empty() || classes.split(',').any(|c| c == a.kind)) && (types.is_empty() || types.split(',').any(|t| t == media_type(a))) && (term.is_empty() || a.name.to_lowercase().contains(&term)) && (include_uploads || a.origin == "inference") && (!uploads_only || a.origin == "upload"));
    if path == "/v1/media_files/mesh/list" {
      files.retain(|a| ["prop", "character", "mesh"].contains(&a.kind.as_str()));
    }
    if path == "/v1/media_files/splat/list" {
      files.retain(|a| a.kind == "splat");
    }
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    if query("sort_ascending").as_deref() == Some("true") {
      files.reverse();
    }
    let size = query("page_size").and_then(|s| s.parse::<usize>().ok()).unwrap_or(50).clamp(1, 100);
    let page = query("page_index").and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
    let offset = query("cursor").and_then(|s| s.parse::<usize>().ok()).unwrap_or(page * size);
    let total = files.len();
    let results = files.into_iter().skip(offset).take(size).map(|a| media_json(store, &a)).collect::<Vec<_>>();
    let has_more = offset + results.len() < total;
    return Ok(json!({"success":true,"results":results,"pagination":{"current":page,"page_index":page,"page_size":size,"total_page_count":total.div_ceil(size),"total_results":total,"has_next":has_more,"maybe_next":if has_more{Some((offset+size).to_string())}else{None},"has_more":has_more,"next_cursor":if has_more{Some((offset+size).to_string())}else{None},"maybe_next_cursor":if has_more{Some((offset+size).to_string())}else{None}}}));
  }
  if path == "/v1/prompt/batch" {
    let tokens = url.query_pairs().filter(|(k, _)| k == "tokens").map(|(_, v)| v.into_owned()).collect::<Vec<_>>();
    let prompts = store.jobs()?.iter().filter(|j| tokens.contains(&j.id)).map(prompt_json).collect::<Vec<_>>();
    return Ok(json!({"success":true,"prompts":prompts}));
  }
  if let Some(token) = path.strip_prefix("/v1/prompts/") {
    let job = store.jobs()?.into_iter().find(|j| j.id == token).ok_or("生成记录不存在")?;
    return Ok(json!({"success":true,"prompt":prompt_json(&job)}));
  }
  if path.contains("characters") || path.contains("/weights/") || path.contains("/bookmarks/") {
    return Ok(json!({"success":true,"results":[],"characters":[],"weights":[],"pagination":{"has_next":false,"has_more":false}}));
  }
  if path == "/v1/logout" {
    return Ok(json!({"success":true}));
  }
  Err(format!("个人 API 版尚不支持这个原版云端服务：{path}"))
}

pub fn user() -> Value {
  json!({"user_token":"local_desktop","username":"local","display_name":"Personal workspace","email_address":"","can_access_studio":true,"can_upload_media_files":true,"role":"user","email_gravatar_hash":"","core_info":{"user_token":"local_desktop","username":"local","display_name":"Personal workspace","gravatar_hash":"","default_avatar":{"color_index":0,"image_index":0}},"maybe_feature_flags":[]})
}
pub fn media_json(store: &Store, asset: &Asset) -> Value {
  let url = store.asset_url(asset);
  let cover = asset.metadata["cover_token"].as_str().and_then(|t| store.asset(t).ok()).map(|a| store.asset_url(&a));
  json!({"token":asset.token,"media_type":media_type(asset),"media_class":asset.kind,"maybe_engine_extension":asset.file.rsplit('.').next(),"maybe_original_filename":asset.name,"maybe_title":asset.name,"maybe_batch_token":asset.metadata["job_id"],"maybe_prompt_token":asset.metadata["job_id"],"maybe_creator_user":user(),"origin":{"origin_category":asset.origin,"product_category":format!("{}_generation",asset.kind),"maybe_model":{"title":asset.metadata["model"]}},"origin_category":asset.origin,"origin_product_category":format!("{}_generation",asset.kind),"maybe_origin_model_type":asset.metadata["model"],"maybe_model_type":asset.metadata["model"],"maybe_duration_millis":asset.metadata["duration_millis"],"public_bucket_path":url,"public_bucket_url":url,"media_links":{"cdn_url":url,"thumbnail_template":if asset.kind=="image"{Some(&url)}else{None},"maybe_thumbnail_template":if asset.kind=="image"{Some(&url)}else{None}},"cover_image":{"maybe_cover_image_public_bucket_path":cover,"maybe_cover_image_public_bucket_url":cover,"maybe_links":{"cdn_url":cover,"maybe_thumbnail_template":cover},"default_cover":{"image_index":0,"color_index":0}},"creator_set_visibility":"private","stats":{"positive_rating_count":0,"bookmark_count":0},"created_at":asset.created_at,"updated_at":asset.created_at})
}
pub fn job_json(store: &Store, job: &Job) -> Value {
  let asset = job.result_ids.first().and_then(|t| store.asset(t).ok());
  let status = match job.status.as_str() {
    "completed" => "complete_success",
    "failed" => "complete_failure",
    "pending" | "submitting" => "pending",
    _ => "started",
  };
  json!({"job_token":job.id,"created_at":job.created_at,"updated_at":job.updated_at,"request":{"inference_category":format!("{}_generation",job.kind),"maybe_model_title":job.model,"maybe_model_type":job.model,"maybe_model_token":job.model,"maybe_prompt_token":job.id,"maybe_raw_inference_text":text(&job.request,"prompt"),"maybe_style_name":""},"status":{"status":status,"attempt_count":1,"requires_keepalive":false,"progress_percentage":if job.status=="completed"{100}else{0},"maybe_failure_category":if job.status=="failed"{Some("generation_failed")}else{None},"maybe_failure_message":job.message,"maybe_extra_status_description":job.message,"maybe_first_started_at":job.created_at},"maybe_result":asset.map(|a|json!({"entity_token":a.token,"entity_type":"media_file","maybe_batch_token":job.id,"maybe_successfully_completed_at":job.updated_at,"media_links":{"cdn_url":store.asset_url(&a)},"maybe_public_bucket_media_path":store.asset_url(&a)}))})
}
pub fn task_json(store: &Store, job: &Job) -> Value {
  let status = match job.status.as_str() {
    "completed" => "complete_success",
    "failed" => "complete_failure",
    "pending" => "pending",
    _ => "started",
  };
  let asset = job.result_ids.first().and_then(|t| store.asset(t).ok());
  json!({"id":job.id,"task_status":status,"task_type":format!("{}_generation",job.kind),"model_type":job.model,"provider":"artcraft","provider_job_id":job.provider_id,"created_at":job.created_at,"updated_at":job.updated_at,"completed_at":if job.status=="completed"{Some(&job.updated_at)}else{None},"failure_reason":if job.status=="failed"{Some(json!({"failure_type":"generation_failed","failure_message":job.message}))}else{None},"completed_item":asset.map(|a|json!({"primary_media_file":{"token":a.token,"cdn_url":store.asset_url(&a),"created_at":a.created_at,"maybe_thumbnail_url_template":if a.kind=="image"{Some(store.asset_url(&a))}else{None}},"media_file_class":a.kind,"maybe_batch_token":job.id}))})
}
fn media_type(asset: &Asset) -> &str {
  match asset.kind.as_str() {
    "prop" | "mesh" => "glb",
    "character" => "pmx",
    "scene" => "scene_json",
    "splat" => "glb",
    "animation" => "bvh",
    kind => kind,
  }
}
fn prompt_json(job: &Job) -> Value {
  json!({"token":job.id,"maybe_positive_prompt":text(&job.request,"prompt"),"maybe_model_type":job.model,"maybe_generation_provider":"artcraft","maybe_prompt_args":job.request,"created_at":job.created_at,"updated_at":job.updated_at})
}
