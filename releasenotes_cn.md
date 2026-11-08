# agentbuddy 发布说明

agentbuddy 是 agenthub 的 Tauri v2 桌面客户端。它把 agenthub 工作台——工作区、线程、任务、
组织、通道、连接器、计算机、调度、人像与设置——对着用户指定的服务器打开，经由环回代理
重写 `/api`、`/a2a`、`/healthz` 与 `/.well-known`。

## 一、平台总览

- **桌面客户端，而非服务端**：agentbuddy 自身无后端、无数据库。它是包着 agenthub Web 工作台的
  Tauri v2（Rust）外壳，复用 agenthub 的认证、A2A 编排、注册中心与任务状态机。
- **环回代理**：Rust axum 代理绑定 `127.0.0.1:0`，仅把前缀 `/api`、`/a2a`、`/healthz` 与
  `/.well-known` 转发到用户配置的 agenthub 服务端；其余路径一律回退到内嵌 SPA 的
  `index.html`。服务端新增 `/api/*` 端点无需改动桌面端代码。
- **13 种语言**：en / zh / zh-TW / es / fr / de / it / ru / ja / ko / pt / ar / hi；外壳自有文案
  与工作台语言集保持一致。
- **纯单色 UI**：所有界面纯灰阶（十六进制三通道相等、无色彩词），由 Vitest 样式守卫强制。

## 二、桌面外壳

- **托盘与退出**：托盘含「打开 / 设置 / 关于 / 退出」，退出真正结束进程。
- **系统通知**：经 `tauri-plugin-notification` 投递，首次运行默认开启。工作台随通知发送一条
  站内路径（`{"title","body","link"}`），点击通知正文（`tap`）会真正跳过去：外壳先把路径入队，
  点击时恢复窗口并赋值 `window.location.hash`——工作台是 hash 路由，这就是一次真实路由跳转。
  只接受站内路径（`//host`、`javascript:`、控制字符一律拒绝），值先 JSON 编码再进 `eval`，
  且一次点击只消费一次。
- **托盘未读角标**：工作台在未读数变化时经 `POST /__shell/badge` 推给外壳（fire-and-forget，
  纯 Web 构建下静默）。tooltip 在所有平台显示「N 条未读」，支持的平台再在托盘标题上显示数字
  （超过 99 显示 `99+`）；计数留在进程里，因此切换语言重建菜单后角标不会消失，归零时才清空。
  文案走 13 语 `trayUnread`，纯函数实现，无窗口也能单测。
- **自动更新**：启动后及此后每 24 小时，外壳并发探测
  `github.com/ariacompute/agentbuddy` 与 `gitee.com/ariacompute/agentbuddy`，取响应最快的一源
  ——不看 IP、不采集位置；单源失败自动切到另一源。版本按 semver 比较，再按本地操作系统与
  CPU 架构匹配对应的签名安装包。发现新版本时弹系统通知（点击进入设置页），并在设置页卡片、
  侧栏横幅与关于页同时显示状态；点「立即升级」后由 `tauri-plugin-updater` 校验 minisign
  签名、安装并重启。自动检查可关闭、某个版本可跳过；当前平台没有发布包时给手动下载入口，
  不重试风暴。
- **会话持久化**：agenthub 会话 cookie 在应用重启间持久化——按服务器 URL 保存，启动时回放进
  cookie jar——切换服务器或重启不会强制重新登录。
- **主题**：应用默认浅色主题，连接/关于页提供切换并设置持久化的 `agentbuddy.theme`。
- **版本戳**：`vX.Y.Z@commit` 版本戳（由最新 git tag 加短提交号构成）显示在登录与关于页。
- **关闭行为**：窗口关闭时读取 `background` 偏好——开启（默认）则隐藏窗口、应用驻留托盘；
  关闭则退出应用。仅托盘「退出」会强制结束。
- **代理准入**：绑定 `127.0.0.1` 只挡住网络、挡不住本机，所以端口本身不再足够。每次启动生成
  256 位 token 与一次性引导 nonce；窗口打开 `/__shell/bootstrap?nonce=…`，取得
  `ab_proxy=<token>; HttpOnly; SameSite=Strict` 后跳转到 `/`。其余路由——`/api`、`/a2a`、
  `/__shell/*` 与静态资源——都必须带这枚 Cookie（原生客户端可用 `Authorization: Bearer`），
  且 `Origin` 指向其他站点的请求在检查 Cookie 之前就被拒绝。token 从不进入 JavaScript
  （注入脚本读不到），转发上游前也会被剥掉。nonce 猜错**不会**消耗掉它：256 位无从猜起，
  而清空它等于让本机任何进程一次请求就能废掉窗口唯一的那次启动。
- **内容安全策略**：窗口打开的是普通环回源，`tauri.conf.json` 里的 CSP 到不了这些响应，
  因此策略由代理自己发：`script-src 'self'` 加每次响应一枚新 nonce——这也是首屏主题脚本
  被外置成 `web/public/theme-init.js` 的原因。服务器选定的策略原样透传：只丢逐跳头，
  上游的 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Frame-Options` 全部保留。
- **凭据存储**：保存的会话 Cookie 等价于 bearer，因此按服务器 URL 存进系统凭据库——
  Windows 凭据管理器（DPAPI）、macOS 钥匙串、Linux Secret Service。没有任何凭据库响应时
  （无头机器、钥匙串已锁）回退为仅属主可读的 `session.json` 并把这件事写进日志，
  `/__shell/config` 以 `sessionBackend` 报告当前后端；已有的明文会话在首次读取时迁入并删除。

## 三、工作台

- **Vue 3 + Vite（bun）** 工作台由外壳托管，采用左栏 + 右内容布局。
- **各屏**：原有八屏——登录、工作区、线程、任务追踪、组织、通道、连接器、设置——外加
  agent 能力屏与共享文件屏，共 15 屏 / 16 条路由；线程与任务各自拥有独立的列表视图与详情视图；
  调度页则从目标列表长成了可观测的调度台。人像与知识库这两屏现在都有侧栏入口：前者有路由有界面、
  却只能手敲 URL 才能到达，后者此前根本没有界面。
- **共享文件**：新增独立页（`/files`，侧栏 `FolderOpen` 入口）。拖拽或点选上传，
  上传中显示等宽进度条与百分比，单文件上限直接取服务端返回的 `maxBytes`（发送前先挡一次超限）；
  文件表给出名称、大小、类型与上传时间，下载是普通链接直达 `/api/files/{id}/content`
  （字节不经 JS），删除走行内二次确认。没有文件与服务端关闭该功能是两种不同的空态。
  上传失败在拖拽区内给出本地化原因并可重试。
- **不留孤儿封装**：`lib/api.js` 的每个具名导出都必须被至少一处界面引用，由
  `tests/api-usage.spec.js` 强制且白名单必须为空；`tests/round4.spec.js` 逐条钉住
  「界面 → 端点」的正常与异常两条路径，于是「有封装没人调」会在测试里红，而不是藏起来。
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

节点跑在 Rust 进程内。网页视图只能通过 `/__shell/executor` 读取它的状态，因此即使控制台页面被
攻破，也拿不到文件系统或命令执行权限。

## 七、鉴权与离线韧性

- 工作台区分会话过期与服务器宕机，从而提示重新登录而非误报离线，并在退出登录后返回登录页。
- **静默期从「你设定的那一刻」起算。** 原来的锚点是首次读取设置的时间，于是开了两小时的页面
  选「静默 30 分钟」会算出已经过去的窗口，静默根本不生效。现在读取与保存都以当前时刻为锚。

## 八、跨平台构建与发布

- 6 个下载：`deb` + 便携 tarball（Linux）、`dmg` + 便携 tarball（macOS aarch64）、
  `msi` + 便携 zip（Windows）；加 `latest.json`、`latest-gitee.json`、`SHA256SUMS`
  共恰好 9 个 assets。
- 配置仓库 secrets `UPDATER_PUBKEY` 与 `TAURI_SIGNING_PRIVATE_KEY` 后，release 把公钥注入
  `desktop/src-tauri/src/upgrade/mod.rs`（运行时验签）与 `tauri.conf.json` 的
  `plugins.updater.pubkey`，并用 `tauri signer sign --app-version V` **直接给 6 个下载签名**。
  base64 签名内嵌在 `latest.json`（GitHub 资产 URL）与 `latest-gitee.json`（Gitee 资产 URL）：
  `platforms` 指向各平台可安装的那个资产，`signatures` 覆盖全部 6 个。不再发布独立更新包、
  `.sig` 或 `updater-*.json`，且从不打开 `bundle.createUpdaterArtifacts`——因此不会产出
  AppImage 与重复 msi。Gitee 镜像上传同样 6 个下载，并把 `latest-gitee.json` 重命名为
  `latest.json`；每份清单只指向自己那一源。发布前的 `verify` 步骤会拒绝任何不等于这 9 个
  文件的集合。未配置密钥时同样发布这 9 个文件，但 `platforms`/`signatures` 为空，
  客户端自动降级为手动下载。
- Linux 上从源码构建还需 `libdbus-1-dev` 与 `pkg-config`：会话存在 Secret Service 里，
  经 D-Bus 访问。Windows 与 macOS 无额外依赖——凭据管理器与钥匙串是系统自带的。

## 九、测试

- Vitest 覆盖 i18n 完整性、单色守卫、连接器策略、轮询监控、通知、语音、登录守卫与外壳根组件、
  模态框与录音组件、API 客户端（每个端点包装各一条用例，路由挪了会在这里红而不是在某一屏上），
  并为每一屏补齐用例（筛选、预算、人像切换、目标新建/启停/删除及每条失败路径、调度水位与
  倒计时、通道新建/删除/重试与仅 SMS 出现的 destination 字段、执行环境控制台与租约操作、
  登录与注册、逐屏的「界面→端点」正常与异常双路径、`lib/api.js` 的导出引用守卫，
  以及专门覆盖「正常路径走不到的分支」的一组用例，外加共享文件页与连接器审批队列，
  以及最后一轮补的边角：无机器码的失败、缺 MIME / 缺连接器名的行、没有参数的审批，
  外加更新卡片的三条外壳路由、每种状态机器码与「无外壳」路径；最后再补一轮
  「按钮 disabled 时点不到的守卫」——直接调用处理函数覆盖提前返回、空响应体与未知机器码，
  并用服务端渲染覆盖无 `window` 的 setup 分支）。
  **共 32 个 spec、785 条用例**，全程离线。
- `bun run test:coverage`（v8，对应 `make web-coverage`）报告：语句、行、分支、函数四项
  均 **100%**（10989 条语句、1804 个分支、433 个函数）。没有未覆盖的防御分支，
  也没有从报告里排除任何文件。
- `cargo test` 覆盖代理（准入控制、nonce 握手、Cookie 重写、流式转发、来源闸、角标端点）、
  配置（语言回落、按服务器隔离的会话存储、明文迁移）、i18n（13 语键集与英文顺序完全一致、
  语言代码编译期对齐 `web/src/lib/languages.js`）与托盘映射；本轮另加升级模块的纯逻辑用例
  （双源择优、semver 比较、平台映射、24h 到期、跳过版本、失败回落）与无窗口路由用例，
  以及此前的托盘角标
  （0 条、`99+`、每种语言各一断言）与 5 条静态文件服务用例（真实 `app_version_stamp()` 形状，
  而非复制一份格式串；客户端路由回落到 shell 且 CSP **每响应**一个新 nonce；缺文件是 404 而不是
  SPA 回落；`assets/` 长期缓存 vs 其余 `no-cache`；about 页的 boot `page`）。已在 Linux（WSL2）与 CI 上执行；Windows
  测试二进制在本环境无法启动，故在 Windows 上只做编译校验。CI 现在把 Linux 那次的输出写进
  `GITHUB_STEP_SUMMARY` 并上传 `desktop-test.log`，本机可用 `make desktop-test-report`
  生成同样的摘要。
