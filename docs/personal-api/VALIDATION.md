# 验证记录

官方基础版本：`d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373`。

- 852 个绘图、3D、视频编辑器、页面与基础控件源文件保持官方版本；`verify-original-ui.py` 比对源码内容摘要。
- 本地生产前端构建通过。
- Rust 模拟服务集成测试通过：官方图片 JSON、兼容 Multipart / mask、百炼原生 TTS、视频任务恢复与单次 POST、本地素材与场景持久化、域名改变后清除密钥及防止任务误用新服务密钥。
- 浏览器验收使用原版界面和测试 IPC：原版首页、设置、图片、视频、音频和画布。实际画笔改变画布像素。
- Windows 发布工作流必须通过实际 Tauri 应用验收才可发布安装包和便携版；结果在 GitHub Actions 的 `personal-api-windows-acceptance` 制品中。

真实付费生成未测试：没有使用真实 API Key。浏览器测试 IPC 不能替代原生 Windows 验收。
