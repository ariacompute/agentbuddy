# agentbuddy 发布说明

agentbuddy 是 agenthub 的 Tauri v2 桌面客户端。它把 agenthub 工作台（注册中心 / 注册源 /
来源 / 链路 / 拓扑 / 通道 / 连接器 / 线程 / 任务）对着用户指定的服务器打开，经由环回代理
重写 `/api`、`/a2a`、`/healthz` 与 `/.well-known`。

## 0.1.0 — 首发

- **桌面壳**（Rust + Tauri v2）：环回 axum 代理、托盘「退出」真正退出进程、经
  `tauri-plugin-notification` 的系统通知，以及内嵌的连接/关于页。无后端、无数据库——
  agenthub 即服务端。
- **工作台**（Vue 3 + Vite，bun）：八屏——登录、工作区、线程、任务追踪、组织、通道、
  连接器、设置——含侧栏/顶栏、语言切换（13 语）、明/暗主题、人像头像与通知中心。
- **通道**：把 Slack / Teams / Telegram / SMS 绑定到线程；查看投递记录、配置签名密钥
  （仅环境变量名）。
- **连接器**：列出 `kind=mcp` 资源，设置 `off / ask_first / allowed` 策略并触发动作；
  `ask_first` 在应用内弹出人工批准卡片（HITL）。
- **语音**：录制语音片段，以 multipart 上传至 `POST /api/threads/{id}/audio`，并回放
  agent 的 TTS 回复。
- **单色 UI**：所有界面纯灰阶（十六进制三通道相等、无色彩词），由 Vitest 样式守卫强制。
- **跨平台构建**：`deb` + 便携 tarball（Linux）、`dmg` + 便携 tarball（macOS aarch64）、
  `msi` + 便携 zip（Windows），并附 `SHA256SUMS`。
- **测试**：Vitest（i18n 完整性、单色、connector-policy、monitor、notifications、voice）
  与 `cargo test`（代理、配置、i18n）。
