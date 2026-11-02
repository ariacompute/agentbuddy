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

## M12 — 桌面外壳安全收口（代理准入 / CSP / 凭据存储，2026-11）

背景：评估指出环回代理对同用户进程无准入控制（任何本机页面都能驱动用户的 agenthub 会话）、
CSP 与上游安全头被丢弃、会话明文落盘。三条一并收口，均不改变 `/api` / `/a2a` 转发语义。

### 1. 环回代理准入（F18）
- [x] `desktop/src-tauri/Cargo.toml`：新增 `rand = "0.8"`（std 无 CSPRNG，token/nonce 需要不可预测字节）
- [x] `desktop/src-tauri/src/proxy/auth.rs`（新）：`Auth`（32 字节 hex token + 单次 nonce + 60s TTL）、
      常量时间比较、`authorized(headers)`（Cookie 或 `Authorization: Bearer`）、`COOKIE_NAME`/`bootstrap_cookie`
- [x] `desktop/src-tauri/src/proxy/mod.rs`：`SHELL_PREFIX` 旁新增 `BOOTSTRAP_PATH`；`ProxyState.auth: Option<Arc<Auth>>`
      （无窗口的测试路由为 `None`）；`ProxyHandle.bootstrap_url`；`dispatch()` 首部两道闸——外来 `Origin` →
      `403 proxy_origin_refused`，无 token → `401 proxy_unauthorized`，仅 `BOOTSTRAP_PATH` 放行
- [x] `desktop/src-tauri/src/proxy/shell.rs`：`GET /__shell/bootstrap?nonce=` 兑换 `ab_proxy` Cookie 后 `303 → /`；
      非 GET/无效 nonce/无 nonce 分别拒绝；`query_param()` 手写解析（nonce 为 hex，无需百分号解码）
- [x] `desktop/src-tauri/src/lib.rs`：窗口导航改用 `bootstrap_url`（缺失时回退 `url`）
- [x] `desktop/src-tauri/src/proxy/forward.rs`：转发上游前剥掉等于代理 token 的 `Authorization`（token 是代理自己的秘密）
- [x] 单测：无 token 401、Cookie 通过、Bearer 通过、错 token 401、外来 Origin 403、同源 Origin 通过、
      bootstrap 为唯一免 token 入口；`shell.rs` 侧另覆盖 nonce 重放 403、未知 nonce 403、无 nonce 403、关闭准入时 404

### 2. 内容安全策略（F18）
- [x] `desktop/src-tauri/src/proxy/csp.rs`（新）：`new_nonce()`（128 位 hex）、`policy(nonce)`、
      `header(nonce)`；`script-src 'self' 'nonce-…'`，`object-src/base-uri/frame-ancestors 'none'`
- [x] `desktop/src-tauri/src/proxy/static_files.rs`：控制台首页与外壳两页都发 CSP 头；注入的版本戳脚本带 `nonce`；
      缺失的**文件**路径（含 `.`）返回 404 而不是 SPA 回退
- [x] `desktop/src-tauri/assets/shell.html`：三个内联 `<script>` 均声明 `nonce="__CSP_NONCE__"`，渲染时替换
- [x] `web/public/theme-init.js`（新）+ `web/index.html`：首屏主题脚本外置为同步 `<script src>`，页面无内联脚本
- [x] `desktop/src-tauri/src/proxy/forward.rs`：只丢逐跳头，上游 `Content-Security-Policy` / `HSTS` /
      `X-Frame-Options` 原样透传（并修正与之矛盾的旧断言）

### 3. 会话凭据存储（F18）
- [x] `desktop/src-tauri/Cargo.toml`：按平台引入 `keyring`（`windows-native` / `apple-native` /
      `sync-secret-service + crypto-rust`；刻意不用 `linux-native` 的 keyutils——重启即失效）
- [x] `desktop/src-tauri/src/session.rs`（新）：`SessionBackend` trait + `Keyring`（`probe()` 区分"NoEntry=可用"
      与"传输层不可用"）+ `File`（0600 / Windows 靠用户配置目录 ACL）+ `Memory`（单测用）；账号名 `session:<server>`
- [x] `desktop/src-tauri/src/config.rs`：`ConfigStore` 持 `Arc<dyn SessionBackend>`；`new()` 仍为文件后端（测试与回退），
      `keyring_or_file()` 为生产构造器；旧 `session.json` 首次读取时迁入凭据库并删除；`session_backend()` 暴露后端名
- [x] `desktop/src-tauri/src/lib.rs`：生产改用 `ConfigStore::keyring_or_file`
- [x] `desktop/src-tauri/src/proxy/shell.rs`：`/__shell/config` 新增 `sessionBackend`
- [x] 单测：内存后端往返/清空、空 Cookie 删文件且可重复、坏文件读作无会话、明文迁移一次性完成、写入凭据库后删除明文副本

### 4. 校验
- [x] `cargo check --all-targets` 无告警；`cargo test --no-run` 通过
      （本机测试二进制仍因 Tauri 原生依赖入口缺失无法启动，属环境问题）
- [x] `bun run build`（web）+ `bun run test` 全绿；单色守卫不受影响
- 待办：Linux 构建需 `libdbus-1-dev`（Secret Service 后端），已在 README 说明

## M13 — 测试补强与覆盖率（2026-11）

目标：把最后一轮新增的安全路径与交互路径都钉进用例，并把前端分支覆盖率从 87.9% 抬起来。

### 1. 新增用例（web，462 → 515）
- [x] `tests/monitor.spec.js`：`start()` 幂等、`stop()` 后不再调度、在途 poll 落地为 no-op、
      老服务端短载荷（缺 `agents`/`tasks` 键）回落空数组、重复 `_syncSubscriptions` 不叠加流、
      迟到帧对已消失的任务不做复活、`seen` 缺失时重建
- [x] `tests/use-copy.spec.js`：语言块整体缺失、未知命名空间、未知枚举组、无 `window` 时解析初始语言
- [x] `tests/api.spec.js`：未登记错误码回显自身、音频上传被拒（413 映射为 `ApiError`）、
      空 200 读作 `null`、连接器动作省略参数、筛选全空时不拼 query
- [x] `tests/views.spec.js`：
      - SchedulesView 五条「无 code 的失败只回显 message」路径 + 两条「未登记原因」路径
      - SettingsView 语言选择 / 三个开关 / 静默期一并落盘
      - ComputersView 选中的 kind 生效、租约弹窗取消、终止弹窗取消与 `update:modelValue` 关闭
      - PersonaEditor 四个字段（称号 / MBTI / 指令 / 头像）一并提交
      - LoginView 注册全流程、两次密码不一致、注册被拒回显
- [x] `tests/views.spec.js`：`BaseDialog` stub 补 `name`，以便断言以 `update:modelValue` 关闭的路径
- [x] `tests/views.spec.js`（ChannelsView）：SMS 才出现的 destination 字段、取消不发请求、
      以 `update:modelValue` 关闭弹窗
- [x] `tests/components.spec.js`：AgentCard（tagline / health 为对象·字符串·缺失·未知值 / description 与 tag 的有无）、
      ArtifactList（`artifacts: null`、无法解析的 artifact 仍占一行、无 mime 的 bytes 用 octet-stream、
      无名文件用本地化标签）、ConnectorCard（空动作名不发请求、`parked` 文案、health 两种形态、policy 缺省 off）、
      Sidebar（无 displayName 回落邮箱、版本号有/无）、StateDot 未知状态原样打印、PersonaAvatar 纯空白名回 `?`
- [x] `tests/copy-fallback.spec.js`：`withCopy` 合并语义（extra 不能新增语言、不改原表）
- [x] `tests/use-copy-node.spec.js`（新，`@vitest-environment node`）：无 `window` 时模块初始化仍落到 `en`，
      且 `useCopy`/`setLang` 在无 DOM 环境下可用（jsdom 下 `window` 恒存在，这条分支只能在 node 环境真正跑到）

### 2. 顺带修掉的问题
- [x] `src/views/LoginView.vue`：`submit()` 增加 `canSubmit` 守卫。此前注册页两次密码不一致时，
      按钮虽为 disabled，但在输入框内回车仍会提交到服务端（表单 submit 不受按钮 disabled 约束）

### 3. 桌面端用例
- [x] `src/proxy/auth.rs`：token 长度与字符集、过期 nonce（TTL 到期即拒且照样消费）、
      长度不符即拒、非 Bearer 的 `Authorization` 回落 Cookie、空 Bearer、无 `ab_proxy` 的 Cookie、
      Cookie 值内含 `=` 仍原样取出
- [x] `src/proxy/shell.rs`：重发 nonce 使旧 URL 失效、非 GET 不得消耗 nonce（后续仍可兑换）、
      nonce 夹在其它 query 参数中仍能取到

### 4. 结果
- [x] web：语句/行 99.98%、**分支 87.93% → 91.88%**、**函数 92.55% → 97.99%**（515 用例全绿）
  - `src/components` 分支 84.31% → 92.95%；`src/lib/copy` 分支 66.66% → **100%**；
    `src/views` 函数 81.25% → 96.09%
  - 剩余缺口集中在视图模板里的 `|| ''` 兜底与未打开的分支（ComputersView 命令表单、SchedulesView 的
    水位渲染分支等），均已确认是「无数据/无权限」的兜底，不是未测行为
- [x] desktop：`cargo check --all-targets` 与 `cargo test --no-run` 通过；`cargo test --lib` 本机仍因
      `STATUS_ENTRYPOINT_NOT_FOUND`（0xc0000139）无法启动，纯逻辑用例以 CI 为准

## M11 — F10–F16 实现落地（agenthub 后端 + agentbuddy 前端脚手架）

本轮把 M10 的契约真正落到代码：agenthub 新增数据层/服务层，agentbuddy 新增 API 调用、错误码与 13 语文案、最小可运行 UI。`go test ./internal/...` 通过；`bun run test`（247 用例）全绿；`bun run build` 通过。

### agenthub（服务端契约 + mock 适配器）
- [x] `migrations/017_computers.sql` / `018_schedules.sql` / `019_knowledge.sql`：幂等建表，`IF NOT EXISTS`；编号接 `016` 之后。

## M12 — 测试覆盖提升（组件 / 视图层，2026-11）

背景：原 `web/tests/` 仅覆盖 `src/lib/*` 纯函数层（257 用例），21 个 `.vue` 组件与 13 个 `.vue`
视图零覆盖。本轮补齐组件 / 视图的渲染与交互测试，总用例 **257 → 318** 全绿，
`bun run build` 通过。

### 1. 测试基建
- [x] `web/package.json`：新增 devDeps `@vue/test-utils`、`jsdom`（组件 / 视图挂载需要）。
- [x] `web/vite.config.js`：`test.setupFiles = ['tests/setup.js']`（node 环境 lib 测试无感；jsdom 组件测试用文件头 `// @vitest-environment jsdom` 单开）。
- [x] `web/tests/setup.js`：jsdom 下补足可用的 `window.localStorage`（i18n 引导 `use-copy.js` 在导入时读 `agentbuddy.lang`），对 node 环境以 `typeof window` 守卫为空操作。
- [x] `web/tests/helpers/vue-utils.js`：`mountWith()` 统一装配 Pinia + memory router + `attachTo: body`，组件 / 视图测试共享。
- [x] 组件 / 视图 spec 以 `vi.mock('../src/lib/api.js')` 自动 mock，断网且确定性；`beforeEach` 给列表 / 读取类 API 预置空响应，避免 onMounted 刷新抛 `data.x`。

### 2. 新增用例
- [x] `web/tests/components.spec.js`：21 个组件全覆盖（BrandMark / PersonaAvatar / SuggestionCard /
  StateDot / AudioPlayer / ArtifactList / DeliveryList / AgentCard / TaskCard / ThemeToggle /
  LanguageSwitcher / PolicySelect / VoiceRecorder / ConnectionBanner / NotificationCenter /
  ApprovalCard / ChannelCard / ConnectorCard / Sidebar / Topbar）。含正常 + 异常路径：
  主题切换写 `document.documentElement.dataset.theme` 与 `localStorage`；语言切换触发
  `setLang`；策略确认拒绝不发射 change；离线下线横幅与重登录；通知中心清空 / 深链跳转；
  ApprovalCard 审批 / 驳回；ChannelCard 开关（API）、ConnectorCard 执行动作（API）等。
- [x] `web/tests/views.spec.js`：13 个视图全覆盖（Workspace / TaskList / TaskTrace / ThreadList /
  Thread / Channels / Connectors / Org / Computers / Schedules / Settings / PersonaEditor /
  Login）。含挂载渲染 + 关键交互：Workspace 审批卡随 `tasks` 派生；TaskTrace 取消经 API；
  ThreadList 新建线程（Teleport 对话框）；Settings 主题经 `/__shell/config` POST；
  PersonaEditor / Schedules 保存 / 列表经 API 等。

### 3. 测试过程中发现并修复的缺陷
- [x] `web/src/components/ApprovalCard.vue`：`approve()` / `reject()` 在 `<script setup>` 内引用裸
  属性 `task`（`ReferenceError`）；改为 `props.task.id`（真实浏览器中点击审批同样崩溃）。
- [x] `web/src/components/AgentCard.vue`：用 `useCopy('enums').t('health')` 取枚举标签，但
  `enumsCopy` 为二级结构（`{group:{en:{...}}}`），`COPIES` 未注册 `enums`，导致 `t('health')`
  为 `undefined` 并在渲染时崩溃；改为 `enumLabel('health', value)`。
- [x] `web/src/views/PersonaEditor.vue`：`load()` 把整个 `{resources:[...]}` 响应赋给
  `agents.value` 而未取 `.resources`，列表永远为空、表单 / 保存永不渲染；改为
  `(await listResources('agent')).resources || []`。
- [x] `web/src/views/SchedulesView.vue`：`load()` 同样未从 `{schedules:[...]}` 中取
  `.schedules`，调度列表渲染出空行；改为 `(await listSchedules()).schedules || []`。

## M13 — 桌面端 Rust 测试覆盖补齐（2026-11）

背景：`desktop/src-tauri/src` 已有 `i18n` / `config` / `proxy/{mod,forward,static_files}` 的
inline 测试，但 `notify.rs`、`proxy/shell.rs`、`proxy/static_files.rs` 的若干分支与
`render_shell_page` 无覆盖。本机测试二进制因 Tauri 原生依赖 DLL 入口缺失
（`STATUS_ENTRYPOINT_NOT_FOUND`，见 M7 注）无法启动，**新增用例仅编译校验、CI 中运行**。

### 1. 新增用例（全部 `app: None` headless 形态，不依赖 Tauri 运行时）
- [x] `desktop/src-tauri/src/notify.rs`：`handle()` 四分支全测 —— 非法 JSON（`invalid_json` /
  400）、缺 title/body 或空白（`missing_fields`）、`notify_enabled=false`（`disabled`）、
  无 `app` 句柄（`no_app`）。（`show()` 成功分支需真实 `AppHandle`，headless 不可测，已在
  注释中说明。）
- [x] `desktop/src-tauri/src/proxy/shell.rs`：`handle()` 路由 —— 未知 shell 路由返回 404 /
  `not_found`；`/__shell/hide` 在 `app: None` 下不崩溃、返回 `ok:true`；`GET /__shell/config`
  回显默认 `background` / `notifyEnabled` / `notifyQuietMinutes` / `insecure`。
- [x] `desktop/src-tauri/src/proxy/static_files.rs`：抽出 `render_shell_page()`（与既有
  `render_console_index()` 同构，便于脱离 `axum::body::Body` 单测），新增用例断言注入的
  `window.__SHELL__` 启动对象含 `version` / `languages` / `dirs` / `page`。

### 2. 覆盖增量
- 桌面端 Rust 单测约 **41 → 49**（新增 8 例，含正常 + 异常路径）。
- `cargo test --no-run` 通过（编译校验）；运行须在 CI（本机 Tauri 二进制无法启动）。
- 未覆盖：`tray.rs`（需 `tauri::test` 集成套件且依赖原生窗口）、`lib.rs` / `main.rs`
  （Tauri 生命周期），属环境限制，非遗漏。

注：其余组件 / 视图交互（如 ConnectorsView 审批区、OrgView 图表）仅消费 `workbench`/`listResources`
的 `.resources`，未踩中同类响应解包缺陷。
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

## M12 — 会话跨重启持久化（bug fix，2026-10）

背景：登录后完全退出应用再启动仍进入登录页、需重新登录。根因：环回代理把会话保存在自身内存的
`reqwest::Jar`（forward.rs 在转发前丢弃 WebView 的 `cookie` 头，因 WebView 源是随机 `127.0.0.1` 端口，
而 cookie 属于服务端域名），`Jar` 随进程退出销毁；下次启动 `Jar` 为空 → 上游 401 → 前端 `whoami` 失败 →
登录页。随机端口与 WebView cookie 持久化并非关键（真正携带会话的是代理的 `Jar`）。

- [x] `desktop/src-tauri/src/config.rs`：`ConfigStore` 新增 `save_session` / `load_session_cookie`，落 `session.json`（与 `config.json` 同目录，`restrict_to_owner` 限权，按 `server` 归属，防跨服务端重放）
- [x] `desktop/src-tauri/src/proxy/mod.rs`：`ProxyState` 增加 `jar` 字段；新增 `seed_jar_from_store`；`start_inner` 启动时为已配置服务端还原落盘会话
- [x] `desktop/src-tauri/src/proxy/forward.rs`：`build_response` 检测到上游 `Set-Cookie` 时调用 `persist_session`——把 `Jar` 当前会话异步写盘；登出/过期（`Jar` 中无 cookie）时清跌落盘副本
- [x] `desktop/src-tauri/src/proxy/shell.rs`：`save_config` 切换 `server_url` 时清掉旧服务端会话，并还原新服务端已存会话
- [x] `desktop/src-tauri/src/proxy/mod.rs`：新增集成测试 `resumes_the_session_after_a_restart`（两个共享同一 store 的代理实例验证会话跨「重启」存活）
- [x] `cargo check --all-targets` 通过（无 warning/error）

## M14 — 调度器落地（F13 由 mock 转为真实，2026-11）

背景：F13 此前是 `mock 调度器 TODO(real)`。本轮 agenthub 新建 `internal/router`（Router 层判定 +
Worker 层执行，双层调度），agentbuddy 把 `/schedules` 从「列表 + 启停」扩展成可观测的调度台。
详见 agenthub `task.md` 的 M6。

### 1. 接口与错误码
- [x] `web/src/lib/api.js`：新增 `runSchedule`、`routerStats`、`listRouterTriggers`、`getRouterTrigger`、`listRouterTickets`、`getRouterTicket`、`cancelRouterTicket`、`handbackRouterTrigger`、`dropRouterSubscription`、`listRouterPolicies`、`saveRouterPolicy`、`kickRouterPass` + `subscribeRouterEvents`（SSE，`?since=` 回放）。
- [x] `web/src/lib/errors.js` `CODE_KEYS` + `copy/scheduler-copy.js`：登记 7 个调度器码（ticket/trigger/thread 未找到、工单已结束、交回耗尽、规则非法、未配置执行者），13 语齐备。

### 2. 视图（`SchedulesView.vue`）
- [x] 「调度水位条」：待判定 / 运行中 / 待人工 / 本批数量 + 上次节拍时间，等宽数字、细分隔线，无彩色进度条。
- [x] 「运行历史」时间线：时间、判定结果徽标、派发任务链接（`/tasks/:id`）、取消 / 交回操作。
- [x] 「最近触发流」列表：时间、来源、摘要截断、判定徽标、工单状态。
- [x] 「立即运行」（`202 Trigger`）与「推进一拍」（`202 kicked`）为主/次按钮对，44px 触控目标。
- [x] 空态一行灰字 + 虚线框；加载骨架行；错误只显示本地化文案；调度器关闭时显示「调度器已关闭」灰字而非 503 报错。
- [x] 单色守卫：六种判定徽标（accept / attach / ignored / filtered / unavailable / routed）全用边框 + 灰度填充 + 文字标签；`style.spec.js` 通过。

### 3. 验证
- [x] `web/tests/api.spec.js`：14 条 router 端点路径与错误映射（正常 + 异常）。
- [x] `web/tests/views.spec.js`：SchedulesView 三区块挂载、空态、调度器关闭态。
- [x] `bun run test`（325 用例）与 `bun run build` 全绿。

注：本机测试二进制仍因 Tauri 原生依赖 DLL 入口缺失（`STATUS_ENTRYPOINT_NOT_FOUND`）无法启动（与 M7 同款
环境问题，与本次测试代码无关），故测试仅编译验证通过、逻辑对齐既有会话测试。

## M15 — 测试覆盖率补齐（web + desktop，2026-11）

背景：上一轮 M14 之后前端 95.5% 语句覆盖但分支只有 77%、函数 75%，`App.vue`/`router.js` 完全没跑，
`BaseDialog`、`ChannelsView`、`ComputersView`、`VoiceRecorder` 的交互路径全靠人工验证；桌面壳的
`tray.rs` 与 `i18n/copy.rs` 零用例。本轮把「没测到的行为」补齐，不追求数字，只补用户能看到的分支。

### 1. 度量前置
- [x] `vite.config.js`：`test.coverage`（v8，`text-summary` + `text`），`package.json` 增 `test:coverage`，
  `Makefile` 增 `web-coverage`。

### 2. 新增 web 用例
- [x] `tests/app.spec.js`（5）：未登录渲染裸路由且不启轮询；登录后挂载外壳并启动 `ActivityMonitor`（含
  `visible()` 探针）；轮询报会话过期时重查身份——会话仍在则只清标记，真过期则登出并退回登录页，
  从未登录时视为空操作。
- [x] `tests/router.spec.js`（6）：匿名访问带 `?next=` 跳登录、登录后可进屏、已登录访问 `/login` 回工作台、
  未知路径归位 `/`、登出后不再重查会话、内存中已有身份时跳过 `whoami`。
- [x] `tests/base-dialog.spec.js`（7）：打开/关闭渲染、`role`/`aria-modal`/`aria-label`、无 footer 插槽时不渲染页脚、
  关闭按钮与遮罩（`.self`）与 Escape 三条关闭路径、Tab 首尾环绕与中途放行（stub `offsetParent`）、
  打开时聚焦首个控件并在关闭后归还焦点、卸载后不再响应 Escape。
- [x] `tests/voice-recorder.spec.js`（5）：点一次开始、再点停止、上传走组件收到的 `threadId`、
  麦克风错误显示本地化拒绝文案并随状态恢复清除、不支持时不出按钮只出说明、卸载时 `reset()`。
- [x] `views.spec.js` 扩充（+25）：TaskListView 四档筛选与空态；OrgView 预算汇总与加载失败仍保住页面框架；
  PersonaEditor 切换智能体重载表单、保存被拒/加载失败/无智能体三态；SchedulesView 目标新建、启停、删除、
  取消被拒、工单状态与不可读时间的占位、倒计时每秒跳动且卸载后不再计时；ChannelsView 新建（含表单到
  请求体的映射）、删除、投递重试、已送达不给重试、被拒时展示本地化原因；ComputersView 列表解包、
  新建会话、失败提示与按钮恢复可用、空态；LoginView 半填禁用、成功跳转、被拒留在原页、版本号页脚。
- [x] `format.spec.js` / `languages.spec.js` / `api.spec.js` / `monitor.spec.js` 补边界：不可用 locale 的
  dash 回退、TB 级字节封顶、hreflang/OG 映射与未映射透传、`subscribeRouterEvents` 的 `since` 与错误回调、
  线程流失效、任务离开执行态后关闭订阅、每小时清理过期簿记。

### 3. 写用例时发现并修掉的问题
- [x] `ComputersView.vue`：`computers.value = await listComputers()` 把信封当成数组，页面永远渲染不出卡片
  （M12 修过同类问题），改为解包 `data.computers`。
- [x] `ChannelsView.vue`：错误横幅直接渲染机器码（违反「只存 code、文案走 errors.js」），改走 `errorMessage()`；
  删除与重试没有 `try/catch`，失败即未处理拒绝，现各自回写内联错误。
- [x] `DeliveryList.vue` / `ChannelCard.vue` / `ChannelsView.vue`：`deliveryRetry` 文案与重试接口早已存在，
  但按钮从未接线（`retry()` 是死代码），补上 `retry` 事件链，已送达的回执不显示按钮。

### 4. desktop 用例
- [x] `src/tray.rs`：把菜单项到路径的映射抽成纯函数 `path_for()`，新增 3 条用例（各菜单项各就各位、
  退出与未知 id 不导航、托盘 id 稳定）。
- [x] `src/i18n/copy.rs`：新增 5 条用例——13 语与 EN 键集/顺序完全一致且无空值（避免 en 兜底掩盖漏译）、
  未知语言回落 EN、各语言块互不共享（防止 match 分支被合并）、键唯一且无空白、
  语言代码与 `web/src/lib/languages.js` 逐条对齐（`include_str!` 编译期钉住）。
- [x] `src/i18n/mod.rs`：大小写/下划线 locale 归一化（`ZH-TW`/`zh_CN`/`zh_HK`/`PT-BR`）、
  `block_for()` 覆盖全部键且非空。
- [x] `src/config.rs`：语言回落与区域匹配、`UrlError` 文案、会话按服务器隔离（跨服务器不串号、
  二次登录覆盖而非追加）、登出删文件且可重复调用、损坏的会话文件读作未登录。
- [x] `cargo test --no-run` 编译通过（本机无法运行，见下注）。

### 5. 结果
- [x] web：`bun run test` 393 用例（原 327）全绿；`bun run test:coverage` 语句/行 98.99%、分支 84.11%、函数 85.47%
  （原 95.54% / 77.08% / 74.91%）。
- [x] `bun run build` 通过（401.20 kB）。
- [x] 文档：README/README_cn 测试命令补 `test:coverage`；AGENTS 记录覆盖率基线与桌面测试的环境限制；
  requirements 补 F6.2 的回执重试与错误展示。

注：desktop 测试在本机仍无法执行（`STATUS_ENTRYPOINT_NOT_FOUND`，与 M7/M14 同款环境问题），
本轮只做编译校验；新增用例全部是纯逻辑（不含 `AppHandle`），CI 上可直接运行。
`i18n` 键集一致性另用一次性脚本按同一断言离线复算过（13 块 × 30 键、13 语代码全部命中）。

## M16 — 执行环境沙盒落地（F17，2026-11）

背景：agenthub 新建 `internal/sandbox`（执行控制面，大脑与双手解耦），并交付 `/api/sandboxes*`。
agentbuddy 把「计算机」屏从三张空卡片升级为**执行环境控制台**，并可选地把自己变成一台**执行节点**。
范式沿用 M14 的调度器控制台：五指标水位条、状态胶囊、灰度徽标、hairline 分隔线。

### 1. 接口与错误码
- [x] `web/src/lib/api.js`：`listSandboxes`、`getSandbox`、`sandboxStats`、`execSandbox`、`renewSandbox`、
  `terminateSandbox`、`listSandboxProviders`、`refreshSandboxProviders`、`listSandboxNodes`、
  `deleteComputer` + `subscribeSandboxEvents`（SSE，`?since=` 回放）。
- [x] `web/src/lib/copy/sandbox-copy.js`：独立表，`sandboxCopy` 并入 `hub`、`sandboxErrorCopy` 并入
  `errors`；`withCopy` 折叠，13 语一次写齐。
- [x] `errors.js` `CODE_KEYS`：8 个码（`sandbox_disabled/unsupported/unknown_provider/policy_denied/
  timeout/node_offline/lease_lost/limit_reached`）。

### 2. 执行环境控制台（`ComputersView.vue` 重写）
- [x] 页头：标题 + 节点胶囊（实心=在线/空心=离线）+ 刷新；未接线时胶囊显示「沙盒已关闭」。
- [x] 节点状态条：在线/离线/未启用、最后心跳相对时间、节点 id，右侧「前往设置」链接。
- [x] 五指标水位条：活跃租约 / 待执行 / 在线节点 / 最近执行 / 上次清扫，等宽数字。
- [x] 类型目录：按隔离层横向可滚动分组，每项显示名称、隔离强度、可用性徽标；不可用项写出原因（虚线框，保持可读）。
- [x] 租约卡片：类型 + 状态胶囊 + 租约 id + 归属/作用域/后端/倒计时/执行次数；44px 三操作（试跑/续租/终止）。
- [x] 审计抽屉：侧滑、租约 id、表格（命令/退出码/耗时/时间/`dry_run`）、失败行左缘 2px 实心竖条；
  抽屉内可试跑并就地显示回执（`stdout || stderr || 无输出`）。
- [x] 状态块：加载行、空态说明 + 申请入口、错误本地化文案 + 重试；`feature_unavailable` 整屏「沙盒已关闭」。
- [x] 键盘/无障碍：卡片 `role=button` + Enter/Space 打开抽屉、Esc 关闭（`BaseDialog`）、44px 触控目标。

### 3. 设置页执行节点区块（`SettingsView.vue`）
- [x] 开关默认关；开启前 `window.confirm` 展示风险说明，拒绝则把勾选回滚（Vue 不会重渲染未变化的绑定值）。
- [x] 工作根目录、命令白名单（逐行）、并发上限、节点 id（只读）、可选 API key（不回显，输入即覆盖）。
- [x] 保存走 `/__shell/executor`，失败按 `code` 映射 13 语原因（`root_unusable` / `command_not_allowed` /
  `server_not_configured` / …），未知码原样显示而不是吞掉。

### 4. 桌面端执行节点（Rust）
- [x] `executor/mod.rs`：状态机 enroll → poll → execute → report；启停、并发上限、退出钩子。
- [x] `executor/policy.rs`：精确命令白名单（禁 shell）、根目录约束、环境变量白名单、超时、输出上限。
- [x] `executor/spawn.rs`：直接 exec（不经 shell）、超时杀进程组、截断、退出码与耗时。
- [x] `executor/jobs.rs`：长轮询领取、结果回传、失败退避与背压。
- [x] `config.rs` / `lib.rs`：`executor_enabled`（默认 false）/ root / allowlist / max_concurrency / node_id / api_key。
- [x] `proxy/shell.rs`：`GET|POST /__shell/executor`（状态、开关、根目录、白名单、节点 id、最近心跳）；
  失败响应同时带 `code` 与 `reason`，让工作台的 `ApiError` 拿到机器码。

### 5. 测试
- [x] `web/tests/views.spec.js`：ComputersView 22 条（水位/目录/空态/未接线/终止确认/试跑与拒绝/申请与拒绝、
  续租成功与失败、刷新成功与失败、键盘开合抽屉、倒计时与临期加粗、过期读作已过期、节点三种状态与心跳
  相对时间、回执截断与空输出、审计表格与失败行、终止当前租约关闭抽屉、读取失败横幅重试、未知隔离层与
  状态原样回退、事件burst 合并为一次刷新并在卸载时关闭流）、设置页执行节点 7 条（确认、拒绝回滚、拒绝
  原因、在线状态、关闭不确认、四字段保存与 key 不回显、最近拒绝原因本地化）。
- [x] `web/tests/api.spec.js`：sandbox 十个端点的路径/方法/请求体，以及 `subscribeSandboxEvents` 的
  `?since=` 回放、事件名、错误回调与 `close()`；另有首次连接不带 query 的用例。
- [x] 覆盖率补测（M16 收尾，本轮新增 42 条）：空白载荷与「无 code 失败」两条路径覆盖四视图的 `?.`/`||`
  回退；`ComputersView` 审计读取失败与终止被拒；`SchedulesView` 撤销交回/推进节拍被拒、天数倒计时、
  未知工单状态原样回退、目标列表读取失败；`TaskTraceView` 读取失败、实时 status/artifact 帧、resume 续接；
  `ThreadView` 提及按钮与去重后的流帧；`ThreadListView` 创建后跳转；`TaskTraceView`/`ThreadView` 的 SSE
  错误与处理器缺省；`ChannelsView` 重试被拒；`components.spec.js` 审批拒绝、连接器策略保存与非法 JSON、
  工件 bytes/无 uri 与「都缺」、音频缺载荷、通知空态、录音组件取麦；`voice.spec.js` 不支持/被拒/空 chunk
  与 reset；`monitor.spec.js` 缺省可见性探针与三个流处理器；`workbench-store.spec.js` 三类刷新失败与单条
  投递读取失败；`use-copy.spec.js` 无 navigator 回落。
- [x] `bun run test` 462 用例（原 420）全绿；`bun run test:coverage` 语句/行 99.98%、分支 87.93%、
  函数 92.55%（补测前 99.06% / 84.69% / 85.95%）；唯一未覆盖语句是 `notifications.js:57` 的
  不可达分支（静默窗口 30s < 幂等窗口 1h，前置判断已先返回）；`bun run build` 通过。
- [x] `executor/tests.rs` 新增 2 条（`unix_seconds` 为墙钟秒、停机可中断长等待），Rust 侧共 120 条。
- [x] `cargo check --all-targets` + `cargo test --no-run` 通过（本机仍无法运行测试二进制：0xc0000139
  `STATUS_ENTRYPOINT_NOT_FOUND`，补齐 x64 `WebView2Loader.dll` 后仍复现，属宿主限制，同 M7/M14/M15）。
