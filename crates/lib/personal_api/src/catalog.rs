use crate::{store::ProviderConfig, Result, Store};
use serde_json::{json, Value};

pub fn models(store: &Store, kind: &str) -> Result<Value> {
  if !["image", "video", "audio"].contains(&kind) {
    return Ok(json!({"success":true,"models":[],"providers":[]}));
  }
  let config = store.config(kind)?;
  let model = match kind {
    "image" => image(&config),
    "video" => video(&config),
    _ => audio(&config),
  };
  let models = if kind == "image" {
    let mut inpaint = model.clone();
    inpaint["model"] = json!("gpt_image_2p5_sunburst_inpaint");
    inpaint["full_name"] = json!("GPT Image 2.5 Sunburst · Inpaint");
    inpaint["text_prompt_supported"] = json!(false);
    vec![model.clone(), inpaint]
  } else {
    vec![model.clone()]
  };
  let offered = models.iter().map(|m| json!({"model":m["model"],"overrides":null})).collect::<Vec<_>>();
  Ok(json!({"success":true,"models":models,"providers":[{"provider":"artcraft","models":offered}]}))
}
pub fn cost() -> Value {
  // Unknown provider pricing must not be advertised as free or as an ArtCraft credit balance.
  json!({"success":true,"cost_in_credits":null,"cost_in_usd_cents":null,"has_watermark":false,"is_free":false,"is_unlimited":false,"is_rate_limited":false})
}
fn image(c: &ProviderConfig) -> Value {
  json!({"model":"gpt_image_2p5_sunburst","model_creator":"open_ai","full_name":"GPT Image 2.5 · Personal API","text_prompt_supported":true,"text_prompt_max_length":32000,"image_refs_supported":true,"image_refs_max":16,"has_fixed_editing_aspect_ratio":false,"aspect_ratio_options":["auto","square","wide","tall"],"aspect_ratio_default":"square","resolution_options":["one_k","two_k","four_k"],"resolution_default":"one_k","quality_options":["auto","low","medium","high","xhigh","max"],"default_quality":"auto","batch_size_min":1,"batch_size_max":4,"batch_size_options":[1,2,3,4],"batch_size_default":1,"is_disabled":false})
}
fn video(c: &ProviderConfig) -> Value {
  json!({"model":"seedance_2p5","model_creator":"bytedance","full_name":"Seedance 2.5 · Personal API","text_prompt_supported":true,"text_to_video_supported":true,"text_prompt_max_length":10000,"aspect_ratio_options":["auto","square","wide","tall","wide_four_by_three","tall_three_by_four","wide_twenty_one_by_nine"],"aspect_ratio_default":"wide","resolution_options":["four_eighty_p","seven_twenty_p","ten_eighty_p"],"resolution_default":"seven_twenty_p","duration_seconds_min":4,"duration_seconds_max":30,"duration_seconds_default":5,"duration_seconds_max_with_image_references":30,"batch_size_min":1,"batch_size_max":1,"batch_size_options":[1],"batch_size_default":1,"starting_keyframe_supported":true,"starting_keyframe_required":false,"ending_keyframe_supported":true,"show_generate_with_sound_toggle":true,"image_references_supported":true,"image_references_max":30,"video_references_supported":true,"video_references_max":10,"video_references_max_total_duration_seconds":30,"audio_references_supported":true,"audio_references_max":10,"audio_references_max_total_duration_seconds":30,"character_references_supported":false,"is_disabled":false})
}
fn audio(c: &ProviderConfig) -> Value {
  json!({"model":c.model,"model_creator":"alibaba","full_name":"Qwen TTS · Alibaba Bailian","extra_info_short":"Speech synthesis · 600 characters","extra_info":"朗读提示词中的文本。音色及语言在 Personal APIs 中设置。","text_prompt_supported":true,"text_prompt_max_length":600,"style_prompt_supported":c.model.contains("instruct"),"audio_references_supported":false,"image_references_supported":false,"instrumental_toggle_supported":false,"loopable_toggle_supported":false,"bpm_supported":false,"musical_key_supported":false,"speed_supported":false,"volume_supported":false,"pitch_supported":false,"is_disabled":false})
}
