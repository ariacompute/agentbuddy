# AGENTS.md — agentbuddy（统一 Agent 工作台桌面客户端）

工程上下文入口，渐进式披露：本文件只给骨架与硬性约束；配置细节看 `README.md`，
行为契约看 `requirements.md`，实施记录看 `task.md`。

## 概述

`agentbuddy` 是 **.NET 10 LTS + C# + Avalonia 11 原生桌面客户端**（Windows / macOS / Linux）。
**自身无后端、无数据库、无 WebView**：原生 XAML 界面用 `HttpClient` 打到进程内的
`127.0.0.1:<随机端口>` 环回网关，网关把相对请求转发到用户配置的 `agenthub` 服务端，
从而复用 agenthub 的认证、A2A 编排、注册中心与任务状态机。

- 服务端（别人的）：`agenthub`（Go + PostgreSQL）。本仓库 **不 import** agenthub，只经 HTTP 对话，本轮零改动。
- 界面：`desktop/src/AgentBuddy.App`，Avalonia XAML + CommunityToolkit.Mvvm；17 个视图
  （15 屏工作台 + Connect + About）、6 个共享控件；**13 种语言**、**纯黑/白/灰单色**、
  默认浅色主题、阿拉伯语右到左、触控目标 ≥44px。
  样式只写 `Styles/Theme.axaml`（Dark 基准 + Light 成对覆盖）与 `Styles/Controls.axaml`。
- 领域层：`desktop/src/AgentBuddy.Core`，纯 C#、无 UI/平台依赖；冻结契约、DTO、13 语文案、
  上游客户端、SSE 解析、轮询聚合、通知决策、实时订阅。
- 外壳层：`desktop/src/AgentBuddy.Shell`，ASP.NET Core / Kestrel 环回网关、凭据库、
  BYOM 执行节点、托盘/通知、自动更新验签安装。

## 架构（单向依赖）

```
┌────────────────────────────────────────────┐        ┌──────────────────────────────┐
│ agentbuddy 桌面客户端                       │        │ agenthub 服务端（常驻）      │
│  App（Avalonia XAML + ViewModel，17 视图）  │  HTTP  │  • agent 运行时 / adapter    │
│    ↓ 引用                                   │ / SSE  │  • 任务推进 / HITL 挂起恢复  │
│  Core（契约 / DTO / 文案 / 客户端 / 服务）   │ ─────► │  • SSE Broker / push         │
│    ↑ 端口接口由 Core 定义，实现在 Shell      │ ◄───── │  • channels / connectors     │
│  Shell（Kestrel 环回网关、托盘、通知、更新）  │        │  • speech / files / router   │
└────────────────────────────────────────────┘        └──────────────────────────────┘
         └─ 127.0.0.1:0 网关：/api /a2a /healthz /.well-known 转发；
            /__shell/* 是 ViewModel 与外壳之间的本地控制面（替代旧的 JS 桥）
```

网关只认**前缀**（`/api`、`/a2a`、`/healthz`、`/.well-known`），因此
**服务端新增 `/api/*` 端点不需要改桌面端代码**。其余路径不是 SPA 回退，
而是 `/__shell/*` 控制面或直接 404 —— 界面不再有 HTML 注入、CSP nonce 与 `web/dist` 内嵌。

## 目录

```
desktop/
  agentbuddy.sln / global.json / Directory.Build.props / Directory.Packages.props
  src/AgentBuddy.Core/
    Contracts/         Endpoints.cs（约 80 端点 + 12 条 /__shell/* + 8 个 SSE 事件名）、
                       Codes.cs（74 错误码 + 13 升级码 + Limits）、ReleaseContract.cs（9 assets）、
                       ShellConfig.cs（config.json 唯一 schema）
    I18n/copy.json     13 语 × 61 键，en 浅合并兜底
    Gateway/           AgentHubClient.cs（HttpClient 单例、上传进度、流式下载、语音 multipart）、
                       SseParser.cs（逐行增量解析）
    Services/          ConfigService / LocalizationService / MonitorService /
                       NotificationDecider / RealtimeService（2 路全局 SSE + 按需实体流 + since 重放）
  src/AgentBuddy.Shell/
    Loopback/          LoopbackGateway / BootstrapAuth / ForwardHandler / ShellRoutes
    Credentials/       ICredentialStore + Win/Mac/Linux/受限文件回退
    Executor/          默认关闭的 BYOM 节点、精确命令白名单、进程组终止
    Notifications/     三平台通知 + DeepLinkQueue
    Tray/              13 语菜单、角标 clamp 999（>99 显示 99+）
    Upgrade/           GitHub/Gitee 选源、semver、Ed25519 验签、平台化安装重启
  src/AgentBuddy.App/
    Views/             17 个 .axaml + ViewClasses.cs
    ViewModels/        每屏一个 VM + NavigationService（17 路由 + 登录守卫）+ ShellViewModel
    Controls/          6 个共享控件（页头、顶栏、侧栏、文件传输、语音、任务动作）
    Styles/            Theme.axaml / Controls.axaml
    Composition.cs     组合根：网关 → 客户端 → VM → 轮询/实时 → 窗口能力注入
  tests/               Core.Tests / Shell.Tests / App.Tests / Guards（xUnit）；
                       Coverage* / *CoverageTests 是逐文件的覆盖套件（含 headless 全链路）
  tools/AgentBuddy.Build/  ab-tool：icons / stamp / inject-pubkey / sign / wix / manifest / verify
  packaging/           linux/control.in、linux/agentbuddy.desktop、macos/Info.plist
  assets/app-icon.png 唯一图标源
.github/workflows/     ci.yml（dotnet job）、release.yml（三平台 publish + 9 assets）
```

## 硬性约定

### 文案、主题与无障碍

- **13 语**：`en zh zh-TW es fr de it ru ja ko pt ar hi`。`copy.json` 每语键集必须完全一致，
  `zh` 与 `zh-TW` 必须不同；`LocalizationService` 用 `{...en, ...lang}` 浅合并 + **en 兜底**。
  **禁止在 `.axaml` 模板里硬编码自然语言**，一切走 `{Binding}` + copy key。
  `tests/AgentBuddy.Guards` 扫描 13 语键集、翻译真实性与模板硬编码。
- **单色禁令**：UI 不得出现任何有彩色相，一律落在 `#000 ↔ #fff` 明度轴。
  控件模板只引用 `DynamicResource Brush.*` 键，禁止硬编码色值；
  `Theme.axaml` 的 Dark 基准与 Light 覆盖必须**成对**写同一批键，`App.axaml` 默认 `Light`。
- **RTL**：`ar` 下 `window.FlowDirection = RightToLeft`；布局一律逻辑属性，
  禁止绝对左右定位与 `HorizontalAlignment=Left/Right` 的语义依赖。
- **无障碍**：触控目标 ≥44px（`Double.MinTouch`）；焦点环 2px + 2px offset；
  不声明任何过渡动画，`ReducedMotionService` 在 `prefers-reduced-motion` 下打 `reduce-motion` 标记。
- **错误**：ViewModel 只存机器 `error.code`；展示文案由 `ErrorText` 按 code 查 copy。
  新增错误码须同步 `Codes.cs` 的 `All`（74 条）与 13 语 `errors.*` 键。

### 契约与接线守卫

- `Contracts/Endpoints.cs` 是**唯一**字面量来源：约 80 个 `/api/*`、12 条 `/__shell/*`、
  8 个 SSE 事件名、`ab_proxy` Cookie 名、默认服务端地址、平台键、错误机器码。
  `EveryFrozenEndpointConstantIsReferencedOutsideItsDefinition` 强制每个常量至少有一处真实调用方，
  **白名单为空**，新增封装却忘了接界面会直接红。
- `ReleaseContract.AllAssets()` 钉住**恰好 9 个发布产物**：6 下载 + `latest.json` +
  `latest-gitee.json` + `SHA256SUMS`；`ab-tool verify` 在发布前断言目录内容完全一致。
- 传输细节：语音 multipart 字段名 `audio`、文件名 `voice.webm`；文件下载是字节流；
  上传有 `IProgress<int>`；`Set-Cookie` 丢 `Secure`/`Domain`/原 `Path`、
  `SameSite=None` → `Lax`、补 `; Path=/` 并保留 `HttpOnly`；`Location` 只改写服务端本地跳转。
- **实体流按需订阅**：常开的只有 `Endpoints.GlobalStreams`（沙盒 / 路由）；线程与任务是
  per-entity 流，由 `NavigationService.EntityStreamChanged` 带着解析出的 id 驱动
  `RealtimeService.Track` / `UntrackAsync` / `SwitchEntityStreamAsync`。同一实体并发 `Track`
  只开一条（`_entityStops.TryAdd` 单飞，落败者释放自己的 linked CTS 并如实返回 true），
  切屏关旧开新，`StopAsync` 连实体 pump 一起收。
  **模板路径永不订阅**（服务端没有该路由，订上就是永久 404）：`Endpoints.IsEntityStream`
  是唯一的「id 填了吗」判断，`TemplateFor` 把具体路径折回模板做归属校验，`StreamEventNames`
  按模板查事件名。非法 id 不发请求也不退化成模板。
- 日志统一 `Microsoft.Extensions.Logging` 分级，**绝不打印密钥、Cookie、URL userinfo 或请求体**；
  通知与角标投递一律 fire-and-forget 且捕获异常。

### 网关准入与安全

- **三件套缺一不可**：每次启动生成 256 位 token 与**一次性 nonce**；窗口经
  `GET /__shell/bootstrap?nonce=…` 兑换 `HttpOnly; SameSite=Strict; Path=/` 的 `ab_proxy` Cookie
  后 `303 → /`。除 bootstrap 外**所有**路径（含 `/api`、`/a2a`、`/__shell/*`）都必须带该 Cookie
  （原生客户端可用 `Authorization: Bearer`）；`Origin` 与 `self_url` 不符者**先于鉴权**
  以 `403 proxy_origin_refused` 拒绝。token 只在网关内存与 Cookie 里，绝不进 UI；出向请求由
  `FilterProxyCookie` 剥掉该 Cookie（**大小写不敏感**），token 绝不转发上游。
- **绑定用端口 0**：Kestrel 绑 `127.0.0.1:0` 后从 `IServerAddressesFeature` 读回实际端口，
  **禁止**「先探测空闲端口→关闭→再绑」（中间会被别的进程抢走）；`AddServerHeader = false`，
  `ContentRootPath` 钉在 `AppContext.BaseDirectory`（当前目录里的 `appsettings.json` 不得影响宿主）。
- **SSE 必须真流式**：`ResponseHeadersRead` + 字节流拷贝，强制 `accept-encoding: identity`，
  **禁止整体超时**（仅 `ConnectTimeout = 10s`）；请求体上限 32MiB。
- **转发只走前缀白名单**：`IsForwardablePath` 拒绝含 `..` / `\` / `//` 的路径
  （`//host` 会改掉 base-URI 的 authority，`/api/../x` 会跑出前缀）。
- **`Location` 按 origin 比较**（scheme + host + port），不是字符串前缀：
  `https://hub.example.com.evil.test` 是另一个主机，绝不能改写到环回 origin。
- **上游 `Set-Cookie` 不得越权**：名为 `ab_proxy` 或带 `__Host-`/`__Secure-` 前缀的 Cookie
  **整条丢弃**；只有 `agenthub_session`（`Gateway.SessionCookieName`）才写入凭据库，
  其余（OAuth state / PKCE verifier）只转发不落盘——恶意服务端因此无法种下长期凭据。
  凭据库写失败只记日志，不能把已成功的登录变成 502。
- **凭据只进凭据库**：agenthub 会话与执行节点 API key 存操作系统凭据库，
  `config.json` 该字段留空并在 `Load()` 回填；无凭据库时回退 `0600` 文件（Windows 用 `icacls` 收紧）。
  `UnixCommandCredentialStore` 的 `security`/`secret-tool` 有 5s 预算（`Limits.CredentialTimeoutSeconds`），
  超时即杀，锁住的钥匙串不得挂住请求。
- **`config.json` 原子私有写**：写同目录私有临时文件（Unix 建即 `0600`、Windows 先 `icacls`）
  再 `File.Move(overwrite: true)`；**禁止**「先删后建」（丢内容、留窗口期）；
  读取时损坏或 >1MiB 一律回落默认值，不阻塞启动。
- **执行节点（BYOM）**：默认关闭、开启需显式确认。命令按**精确名**白名单匹配且**必须是裸名**
  （`command == Path.GetFileName(command)`，含 `/`、`\`、空格、`..`、控制字符一律拒绝）；
  shell（`sh`/`bash`/`cmd`/`sh.exe`…）与「启动器」（`env`/`sudo`/`xargs`/`timeout`/`docker`/`ssh`…，
  `ExecutorReject.Launchers`）构造上拒绝，白名单条目本身也按同一规则校验；
  **绝不拼 shell**（argv 直 exec）、根目录与环境变量白名单、并发上限；
  根目录与工作目录先经 `ResolveExisting` 解析符号链接再比较（链接逃逸被拒），
  文件系统根永远不可用；stdout/stderr 边读边截断（超限只丢弃，内存有界）；
  Unix 负 pgid `TERM → 250ms → KILL → wait()` 收尸，Windows 无进程组语义，如实退回直接子进程终止。
  状态/开关只经 `GET|POST /__shell/executor` 暴露，**UI 不获得任何文件系统或命令执行权限**；
  拒绝原因是机器码（`root_unusable` 等），13 语本地化。
- **两条写配置的路由共用一套校验**：`POST /__shell/config` 与 `POST /__shell/executor` 都走
  `ShellRoutes.ValidatePatch`；`executorApiKey` 在合并前被 `ExtractApiKey` 摘出并只进凭据库，
  **永远不进 `config.json`**（曾经的后门：`/__shell/executor` 直接 `ApplyPatchAsync(raw)`）。
- **通知文本绝不进脚本源码**：标题/正文来自服务端，Windows 走 `AB_NOTIFY_TITLE`/`AB_NOTIFY_BODY`
  环境变量、macOS 走 `osascript` 的 `run argv`、Linux 走 `notify-send --`，一律单行且限长
  （`MaxNotifyTitleChars` / `MaxNotifyBodyChars`）；深链队列有上限（20 条、单条 ≤512 字符）。
- **有界读取（内存是攻击面）**：JSON 响应 `MaxJsonBytes`、SSE 单事件 `MaxEventBytes`
  （逐字节分帧，超长行整行丢弃）、更新包 `MaxPackageBytes`；文件下载返回**活流**
  （`OwnedStream` 随 `Dispose` 释放 response），不再整包读进内存。
- **验签是严格 minisign 布局**：公钥盒 42 字节、签名盒 74 字节，`Ed` 标记与 8 字节 key id
  必须两侧一致；`ED`（预哈希）直接拒绝而不是给出另一种答案；空负载、空公钥一律失败。

### 托盘、通知与更新

- **托盘菜单语言跟随应用**：`ShellViewModel.Lang` 变化时经 `/__shell/config` 推 `lang` 给外壳，
  `TrayService.Refresh()` 重建 13 语菜单；角标计数留在进程里，`refresh` 后重新套用。
- **通知深链**：`link` 是站内路径（`/threads/42`），`DeepLinkQueue` 只接受单斜杠开头，
  拒绝 `//host`、`javascript:`、反斜杠与控制字符；点击只消费一次并交给 `NavigationService`。
  标题在发送瞬间按当前语言解析，**不能传 copy key**。
- **未读角标**：`POST /__shell/badge` clamp 到 999，>99 显示 `99+`，0 清空 tooltip 回落产品名。
- **自动更新**：GitHub / Gitee 并发竞速（不采集位置、不读 IP）、semver 比较、24h 单飞
  （时钟回拨视为到期）、跳过版本；`MinisignVerifier` 用 minisign 兼容的 Ed25519 验签，
  **未配置公钥一律返回 `not_configured`，绝不安装未验签包**；签名字段覆盖全部 6 个下载。
  发布矩阵仅 `linux-x86_64` / `darwin-aarch64` / `windows-x86_64`，其余返回 `unsupported_platform`。
- **同一个公钥只有一处**：release 前 `ab-tool inject-pubkey` 从 secret 写入
  `Upgrade/Pubkey.g.cs`；无 secret 时保持空。签名私钥 secret 为 minisign key box
  （两行文本或其 base64 包装），由 `ab-tool sign` / `MinisignVerifier.Decode` 共用同一解码语义。

### 测试与命令

- `cd desktop && dotnet test agentbuddy.sln`。四个 xUnit 项目：Core（契约/文案/轮询/SSE）、
  Shell（准入/Cookie/流式/凭据/执行节点/升级/真 socket 冒烟）、App（Headless VM/导航守卫）、
  Guards（静态扫描）。新增功能须补**正常 + 异常**双路径用例。
- **平台与生产专属依赖只留内部接缝**：用 `InternalsVisibleTo` 给对应测试项目，禁止为测试
  放宽公开 API。现行接缝：注入 `IAppPaths` / `ICredentialStore`、`CreatePrimary(os, exists)`、
  执行节点超时预算、音频 / 通知 / 安装器的 `StartProcess`、`DescribeNative(os)` /
  `DescribeInstall(os)` / `InputDevice(os)`、`ReducedMotionService.Detect(value, isWindows)`、
  `TrayHost.Handle`、`Composition.InitializeAsync(paths)`、`Composition.OnRealtimeEvent`。
  三平台契约因此能在任意宿主上断言，而不是只在对应系统上碰运气。
- **替身进程必须按 OS 分支**：假的 ffmpeg / 播放器 / 安装器 / 通知端 / 执行命令只能选各系统
  都有的工具（Unix 用 `/bin/echo`、`/bin/cat`、`/bin/sleep`、`/usr/bin/false`；Windows 用
  `cmd /c echo`、`findstr.exe`、`ping.exe`），**禁止**在无分支处直接拿 `where.exe` 这类只在
  Windows 存在的命令充当替身——CI 在 macOS / Linux 上会以 `speech_disabled`、`no_app`、
  `denied` 之类的机器码假失败（Shell 侧唯一入口是 `tests/AgentBuddy.Shell.Tests/TestProbe.cs`）。
- **覆盖率基线**（`make dotnet-coverage` 口径，34 个源文件）：行 **98.97%**、分支 **90.21%**。
  余下未命中都是平台独占或防御分支（`UnixCreateMode`、钥匙串助手、`IsWindows` 三元、
  两处 `while` 回边、`Program` 入口）；基线只降要写清理由，不能靠过滤器抹平。
- `dotnet build agentbuddy.sln -warnaserror` 必须 **0 警告 0 错误**；
  `dotnet test --collect:"XPlat Code Coverage"` 出 Cobertura。
  静态守卫是硬门槛（13 语键集、单色 XAML、契约常量可达性、共享控件复用、构建/发布只用 .NET），
  禁止用 exclude 绕过。
- CI 用 `actions/setup-dotnet@v4` + `global-json-file: desktop/global.json`；
  release 用 `dotnet publish -r <rid> --self-contained true` + WiX v4 / `dpkg-deb` / `hdiutil`
  + `ab-tool` 出 9 个 assets。

### 服务端（agenthub，改动需谨慎）

- 迁移幂等，新增走新文件（`013` 起）；`store_test.go` 的 `want` 切片钉住文件名清单，必须同步。
- 新路由必须同时登记 `handlers/listen.go` 的 `Listeners()` 与 `listen_test.go` 的 `probes`。
- 不新增权限码：通道 / 连接器 / 语音复用 `tasks:read` / `tasks:write` / `resources:*`。

## 常用命令

```bash
make help                # 列出全部目标
make dotnet-install      # 校验 global.json 的 SDK + dotnet restore
make dotnet-icons        # 从 assets/app-icon.png 派生 png/ico/icns
make dotnet-build        # 全解决方案（warnings are errors）
make dotnet-test         # 四个 xUnit 项目
make dotnet-test-report  # 同一批测试 + 可粘贴的摘要与保留日志
make dotnet-coverage     # Cobertura 覆盖率
make dotnet-smoke        # 真 socket 环回网关冒烟
make dotnet-publish RID=win-x64   # 自包含发布（linux-x64 / osx-arm64 / win-x64）
make icons               # dotnet-icons 的别名
make stamp VERSION=1.2.3 # 写 Directory.Build.props 的唯一版本源
make manifest / make verify       # 双清单 / 恰好 9 assets 校验
make smoke / make test / make build / make clean
```

`ab-tool`：`dotnet run --project desktop/tools/AgentBuddy.Build -- <子命令>`，
子命令 `icons`、`stamp`、`inject-pubkey`、`sign`、`wix`、`manifest`、`verify`。

## 开发流程（硬性要求）

1. **Plan 模式产出 `requirements.md`**（功能边界 / API / 异常 / 验收标准），
   人工审核通过后再创建 `task.md` 分步实施。
2. **实现与单元测试同步**：新增功能必须补单测，覆盖正常与异常路径。
3. **合入前校验全绿**：`make dotnet-build` + `make dotnet-test`；
   涉及网关/通知/更新链路时加跑 `make dotnet-smoke`；agenthub 改动走 `go build` + `go vet` + `go test -race ./...`。
4. 改动行为时同步三件套：`README.md`、`requirements.md`、`task.md`；只改代码不改文档视为未完成。
5. 渐进式披露：本文件保持精简，领域细节写在各自子目录或代码注释中。
