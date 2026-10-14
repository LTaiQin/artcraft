Windows 本地创作工作台，使用 ArtCraft 的 PageDraw / Stage3D 编辑引擎。

- 无需 ArtCraft 账号；画布、3D 编辑和渲染在本机执行。
- 自定义 API 地址、模型 ID 和密钥：GPT Image 2.5、Seedance 2.5、阿里云百炼 Qwen TTS。
- 本地素材和场景保存；视频任务中断后继续查询原 ID，避免重复提交。
- 完整解压 Windows x64 ZIP 后，打开 `LTaiQin Studio.exe`，在「API 设置」填写密钥。

此 Release 经过 Windows runner 上的 Electron 操作与本地模拟 API 验收。尚未进行真实付费 API 生成；服务商的模型权限、额度和网络访问需使用个人密钥确认。应用没有代码签名。

同时提供 SHA256 校验文件、使用说明和验证记录。源代码位于本仓库 `studio/`。
