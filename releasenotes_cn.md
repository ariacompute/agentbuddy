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
- **系统通知**：经 `tauri-plugin-notification` 投递，首次运行默认开启。
- **会话持久化**：agenthub 会话 cookie 在应用重启间持久化——按服务器 URL 保存，启动时回放进
  cookie jar——切换服务器或重启不会强制重新登录。
- **主题**：应用默认浅色主题，连接/关于页提供切换并设置持久化的 `agentbuddy.theme`。
- **版本戳**：`vX.Y.Z@commit` 版本戳（由最新 git tag 加短提交号构成）显示在登录与关于页。
- **关闭行为**：窗口关闭时读取 `background` 偏好——开启（默认）则隐藏窗口、应用驻留托盘；
  关闭则退出应用。仅托盘「退出」会强制结束。

## 三、工作台

- **Vue 3 + Vite（bun）** 工作台由外壳托管，采用左栏 + 右内容布局。
- **各屏**：原有八屏——登录、工作区、线程、任务追踪、组织、通道、连接器、设置——外加三个
  新增的 agent 能力屏，且线程与任务各自拥有独立的列表视图与详情视图。
- **多语言与主题**：语言切换（13 语）与明/暗主题、人像头像及通知中心。

## 四、通道、连接器与语音

- **通道**：把 Slack / Teams / Telegram / SMS 绑定到线程；查看投递记录、配置签名密钥
  （仅环境变量名）。
- **连接器**：列出 `kind=mcp` 资源，设置 `off / ask_first / allowed` 策略并触发动作；
  `ask_first` 在应用内弹出人工批准卡片（HITL）。
- **语音**：录制语音片段，以 multipart 上传至 `POST /api/threads/{id}/audio`，并回放
  agent 的 TTS 回复。

## 五、Agent 能力视图

对应 agenthub 的 F10–F16，工作台新增三块覆盖 agent 能力面的视图（服务端侧均为确定性脚手架，
深层能力仍标 `TODO(real)`）：

- **计算机**：列出并创建绑定到 agent 的 `browser` / `shell` / `screen` 沙箱
  （`GET/POST /api/computers`、`GET /api/computers/{id}`）。
- **调度**：创建、编辑与删除主动目标——目标 / cron 表达式 / 是否启用
  （`GET/POST/PUT/DELETE /api/schedules`）。
- **人像编辑器**：编辑 agent 的人像档案——角色、指令、MBTI、头像与标题——并通过资源
  更新端点持久化到 agenthub。

## 六、鉴权与离线韧性

- 工作台区分会话过期与服务器宕机，从而提示重新登录而非误报离线，并在退出登录后返回登录页。

## 七、跨平台构建与发布

- `deb` + 便携 tarball（Linux）、`dmg` + 便携 tarball（macOS aarch64）、`msi` + 便携 zip
  （Windows），并附 `SHA256SUMS`。

## 八、测试

- Vitest（i18n 完整性、单色、connector-policy、monitor、notifications、voice）与
  `cargo test`（代理、配置、i18n）。
