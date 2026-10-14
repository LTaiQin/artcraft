# LTaiQin Studio · Windows 桌面创作工作台

基于 [ArtCraft](https://github.com/storytold/artcraft) 的真实 PageDraw / Stage3D 编辑引擎，增加独立 Electron 桌面窗口、个人 API、本地素材库和持久化任务。无需 ArtCraft 账号；不下载 AI 模型。源码独立维护在 [LTaiQin/artcraft](https://github.com/LTaiQin/artcraft)，入口位于本仓库的 `studio/`。

[下载 Windows 免安装版](https://github.com/LTaiQin/artcraft/releases)。现有网站上的浏览器版仍单独保留。

## 使用

1. 下载 `LTaiQin-Studio-1.0.0-Windows-x64.zip`，完整解压到一个固定目录。
2. 双击 `LTaiQin Studio.exe`。不要只把 EXE 从目录中移走，它需要旁边的运行文件。
3. 打开左侧「API 设置」，为所需服务填写 API Key，点击「保存 API 配置」。三个服务独立配置；只使用画布和 3D 编辑不需要密钥。
4. 从「生成图片」「生成视频」或「声音创作」提交任务。结果下载到本机，可在「本地素材」查看、作为参考或导出。

这是 Windows x64 的免安装版本，没有申请代码签名。应用没有网站登录、ArtCraft 登录、会员或订阅入口。API 服务商仍要求有效的密钥、模型权限和可用额度；应用本身不提供额度。生成只有在你主动点击按钮时才提交，按所选服务商计费。

## 默认接口和模型

| 用途 | API 基础地址                              | 默认模型 ID                   | 接口协议          |
|------|-------------------------------------------|-------------------------------|-------------------|
| 图片 | `https://api.openai.com/v1`                 | `gpt-image-2.5-sunburst`        | OpenAI Images     |
| 视频 | `https://ark.cn-beijing.volces.com/api/v3`  | `doubao-seedance-2-5-260628`    | 火山方舟视频任务  |
| 语音 | `https://dashscope.aliyuncs.com/api/v1`     | `qwen3-tts-flash`              | 百炼 Qwen TTS HTTP |

基础地址和模型 ID 均可更改。只填写接口前缀，应用会追加下面的端点；不要重复填写完整生成 URL。兼容平台必须同时兼容相应的请求格式和返回结构，不能仅凭“OpenAI 兼容”字样判断视频或百炼语音接口可用。

- **图片**：`POST /images/generations`；添加参考图后调用 `POST /images/edits`。默认使用当前 OpenAI 官方 JSON 格式 `images: [{image_url: ...}]`。兼容旧式上传的平台可选择 Multipart 编辑协议。支持 1—4 张结果、最多 16 张参考图、透明背景；还可选 `gpt-image-2.5-flare` 或自行输入服务商提供的 ID。返回 `data[].b64_json`，兼容平台也可返回图片 URL。
- **视频**：`POST /contents/generations/tasks` 创建，返回 `id`；`GET /contents/generations/tasks/{id}` 查询。成功结构为 `status: "succeeded", content: {video_url: ...}`。支持文生视频、首尾帧和图片 / 视频 / 音频多模态参考；首尾帧模式不能混用多模态参考。当前限制 4—30 秒、480p / 720p / 1080p，最多 30 张图片、10 段视频、10 段音频、总计 50 个。服务商还有素材时长、内容和可用组合限制，最终以接口响应为准。
- **语音**：`POST /services/aigc/multimodal-generation/generation`；使用 `model` 与 `input: {text, voice, language_type}`，读取 `output.audio.url`。这是文字转语音，适合旁白和对白。声音风格指令需要选择 `qwen3-tts-instruct-flash`；支持输入自定义音色 ID。每次最多 600 字符。

官方文档（接口核对日期：2026-10-14）：

- [OpenAI 图片生成](https://developers.openai.com/api/reference/resources/images/methods/generate) / [图片编辑](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Seedance 2.5](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=en) / [创建任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh) / [查询任务](https://docs.volcengine.com/docs/ark/get-video-generation-task-api?lang=zh)
- [百炼 Qwen TTS](https://help.aliyun.com/zh/model-studio/qwen-tts-api)

## 编辑、保存和网络

- 2D 画布支持绘制、撤销、图层与构图；点击「保存画布到素材库」保存 PNG。画布 AI 修改通过你配置的图片 API 提交当前画面。
- 3D 编辑支持几何体、镜头、时间轴、本地 GLB / SPZ 导入和截图 / 视频渲染。带骨骼的 GLB 可作为角色导入。FBX 请先自行转换为自包含 GLB；不接入原厂的模型转换服务。
- 3D 的 File → Save scene 在本机保存场景，可从素材库重新打开；草稿会在离开 3D 页面时缓存。退出前保存重要场景和画布。部分原编辑器按钮沿用英文。
- 原厂云端角色、模型库和 AI 3D 生成不包含在此版本。自然语言直接重建 3D 场景是上游占位能力，因此此版本只保留实际编辑功能。
- 本地素材单文件最多 200 MB；视频内联参考单文件最多 50 MB。更大的参考视频可填写服务商可读取的 HTTPS 链接。API 服务商可能设置更严格的限制。
- 本地编辑、渲染及媒体回看不经过 VPS。AI 请求从这台 Windows 电脑直接访问你配置的服务；独立网络会话跟随系统代理。服务器仅提供应用下载。
- 媒体使用本地协议读取，支持字节范围请求。生成的视频保留云端任务 ID。停止等待暂停本机查询，云端任务可能继续运行；重启后点击「继续查询」只请求原 ID，不重新提交生成。
- 图片和语音提交不自动重试。若提交时网络中断而尚未收到结果，请先查服务商记录，再决定是否重新生成，以免重复计费。

## 数据与密钥

「打开数据目录」可查看数据位置。Windows 默认位于当前用户的 `%APPDATA%` 下，目录名由 Electron 的 userData 设置确定；应用显示的路径是实际位置。

`studio.json` 保存接口配置、素材索引、任务和场景索引；`media/` 保存素材；`scenes/` 保存场景。Windows API Key 通过系统加密存储，不发送到本站服务器。编辑页面只收到“已配置”状态，不会拿到已经保存的密钥。更换 API 域名时清除旧密钥，需重新填写。系统无法提供安全加密时，仅在本次运行的内存中保留密钥。

备份作品时应复制整个数据目录。系统加密后的密钥与 Windows 用户环境相关，换电脑后重新填写密钥。

## 源码构建

需要 Python 3、Git、Node.js 22+ / npm。编辑引擎固定在 ArtCraft 提交 `d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373`，构建脚本只适配列出的文件，不重置用户的整个检出。

```bash
cd studio
npm ci
npm run build:renderer
npm test
npm run package:windows
```

`ARTCRAFT_SOURCE` 可指向此提交的已有稀疏检出，减少重复下载。GitHub Release 工作流会在 Windows runner 上执行构建、后端测试和桌面模拟 API 验收，通过后发布 `studio-v<版本号>`；更新发布需先修改 `studio/package.json` 的版本号。首次构建会下载 upstream 依赖和 Electron。产物位于 `release/`。Linux 上可以交叉打包 Windows ZIP；Linux 上运行 `npm run package:linux` 可生成本机测试目录。

后端测试不调用真实服务商。`test/verify-desktop.cjs` 另提供 Playwright / Electron 完整验收，运行前可用 `node test/make-fixtures.cjs /absolute/path/to/fixtures` 生成素材，并设置 `PLAYWRIGHT_MODULE`、`STUDIO_TEST_OUTPUT`、`STUDIO_TEST_FIXTURES`。它用本地模拟 HTTP 服务验证 IPC、生成下载、编辑和任务恢复，不会消费真实 API 额度。

## 来源和验证边界

原始 ArtCraft 桌面编辑器按 MIT / Apache-2.0 双许可证使用，应用随附原始许可证和 NOTICE。新增桌面适配代码见本目录；原项目不为此个人版本背书。这个版本使用 Electron 宿主，复用原始编辑引擎，不是原 Tauri / Rust 程序的完整复刻。

实际验证结果见 [验证记录](VALIDATION.md)。模拟接口通过不代表某个真实账号的模型权限、余额或云端质量已验证；当前未使用真实 Key，也未进行付费生成。
