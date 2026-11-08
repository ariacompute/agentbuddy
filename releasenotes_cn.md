# agentbuddy 发布说明

agentbuddy 是 agenthub 的 **.NET 10 / Avalonia 原生桌面客户端**。它把 agenthub 工作台——
工作区、线程、任务、组织、通道、连接器、计算机、调度、人像、知识、共享文件与设置——
对着用户指定的服务器打开，经由进程内环回网关转发 `/api`、`/a2a`、`/healthz` 与 `/.well-known`。

## 一、平台总览

- **原生客户端，而非服务端**：agentbuddy 自身无后端、无数据库、无 WebView。
  XAML 界面用 `HttpClient` 访问进程内 Kestrel 环回网关，复用 agenthub 的认证、
  A2A 编排、注册中心与任务状态机。
- **环回网关**：绑定 `127.0.0.1:0`，仅把前缀 `/api`、`/a2a`、`/healthz` 与 `/.well-known`
  转发到用户配置的 agenthub 服务端；其余路径是 `/__shell/*` 本地控制面或普通 404，
  没有 SPA 回退、没有内嵌 `index.html`。服务端新增 `/api/*` 端点无需改动桌面端代码。
- **13 种语言**：en / zh / zh-TW / es / fr / de / it / ru / ja / ko / pt / ar / hi；
  单一 `copy.json` 资源以英文浅合并兜底，界面与托盘共用；`ar` 下 `FlowDirection=RightToLeft`。
- **纯单色 UI**：所有界面纯灰阶，`AgentBuddy.Guards` 静态扫描全部 `.axaml`；
  控件模板只引用 `DynamicResource Brush.*`，不写死色值。

## 二、桌面外壳

- **托盘与退出**：托盘含「打开 / 设置 / 关于 / 退出」，退出真正结束进程。
- **系统通知**：走各平台原生通道（Windows toast / macOS 通知中心 / Linux D-Bus），
  首次运行默认开启。工作台随通知发送一条站内路径（`{"title","body","link"}`），
  外壳把它放进 `DeepLinkQueue`，点击 toast 时恢复窗口并交给 `NavigationService` 完成跳转。
  只接受单斜杠开头的站内路径（`//host`、`javascript:`、反斜杠与控制字符一律拒绝），
  且一次点击只消费一次。
- **托盘未读角标**：工作台在未读数变化时经 `POST /__shell/badge` 推给外壳（fire-and-forget，
  异常一律吞掉，绝不产生未观察异常）。tooltip 在所有平台显示「N 条未读」，支持的平台再在托盘标题上显示数字
  （超过 99 显示 `99+`）；计数留在进程里，因此切换语言重建菜单后角标不会消失，归零时才清空。
  文案走 13 语 `trayUnread`，纯函数实现，无窗口也能单测。
- **自动更新**：启动后及此后每 24 小时，外壳并发探测
  `github.com/ariacompute/agentbuddy` 与 `gitee.com/ariacompute/agentbuddy`，取响应最快的一源
  ——不看 IP、不采集位置；单源失败自动切到另一源。版本按 semver 比较，再按本地操作系统与
  CPU 架构匹配对应的签名安装包。发现新版本时弹系统通知（点击进入设置页），并在设置页卡片、
  侧栏横幅与关于页同时显示状态；点「立即升级」后由 `UpgradeService` 校验
  minisign 兼容的 Ed25519 签名、安装并重启。自动检查可关闭、某个版本可跳过；
  当前平台没有发布包时给手动下载入口，不重试风暴。
- **会话持久化**：agenthub 会话 cookie 在应用重启间持久化——按服务器 URL 保存，启动时回放进
  cookie jar——切换服务器或重启不会强制重新登录。
- **主题**：应用默认浅色主题，连接/关于页提供切换并设置持久化的 `agentbuddy.theme`。
- **版本戳**：`vX.Y.Z@commit` 版本戳（由最新 git tag 加短提交号构成）显示在登录与关于页。
- **关闭行为**：窗口关闭时读取 `background` 偏好——开启（默认）则隐藏窗口、应用驻留托盘；
  关闭则退出应用。仅托盘「退出」会强制结束。
- **代理准入**：绑定 `127.0.0.1` 只挡住网络、挡不住本机，所以端口本身不再足够。每次启动生成
  256 位 token 与一次性引导 nonce；窗口打开 `/__shell/bootstrap?nonce=…`，取得
  `ab_proxy=<token>; HttpOnly; SameSite=Strict` 后跳转到 `/`。其余路由——`/api`、`/a2a`、
  `/__shell/*`——都必须带这枚 Cookie（原生客户端可用 `Authorization: Bearer`），
  且 `Origin` 指向其他站点的请求在检查 Cookie 之前就被拒绝。token 从不进入界面代码，
  转发上游前也会被剥掉。nonce 猜错**不会**消耗掉它：256 位无从猜起，
  而清空它等于让本机任何进程一次请求就能废掉窗口唯一的那次启动。
- **不再输出 HTML**：没有 WebView，就不需要逐响应 CSP nonce、首屏主题脚本与版本戳注入。
  连接页与关于页是 Avalonia 原生窗口，主题由 `RequestedThemeVariant` 设定，
  版本戳是 ViewModel 绑定。服务器选定的策略原样透传：只丢逐跳头，
  上游的 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Frame-Options` 全部保留。
- **凭据存储**：保存的会话 Cookie 等价于 bearer，因此按服务器 URL 存进系统凭据库——
  Windows 凭据管理器（DPAPI）、macOS 钥匙串、Linux Secret Service。没有任何凭据库响应时
  （无头机器、钥匙串已锁）回退为仅属主可读的 `session.json` 并把这件事写进日志，
  `/__shell/config` 以 `sessionBackend` 报告当前后端；已有的明文会话在首次读取时迁入并删除。

## 三、工作台

- **Avalonia XAML + MVVM** 原生工作台，共享顶栏、左栏与内容区；6 个共享控件
  （页头、顶栏、侧栏、文件传输、语音、任务动作）在 17 个视图间复用。
- **各屏**：原有八屏——登录、工作区、线程、任务追踪、组织、通道、连接器、设置——外加
  agent 能力屏与共享文件屏，共 15 屏 / 16 条路由；线程与任务各自拥有独立的列表视图与详情视图；
  调度页则从目标列表长成了可观测的调度台。人像与知识库这两屏现在都有侧栏入口：前者有路由有界面、
  却只能手敲 URL 才能到达，后者此前根本没有界面。
- **共享文件**：`/files` 独立页。原生文件选择器挑文件上传，进度条按 `IProgress<int>`
  实时更新；列表选中行会解析出文件 id，下载直接取字节流并用原生「另存为」落盘，
  删除走 `DELETE /api/files/{id}`。上传失败只在页头显示本地化机器码文案。
- **语音**：线程详情页用共享语音控件录音（`audio` 字段 / `voice.webm`）、
  提交到 `/api/threads/{id}/audio`，并可回放刚录的片段；音频后端可选，
  未配置时返回 `speech_disabled`，不隐藏文本输入。
- **不留孤儿端点**：`Core/Contracts/Endpoints.cs` 的每个冻结常量都必须在其定义之外
  被真实引用，由 `AgentBuddy.Guards` 强制且白名单必须为空；每屏声明 `EndpointsUsed`，
  App 测试逐条钉住正常与异常两条路径，于是「有常量没人调」会在测试里红，而不是藏起来。
- **界面接线**：组织页可直接新建资源（`POST /api/resources`）；连接器页按需列出某个连接器
  声明的动作（`GET /api/connectors/{id}/actions`）；计算机页列出 agent 计算机卡片，删除前
  先重读再删（`GET /api/computers`、`GET/DELETE /api/computers/{id}`）；调度页展示并保存
  路由器的来源策略（`GET /api/router/policies`、`PUT /api/router/policies/{source}`），
  触发与工单可展开看正文与判定，实时帧会去抖刷新列表；线程输入框提供 `@` 候选（只从本线程
  发过言的 agent 里挑），并可停止委派（`DELETE /api/router/subscriptions/{threadId}`）。
- **删除即消失**：服务端对「删不到的行」回 404 而不是 204，因此另一台机器上删掉的目标、通道、
  计算机或文件回来时会带 `schedule_not_found` / `channel_not_found` / `computer_not_found` /
  `file_not_found`；调度、通道、计算机与文件四屏都把它当作「已经没了」并重拉列表，而不是对一行
  已经不存在的记录弹一句拒绝。其余失败仍按本地化文案就地显示，行不消失。
- **多语言与主题**：语言切换（13 语）与明/暗主题、人像头像及通知中心。

## 四、通道、连接器与语音

- **通道**：把 Slack / Teams / Telegram / SMS 绑定到线程；查看投递记录、配置签名密钥
  （仅环境变量名）。未送达的回执带「重试」（`POST /api/channels/{id}/deliveries/{did}/retry`），
  已送达的不给重试入口；通道错误一律显示本地化文案，不再打印机器码。
- **连接器**：列出 `kind=mcp` 资源，设置 `off / ask_first / allowed` 策略并触发动作；
  `ask_first` 会把动作真正挂起，并在连接器页形成可操作的**审批队列**——每条显示连接器名、
  等宽动作名、参数摘要（悬浮看全文）与请求时间，「批准」即让服务端真跑一次、「拒绝」即终止。
  决策后重新拉取队列而不是本地猜测；失败的行保留并就地给出原因（已决定、已不存在）。
  修掉了「动作名两边字段不一致」的报文错位（服务端读 `action`）。
- **语音**：录制语音片段，以 multipart 上传至 `POST /api/threads/{id}/audio`，并回放
  agent 的 TTS 回复。

## 五、Agent 能力视图

对应 agenthub 的 F10–F16，工作台新增覆盖 agent 能力面的视图。其中调度已接上 agenthub 的真实
触发路由器，其余仍为确定性脚手架（深层能力在服务端标 `TODO(real)`）：

- **执行环境**：计算机屏升级为 agenthub 沙盒控制台的控制台——按隔离层分组的后端目录（每项都给出
  是否可用**以及不可用的原因**）、五指标水位条（活跃租约 / 待执行任务 / 在线节点 / 最近执行 /
  上次清扫）、带到期倒计时的租约卡片，以及可试跑命令的审计抽屉。终止租约前二次确认；服务端未
  接线该能力时页面直接说明「沙盒已关闭」及开启方式，而不是画一条看起来健康的 0。
- **调度台**：读取 agenthub 的触发路由器，而不再是 mock 计时器——顶部「水位条」（待判定 /
  运行中 / 待人工 / 本批数量 / 已跑节拍）、该目标的运行历史时间线（可点进真实任务追踪）、
  以及最近触发流并对每一行标注判定结果（`GET /api/router/stats`、`/triggers`、`/tickets`）。
  「立即运行」触发一次目标（`POST /api/schedules/{id}/run`），「推进一拍」请求一轮调度
  （`POST /api/router/passes`），在飞的运行可取消或交回。服务端关闭调度器时页面直接说明，
  而不是显示一排看起来健康的 0。
- **目标**：创建、编辑与删除主动目标——目标 / cron 表达式 / 是否启用
  （`GET/POST/PUT/DELETE /api/schedules`），cron 表达式在保存时校验。
- **人像编辑器**：编辑 agent 的人像档案——角色、指令、MBTI、头像与标题——并通过资源
  更新端点持久化到 agenthub。

## 六、执行节点（BYOM）

设置页新增**执行节点**区块，默认关闭。开启前必须先确认，因为这会让服务端以你的身份在这台机器上
执行命令。它**不做**什么与它做什么同样重要：

- **没有 shell**——参数直接 exec；只接受白名单里的精确命令名，`sh` / `bash` / `cmd` 在构造上即被拒绝；
- **单一根目录**——工作根目录必须是绝对路径，目录之外的读写与执行一律不可能；
- **有界**——超时会杀掉整个进程组，输出截断，并发有上限；
- **可见**——节点 id、最近心跳与最近一次拒绝原因都显示在区块里，且由外壳返回的机器码本地化而来。

节点跑在 .NET 宿主进程内。Avalonia 视图只能通过 `/__shell/executor` 读取它的状态；
连窗口专属能力（文件选择器、音频采集）也以委托注入到可无窗口单测的 ViewModel，
界面拿不到任何文件系统或命令执行权限。

## 七、鉴权与离线韧性

- 工作台区分会话过期与服务器宕机，从而提示重新登录而非误报离线，并在退出登录后返回登录页。
- **静默期从「你设定的那一刻」起算。** 原来的锚点是首次读取设置的时间，于是开了两小时的页面
  选「静默 30 分钟」会算出已经过去的窗口，静默根本不生效。现在读取与保存都以当前时刻为锚。

## 八、跨平台构建与发布

- 6 个下载：`deb` + 便携 tarball（Linux）、`dmg` + 便携 tarball（macOS aarch64）、
  `msi` + 便携 zip（Windows）；加 `latest.json`、`latest-gitee.json`、`SHA256SUMS`
  共恰好 9 个 assets。
- 三个构建 leg 各跑一次 `dotnet publish -r <rid> --self-contained true`；WiX v4
  （作者文件由 `ab-tool wix` 从 publish 输出确定性生成）、`dpkg-deb`、`hdiutil`
  分别产出安装包，并各出一份便携包。
- 配置仓库 secrets `UPDATER_PUBKEY` 与 `UPDATER_PRIVATE_KEY` 后，`ab-tool inject-pubkey`
  把公钥写入 `Shell/Upgrade/Pubkey.g.cs`，`ab-tool sign` 用 minisign 兼容的 Ed25519
  直接给 6 个下载签名。base64 签名内嵌在 `latest.json`（GitHub 资产 URL）与
  `latest-gitee.json`（Gitee 资产 URL）：`platforms` 指向各平台可安装的那个资产，
  `signatures` 覆盖全部 6 个。不再发布独立更新包、`.sig` 或 `updater-*.json`，
  也不会产出 AppImage 与重复 msi。Gitee 镜像上传同样 6 个下载，并把
  `latest-gitee.json` 重命名为 `latest.json`；每份清单只指向自己那一源。
  发布前 `ab-tool verify` 会拒绝任何不等于这 9 个文件的集合。未配置密钥时同样发布这
  9 个文件，但 `platforms`/`signatures` 为空，客户端自动降级为手动下载。
- 从源码构建只需 `desktop/global.json` 钉住的 .NET 10 SDK。Linux 上凭据库经
  D-Bus 访问 Secret Service；Windows 凭据管理器与 macOS 钥匙串是系统自带的。

## 九、测试

- 四个 xUnit 项目取代旧的前端/桌面双套测试，**91 条用例**全程离线，每项新能力都有正常与
  异常双路径。`AgentBuddy.Core.Tests` 覆盖 13 语兜底、端点契约、配置、SSE 分帧、
  `MonitorService` 与 `RealtimeService`（事件分类、`since` 重放、重连退避、有界环形缓冲）。
  `AgentBuddy.Shell.Tests` 覆盖 bootstrap 准入（含错猜 nonce 不消耗）、Cookie/Location
  改写、流式转发、凭据回退、执行节点策略、升级选源与验签失败、通知深链与托盘角标；
  `GatewaySmokeTests` 用真实 Kestrel 环回网关 + 上游 HTTP 桩跑真 socket，SSE 逐块到达。
  `AgentBuddy.App.Tests` 覆盖 Avalonia.Headless ViewModel、路由守卫、数字详情路由、
  文件传输、语音与通知深链。
- `AgentBuddy.Guards` 是硬门槛：13 语键集与真实翻译、单色 `.axaml` 扫描、
  模板无硬编码自然语言、冻结端点常量全部可达（白名单为空）、17 个视图与
  `ViewLocator` 一一对应、共享控件复用、主题字典成对、构建/发布只用 .NET、
  恰好 9 个发布 assets。
- `dotnet build agentbuddy.sln -warnaserror` **0 警告 0 错误**；
  `dotnet test --collect:"XPlat Code Coverage"` 产出 Cobertura，CI 同时上传覆盖率与测试日志。
  静态守卫而非行覆盖率是硬门槛，因此出现彩色值或漏译键会直接红。
- 发布链路也在本机验过：自包含 `win-x64` publish 交给 `ab-tool wix`，WiX 4.0.6 用生成的
  369 个 Component 真实产出 MSI；一次性 minisign 密钥签 6 个下载，
  `ab-tool manifest` 出两份清单，`ab-tool verify` 断言恰好 9 个文件并全绿。
