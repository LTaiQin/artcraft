use crate::{now, store::ProviderConfig, text, strings, Asset, Job, Result, Store, MAX_FILE};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{
  Client, Method,
  multipart::{Form, Part},
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, time::Duration};
use url::Url;

const MAX_JSON: usize = 100 * 1024 * 1024;

pub struct ImageInput {
  pub body: Value,
  pub references: Vec<String>,
  pub mask: Option<Vec<u8>>,
}

pub async fn run_job(store: &Store, job: &mut Job) -> Result<Vec<Asset>> {
  let key = store.key_for(&job.kind, &job.config)?;
  job.status = "submitting".into();
  job.updated_at = now();
  store.update_job(job)?;
  let result = match job.kind.as_str() {
    "image" => generate_image(store, &job.config, &key, &job.request, &job.id).await,
    "audio" => generate_audio(store, &job.config, &key, &job.request, &job.id).await,
    "video" => {
      if job.provider_id.is_none() {
        let body = video_payload(store, &job.config, &job.request)?;
        let response = json_request(&job.config, &key, "contents/generations/tasks", Method::POST, Some(body), None).await?;
        let provider_id = response["id"].as_str().filter(|s| !s.is_empty()).ok_or("视频接口未返回任务 ID；请检查服务商记录")?;
        job.provider_id = Some(provider_id.into());
        job.status = "running".into();
        // Persist the accepted cloud ID before issuing any polling request.
        store.update_job(job)?;
      }
      poll_video(store, job, &key).await
    },
    _ => Err("这种生成服务没有配置。现有 API 支持图片、视频和语音；3D 编辑和渲染仍可在本地使用".into()),
  };
  result.map_err(|error| redact(&error, &key))
}

pub fn image_payload(store: &Store, config: &ProviderConfig, request: &Value) -> Result<ImageInput> {
  let prompt = text(request, "prompt").trim();
  if prompt.is_empty() || prompt.chars().count() > 32000 {
    return Err("图片提示词需要 1—32000 个字符".into());
  }
  let count = request["image_batch_count"].as_u64().or_else(|| request["batch_size"].as_u64()).or_else(|| request["number_images"].as_u64()).unwrap_or(1);
  if !(1..=4).contains(&count) {
    return Err("每次生成 1—4 张图片".into());
  }
  let quality = request["quality"].as_str().unwrap_or("auto");
  if !["auto", "low", "medium", "high", "xhigh", "max"].contains(&quality) {
    return Err("图片质量无效".into());
  }
  let mut references = Vec::new();
  for field in ["canvas_image_media_token", "scene_image_media_token", "image_media_token"] {
    if let Some(token) = request[field].as_str().filter(|s| !s.is_empty()) {
      references.push(token.into());
    }
  }
  references.extend(strings(request, "image_media_tokens"));
  let mut seen = BTreeSet::new();
  references.retain(|s| seen.insert(s.clone()));
  if references.len() > 16 {
    return Err("图片编辑最多 16 张参考图".into());
  }
  let mut urls = references.iter().map(|t| store.data_url(t, "image")).collect::<Result<Vec<_>>>()?;
  for field in ["canvas_image_raw_bytes", "scene_image_raw_bytes"] {
    if let Some(bytes) = raw_bytes(&request[field])? {
      urls.insert(0, format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
    }
  }
  if urls.len() > 16 {
    return Err("图片编辑最多 16 张参考图".into());
  }
  let mask = if let Some(token) = request["inpainting_mask_image_media_token"].as_str() {
    let asset = store.asset(token)?;
    if asset.mime != "image/png" {
      return Err("局部编辑蒙版需要 PNG".into());
    }
    Some(fs::read(store.path(&asset)).map_err(|e| e.to_string())?)
  } else {
    raw_bytes(&request["inpainting_mask_image_raw_bytes"])?
  };
  if mask.is_some() && urls.is_empty() {
    return Err("局部编辑需要一张原始图片".into());
  }
  let ratio = request["aspect_ratio"].as_str().or_else(|| request["common_aspect_ratio"].as_str()).unwrap_or("square");
  let resolution = request["resolution"].as_str().or_else(|| request["common_resolution"].as_str()).unwrap_or("one_k");
  let size = image_size(ratio, resolution)?;
  let mut prompt = prompt.to_owned();
  if request["adjust_horizontal_angle"].is_number() || request["adjust_vertical_angle"].is_number() || request["adjust_zoom"].is_number() {
    prompt.push_str(&format!("\nAdjust the viewpoint: horizontal angle {}, vertical angle {}, zoom {}. Preserve subject identity.", request["adjust_horizontal_angle"], request["adjust_vertical_angle"], request["adjust_zoom"]));
  }
  let mut body = json!({"model":config.model,"prompt":prompt,"n":count,"quality":quality,"size":size,"output_format":"png"});
  if !urls.is_empty() {
    body["images"] = json!(urls.iter().map(|u| json!({"image_url":u})).collect::<Vec<_>>());
  }
  if let Some(bytes) = &mask {
    body["mask"] = json!({"image_url":format!("data:image/png;base64,{}",STANDARD.encode(bytes))});
  }
  if request["background"] == "transparent" {
    body["background"] = json!("transparent");
  }
  Ok(ImageInput { body, references, mask })
}

pub fn video_payload(store: &Store, config: &ProviderConfig, request: &Value) -> Result<Value> {
  if !strings(request, "reference_character_tokens").is_empty() {
    return Err("Seedance 官方 API 不支持 ArtCraft 账号中的角色 token；请使用图片、视频或音频参考".into());
  }
  let prompt = text(request, "prompt").trim();
  if prompt.chars().count() > 10000 {
    return Err("视频提示词超过 10000 字符".into());
  }
  let duration = request["duration_seconds"].as_i64().unwrap_or(5);
  if !(4..=30).contains(&duration) {
    return Err("Seedance 2.5 时长需要 4—30 秒".into());
  }
  let resolution = match request["resolution"].as_str().unwrap_or("seven_twenty_p") {
    "four_eighty_p" | "480p" => "480p",
    "seven_twenty_p" | "720p" => "720p",
    "ten_eighty_p" | "1080p" => "1080p",
    _ => return Err("视频分辨率无效".into()),
  };
  let ratio = video_ratio(request["aspect_ratio"].as_str().unwrap_or("wide"))?;
  let first = request["start_frame_image_media_token"].as_str().or_else(|| request["image_media_token"].as_str()).filter(|s| !s.is_empty());
  let last = request["end_frame_image_media_token"].as_str().filter(|s| !s.is_empty());
  let images = strings(request, "reference_image_media_tokens");
  let videos = strings(request, "reference_video_media_tokens");
  let audios = strings(request, "reference_audio_media_tokens");
  if images.len() > 30 || videos.len() > 10 || audios.len() > 10 || images.len() + videos.len() + audios.len() > 50 {
    return Err("参考上限为 30 张图片、10 段视频、10 段音频，总共 50 个".into());
  }
  if last.is_some() && first.is_none() {
    return Err("尾帧必须和首帧一起使用".into());
  }
  if (first.is_some() || last.is_some()) && !images.is_empty() || first.is_some() && (!videos.is_empty() || !audios.is_empty()) {
    return Err("首尾帧与多模态参考需要分开使用".into());
  }
  let mut content = Vec::new();
  if !prompt.is_empty() {
    content.push(json!({"type":"text","text":prompt}));
  }
  if let Some(token) = first {
    content.push(reference(store, token, "image", "first_frame")?);
  }
  if let Some(token) = last {
    content.push(reference(store, token, "image", "last_frame")?);
  }
  for (tokens, kind) in [(images, "image"), (videos, "video"), (audios, "audio")] {
    for token in tokens {
      content.push(reference(store, &token, kind, &format!("reference_{kind}"))?);
    }
  }
  if content.is_empty() {
    return Err("请填写视频提示词或添加参考素材".into());
  }
  Ok(json!({"model":config.model,"content":content,"duration":duration,"resolution":resolution,"ratio":if first.is_some(){"adaptive"}else{ratio},"generate_audio":request["generate_audio"].as_bool().unwrap_or(true),"watermark":false}))
}

pub fn audio_payload(config: &ProviderConfig, request: &Value) -> Result<Value> {
  let prompt = text(request, "prompt").trim();
  if prompt.is_empty() || prompt.chars().count() > 600 {
    return Err("百炼语音合成需要 1—600 个字符".into());
  }
  if !strings(request, "audio_media_tokens").is_empty() || !strings(request, "image_media_tokens").is_empty() {
    return Err("此 Qwen TTS 接口支持文本朗读，请清除参考素材".into());
  }
  let mut input = json!({"text":prompt,"voice":config.voice,"language_type":config.language});
  let instructions = text(request, "style_prompt").trim();
  if !instructions.is_empty() {
    if !config.model.contains("instruct") {
      return Err("声音风格指令需要 qwen3-tts-instruct-flash 模型".into());
    }
    input["instructions"] = json!(instructions);
  }
  Ok(json!({"model":config.model,"input":input}))
}

async fn generate_image(store: &Store, config: &ProviderConfig, key: &str, request: &Value, job_id: &str) -> Result<Vec<Asset>> {
  let input = image_payload(store, config, request)?;
  let edits = input.body.get("images").is_some();
  let suffix = if edits { "images/edits" } else { "images/generations" };
  let (body, form) = if edits && config.edit_format == "multipart" {
    let mut form = Form::new();
    for (key, value) in input.body.as_object().unwrap() {
      if !["images", "mask"].contains(&key.as_str()) {
        form = form.text(key.clone(), value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()));
      }
    }
    // Include raw canvas images too, using the exact same ordered list as JSON edits.
    for (index, value) in input.body["images"].as_array().unwrap().iter().enumerate() {
      let data = text(value, "image_url");
      let (meta, data) = data.split_once(',').ok_or("参考图片内容无效")?;
      let mime = meta.trim_start_matches("data:").split(';').next().unwrap_or("image/png");
      let bytes = STANDARD.decode(data).map_err(|_| "参考图片编码无效")?;
      form = form.part("image[]", Part::bytes(bytes).file_name(format!("reference-{index}.png")).mime_str(mime).map_err(|e| e.to_string())?);
    }
    if let Some(mask) = input.mask {
      form = form.part("mask", Part::bytes(mask).file_name("mask.png").mime_str("image/png").map_err(|e| e.to_string())?);
    }
    (None, Some(form))
  } else {
    (Some(input.body), None)
  };
  let result = json_request(config, key, suffix, Method::POST, body, form).await?;
  let data = result["data"].as_array().filter(|v| !v.is_empty()).ok_or("图片接口未返回 data 图片列表")?;
  let mut assets = Vec::new();
  for item in data {
    let bytes = if let Some(b64) = item["b64_json"].as_str() {
      STANDARD.decode(b64).map_err(|_| "图片 Base64 数据无效")?
    } else if let Some(url) = item["url"].as_str() {
      download(url).await?
    } else {
      return Err("图片接口未返回 b64_json 或 url".into());
    };
    let image = image::load_from_memory(&bytes).map_err(|_| "服务没有返回可解码的图片")?;
    let mut output = std::io::Cursor::new(Vec::new());
    image.write_to(&mut output, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    assets.push(store.add_asset(&output.into_inner(), "GPT-Image.png", "image", "image/png", "inference", json!({"prompt":text(request,"prompt"),"model":config.model,"job_id":job_id}))?);
  }
  Ok(assets)
}
async fn generate_audio(store: &Store, config: &ProviderConfig, key: &str, request: &Value, job_id: &str) -> Result<Vec<Asset>> {
  let result = json_request(config, key, "services/aigc/multimodal-generation/generation", Method::POST, Some(audio_payload(config, request)?), None).await?;
  let audio = &result["output"]["audio"];
  let bytes = if let Some(url) = audio["url"].as_str() {
    download(url).await?
  } else if let Some(data) = audio["data"].as_str() {
    STANDARD.decode(data).map_err(|_| "音频编码无效")?
  } else {
    return Err("百炼接口未返回音频地址或内容".into());
  };
  Ok(vec![store.add_asset(&bytes, "Qwen-Voice.wav", "audio", "audio/wav", "inference", json!({"prompt":text(request,"prompt"),"model":config.model,"job_id":job_id}))?])
}
async fn poll_video(store: &Store, job: &mut Job, key: &str) -> Result<Vec<Asset>> {
  if job.output_url.is_none() {
    let provider_id = job.provider_id.as_deref().ok_or("缺少云端任务 ID")?;
    if !provider_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
      return Err("云端任务 ID 无效".into());
    }
    let suffix = format!("contents/generations/tasks/{provider_id}");
    let result = json_request(&job.config, key, &suffix, Method::GET, None, None).await?;
    match text(&result, "status") {
      "succeeded" => {
        let output = result["content"]["video_url"].as_str().ok_or("视频完成但没有下载地址")?;
        job.output_url = Some(output.into());
        job.status = "downloading".into();
        store.update_job(job)?;
      },
      "failed" | "cancelled" | "expired" => {
        return Err(format!("云端视频任务失败：{}", result["error"]["message"].as_str().unwrap_or("请查看服务商记录")));
      },
      "queued" | "running" => {
        job.status = "running".into();
        job.updated_at = now();
        store.update_job(job)?;
        return Ok(Vec::new());
      },
      _ => return Err("视频接口返回未知任务状态；已保留任务 ID，不会重复提交".into()),
    }
  }
  let bytes = download(job.output_url.as_deref().unwrap()).await?;
  let asset = store.add_asset(&bytes, "Seedance-Video.mp4", "video", "video/mp4", "inference", json!({"prompt":text(&job.request,"prompt"),"model":job.config.model,"job_id":job.id,"duration_millis":job.request["duration_seconds"].as_u64().unwrap_or(5)*1000}))?;
  Ok(vec![asset])
}

pub async fn json_request(config: &ProviderConfig, key: &str, suffix: &str, method: Method, body: Option<Value>, form: Option<Form>) -> Result<Value> {
  crate::store::validate_base(&config.base_url)?;
  let timeout = if method == Method::GET { 45 } else { 240 };
  let client = Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(timeout)).build().map_err(|e| e.to_string())?;
  let url = format!("{}/{}", config.base_url.trim_end_matches('/'), suffix.trim_start_matches('/'));
  let mut request = client.request(method, &url).bearer_auth(key);
  if let Some(body) = body {
    request = request.json(&body);
  }
  if let Some(form) = form {
    request = request.multipart(form);
  }
  // POST is intentionally attempted once. A timeout can mean it was accepted.
  let response = request.send().await.map_err(|_| "API 请求中断或超时；生成请求可能已被接受，请先检查服务商记录，避免重复计费".to_string())?;
  let status = response.status();
  let bytes = read_limited(response, MAX_JSON).await?;
  let result: Value = serde_json::from_slice(&bytes).map_err(|_| format!("API 返回非 JSON 内容（HTTP {}）；请检查地址和协议", status.as_u16()))?;
  if !status.is_success() || result.get("error").is_some() && !["failed", "cancelled", "expired"].contains(&text(&result, "status")) || result.get("code").is_some() && result.get("output").is_none() {
    return Err(redact(&format!("HTTP {} · {}", status.as_u16(), result["error"]["message"].as_str().or_else(|| result["message"].as_str()).unwrap_or("服务拒绝请求")), key));
  }
  Ok(result)
}
pub async fn download(url: &str) -> Result<Vec<u8>> {
  let parsed = Url::parse(url).map_err(|_| "媒体地址无效")?;
  if !["https", "http"].contains(&parsed.scheme()) || !parsed.username().is_empty() || parsed.password().is_some() {
    return Err("媒体下载地址无效".into());
  }
  // Separate client: no Authorization or provider cookies are sent to the CDN.
  let client = Client::builder().timeout(Duration::from_secs(180)).redirect(reqwest::redirect::Policy::limited(5)).build().map_err(|e| e.to_string())?;
  let response = client.get(parsed).send().await.map_err(|_| "下载失败；云端视频任务 ID 已保存，稍后会继续下载".to_string())?;
  if !response.status().is_success() {
    return Err(format!("下载失败（HTTP {}）", response.status().as_u16()));
  }
  read_limited(response, MAX_FILE).await
}
async fn read_limited(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
  if response.content_length().is_some_and(|s| s > limit as u64) {
    return Err("响应超过大小限制".into());
  }
  let mut bytes = Vec::new();
  while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
    if bytes.len() + chunk.len() > limit {
      return Err("响应超过大小限制".into());
    }
    bytes.extend_from_slice(&chunk);
  }
  Ok(bytes)
}
fn reference(store: &Store, token: &str, kind: &str, role: &str) -> Result<Value> {
  let url = store.data_url(token, kind)?;
  let key = format!("{kind}_url");
  let mut value = json!({"type":key,"role":role});
  value[&key] = json!({"url":url});
  Ok(value)
}
fn raw_bytes(value: &Value) -> Result<Option<Vec<u8>>> {
  if value.is_null() {
    return Ok(None);
  }
  let values: Vec<&Value> = if let Some(arr) = value.as_array() {
    arr.iter().collect()
  } else if let Some(obj) = value.as_object() {
    let mut indexed = obj.iter().map(|(key, val)| key.parse::<usize>().map(|i| (i, val)).map_err(|_| "原始图片字节索引无效".to_string())).collect::<Result<Vec<_>>>()?;
    indexed.sort_by_key(|(i, _)| *i);
    indexed.into_iter().map(|(_, v)| v).collect()
  } else {
    return Err("原始图片字节无效".into());
  };
  if values.is_empty() || values.len() > MAX_FILE {
    return Err("原始图片为空或过大".into());
  }
  values.into_iter().map(|v| v.as_u64().filter(|v| *v < 256).map(|v| v as u8).ok_or_else(|| "原始图片字节无效".into())).collect::<Result<Vec<_>>>().map(Some)
}
fn image_size(ratio: &str, resolution: &str) -> Result<String> {
  let base = match resolution {
    "one_k" | "1k" => 1024,
    "two_k" | "2k" => 2048,
    "four_k" | "4k" => 2880,
    _ => return Err("图片分辨率无效".into()),
  };
  match ratio {
    "auto" => Ok("auto".into()),
    "square" | "1:1" => Ok(format!("{base}x{base}")),
    "wide" | "wide_sixteen_by_nine" | "16:9" => Ok(if base == 2880 { "3840x2160".into() } else { format!("{base}x{}", base * 9 / 16) }),
    "tall" | "tall_nine_by_sixteen" | "9:16" => Ok(if base == 2880 { "2160x3840".into() } else { format!("{}x{base}", base * 9 / 16) }),
    _ => Err("图片画幅无效".into()),
  }
}
fn video_ratio(ratio: &str) -> Result<&str> {
  Ok(match ratio {
    "auto" => "adaptive",
    "square" | "1:1" => "1:1",
    "wide" | "wide_sixteen_by_nine" | "16:9" => "16:9",
    "tall" | "tall_nine_by_sixteen" | "9:16" => "9:16",
    "wide_four_by_three" | "4:3" => "4:3",
    "tall_three_by_four" | "3:4" => "3:4",
    "cinematic" | "wide_twenty_one_by_nine" | "21:9" => "21:9",
    _ => return Err("视频画幅无效".into()),
  })
}
pub fn redact(message: &str, key: &str) -> String {
  if key.is_empty() {
    message.chars().take(700).collect()
  } else {
    message.replace(key, "[密钥已隐藏]").chars().take(700).collect()
  }
}
