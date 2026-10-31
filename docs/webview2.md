# WebView2 试验版

本次只替换桌面外壳，画布代码保持与 Electron 版一致，以便比较。使用 .NET Framework WinForms + Microsoft.Web.WebView2 SDK 1.0.4314.35（net462 + x64 loader），复用已安装的 Evergreen WebView2 Runtime。产物为独立免安装目录，不取代旧 Electron 程序或公开站点。

## 文件与桌面契约

`.drawai` 格式完全复用 v1 容器与 v3 图表；同一空间单独绑定文件。原始文件由 C# 限制大小、解析容器，再由受信任本地页面中的现有 validateDocument 校验全部图表字段；打开失败不会修改源文件。保存前也复用该校验器，不维护另一套图表 Schema。

渲染层仍使用 drawaiDesktop.initial/initialize/changed/save/exportFile/open/close/aiRequest/aiCancel/onCommand。WebView2 使用带请求 ID 的 WebMessage，主窗口检查发送 URL；不开放通用 HostObject、任意路径读写或任意方法调用。静态资源由 WebResourceRequested 的白名单提供，不开 HTTP 端口；CSP 禁止第三方脚本、frame、对象，禁止导航与新浏览器窗口，权限默认拒绝。测试桥只在显式 DRAWAI_WV_TEST=1 环境启用，CDP 调试端口只在测试时开启并指定本机地址。

原文件采用同目录临时文件、Flush(true)、File.Replace/Move 提交，两次比较旧文本防止覆盖外部修改。不同空间/窗口不得绑定同一路径；另存为更新当前空间绑定。保存/关闭串行，正在保存的新内容仍保持未保存标记。关闭先结束内联编辑、同步数据，再提示保存所有未保存空间。

WindowsFormsApplicationBase 单实例处理真实第二次启动参数；同文件聚焦对应窗口和空间，异文件新开窗口。用户选择「关联 .drawai」后才登记 HKCU 的 DrawAI.WebView2.Diagram；不写 Windows UserChoice、不自动覆盖原版关联。可以在旧 Electron 版中重新关联切回。

## 构建与运行

`npm run build:webview2` 从官方 NuGet 下载指定 SDK（若本地没有缓存），使用 Windows .NET Framework 的 C# 编译器生成 x64 EXE。只打包 18 个白名单文件：薄宿主、3 个 SDK DLL、应用资源、图标、许可和说明。不带浏览器运行时、node_modules、构建工具或用户数据。包内无图表；测试和性能测量使用 tests/fixtures 中显式构造的夹具。

运行需要 Windows x64、.NET Framework 4.6.2+ 和 WebView2 Runtime。缺失会提示微软安装入口，不自动下载安装。程序配置和缓存位于程序旁 data，可搬移；移动目录后需重新关联扩展名。未签名的试验构建。

## 验证

`npm run test:webview2` 启动真实 EXE，通过 CDP 操作实际 WebView2 页面、原生桥与磁盘。对话框选择由测试队列提供，避免操作用户文件或注册表；实际文件关联确认界面未自动操作。覆盖文件打开、保存、另存为、工作空间隔离、取消、外部修改保护、真实第二进程/重复文件、关闭草稿及关闭保存、非法文件、.drawai 副本导出及重新打开、图形拖动/缩放/连线、表格原位编辑、平面/三维旋转。

导出通过独立 export 消息进入原生保存对话框和临时文件原子写入逻辑，不修改原文件绑定或已保存快照。一般浏览器下载仍由 DownloadStarting 处理；测试连接保留默认下载控制。

## 内存对照方法

scripts/compare-desktop-memory.mjs 顺序启动两版的单可见窗口、隔离数据目录，打开同一份示例（2 层、12 图形、1 表、15 连线），将 WebView2 内容区调整成 Electron 的相同尺寸。Windows 枚举整个子进程树，对 PrivateMemorySize64 与 WorkingSet64 分别求和，包含宿主和渲染/网络/GPU等进程，不计算显存；共享页可能在工作集求和中重复。两版均连接自动化，使用各自实际运行时版本；不是跨机性能保证。

平面/三维静置各 3 次，6 次相同旋转手势后采样，再静置 8 秒。手势命令耗时含自动化开销，不作为帧率指标。结果写入本机 .local 中的 comparison.json；分发包减小与运行内存是两个独立指标。

2026-10-30 同机、同内容区 1434×911 实测如下（MiB）：

| 指标 | Electron | WebView2 |
| --- | ---: | ---: |
| 进程数 | 5 | 7 |
| 平面静置私有内存 | 281.22–281.26 | 272.15–272.20 |
| 三维静置私有内存 | 285.43–289.16 | 277.80–278.64 |
| 旋转采样私有内存 | 351.23–422.80 | 369.94–426.64 |
| 三维静置工作集合计 | 376.20–379.60 | 454.62–455.30 |
| 旋转采样工作集合计 | 436.20–484.55 | 510.90–561.92 |

结论：分发包大幅缩小；私有内存略低或相近，工作集合计更高，不能宣称内存显著降低。旋转手势自动化命令耗时两版均约 0.34 秒，本指标不是帧率或流畅度证明。结果来自单次本机采样，Runtime 版本、GPU/窗口/缓存与采样时机都会影响；没有修改画布渲染以偏向任一外壳。原始记录：`.local/memory-comparison/run-TXPbUD/comparison.json`。

## AI 请求通道（0.7.0）

`aiRequest` / `aiCancel` 使用带 ID 的消息桥；宿主只接受已初始化主页面请求，经 HttpClient 发到用户设置的 HTTP(S) Chat Completions 地址。每窗口最多一个请求，不跟随重定向、不保存 Cookie，120 秒超时，限制请求与回复大小；关闭窗口会取消请求。Key 仅经内存传递，不落盘。图片使用 data URL 随请求发送，详见 [AI 接入](ai.md)。
