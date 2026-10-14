use personal_api::{id, now, providers, routes, success, failure, text, Asset, Job, Store};
use serde_json::{json, Value};
use std::{
  collections::HashSet,
  sync::{Arc, Mutex},
  time::Duration,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
pub struct PersonalState {
  pub store: Store,
  active: Arc<Mutex<HashSet<String>>>,
}
impl PersonalState {
  pub fn new(store: Store) -> Self {
    Self { store, active: Arc::new(Mutex::new(HashSet::new())) }
  }
  pub fn start(&self, app: AppHandle, job: Job) {
    let Ok(mut active) = self.active.lock() else {
      return;
    };
    if !active.insert(job.id.clone()) {
      return;
    }
    let state = self.clone();
    tauri::async_runtime::spawn(async move {
      state.execute(app, job).await;
    });
  }
  pub fn enqueue(&self, app: AppHandle, kind: &str, request: Value) -> Value {
    let result = (|| -> personal_api::Result<Job> {
      let config = self.store.config(kind)?;
      self.store.key_for(kind, &config)?;
      match kind {
        "image" => {
          providers::image_payload(&self.store, &config, &request)?;
        },
        "video" => {
          providers::video_payload(&self.store, &config, &request)?;
        },
        "audio" => {
          providers::audio_payload(&config, &request)?;
        },
        _ => return Err("现有个人 API 不支持 3D 生成，请使用本地 3D 编辑器导入模型并渲染".into()),
      };
      let job = Job { id: id("job"), kind: kind.into(), model: request["model"].as_str().unwrap_or(&config.model).to_owned(), request, status: "pending".into(), created_at: now(), updated_at: now(), provider_id: None, result_ids: Vec::new(), output_url: None, message: None, dismissed: false, config };
      self.store.push_job(job.clone())?;
      Ok(job)
    })();
    match result {
      Ok(job) => {
        let job_id = job.id.clone();
        emit(&app, "generation-enqueue-success-event", json!({"action":format!("generate_{kind}"),"service":"personal_api","model":job.model}));
        self.start(app, job);
        success(json!({"success":true,"inference_job_token":job_id,"all_job_tokens":[job_id]}))
      },
      Err(message) => {
        emit(&app, "flash_user_input_error_event", json!({"message":message}));
        failure(message)
      },
    }
  }
  pub fn resume(&self, app: &AppHandle) {
    if let Ok(jobs) = self.store.jobs() {
      for job in jobs {
        if job.provider_id.is_some() && job.status != "completed" && job.status != "failed" {
          self.start(app.clone(), job);
        }
      }
    }
  }
  async fn execute(&self, app: AppHandle, mut job: Job) {
    let mut failures = 0u32;
    loop {
      // Recover an asset persisted just before an interrupted completion write.
      let existing = self.store.assets().unwrap_or_default().into_iter().filter(|a| a.metadata["job_id"].as_str() == Some(&job.id)).collect::<Vec<_>>();
      let result = if !existing.is_empty() { Ok(existing) } else { providers::run_job(&self.store, &mut job).await };
      match result {
        Ok(assets) if !assets.is_empty() => {
          job.result_ids = assets.iter().map(|a| a.token.clone()).collect();
          job.status = "completed".into();
          job.message = None;
          job.updated_at = now();
          if let Err(error) = self.store.update_job(&job) {
            log::error!("Could not persist completion: {error}");
          }
          self.complete(&app, &job, &assets);
          break;
        },
        Ok(_) => {
          failures = 0;
          tokio::time::sleep(Duration::from_secs(5)).await;
        },
        Err(message) => {
          // Only retry polling/downloading. An accepted video is never resubmitted.
          let terminal = message.starts_with("云端视频任务失败") || message.contains("任务 ID 无效");
          if job.provider_id.is_some() && !terminal {
            failures += 1;
            job.status = "running".into();
            job.message = Some(message);
            job.updated_at = now();
            if let Err(error) = self.store.update_job(&job) {
              log::error!("Could not persist retry state: {error}");
            }
            tokio::time::sleep(Duration::from_secs((5u64.saturating_mul(2u64.pow(failures.min(5)))).min(120))).await;
          } else {
            job.status = "failed".into();
            job.message = Some(message.clone());
            job.updated_at = now();
            if let Err(error) = self.store.update_job(&job) {
              log::error!("Could not persist failure: {error}");
            }
            emit(&app, "generation-failed-event", json!({"action":format!("generate_{}",job.kind),"service":"personal_api","model":job.model,"reason":message,"maybe_frontend_subscriber_id":job.request["frontend_subscriber_id"]}));
            break;
          }
        },
      }
    }
    if let Ok(mut active) = self.active.lock() {
      active.remove(&job.id);
    }
  }
  fn complete(&self, app: &AppHandle, job: &Job, assets: &[Asset]) {
    let images = assets.iter().map(|a| json!({"media_token":a.token,"cdn_url":self.store.asset_url(a),"maybe_thumbnail_template":if a.kind=="image"{Some(self.store.asset_url(a))}else{None}})).collect::<Vec<_>>();
    let subscriber = &job.request["frontend_subscriber_id"];
    let payload = &job.request["frontend_subscriber_payload"];
    if job.kind == "image" {
      emit(app, "text_to_image_generation_complete_event", json!({"generated_images":images,"maybe_frontend_subscriber_id":subscriber,"maybe_frontend_subscriber_payload":payload}));
      if text(&job.request, "personal_action") == "remove_background" {
        emit(app, "canvas_bg_removed_event", json!({"media_token":assets[0].token,"image_cdn_url":self.store.asset_url(&assets[0]),"maybe_frontend_subscriber_id":subscriber,"maybe_frontend_subscriber_payload":payload}));
      }
    } else if job.kind == "video" {
      emit(app, "video_generation_complete_event", json!({"generated_video":images.first(),"maybe_frontend_subscriber_id":subscriber,"maybe_frontend_subscriber_payload":payload}));
    }
    emit(app, "generation-complete-event", json!({"action":format!("generate_{}",job.kind),"service":"personal_api","model":job.model}));
    emit(app, "task-queue-update", json!({}));
  }
}
pub fn emit(app: &AppHandle, name: &str, data: Value) {
  if let Err(err) = app.emit(name, json!({"status":"success","data":data})) {
    log::error!("Could not emit {name}: {err}");
  }
}
pub fn local_queue(state: &PersonalState) -> personal_api::Result<Value> {
  Ok(success(json!({"tasks":state.store.jobs()?.iter().filter(|j|!j.dismissed).rev().map(|j|routes::task_json(&state.store,j)).collect::<Vec<_>>()})))
}
