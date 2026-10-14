use personal_api::{
  catalog, id, now, providers,
  routes::{self, LocalRequest},
  Job, Store,
};
use serde_json::{json, Value};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn local_library_upload_scene_filter_and_pagination_survive_restart() {
  let dir = tempfile::tempdir().unwrap();
  let store = Store::open(dir.path().into()).unwrap();
  let image = store.add_asset(b"image-fixture", "test.png", "image", "image/png", "upload", json!({})).unwrap();
  let scene = store.add_asset(br#"{"scene":"fixture"}"#, "Scene.json", "scene", "application/json", "upload", json!({})).unwrap();
  let req = |path: &str| LocalRequest { url: format!("https://personal.artcraft.local{path}"), method: "GET".into(), body: Value::Null, files: vec![] };
  let session = routes::request(&store, req("/v1/session")).unwrap();
  assert_eq!(session["user"]["username"], "local");
  let result = routes::request(&store, req("/v1/media_files/list/user/local?filter_media_classes=scene&page_size=1")).unwrap();
  assert_eq!(result["results"][0]["token"], scene.token);
  assert_eq!(result["results"].as_array().unwrap().len(), 1);
  drop(store);
  let reopened = Store::open(dir.path().into()).unwrap();
  assert_eq!(reopened.assets().unwrap().len(), 2);
  reopened.delete_asset(&image.token).unwrap();
  assert_eq!(reopened.assets().unwrap().len(), 1);
}

#[test]
fn api_origin_change_clears_keys_and_blocks_old_job_credentials() {
  let dir = tempfile::tempdir().unwrap();
  let store = Store::open(dir.path().into()).unwrap();
  let old = store.config("image").unwrap();
  store.save_config("image", old.clone(), Some("fixture-key".into()), false).unwrap();
  assert!(store.settings().unwrap()["image"]["hasKey"].as_bool().unwrap());
  assert!(!store.settings().unwrap().to_string().contains("fixture-key"));
  let mut next = old.clone();
  next.base_url = "https://compatible.example/v1".into();
  store.save_config("image", next.clone(), None, false).unwrap();
  assert_eq!(store.settings().unwrap()["image"]["hasKey"], false);
  store.save_config("image", next, Some("new-key".into()), false).unwrap();
  assert!(store.key_for("image", &old).is_err());
  assert!(!std::fs::read_to_string(dir.path().join("library.json")).unwrap().contains("new-key"));
  for base in ["http://evil.example/v1", "https://key:secret@api.example/v1", "https://api.example/v1?key=foo"] {
    let mut config = old.clone();
    config.base_url = base.into();
    assert!(store.save_config("image", config, None, false).is_err());
  }
}

#[test]
fn editor_payload_preserves_canvas_references_and_inpaint_mask() {
  let dir = tempfile::tempdir().unwrap();
  let store = Store::open(dir.path().into()).unwrap();
  let a = store.add_asset(b"canvas", "canvas.png", "image", "image/png", "upload", json!({})).unwrap();
  let b = store.add_asset(b"ref", "ref.png", "image", "image/png", "upload", json!({})).unwrap();
  let input = providers::image_payload(&store, &store.config("image").unwrap(), &json!({"prompt":"edit the scene","canvas_image_media_token":a.token,"image_media_tokens":[a.token,b.token],"inpainting_mask_image_raw_bytes":[1,2,3,4],"aspect_ratio":"wide","resolution":"four_k","batch_size":2})).unwrap();
  assert_eq!(input.body["images"].as_array().unwrap().len(), 2);
  assert_eq!(input.body["size"], "3840x2160");
  assert_eq!(input.body["n"], 2);
  assert_eq!(input.body["mask"]["image_url"], format!("data:image/png;base64,{}", STANDARD.encode([1, 2, 3, 4])));
  assert!(providers::video_payload(&store, &store.config("video").unwrap(), &json!({"prompt":"scene","duration_seconds":31})).is_err());
  assert!(providers::video_payload(&store, &store.config("video").unwrap(), &json!({"prompt":"scene","start_frame_image_media_token":a.token,"reference_image_media_tokens":[b.token]})).is_err());
  assert!(providers::audio_payload(&store.config("audio").unwrap(), &json!({"prompt":"中".repeat(601)})).is_err());
  assert_eq!(catalog::cost()["is_free"], false);
}

#[tokio::test]
async fn official_http_protocols_and_video_restart_never_repeat_post() {
  let calls = Arc::new(Mutex::new(Vec::<(String, String, String)>::new()));
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  let base = format!("http://{address}/v1");
  let capture = calls.clone();
  let server = tokio::spawn(async move {
    loop {
      let (mut socket, _) = listener.accept().await.unwrap();
      let calls = capture.clone();
      tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 8192];
        let header_end = loop {
          let n = socket.read(&mut chunk).await.unwrap();
          if n == 0 {
            return;
          }
          buffer.extend_from_slice(&chunk[..n]);
          if let Some(i) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
          }
        };
        let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
        let length = head.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
        while buffer.len() < header_end + length {
          let n = socket.read(&mut chunk).await.unwrap();
          if n == 0 {
            break;
          }
          buffer.extend_from_slice(&chunk[..n]);
        }
        let first = head.lines().next().unwrap().to_owned();
        let body = String::from_utf8_lossy(&buffer[header_end..]).to_string();
        calls.lock().unwrap().push((first.clone(), head, body));
        let result = if first.starts_with("POST /v1/contents/generations/tasks ") {
          json!({"id":"task-fixture"})
        } else if first.starts_with("GET /v1/contents/generations/tasks/task-fixture ") {
          json!({"status":"succeeded","content":{"video_url":format!("http://{address}/media/video")}})
        } else if first.starts_with("POST /v1/images/generations ") || first.starts_with("POST /v1/images/edits ") {
          let image = image::DynamicImage::new_rgba8(32, 32);
          let mut png = std::io::Cursor::new(Vec::new());
          image.write_to(&mut png, image::ImageFormat::Png).unwrap();
          json!({"data":[{"b64_json":STANDARD.encode(png.into_inner())}]})
        } else if first.starts_with("POST /v1/services/aigc/multimodal-generation/generation ") {
          json!({"output":{"audio":{"url":format!("http://{address}/media/audio")}}})
        } else {
          Value::Null
        };
        let bytes = if result.is_null() { b"fixture-media".to_vec() } else { serde_json::to_vec(&result).unwrap() };
        let header = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n", bytes.len());
        socket.write_all(header.as_bytes()).await.unwrap();
        socket.write_all(&bytes).await.unwrap();
      });
    }
  });
  let dir = tempfile::tempdir().unwrap();
  let store = Store::open(dir.path().into()).unwrap();
  for kind in ["image", "video", "audio"] {
    let mut config = store.config(kind).unwrap();
    config.base_url = base.clone();
    store.save_config(kind, config, Some("fixture-key".into()), false).unwrap();
  }
  let make_job = |kind: &str, request: Value| Job { id: id("job"), kind: kind.into(), model: store.config(kind).unwrap().model.clone(), request, status: "pending".into(), created_at: now(), updated_at: now(), provider_id: None, result_ids: vec![], output_url: None, message: None, dismissed: false, config: store.config(kind).unwrap() };
  let mut image = make_job("image", json!({"prompt":"draw","batch_size":1}));
  store.push_job(image.clone()).unwrap();
  let assets = providers::run_job(&store, &mut image).await.unwrap();
  assert_eq!(assets.len(), 1);
  let mut config = store.config("image").unwrap();
  config.edit_format = "multipart".into();
  store.save_config("image", config, None, false).unwrap();
  let mut edit = make_job("image", json!({"prompt":"edit","image_media_tokens":[assets[0].token],"inpainting_mask_image_raw_bytes":[1,2,3]}));
  store.push_job(edit.clone()).unwrap();
  providers::run_job(&store, &mut edit).await.unwrap();
  let mut audio = make_job("audio", json!({"prompt":"你好"}));
  store.push_job(audio.clone()).unwrap();
  providers::run_job(&store, &mut audio).await.unwrap();
  // Simulate an accepted cloud task persisted before process termination.
  let mut video = make_job("video", json!({"prompt":"move","duration_seconds":5}));
  let key = store.key_for("video", &video.config).unwrap();
  let result = providers::json_request(&video.config, &key, "contents/generations/tasks", reqwest::Method::POST, Some(providers::video_payload(&store, &video.config, &video.request).unwrap()), None).await.unwrap();
  video.provider_id = Some(result["id"].as_str().unwrap().into());
  video.status = "running".into();
  store.push_job(video.clone()).unwrap();
  let reopened = Store::open(dir.path().into()).unwrap();
  let mut recovered = reopened.jobs().unwrap().into_iter().find(|j| j.id == video.id).unwrap();
  let result = providers::run_job(&reopened, &mut recovered).await.unwrap();
  assert_eq!(result.len(), 1);
  let calls = calls.lock().unwrap();
  assert_eq!(calls.iter().filter(|(l, _, _)| l.starts_with("POST /v1/contents/generations/tasks ")).count(), 1);
  assert!(calls.iter().any(|(l, h, b)| l.starts_with("POST /v1/images/edits ") && h.contains("multipart/form-data") && b.contains("name=\"image[]\"") && b.contains("name=\"mask\"")));
  assert!(calls.iter().filter(|(l, _, _)| l.starts_with("GET /media/")).all(|(_, h, _)| !h.to_lowercase().contains("authorization")));
  assert!(calls.iter().any(|(l, _, b)| l.starts_with("POST /v1/services/aigc/multimodal-generation/generation ") && b.contains("你好") && b.contains("Cherry")));
  server.abort();
}
