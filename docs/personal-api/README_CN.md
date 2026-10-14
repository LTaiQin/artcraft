# ArtCraft 原版桌面界面 · 个人 API 版

此版本以官方 ArtCraft Tauri 桌面版为基础。首页、导航、绘图、3D Stage、视频编辑器、主题和快捷键保留原版。它替换官方账号、平台积分和云端请求，使用个人 API 和本地素材库。

## Windows 下载与启动

在本仓库的 Releases 下载 `ArtCraft_0.42.1_x64-setup.exe` 安装包，或下载 `ArtCraft-Personal-API-0.42.1-Windows-x64.zip` 解压运行 `ArtCraft.exe`。便携版需要 Microsoft Edge WebView2 Runtime；安装包会检查并安装该运行时。安装包尚未购买代码签名证书。

旧的 `studio-v1.0.0` 是早先的重新设计版本，不是本次交付。请使用 `personal-api-v0.42.1`。

## 配置 API

点击原版右上角齿轮 → **Personal APIs**。三个服务分别填写 Base URL、Model ID、API Key 后点击 Save。兼容服务需要实现相应的官方协议，而不只是有一个聊天接口。

| 服务     | Base URL                                   | 默认 Model ID                  | 协议                                    |
| ------ | ------------------------------------------ | ---------------------------- | ------------------------------------- |
| 图片     | `https://api.openai.com/v1`                | `gpt-image-2.5-sunburst`     | `/images/generations`、`/images/edits` |
| 视频     | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedance-2-5-260628` | `/contents/generations/tasks` 和任务查询   |
| 语音     | `https://dashscope.aliyuncs.com/api/v1`    | `qwen3-tts-flash`            | 百炼原生 TTS JSON API                     |

图片编辑默认使用官方 JSON 的 `images` 和 `mask`。部分兼容平台使用 Multipart 的 `image[]` 和 `mask`，可以在同一设置页切换。

百炼音色默认 Cherry，语言 Chinese，可以在设置中修改。输入文本会被朗读，每次最多 600 字符。需要声音风格指令时使用 `qwen3-tts-instruct-flash`；本接口不是音乐生成接口。

各服务需要你自己的 API Key 和对应模型权限；模型 ID 可以修改为服务商实际开通的型号。应用不会安装本地生成模型，绘图与 3D 编辑/渲染在本机进行，AI 生成调用云端。

## 本地数据与任务

- 生成结果、导入素材、场景和任务保存在 `%APPDATA%\com.ltaiqin.artcraft.personal`。
- API Key 使用 Windows DPAPI 加密，绑定当前 Windows 用户；设置页只显示是否保存，不回读明文。
- 更换 API 地址的域名后清除旧密钥，防止误发给另一个服务；请重新填写该服务的密钥。
- 视频任务先保存云端 ID，再查询结果。关闭应用后云端仍可能继续生成，重新打开应用会继续查询或下载，不重复提交生成请求。
- 图片/语音请求中断后不会自动重新提交。请求超时可能意味着已经被服务商接受，请先检查服务商记录。
- 费用由所选 API 服务商收取，请在服务商控制台查看；应用不虚构免费额度或 ArtCraft 积分。

官方云端社区、账号角色库、在线分享、平台订阅和 3D AI 生成功能需要其他服务，当前这三种个人 API 无法替代。原版入口保留，无法支持的请求会说明原因。3D Stage 的本地编辑、模型导入、场景保存和渲染仍可使用。

## 开发与验证

```bash
cargo test -p personal_api --locked
python script/artcraft/personal-api/verify-original-ui.py
cd frontend && npm ci
cd apps/artcraft && npm run build -- --emptyOutDir
cd ../../..
cargo build -p artcraft --release --locked
```

Windows 工作流在发布前验证原版界面源码、API 协议、本地数据、实际 Tauri 窗口、Windows 密钥加密和视频任务重启恢复。验收使用本机模拟接口，不消耗真实 API 额度。没有服务商密钥的情况下，不能宣称已经通过付费生成测试。

官方固定版本：`storytold/artcraft@d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373`。源码保留 MIT/Apache 许可及 NOTICE。个人版本与官方服务没有隶属关系。
