# Windows 桌面版验证记录

日期：2026-10-14。应用：LTaiQin Studio 1.0.0。ArtCraft 来源固定在 `d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373`。

## 已完成

- Vite 生产构建成功，实际使用 ArtCraft PageDraw / Stage3D 源码。图片和 3D 编辑模块按需加载。
- Node 后端 10 项测试全部通过，覆盖密钥加密 / 内存保存、域名切换清除密钥、URL 校验、官方 JSON 与兼容 Multipart 图片编辑、CDN 不携带 API 密钥、无效输入拒绝、Seedance 多模态与首尾帧、视频暂停 / 重启 / 继续查询、终态失败与错误脱敏、百炼 TTS 请求和下载。
- 在 Linux Xvfb 中实际启动 Electron 桌面窗口，完成三类自定义 API 配置，以及图片 / 视频 / 语音从 IPC 到模拟 HTTP 再到本地素材的完整流程。
- 在真实画布绘制并检查像素变化；撤销后检查笔迹消失；保存画布 PNG；通过配置的模拟图片接口修改画布。
- 在真实 WebGL 场景拖入几何体，使用原生文件导入接口加载本地 GLB；将场景命名后写入本机；重启后重新加载场景并检查导入模型仍存在。
- 执行 3D 截图，检查 PNG 文件头和实际结果字节，并保存到本地素材库。
- 本地视频支持 HTTP 风格的字节范围读取，`bytes=0-7` 实际返回 206 和 8 字节。
- 视频任务暂停后关闭并重开应用，继续查询原云端 ID，确认没有第二次生成 POST。
- 验收期间没有 ArtCraft 登录 / 云端请求，没有页面 JavaScript 错误，没有付费 API 请求。
- 使用独立 Linux 打包目录中的 `app.asar` 进行相同桌面验收，额外验证 Electron 网络会话支持 Multipart 兼容编辑。

Windows 和 Linux Electron 44.7.2 运行文件均通过该版本官方 `SHASUMS256.txt` 校验。Windows 产物为完整 x64 ZIP，包含 EXE、运行资源、`app.asar`、说明和上游许可证。

2026-10-14 补充：独立仓库已在 Windows Server 2025 的 GitHub runner 上完成全部原生桌面验收，并在 Windows 上打包发布 [studio-v1.0.0](https://github.com/LTaiQin/artcraft/releases/tag/studio-v1.0.0)。[发布与测试任务](https://github.com/LTaiQin/artcraft/actions/runs/38563995094)全部成功，包含 10 项后端测试、9 组桌面验收、模型重开、实际渲染 PNG 和任务恢复。

同一版本也在 Linux 的 1024×681 内容窗口中复测通过，修复了侧栏偏移导致的 3D 右侧拖入边界问题。真实付费 API 仍未调用。

## 尚未验证

- 用户个人 Windows 电脑的驱动、显示缩放和网络环境尚未验证；GitHub Windows runner 的结果不能代替具体设备的实际使用确认。
- 没有用户 API Key，未发起真实付费图片、视频或语音生成。云端模型权限、地域权限、额度、内容审核、质量和真实时延仍须使用者的有效账号验证。
- 实测了自包含 GLB 和单帧 PNG 渲染；没有全面验收所有骨骼、复杂动画、SPZ 大场景或长视频录制。其编码性能由本机硬件决定。
- 没有通过完整上游仓库的 TypeScript 项目检查；生产编译和实际操作通过不代表所有原仓库模块均已验证。

## 验收证据

初次发布的本机 QA 目录 `.local-qa/artcraft-desktop-20261014/` 保留生产构建日志、Node 测试输出、Electron 验收 JSON、截图和实际渲染 PNG。它是测试证据目录，不包含在源码提交或交付应用中。`acceptance4/verification.json` 是源码宿主验收；`packaged-acceptance/verification.json` 是打包宿主验收。测试使用隔离数据目录和本地模拟服务，没有读取或修改现有网站的用户数据库。

运行后端测试：`npm --prefix studio test`。完整桌面验收脚本和调用要求见 [README](README.md)。

桌面源码已迁移至独立仓库 `LTaiQin/artcraft` 的 `studio/` 目录。迁移未改变生成协议和编辑器代码；构建脚本的工作目录已适配独立仓库。历史验收数据仍保留在原本机 QA 目录。

Windows Release ZIP SHA256：`e0b71e89f41b9fc8c3768af406fb43351f2a8f2c35eea8414f4e963ff4ca0106`，文件大小 181857558 字节。
