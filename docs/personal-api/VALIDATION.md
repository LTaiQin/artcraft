# 验证记录

官方基础版本：`d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373`。

- 852 个绘图、3D、视频编辑器、页面与基础控件源文件保持官方版本；`verify-original-ui.py` 比对源码内容摘要。
- 本地生产前端构建通过。
- Rust 模拟服务集成测试通过：官方图片 JSON、兼容 Multipart / mask、百炼原生 TTS、视频任务恢复与单次 POST、本地素材与场景持久化、域名改变后清除密钥及防止任务误用新服务密钥。
- 浏览器验收使用原版界面和测试 IPC：原版首页、设置、图片、视频、音频和画布。实际画笔改变画布像素。
- Windows 发布工作流必须通过实际 Tauri 应用验收才可发布安装包和便携版；结果在 GitHub Actions 的 `personal-api-windows-acceptance` 制品中。

真实付费生成未测试：没有使用真实 API Key。浏览器测试 IPC 不能替代原生 Windows 验收。

## Windows 原生验收通过

- 源码提交：`af14ca9cd656b86ca4f99966adf914a781d56f89`。
- [成功的构建、验收与发布](https://github.com/LTaiQin/artcraft/actions/runs/38613620118)。
- 原生验收报告：`passed: true`，`errors: []`，12 次本机模拟 HTTP 请求。
- 验收覆盖原版主页与本地会话、三个服务设置与 DPAPI 加密、生成按钮到真实 IPC / Rust API / 本地图库、JSON / Multipart / 蒙版、Seedance 与百炼 TTS、真实画布像素、WebGL 3D 窗口与场景保存，以及重启后视频仅 GET 查询。
- 验收制品 SHA-256：`643204626ba53a304ca426d5e850fd5c4fc9862942231ab1c0f46c046b7d5b4f`。
- [正式 Release](https://github.com/LTaiQin/artcraft/releases/tag/personal-api-v0.42.1) 提供安装包和便携 ZIP。
- 便携 ZIP SHA-256：`f9ad5b2460cf32d9038857ccf36333db8882758dbd6ab819274e917db0908686`。
- 安装包 SHA-256：`499bc7571be188c15d5edfcd4b2473fe90e39f6c12c0979f5082e4a1679428e0`。
