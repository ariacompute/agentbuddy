# task.md — agentbuddy 实施记录

> 每完成一项打 `[x]` 并记录落点文件。与 `requirements.md`（契约）、`README.md`（手册）同步维护。

## M0 — 仓库骨架与工程规范

1. [x] `.gitignore`：node_modules / web/dist / src-tauri/target / .env
2. [x] `Makefile`：web-install/dev/build/test、desktop-install/dev/build/test/check、icons、stamp
3. [x] `AGENTS.md`：工程上下文入口（架构、目录、硬性约定、常用命令、开发流程）
4. [x] `requirements.md`：功能边界（F1–F9）、非功能（N1–N7）、服务端契约、机器码、验收标准
5. [ ] `README.md` / `README_cn.md`
6. [ ] `.github/workflows/release.yml`：三平台矩阵 deb / dmg+app / msi + 便携包 + SHA256SUMS

## M1 — web 基座（单色 + 13 语 + api）

10. [ ] `web/package.json`：vue/vue-router/pinia/lucide-vue-next + vite/vitest/@vitejs/plugin-vue（版本对齐 agenthub）
11. [ ] `web/vite.config.js`：proxy `/api` `/a2a` `/healthz` `/.well-known`；`test.environment='node'`
12. [ ] `web/index.html`：pre-paint 主题脚本（键名 `agentbuddy.theme`）
13. [ ] `web/src/style.css`：`:root` 暗色令牌 + `[data-theme='light']` 翻转 + 组件类 + reduced-motion
14. [ ] `web/src/lib/languages.js`：13 语目录 + matchLang/isRTL/hreflangFor/ogLocaleFor
15. [ ] `web/src/lib/use-copy.js`：STORAGE_KEY='agentbuddy.lang'；resolve/detectLang/setLang/useCopy/enumLabel
16. [ ] `web/src/lib/copy/*-copy.js`：shell/workspace/thread/task/org/channel/connector/settings/errors/enums（10 × 13 语）
17. [ ] `web/src/lib/errors.js` + `copy/errors-copy.js`：CODE_KEYS（含本轮新增 14 个机器码）+ 13 语
18. [ ] `web/src/lib/api.js`：auth/workspace/threads/tasks/resources/channels/connectors/audio + SSE + multipart
19. [ ] `web/src/lib/auth-store.js`：PERMISSIONS 词表 + signedIn/isOwner/can
20. [ ] `web/src/lib/workbench-store.js`：agents/threads/tasks/approvals/channels/connectors/notifications
21. [ ] `web/src/lib/monitor.js`：ActivityMonitor（轮询 + 按需 SSE，上限 6 + 退避）
22. [ ] `web/src/lib/notifications.js`：decide() 纯函数（幂等/静默/合并/深链）
23. [ ] `web/src/lib/voice.js`：录音状态机纯逻辑（降级）
24. [ ] `web/src/lib/connector-policy.js`：策略判定纯函数
25. [ ] `web/src/lib/format.js`、`use-dismiss.js`

## M2 — agenthub 增补：persona + channels

30. [ ] `migrations/013_persona.sql`：`ALTER TABLE resources ADD COLUMN IF NOT EXISTS persona JSONB;`
31. [ ] `migrations/014_channels.sql`：`channels` + `channel_messages`（external_ref 唯一键）
32. [ ] `internal/registry/registry.go`：`Entry.Persona` + `normalizePersona`
33. [ ] `internal/model/model.go`：`Resource.Persona` + `Channel` / `ChannelMessage` 模型
34. [ ] `internal/store/resource_store.go`：3 处（updateColumns / fromEntry / entryFrom）
35. [ ] `internal/channels/`：类型、签名校验（Slack/Teams/Telegram）、投递、Store 端口
36. [ ] `internal/store/channels_store.go`：GORM 实现
37. [ ] `internal/handlers/channels.go`：`/api/channels*` + public webhook
38. [ ] `internal/handlers/handlers.go`：`Deps` 增 Channels；注册路由
39. [ ] `internal/handlers/listen.go` + `listen_test.go`：Listeners 与 probes 同步
40. [ ] `internal/store/store_test.go`：迁移清单 `want` 追加 013/014
41. [ ] `internal/config/config.go`：`AGENTHUB_CHANNELS_ENABLED`
42. [ ] `internal/httputil/json.go`：通道相关机器码常量
43. [ ] `cmd/agenthub-server/main.go`：注入 channels 服务
44. [ ] 单测：签名校验、幂等、路由覆盖、迁移顺序

## M3 — agenthub 增补：connectors + speech

50. [ ] `migrations/015_thread_origin.sql`：`thread_messages.origin`
51. [ ] 连接器策略持久化（MCPConfig / Metadata，jsonb 无迁移）
52. [ ] `internal/adapter/speech.go`：确定性 mock STT/TTS（`TODO(real)`）
53. [ ] `internal/handlers/connectors.go`：`/api/connectors*` + 动作审批网关
54. [ ] 二次 park 防护：`Hub.Resume` 注入 approved 标记 → `InvokeRequest.Metadata`
55. [ ] `internal/handlers/speech.go`：`POST /api/threads/{id}/audio`（multipart 16 MiB）
56. [ ] `internal/store/threads_store.go`：`origin` 读写
57. [ ] `internal/config/config.go`：`AGENTHUB_SPEECH_MODE` / `AGENTHUB_AUDIO_MAX_BYTES`
58. [ ] Listen/probes/迁移清单同步；单测

## M4 — web 核心六屏

60. [ ] `App.vue` / `router.js` / `main.js`
61. [ ] 组件：Sidebar / Topbar / LanguageSwitcher / ThemeToggle / StateDot / PersonaAvatar
62. [ ] `LoginView.vue`
63. [ ] `WorkspaceView.vue`
64. [ ] `ThreadView.vue`
65. [ ] `TaskTraceView.vue`
66. [ ] `OrgView.vue`
67. [ ] `SettingsView.vue`

## M5 — web 通道 / 连接器 / 语音

70. [ ] `ChannelsView.vue` + ChannelCard / DeliveryList
71. [ ] `ConnectorsView.vue` + ConnectorCard / PolicySelect / ApprovalCard
72. [ ] `VoiceRecorder.vue` / `AudioPlayer.vue`
73. [ ] `ArtifactList.vue`（含音频内联播放）
74. [ ] `NotificationCenter.vue` / `ConnectionBanner.vue`

## M6 — Rust 桌面外壳

80. [ ] `Cargo.toml` / `build.rs` / `tauri.conf.json` / `capabilities/default.json`
81. [ ] `src/lib.rs`：配置 → 托盘 → CloseRequested 隐藏 → 启动代理 → 导航
82. [ ] `src/config.rs`：AppConfig（含后台运行、通知、静默期）
83. [ ] `src/proxy/{mod,forward,shell,static_files}.rs`：真流式 + cookie 重写 + `/__shell/*`
84. [ ] `src/tray.rs`：显示/隐藏/设置/关于/退出，13 语
85. [ ] `src/notify.rs`：`tauri-plugin-notification` → `/__shell/notify`
86. [ ] `src/i18n/{mod,copy}.rs`：13 语外壳文案
87. [ ] `assets/shell.html`：连接页 + 关于页
88. [ ] `frontend-stub/index.html`：灰阶启动占位页
89. [ ] `Info.plist`：`NSMicrophoneUsageDescription`
90. [ ] `assets/app-icon.png`（单色）+ `scripts/make-icon.mjs`（降级生成器）
91. [ ] `scripts/stamp.mjs`

## M7 — 测试与发布

100. [x] `web/tests/`：languages / copy-fallback / enums-copy / use-copy / errors / api /
       monitor / notifications / voice / connector-policy / **style（单色守卫）**
       - 新增 `auth-store.spec.js`（Pinia getters/actions）、`workbench-store.spec.js`
         （ingestTask 通知决策、refresh*/approve/reject、getters）、`use-dismiss.spec.js`
         （自动消失计时）；扩展 `api.spec.js`（auth/workspace/threads/tasks/resources/
         speech + SSE 订阅构建器）、`use-copy.spec.js`（useCopy/useLang/label 助手/
         setLang 镜像 `<html>`）、`monitor.spec.js`（订阅同步与状态处理）。
       - 总用例 179 → **234** 全绿（`bun run test`）。
101. [x] `desktop/src-tauri` Rust 单测（proxy、config、i18n、static_files）：在 `proxy/mod.rs`
       的端到端测试新增 `clamps_quiet_minutes_to_a_sane_ceiling` 与
       `connection_test_rejects_an_empty_url`；`cargo check --tests` 通过。
       - 注：本机测试二进制因 Tauri 原生依赖的 DLL 入口缺失
         （`STATUS_ENTRYPOINT_NOT_FOUND`）无法启动，属环境问题，与测试代码无关。
102. [ ] agenthub `go build` + `go vet` + `go test -race ./...`
103. [ ] `.github/workflows/release.yml`：三平台矩阵
104. [ ] `README.md` / `README_cn.md` 收尾
105. [ ] `requirements.md` / `AGENTS.md` 与实现对齐复核

## M9 — 登录页右上角语言 / 主题切换（2026-10）

- [x] `web/src/views/LoginView.vue`：新增 `.login-head`，放入 `LanguageSwitcher` 与 `ThemeToggle`（落点 F1.6）
- [x] `web/src/components/LanguageSwitcher.vue`：移除硬编码 `aria-label="Language"`，改用 `t('langLabel')`（shell 文案 13 语已齐备）
- [x] `web/src/style.css`：新增 `.login-head`（绝对定位右上角，`inset-inline-end`/`inset-block-start` 兼容 RTL）
- [x] 校验：`bun run build` 通过；`bun run test` 179 用例全绿（含 `style.spec.js` 单色守卫、`copy-fallback.spec.js` 13 语完整性）

## M8 — eMudhra / emSign 证书私钥泄露响应（2026-10）

背景：eMudhra(emSign) 8 张中间 CA 私钥极弱（P-384 私钥标量 <256），可被反推伪造任意域名证书；
Bun / Rust(webpki-roots) 等自带信任库需升级。agentbuddy 无后端、无容器，风险面集中在
bun 构建/测试运行时与桌面端（Rust/Tauri）对 agenthub 服务端的出向 TLS。

### 1. 前端 / 桌面脚本（Bun）
- `web/package.json` 与 `desktop/package.json`：新增 `engines.bun >=1.4.4`，约束 bun 运行时版本
  （Bun 1.4.4 修复其 TLS 信任库）。本仓无 Docker 镜像，bun 版本以本地/CI 运行时为准。
- 本仓无 Go / Node / Python 参与构建或运行时信任库，无需相应升级。

### 2. 桌面端（Rust / Tauri，reqwest + rustls）
- `desktop/src-tauri/Cargo.toml`：显式固定 `webpki-roots = "1.0.10"`（Rust 信任库在 1.0.10 移除
  emSign 根；桌面环回代理对 agenthub 服务端的 SSE/HTTP 出向校验依赖它）。本仓此前无 `Cargo.lock`，
  首次构建须解析到 ≥1.0.10。

### 3. 检测与验证
- 无容器 CA bundle 可扫；验证改为：`bun --version` 须 ≥1.4.4；桌面构建后
  `cargo tree -i webpki-roots`（或 `cargo update -p webpki-roots`）确认 ≥1.0.10。
- 站点证书（部署用 Let's Encrypt）不受影响，无需重签。

## MX — Login page version stamp

- [x] desktop/src-tauri/src/proxy/static_files.rs: inject window.__AGENTBUDDY_VERSION__ (X.Y.Z@<7-char commit>) into the console index.html at the closing body tag; adds app_version_stamp() and render_console_index(); unit tests for both.
- [x] web/src/views/LoginView.vue: read window.__AGENTBUDDY_VERSION__ and render it in a footer (hidden when absent, e.g. plain web dev).
- [x] web/src/style.css: .login-version style (monochrome, token-based, absolute bottom-center).
- [x] Makefile: pass AGENTBUDDY_COMMIT (derived from `git rev-parse --short=7 HEAD` in the Makefile) to desktop-build/dev/check/test so the real 7-char commit is stamped (falls back to `unknown`).
- [x] desktop/src-tauri/src/proxy/static_files.rs: `shell_page` boot `version` now uses `app_version_stamp()` (the same `vX.Y.Z@<7-char commit>`), so the About page's "版本" matches the login page; dropped the redundant Build row.
- [x] desktop/src-tauri/assets/shell.html: removed the Build row (template + JS assignment) from the About card.
- [x] desktop/src-tauri/src/proxy/mod.rs: added `about_page_version_matches_the_login_stamp` test.
- [x] desktop/src-tauri/build.rs: derive `AGENTBUDDY_COMMIT` at build time via `git rev-parse --short=7 HEAD` (emitted with `cargo:rustc-env`), honoring a CI-supplied `AGENTBUDDY_COMMIT` when present; fixes the version stamp always reading `unknown`.
- [x] desktop/src-tauri/build.rs: re-run the build script on commit changes (`cargo:rerun-if-changed` on `.git/HEAD` and the resolved ref) so the stamped commit does not go stale after a new `git commit` (cargo cached `cargo:rustc-env`, freezing `crate::COMMIT` at an old hash).
- [x] Makefile: drop the redundant/buggy `AGENTBUDDY_COMMIT=$(COMMIT)` forwarding — it only applied to `cd`, so cargo never received it; build.rs now owns the stamp.
- [x] desktop/src-tauri/src/lib.rs: document that `COMMIT` comes from `build.rs` (git or env), `unknown` only as a last resort.
- [x] desktop/src-tauri/src/proxy/static_files.rs: wrap the injected version assignment in `<script>` (the missing wrapper rendered it as literal text `window.__AGENTBUDDY_VERSION__ = ...;` on the login dialog); injection now yields `<script>window.__AGENTBUDDY_VERSION__ = "vX.Y.Z@<7-char commit>";</script>` before `</body>`.
- [x] web/src/views/LoginView.vue + web/src/style.css: show the version in the bottom-left corner of the login screen (absolute, pinned to the viewport bottom-left; moved out of the login card).

## M10 — 融合 6 标杆项目的特性扩展（F10–F16，agenthub 为服务端）

背景：参考 `agent-assistant-analysis.md`（OpenDots / openmuse / openbot / Octop / openagents / Velozity
六个项目的 Agent Assistant 特性），将可借鉴能力抽象为 agentbuddy 正式特性规格；agenthub 继续作为
唯一后端（执行/编排/通道/语音）。真实第三方对接首版为确定性 mock，标 `TODO(real)`；不新增权限码。

- [x] `requirements.md`：在 §2 与 §3 间新增 `## 2B. 融合标杆项目的扩展特性（F10–F16）`
  - F10 Agent 角色与人格（persona 角色/指令/MBTI/头像，扩展 `registry.Entry.persona`）
  - F11 Agent 计算机 / Computer Use（mock 适配器 `TODO(real)`）
  - F12 Agent 间协作与共享空间（增强 F3 Threads，`origin` 015 已加列）
  - F13 目标与主动调度（复用 hub tasks + `schedules` 表，mock 调度器 `TODO(real)`）
  - F14 技能与知识库（`kind=skill` 版本/共享 + `knowledge` 表，mock RAG `TODO(real)`）
  - F15 建议与富结果（带证据卡片）
  - F16 多用户/团队与云协作（标注为 agenthub 服务端能力，客户端仅消费）
- [x] `requirements.md` §1.1：区分「现有 / 上一轮已落地 / 本轮新增」端点，本轮新增 `/api/computers*`、`/api/schedules*`
- [x] `requirements.md` §4.1：新增 `/api/computers*`、`/api/schedules*` 端点（全部 `tasks:*`/`resources:*` 权限，落 `/api` 前缀）
- [x] `requirements.md` §4.2：新增机器码 `computer_not_found`/`computer_disabled`/`schedule_not_found`/`schedule_invalid`/`knowledge_unavailable`/`skill_distill_disabled`
- [x] `requirements.md` §4.3：修正迁移口径——`013–015` 已存在；本轮新增 `017_computers.sql` / `018_schedules.sql` / `019_knowledge.sql`（编号接 agenthub 已达的 `016_wechat_login.sql` 之后）
- [x] `requirements.md` §5：新增计算机会话/调度/知识库/技能蒸馏的异常与降级行
- [x] `requirements.md` §6：验收标准新增 11–16 条（F10–F16 可测项）
- [x] `README.md`：在 Features 后新增 `## Feature Comparison`（英文对照表，含 10 维度 × 7 列）
- [x] `README_cn.md`：在 功能 后新增 `## 功能对比`（中文对照表，维度对齐英文版）
- [x] agenthub 实现侧（本轮已落地，详见 M11）：`017/018/019` 迁移、`/api/computers*`、`/api/schedules*`、`/api/knowledge` handler、机器码常量、Listen/probes/`store_test.go` want 清单同步

注意：agenthub 迁移当前最大编号为 `016_wechat_login.sql`，故新迁移从 `017` 起（原方案误用 `016`）。

## M11 — F10–F16 实现落地（agenthub 后端 + agentbuddy 前端脚手架）

本轮把 M10 的契约真正落到代码：agenthub 新增数据层/服务层，agentbuddy 新增 API 调用、错误码与 13 语文案、最小可运行 UI。`go test ./internal/...` 通过；`bun run test`（247 用例）全绿；`bun run build` 通过。

### agenthub（服务端契约 + mock 适配器）
- [x] `migrations/017_computers.sql` / `018_schedules.sql` / `019_knowledge.sql`：幂等建表，`IF NOT EXISTS`；编号接 `016` 之后。
- [x] `internal/model/{computers,schedules,knowledge}.go`：GORM 模型。
- [x] `internal/computers` / `internal/schedules` / `internal/knowledge`：领域类型 + `Store` 端口（依赖倒置，镜像 channels 模式）。
- [x] `internal/store/{computers,schedules,knowledge}_store.go`：GORM 双模实现，`NewComputersStore` 等；`store_test.go` 的 `want` 追加 017/018/019。
- [x] `internal/httputil/json.go`：新增 6 个 `Code*`（computer/schedule/knowledge/skill）；`writeDomainErr` 映射状态（404/403/400/503）。
- [x] `internal/handlers/computers.go` / `schedules.go` / `knowledge.go`：mock 适配器（浏览器/Shell/屏幕占位、内存 ticker 调度、确定性 RAG 片段），真实能力标 `TODO(real)`；复用 `resources:*` / `tasks:*` 权限，无新权限码。
- [x] `internal/handlers/handlers.go`：`Deps` 增 `Computers/Schedules/Knowledge`，注册 9 条 `/api` 路由。
- [x] `internal/handlers/listen.go` `Listeners()` + `listen_test.go` `probes`：双向同步 9 个端点（`TestListenersCoverRoutes` 兜底）。
- [x] `cmd/agenthub-server/main.go`：注入三个新 store 到 `Deps`。

### agentbuddy（前端脚手架）
- [x] `web/src/lib/api.js`：新增 `list/create/getComputers`、`list/create/update/deleteSchedules`、`listKnowledge`、`createResource/updateResource`。
- [x] `web/src/lib/errors.js` `CODE_KEYS`：登记 6 新码；`errors-copy.js` 13 语补译。
- [x] `web/src/lib/copy/hub-copy.js`：新增（Computers/Schedules/Persona/Suggestions/Knowledge 文案，13 语）；`use-copy.js` 注册 `hub`；`tests/copy-fallback.spec.js` 加入 `hub` 命名空间（130 用例全绿）。
- [x] 视图：`ComputersView.vue`（三类型 mock）、`SchedulesView.vue`（目标/周期任务 + 新建/启停/删除）、`PersonaEditor.vue`（F10 角色/指令/MBTI/头像，写 `POST/PUT /api/resources` 的 `persona`）；组件 `SuggestionCard.vue`（F15 带证据卡）。
- [x] `router.js`：新增 `/computers` `/schedules` `/persona` 路由；`Sidebar.vue`：新增 Computers / Schedules 导航项。
- [x] `ThreadView.vue`：消息流标记 `agent:` 来源（F12）、侧栏渲染 `SuggestionCard`（F15）。

### 约束核对
- 不新增权限码；新端点全落 `/api` 前缀（桌面环回代理自动覆盖，无需改桌面端）。
- 单色 + 13 语 + RTL + 无障碍：`style.spec.js` 与 `copy-fallback.spec.js` 均通过。
- F16 仅标注为 agenthub 服务端能力（JWT/实例互联），客户端未新增账号/联邦逻辑。
- 深层能力（RAG / 真实调度 / 真实计算机控制）一律 mock + `TODO(real)`，未引入子进程/网络依赖。
