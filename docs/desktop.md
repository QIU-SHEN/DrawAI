# DrawAI 桌面交付

Windows 10/11 x64 免安装目录，使用 Electron 45.1.0；网页编辑器复用同一份源码，通过 `drawai-app://editor` 本地协议加载白名单静态资源，不开启 HTTP 端口。文件格式为 `.drawai`，独立于原 JSON 与离线 HTML。

免安装版运行配置、缓存、临时文件和日志存放在 EXE 旁的 `data` 目录，需放在当前用户有写权限的位置；分发 ZIP 不包含运行数据。桌面工作空间只在内存保留，使用“保存”持久化到图表文件；不额外保留无法恢复的随机 localStorage 草稿。

## 交互

右上角打开、保存、另存为；文件菜单支持新窗口、打开、保存、另存为和后缀关联。打开已有文件不覆盖当前图表，使用独立窗口；单实例转交启动参数，已打开同一文件则聚焦其工作空间。各工作空间分别保存，关闭提示涵盖所有有未保存内容的空间。

文件关联由用户点击菜单明确触发，登记 HKCU/Software/Classes 下 DrawAI.Diagram 和 .drawai，通过带引号的 EXE 路径与 "%1" 传递文件名；不篡改 Windows 的 UserChoice。文件夹搬迁后重新登记；系统已有用户选择时可用「打开方式 → 始终使用」。不在测试或启动时自动改注册表。

## 主进程桥接

preload 仅提供 initial、initialize、changed、save、exportFile、open、close、aiRequest、aiCancel、onCommand；不暴露原始 IPC、Node.js 或任意路径 API。IPC 验证来源主 frame 和本地 URL，所有文件结构在主进程再校验。contextIsolation、sandbox、webSecurity 开启；禁止导航、新窗口、webview 与权限请求。协议只提供白名单应用静态文件；CSP 限制脚本到本地源。

保存和关闭操作按窗口串行；路径来自命令行或原生文件对话框。保存失败保留原文件和未保存状态。关闭请求先完成编辑草稿和数据同步，确认保存失败/取消时保留窗口。

## 验证和分发

`npm run test:desktop` 使用真实 Electron 窗口和磁盘文件，模拟操作系统对话框返回值，避免修改用户注册表；覆盖文件启动、读写、中文路径、另存为、工作空间隔离、外部修改冲突、取消、第二次启动转交与关闭草稿。Windows 的实际“选择默认应用”界面仍取决于当前电脑用户设置。

`npm run build:desktop` 生成 releases 下应用目录与 ZIP。源目录采用白名单，不打包开发依赖、Git 历史、凭据或用户数据。附使用说明，不附带图表。构建可通过 ELECTRON_ZIP_DIR 使用已校验的官方 Electron ZIP。未配置付费代码签名；当前为未签名测试版。

## AI 请求通道（0.7.0）

新增 `aiRequest` / `aiCancel`，与文件 IPC 使用同一主 frame 来源校验；主进程 fetch 直接请求用户配置的兼容接口。请求不经过 DrawAI 服务器，不跟随重定向，有限制、超时和取消；Key 不持久化。详见 [AI 接入](ai.md)。
