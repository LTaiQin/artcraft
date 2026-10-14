use super::super::runtime::PersonalState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn generate_mesh_command(request: Value) -> Result<Value, Value> {
  let _ = request;
  Err(personal_api::failure("当前配置没有 3D 生成 API。原版 3D 编辑器支持导入本地模型、编辑、场景保存和渲染。"))
}
