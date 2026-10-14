保留官方原版 ArtCraft 桌面界面：主页、绘图、3D Stage、视频编辑器、主题和原有导航。

原账号与平台积分改为个人 API。右上角 Settings → Personal APIs 可分别配置 GPT Image 2.5、Seedance 2.5、阿里云百炼 Qwen TTS，以及实现对应官方协议的兼容服务。

素材和场景保存在本机；Windows API Key 使用 DPAPI 加密。视频云端任务 ID 持久化，重启后继续查询，不重复提交生成。

Windows 安装包与便携 ZIP 在原版源码保护检查、Rust 协议/存储测试和真实 Windows Tauri 应用验收通过后发布。验收使用模拟 API，未消耗真实付费额度。

请下载此版本。旧 `studio-v1.0.0` 使用重新设计的界面，已被本版本替代。

当前三种 API 不包含 3D AI 生成和音乐生成；本地 3D 编辑/渲染与百炼文本朗读仍可使用。详见压缩包内 README_CN.md。
