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
                       NotificationDecider / RealtimeService（四路 SSE + since 重放）
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
  tests/               Core.Tests / Shell.Tests / App.Tests / Guards（xUnit）
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
- 日志统一 `Microsoft.Extensions.Logging` 分级，**绝不打印密钥、Cookie、URL userinfo 或请求体**；
  通知与角标投递一律 fire-and-forget 且捕获异常。

### 网关准入与安全

- **三件套缺一不可**：每次启动生成 256 位 token 与**一次性 nonce**；窗口经
  `GET /__shell/bootstrap?nonce=…` 兑换 `HttpOnly; SameSite=Strict; Path=/` 的 `ab_proxy` Cookie
  后 `303 → /`。除 bootstrap 外**所有**路径（含 `/api`、`/a2a`、`/__shell/*`）都必须带该 Cookie
  （原生客户端可用 `Authorization: Bearer`）；`Origin` 与 `self_url` 不符者**先于鉴权**
  以 `403 proxy_origin_refused` 拒绝。token 只在网关内存与 Cookie 里，绝不进 UI、绝不转发上游。
- **SSE 必须真流式**：`ResponseHeadersRead` + 字节流拷贝，强制 `accept-encoding: identity`，
  **禁止整体超时**（仅 `ConnectTimeout = 10s`）；请求体上限 32MiB。
- **凭据只进凭据库**：agenthub 会话与执行节点 API key 存操作系统凭据库，
  `config.json` 该字段留空并在 `Load()` 回填；无凭据库时回退 `0600` 文件（Windows 用 `icacls` 收紧）。
- **执行节点（BYOM）**：默认关闭、开启需显式确认。命令按**精确名**白名单匹配
  （`sh`/`bash`/`cmd` 构造上拒绝）、**绝不拼 shell**（argv 直 exec）、根目录与环境变量白名单、
  输出截断、并发上限；Unix 负 pgid `TERM → 250ms → KILL → wait()` 收尸，
  Windows 无进程组语义，如实退回直接子进程终止。状态/开关只经 `GET|POST /__shell/executor` 暴露，
  **UI 不获得任何文件系统或命令执行权限**；拒绝原因是机器码（`root_unusable` 等），13 语本地化。

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
