# task.md — agentbuddy 实施记录

> 每完成一项打 `[x]` 并记录落点文件。与 `requirements.md`（契约）、`README.md`（手册）同步维护。

## M0 — 仓库骨架与工程规范

1. [x] `.gitignore`：node_modules / web/dist / src-tauri/target / .env
2. [x] `Makefile`：web-install/dev/build/test、desktop-install/dev/build/test/check、icons、stamp
3. [x] `AGENTS.md`：工程上下文入口（架构、目录、硬性约定、常用命令、开发流程）
4. [x] `requirements.md`：功能边界（F1–F9）、非功能（N1–N7）、服务端契约、机器码、验收标准
5. [x] `README.md` / `README_cn.md`
6. [x] `.github/workflows/release.yml`：三平台矩阵 deb / dmg+app / msi + 便携包 + SHA256SUMS

## M1 — web 基座（单色 + 13 语 + api）

10. [x] `web/package.json`：vue/vue-router/pinia/lucide-vue-next + vite/vitest/@vitejs/plugin-vue（版本对齐 agenthub）
11. [x] `web/vite.config.js`：proxy `/api` `/a2a` `/healthz` `/.well-known`；`test.environment='node'`
12. [x] `web/index.html`：pre-paint 主题脚本（键名 `agentbuddy.theme`）
13. [x] `web/src/style.css`：`:root` 暗色令牌 + `[data-theme='light']` 翻转 + 组件类 + reduced-motion
14. [x] `web/src/lib/languages.js`：13 语目录 + matchLang/isRTL/hreflangFor/ogLocaleFor
15. [x] `web/src/lib/use-copy.js`：STORAGE_KEY='agentbuddy.lang'；resolve/detectLang/setLang/useCopy/enumLabel
16. [x] `web/src/lib/copy/*-copy.js`：shell/workspace/thread/task/org/channel/connector/settings/errors/enums（10 × 13 语）
17. [x] `web/src/lib/errors.js` + `copy/errors-copy.js`：CODE_KEYS（含本轮新增 14 个机器码）+ 13 语
18. [x] `web/src/lib/api.js`：auth/workspace/threads/tasks/resources/channels/connectors/audio + SSE + multipart
19. [x] `web/src/lib/auth-store.js`：PERMISSIONS 词表 + signedIn/isOwner/can
20. [x] `web/src/lib/workbench-store.js`：agents/threads/tasks/approvals/channels/connectors/notifications
21. [x] `web/src/lib/monitor.js`：ActivityMonitor（轮询 + 按需 SSE，上限 6 + 退避）
22. [x] `web/src/lib/notifications.js`：decide() 纯函数（幂等/静默/合并/深链）
23. [x] `web/src/lib/voice.js`：录音状态机纯逻辑（降级）
24. [x] `web/src/lib/connector-policy.js`：策略判定纯函数
25. [x] `web/src/lib/format.js`、`use-dismiss.js`

## M2 — agenthub 增补：persona + channels

30. [x] `migrations/013_persona.sql`：`ALTER TABLE resources ADD COLUMN IF NOT EXISTS persona JSONB;`
31. [x] `migrations/014_channels.sql`：`channels` + `channel_messages`（external_ref 唯一键）
32. [x] `internal/registry/registry.go`：`Entry.Persona` + `normalizePersona`
33. [x] `internal/model/model.go`：`Resource.Persona` + `Channel` / `ChannelMessage` 模型
34. [x] `internal/store/resource_store.go`：3 处（updateColumns / fromEntry / entryFrom）
35. [x] `internal/channels/`：类型、签名校验（Slack/Teams/Telegram）、投递、Store 端口
36. [x] `internal/store/channels_store.go`：GORM 实现
37. [x] `internal/handlers/channels.go`：`/api/channels*` + public webhook
38. [x] `internal/handlers/handlers.go`：`Deps` 增 Channels；注册路由
39. [x] `internal/handlers/listen.go` + `listen_test.go`：Listeners 与 probes 同步
40. [x] `internal/store/store_test.go`：迁移清单 `want` 追加 013/014
41. [x] `internal/config/config.go`：`AGENTHUB_CHANNELS_ENABLED`
42. [x] `internal/httputil/json.go`：通道相关机器码常量
43. [x] `cmd/agenthub-server/main.go`：注入 channels 服务
44. [x] 单测：签名校验、幂等、路由覆盖、迁移顺序

## M3 — agenthub 增补：connectors + speech

50. [x] `migrations/015_thread_origin.sql`：`thread_messages.origin`
51. [x] 连接器策略持久化（MCPConfig / Metadata，jsonb 无迁移）
52. [x] `internal/adapter/speech.go`：确定性 mock STT/TTS（`TODO(real)`）
53. [x] `internal/handlers/connectors.go`：`/api/connectors*` + 动作审批网关
54. [x] 二次 park 防护：`Hub.Resume` 注入 approved 标记 → `InvokeRequest.Metadata`
55. [x] `internal/handlers/speech.go`：`POST /api/threads/{id}/audio`（multipart 16 MiB）
56. [x] `internal/store/threads_store.go`：`origin` 读写
57. [x] `internal/config/config.go`：`AGENTHUB_SPEECH_MODE` / `AGENTHUB_AUDIO_MAX_BYTES`
58. [x] Listen/probes/迁移清单同步；单测

## M4 — web 核心六屏

60. [x] `App.vue` / `router.js` / `main.js`
61. [x] 组件：Sidebar / Topbar / LanguageSwitcher / ThemeToggle / StateDot / PersonaAvatar
62. [x] `LoginView.vue`
63. [x] `WorkspaceView.vue`
64. [x] `ThreadView.vue`
65. [x] `TaskTraceView.vue`
66. [x] `OrgView.vue`
67. [x] `SettingsView.vue`

## M5 — web 通道 / 连接器 / 语音

70. [x] `ChannelsView.vue` + ChannelCard / DeliveryList
71. [x] `ConnectorsView.vue` + ConnectorCard / PolicySelect / ApprovalCard
72. [x] `VoiceRecorder.vue` / `AudioPlayer.vue`
73. [x] `ArtifactList.vue`（含音频内联播放）
74. [x] `NotificationCenter.vue` / `ConnectionBanner.vue`

## M6 — Rust 桌面外壳

80. [x] `Cargo.toml` / `build.rs` / `tauri.conf.json` / `capabilities/default.json`
81. [x] `src/lib.rs`：配置 → 托盘 → CloseRequested 隐藏 → 启动代理 → 导航
82. [x] `src/config.rs`：AppConfig（含后台运行、通知、静默期）
83. [x] `src/proxy/{mod,forward,shell,static_files}.rs`：真流式 + cookie 重写 + `/__shell/*`
84. [x] `src/tray.rs`：显示/隐藏/设置/关于/退出，13 语
85. [x] `src/notify.rs`：`tauri-plugin-notification` → `/__shell/notify`
86. [x] `src/i18n/{mod,copy}.rs`：13 语外壳文案
87. [x] `assets/shell.html`：连接页 + 关于页
88. [x] `frontend-stub/index.html`：灰阶启动占位页
89. [x] `Info.plist`：`NSMicrophoneUsageDescription`
90. [x] `assets/app-icon.png`（单色）+ `scripts/make-icon.mjs`（降级生成器）
91. [x] `scripts/stamp.mjs`

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
102. [x] agenthub `go build` + `go vet` + `go test -race ./...`（后续里程碑各自复验，见 M11/M14/M16）
103. [x] `.github/workflows/release.yml`：三平台矩阵
104. [x] `README.md` / `README_cn.md` 收尾
105. [x] `requirements.md` / `AGENTS.md` 与实现对齐复核

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
  - F11 Agent 计算机 / Computer Use（computers 已接真实执行环境租约；浏览器自动化由服务端提供方承担）
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
- [x] **WSL2（Linux）实机跑通**：`cargo test` 153 passed / 0 failed，`cargo check --all-targets` 通过。
      `keyring` 以 `sync-secret-service + crypto-rust` 在 Linux 完成链接；该机无 D-Bus 会话与
      keyring 守护进程，`Keyring::probe` 返回不可用，实际走的是「属主可读文件」回退路径
      （真钥匙串路径无自动化用例，见下）
- 待办：Linux 构建需 `libdbus-1-dev`（Secret Service 后端），已在 README 说明

### 5. 实机验证发现并修掉的问题（nonce 一次性语义）
- [x] `proxy/auth.rs` 的 `take_nonce` 原先「无论是否匹配都清空」，注释理由是「一次猜错就结束」。
      但 nonce 是 256 位、猜测毫无意义，而清空带来一个真问题：本机任何进程只要对
      `/__shell/bootstrap?nonce=x` 发一次错误请求，就能**把窗口唯一的那次引导永久作废**——
      引导 URL 只在启动时用一次，于是控制台再也拿不到 Cookie。改为「命中才消费，未命中保持原值；
      过期的照样丢弃」，并补 `a_wrong_guess_does_not_burn_the_real_nonce` 用例
- [x] 该缺陷由 `reissuing_a_nonce_retires_the_earlier_url` 在 WSL2 上暴露（Windows 上此前无法运行
      测试二进制，因此一直是「编译通过」而非「行为正确」）

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

## M17 — 特性评估第 6 节缺口补齐（2026-11-02）

背景：《agenthub + agentbuddy 特性完整度评估》点名若干「已写进规格但没做到」的地方。本轮只补这些缺口，
不新增路由、权限码或依赖。

### 1. 登录与人格（F1.3 / F10.2）
- [x] `web/src/views/LoginView.vue`：OAuth 提供方按钮的 `window.open` 移进 `<script setup>` 的
  `openProvider(url)`。模板内联调用在编译后拿不到作用域，点击即抛异常；现改为一次函数调用。
- [x] `web/src/views/PersonaEditor.vue`：补「角色（role）」输入框并纳入保存载荷，修正 `title` 字段标签，
  保存仍整体走 `PUT /api/resources/{id}`。
- [x] `web/src/lib/copy/hub-copy.js`：新增 `personaRole`、`personaTitleLabel`（13 语）。
- [x] 服务端 `registry.Persona` 扩展 `role/instruction/mbti/avatar_ref` 并加 `normalizePersona`
  （trim、长度截断、MBTI 仅 16 型），因此界面上的 `role` 真正落库而不再被覆盖为空。

### 2. 系统通知投递（F5.4）
- [x] `web/src/lib/shell-settings.js`（新）：读 `/__shell/config` 的 `notifyEnabled` /
  `notifyQuietMinutes`，换算成 `decide()` 需要的 `{enabled, quietUntil, quietMinutes, inShell}`；
  带 TTL、`force`、`apply`、`reset`；非外壳环境返回宽容默认值。
- [x] `web/src/lib/api.js`：新增 `notifyShell({title, body, link})` → `POST /__shell/notify`；
  `request()` 读 `globalThis.__AGENTBUDDY_BASE__`（默认为空，保持相对 URL 语义），供冒烟用例打到真桩。
- [x] `web/src/lib/workbench-store.js`：`ingestTask` 把外壳通知设置喂给 `decide()`；命中时
  `announce()` 在发送瞬间用当前语言解析标题（不是 copy key），并以
  `Promise.resolve(...).catch()` + `try/catch` 包裹 fire-and-forget 调用，外壳同步抛错也不会击穿轮询。
- [x] `web/src/App.vue`：登录后加载一次外壳通知设置并在设置变更时 `apply`。
- [x] 用例：`workbench-store.spec.js` 三路径（发系统通知 / 静默期不发 / 被拒也不抛错）、
  `shell-settings.spec.js`（有/无 `/__shell`、TTL、静默期锚点）、`views.spec.js`（OAuth 点击、role 往返）。

### 3. 桌面密钥与文件权限（F18）
- [x] `desktop/src-tauri/src/session.rs`：`write_private_file()` 用
  `OpenOptionsExt::mode(0o600)` **创建即私有**（不再「先写后改权限」），写后仍 `restrict_to_owner`
  以收紧旧版本留下的宽权限文件；Windows 走 `icacls <path> /inheritance:r /grant:r <user>:F`
  （argv 直调，失败只 `eprintln` 一次）。
- [x] `SessionBackend` 增加 `stores_secrets()` / `load_secret()` / `save_secret()`：`Keyring` 用
  `secret:<name>` 账户，`Memory` 供测试，`File` 明确答「不能存」（默认实现报错）。
- [x] `desktop/src-tauri/src/config.rs`：`save()` 把非空 `executor_api_key` 存进凭据库并把**写盘副本**
  置空（内存里的配置不动，节点照常可用）；`load()` 在字段为空时回填；旧版本留在 `config.json` 的
  明文 key 在下次保存时迁移并清空。凭据库不可用时保留 owner-only 文件，行为与今天一致。
- [x] 用例：会话文件 0600（新建 + 旧宽文件被收紧，`cfg(unix)`）、密钥往返、旧明文迁移、文件后端保留密钥。

### 4. 超时清场（F17.7）
- [x] `desktop/src-tauri/src/executor/procgroup_unix.rs`（新）：`extern "C" kill` + `terminate_group`
  （TERM）/ `kill_group`（KILL），`pgid <= 1` 一律拒绝；`procgroup_windows.rs`（新）如实返回 `false`。
- [x] `executor/spawn.rs`：超时改为 `terminate_tree()`——对整组 TERM → 250ms 宽限 → KILL → `wait()`
  收尸；组信号被拒时降级为直接子进程 `start_kill`，绝不向自身组发信号。头注释与 `process_group(0)`
  的说明同步更新。
- [x] 用例：`sh -c 'sleep 30 & …'` 拉起孙进程后整组终止，断言孙进程不残留、直接子进程被回收；
  守卫用例（0/1/负数）断言不会误伤自身。

### 5. 跨进程冒烟
- [x] `web/tests/smoke.e2e.spec.js`（新，`@vitest-environment node`）：`node:http` 真桩 + 真 socket，
  跑通 `refreshAll()`（五个端点）→ `POST /__shell/notify`（标题已本地化、link 正确）、401 透传为
  `authExpired`、连接被拒判为 `offline` 且 `isAuthError` 为假。
- [x] `desktop/src-tauri/src/proxy/mod.rs`：`spawn_gated_proxy()` + `a_whole_shell_session_over_real_sockets`
  ——真 `TcpListener` 上游 + 真 `axum::serve` 代理 + 真 `reqwest`：无 token 401 → bootstrap nonce →
  Cookie → `/api` 转发（上游 `Set-Cookie` 被重写）→ `/__shell/notify` 回机器码 → 外来 Origin 403；
  每步带 5s 超时。
- [x] `Makefile`：新增 `web-smoke` / `desktop-smoke` / `smoke`。

### 6. 校验
- [x] `cd web && bun run test`：24 文件 541 用例全绿（含新增冒烟与新通知用例）。
- [x] `cd desktop/src-tauri && cargo check --all-targets` 通过（无告警）。
- [ ] `cargo test` 本机仍因宿主缺失 Tauri 入口无法启动（0xc0000139 `STATUS_ENTRYPOINT_NOT_FOUND`），
  进程组用例仅 unix 编译，需在 CI 上执行。

## M18 — CI `cargo test` 编译失败修正（bug fix，2026-11-02）

背景：GitHub Actions 的桌面 job（ubuntu / windows 各一次）在 `cargo test` 编译期就挂了，
共 6 处 `E0599: no associated function or constant named 'get' found for struct 'Console'`
（`proxy/static_files.rs:43`、`:55` 及三处用例），外加一条
`rust-embed ... folder '.../web/dist' does not exist`。两种情况其实是同一个根因。

### 1. 根因：`build.rs` 丢了「保证 `web/dist` 存在」这一步
- 首次 v2 外壳落地时 `build.rs` 里有 `create_dir_all("../../web/dist")`；`3dca838`
  （把提交号从 git 读出来）重写该文件时把这段弄丢，只剩注释里的承诺。
- `web/dist/` 是构建产物且被 gitignore，于是**任何没有先跑 `make web-build` 的构树**（CI
  的干净检出就是）都会让 `#[derive(RustEmbed)]` 直接失败；derive 失败后宏不再产出
  `Assets`/`Embed` 实现，`Console::get(...)` 才跟着报 `E0599`——不是 trait 没引入，
  也不缺 `use`。
- 修复：`build.rs` 新增 `ensure_console_dir()`，在 `tauri_build::build()` 之前保证目录存在；
  建不出来时用 `cargo:warning=` 打出路径，避免下次只看到宏指向的死路。
  目录**有意留空**而不是塞占位页：空目录下 `Console::get("index.html")` 为 `None`，
  外壳走既有的 `console_missing`（503）分支，如实说「工作台没构建」，不会把占位页当成
  真的工作台服务出去；依赖真实产物的两处用例也保持原有的「缺产物就跳过」语义。

### 2. 校验
- [x] 复现：把 `web/dist` 整个移走后 `touch build.rs && cargo check --all-targets`，
      编译通过（空目录被 build.rs 重建，rust-embed 不再报错），6 处 `E0599` 全部消失。
- [x] 恢复真实产物后 `cargo check --all-targets` 仍通过、无告警。
- [ ] 本机无 Tauri 运行入口，`cargo test` 的实际执行仍需 CI（与 M17 第 6 节同一限制）。
- [ ] CI 侧另外注意：空 `web/dist` 下 `static_files` 的两条用例会自行跳过，
      CI 只验证「能编译」；要验证 SPA 回退与版本注入需要先 `make web-build`（本轮不改 CI）。

## M19 — 第四轮完整度报告 §8 收口（2026-11-02）

背景：第四轮完整度报告指出「封装有了、界面没接」这一类缺陷——`api.js` 里 12 个导出
没有任何界面引用，`/persona` 有路由却无入口，通知的 `link` 在壳里解析完就丢。共同点
是**只测「渲染出正确答案」的用例不会红**，所以本轮同时补接线与守卫。

### 1. N1 静默窗口以「现在」为锚

- 症状：`notifySettingsFrom()` 用**首次读取时刻** `startedAt` 当锚点，于是「再静默 30 分钟」
  在页面开了两小时后算出负数，`quietUntil` 落在过去，静默窗口实际上不生效。
- 修复：删掉 `startedAt`，改为 `quietUntil = minutes > 0 ? now + minutes*60*1000 : 0`；
  `loadShellNotifySettings()` 与 `applyShellNotifySettings()` 都以调用时刻为锚。
- 用例：T0 读 30 分钟 → `quietUntil === T0 + 30min`；T0+2h 保存 → 窗口从 T0+2h 起算且剩余为正。

### 2. N2 通知深链真正驱动导航

- 症状：`NotifyPayload.link` 标着 `#[allow(dead_code)]`，点击 toast 只会把窗口叫到前台。
- 修复（`desktop/src-tauri/src/notify.rs`）：
  - `remember_link` / `take_link` / `hash_expr` 三个纯函数（可 headless 单测）。只接受单斜杠
    开头的站内路径；`//host`、`javascript:`、反斜杠、控制字符与 U+2028/2029 一律拒绝。
  - `install(&AppHandle)` 注册 `on_action`：`action_id() == "tap"` 时取用路径、`unminimize`
    + `show` + `set_focus` + `window.eval(hash_expr(..))`；`lib.rs` 在 setup 里调用一次。
  - 路径用 `serde_json` 编码成 JS 字符串字面量，不拼接原文；一次点击只消费一次，
    toast 发射失败时清空槽位，避免下一次点击跳到上一条的地址。
- 语义：工作台是 `createWebHashHistory()`，所以 `window.location.hash = '#/threads/42'`
  就是一次真实路由跳转，不需要新增 IPC 面。

### 3. N3 侧栏补齐 persona 与 knowledge

- `Sidebar.vue` 增 `/persona`、`/knowledge` 两个入口（`hub`/`ops` 命名空间文案，13 语）；
  `Topbar.vue` 的标题映射补 `persona` / `knowledge`（此前落到默认标题）。

### 4. N4 `api.js` 导出引用守卫

- 新增 `web/tests/api-usage.spec.js`：扫 `web/src/**`（排除 `lib/api.js`），对 `api.js`
  每个具名导出断言至少被一处引用；**白名单必须为空**，失败信息直接列出无人使用的导出。
  这条守卫是「有封装无界面」的根治手段。

### 5. D7 六面接线（每面都补齐 13 语文案）

| 面 | 落点 | 接线 |
| --- | --- | --- |
| 知识库 | `views/KnowledgeView.vue`（新）+ `/knowledge` 路由 | `listKnowledge(agentId?)`，agent 过滤、空态、错误态、`feature_unavailable` 说「已关闭」 |
| 资源新建 | `OrgView.vue` 表单 | `createResource(body)` → 成功后重读 `listResources()`，失败保留输入并显示原因 |
| 连接器动作 | `ConnectorsView.vue` 折叠区 | `getConnectorActions(id)`，一次展开一次请求，错误不伪装成空列表 |
| 计算机卡片 | `ComputersView.vue` 卡片区 | `listComputers()`；删除前 `getComputer(id)` 复核，再 `deleteComputer(id)` 并重读列表 |
| 调度策略/详情 | `SchedulesView.vue` | `listRouterPolicies` + `saveRouterPolicy(source, patch)`；触发/工单行按需 `getRouterTrigger` / `getRouterTicket`，再点折叠 |
| 调度实时流 | `SchedulesView.vue` | `subscribeRouterEvents(0, …)`，800ms 去抖合并成一次 `loadRouter()`，卸载关闭 |
| @提及 | `ThreadView.vue` | 从已发言的 agent 里按前缀挑候选，↑↓/Enter/Esc，插入 `@name ` |
| 解除订阅 | `ThreadView.vue` | `dropRouterSubscription(id)`；`not_found` / `feature_unavailable` 视为已完成 |

### 6. CI：编译前先产出 `web/dist`

`.github/workflows/ci.yml` 的 desktop job 在 `cargo` 之前加 `bun install --frozen-lockfile
&& bun run build`（Windows runner 无 `make`）。此前 `proxy/static_files.rs` 与 `proxy/mod.rs`
里两条静态文件用例一直走「未构建则跳过」分支：绿，但没有证明 SPA 回退与版本注入。

### 7. 校验

- [x] `cd web && bun run build` 通过。
- [x] `cd web && bun run test`：**28 个 spec / 663 条用例**全绿（含新增 `view-edges.spec.js` 48 条、
      `round4.spec.js` 27 条、`api-usage.spec.js`）。
- [x] `bun run test:coverage`：语句/行 **100%**、分支 **98.29%**、函数 **99.74%**
      （9777 条语句 / 1586 个分支）。抬升来自 §8b 那一批「未被走过的分支」。
- [x] 桌面：`cargo check --all-targets` 通过（含新增用例的编译校验）。
- [ ] `cargo test` 本机仍不可执行（M17 §6、M18 §2 同一限制：Windows 缺 Tauri 原生测试入口，
      测试二进制以 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` 退出，补 `WebView2Loader.dll`
      到 PATH 与 `deps/` 均无效）；通知深链与执行节点身份的用例已写好，交由 CI / WSL2 收口。
- [ ] 桌面通知点击的端到端验证（真弹出 → 真点击 → 真跳转）需要图形环境，未在本机执行。

### 8b. 覆盖率补测（未被走过的分支）

只加用例、不改行为；唯一的生产代码改动是 `OrgView` 删掉一条不可能为假的 `|| []`。

- `view-edges.spec.js`（48 条）：按「响应形状 / 取消与关闭 / 失败无机器码 / 二次点击」四类
  覆盖此前只有正常路径的分支——知识库的 `{chunks:[]}` 与裸数组、连接器展开只取一次、
  组织页每个字段都提交一次、计算机卡片三种状态与删除确认的取消、调度页无 cron/无 lastStatus
  的行、已过期的倒计时、未知工单状态、触发详情无正文、抽屉关闭、SSE 帧去抖与卸载清定时器、
  线程 `@` 候选取自没有显示名的作者、委派后刷新任务列表、退订失败展示原因、
  Settings 在 `/__shell` 不可用时的本地镜像回退（含非 JSON）、执行节点拒绝原因的三种形态。
- `api.spec.js`：`getShellConfig` / `notifyShell` 两个此前无人调用的封装，以及「服务端没给码」
  时 `ApiError` 不渲染成 `undefined`。
- `workbench-store.spec.js` / `notifications.spec.js`：列表答复缺键时保持空数组、
  未知文案键回落到原始键、`notifySettings` 缺失时仍能判定；`decide` 收到空事件或 NaN 时钟、
  `markSeen`/`pruneSeen` 收到 undefined。
- 桌面 `executor/tests.rs`：`generate_node_id` 的形状与唯一性、`node_name` 不为空且无空白、
  `unix_seconds` 落在合理区间、`note()` 的成败两态（失败记错误、成功清错误并推进心跳）。

仍未覆盖且确认为**不可能走到**的防御分支（保留代码，不写假用例）：
`ComputersView` 的 `if (!card) return` / `if (!lease) return` 类前置守卫（对应按钮在无选中时
不可点）、同一文件里 `runTrial` / `create` 的「已在跑」臂（按钮此时 disabled）、
`SchedulesView` 空表单提交与 `selected ? … : []` 空选择臂（历史区只在有选中时渲染）、
`PersonaEditor` 的 `|| null`（选中的 id 必来自列表）与 `saving` 臂（保存中按钮 disabled）、
`BaseDialog` 无焦点元素（面板自身永远渲染关闭按钮）、浏览器环境判定（jsdom 里 `typeof window`
恒为真，node 环境的 `use-copy` 实例不计入同一份覆盖率）、`OrgView` 空名提交（按钮 disabled）。
这些占 27 条分支，即 **98.29% → 100%** 的差值。

### 8. 残余

- `channels` / `threads` 的投递明细与 webhook 循环仍无行级隔离（owner 作用域在服务端
  handler 层已收口，数据库第二道闸只覆盖 schedules / channels / computers 三张有
  `owner_id` 的表），详见 agenthub 仓 `task.md`。
- 连接器动作只是「声明能力」，不产生调用历史；真正的调用记录仍在任务 trace 里。

## M20 — 第五轮完整度收口：托盘角标 / 共享文件 / 审批队列 / 文档基线（2026-11-03）

对照《agenthub-agentbuddy 完整度评估》第 7 节 client 侧建议 1/2/3/4/5。

### 1. 托盘未读角标（建议 1）

- 外壳：`POST /__shell/badge`（`{count}`，缺字段 400 `invalid_count`、坏 JSON 400 `invalid_json`、
  超 `999` clamp 到 `999`），走 `dispatch` 既有的 Cookie/Origin 准入；计数存
  `ProxyState.unread: Arc<Mutex<u32>>`（`ProxyState` 仍可 `Clone`）。
- `tray::set_unread(app, lang, count)`：tooltip 全平台、`set_title` 在不支持的平台静默失败；
  0 清空角标并把 tooltip 回落产品名；>99 显示 `99+`。计数在进程里，`build`/`refresh` 都会重新套用，
  所以切语言不会把角标抹掉。
- 文案 `trayUnread` 13 语进 `i18n/copy.rs`（EN 为键序基准），`badge_text` / `title_for` 是纯函数，
  三个新用例覆盖 0 / 99+ / 每语言一断言。
- 前端：`api.js` 增 `setTrayBadge`；`workbench-store` 在 `ingestTask`、`markAllRead`、
  `clearNotifications` 三处 fire-and-forget 推送，纯 Web 构建的拒绝被吞掉。

### 2. 共享文件屏（建议 2）

- `views/FilesView.vue` + `/files` 路由 + 侧栏 `FolderOpen` 入口（15 屏 / 16 路由）。
- 上传用 `XMLHttpRequest`（只有它给上传进度），其余走既有 fetch 封装；下载是
  `<a :href="fileContentUrl(id)" download>`，字节不经 JS。
- 状态三分：加载中 / 空列表 / 服务端 `files_disabled`。上限提示取服务端 `maxBytes`，
  发送前先挡一次超限；删除走行内二次确认，失败保留该行。
- `copy/files-copy.js` 13 语（17 键）+ 8 个新错误码文案（`filesErrorCopy`，在 `errors-copy.js` 合并）。
- 样式追加进唯一的 `style.css`：拖拽区、进度条、文件表与 ≤900px 的卡片化降级，全部复用既有
  令牌，未新增颜色。

### 3. 连接器审批队列界面（建议 3）

- `ConnectorsView.vue` 的审批区从「只读 id 列表」改为真实队列：连接器名、等宽动作名、
  参数摘要（悬浮全文）、时间、计数徽标、刷新；批准（实心）/ 拒绝（描边）。
- 决策后重新拉取队列并刷新任务列表；失败保留该行并显示本地化原因，不做乐观删除。
- 修掉 `runConnectorAction` 的报文错位（服务端读 `action`，前端曾发 `name`）。

### 4. 文档与可验证性（建议 4/5）

- `requirements.md`：F5.5 拆为「角标（已实现）」与「F5.6 toast 深链（已实现）」，断线重放顺延为
  F5.8；新增 F19「共享文件与连接器审批队列」七条。
- `AGENTS.md`：屏数 14→15、路由 15→16、spec 28→30、用例 663→713、覆盖率基线改为
  语句/行 100% / 分支 98.52% / 函数 99.76%（10492 语句、1693 分支），并补 `/__shell/badge` 说明。
- `releasenotes.md`：同一组数字与 Rust 用例说明对齐；新增 `make desktop-test-report`。
- CI：desktop job 在 Linux 上 `tee desktop-test.log` → 摘要写进 `GITHUB_STEP_SUMMARY` →
  上传 `desktop-test-log` 产物；Windows 仍是 `cargo test --no-run` 编译校验。

### 5. 校验与残余

- `cd web && bun run test`：**30 个 spec / 713 用例**全绿；`bun run test:coverage`：
  语句与行 100%、分支 98.52%、函数 99.76%；`bun run build` 通过。
- 补测的守卫面（本轮新增 16 条）：无机器码失败的回退文案（文件列表/上传/删除、审批队列读与决策）、
  行缺 mime/createdAt/connectorName 时的 `—`、无法解析的体积按 0 字节、`files`/`maxBytes` 缺失的
  空态、提交空名称、审批参数为 `undefined` 时不留 `{}`、`login`/`register` 在后续 `whoami`
  失败时仍可用的语义、无 `MediaRecorder` 时的 setup、无可见控件时 Tab 不被吞、无 `document` 时主题
  切换不写存储。
- Rust：新增 `proxy/static_files.rs` 的 5 条（真实 `app_version_stamp()` 形状、客户端路由带**每响应
  nonce** 的 CSP、缺文件 404 而非 SPA 回退、`assets/` 长期缓存 vs `no-cache`、about 页 boot 名），
  并把原来「复制一份格式化字符串再断言」的假用例改成调用真实函数。`cargo test --no-run` 通过
  （180 条用例编译成功）；本机执行仍因测试二进制缺入口点（`STATUS_ENTRYPOINT_NOT_FOUND`）无法运行，
  Linux CI 负责实跑。
- Rust：本机 `cargo` 无法执行（工具链所在卷被判定为不可信挂载，`ApplicationFailedException`），
  因此 `badge`/`tray`/`shell` 的 Rust 改动只经代码审读，实际编译由 CI 的 Linux job 把关。

## M21 — 删除语义对齐：服务端 404 由客户端吃下（2026-11-03）

agenthub 把 `DELETE /api/schedules/{id}` 与 `DELETE /api/channels/{id}` 从「删不到也回 204」改成
「读不到就 404」（见其 `task.md` M17：判定来自 `RowsAffected`，不是先读一次）。服务端不再用状态码
替客户端保证幂等，于是这一半由客户端接住。

### 1. 两个视图

- `SchedulesView.remove`：`schedule_not_found` → 清掉选中、`load()` 重拉、不报错；其余错误照旧走
  `errorMessage(e.code) || e.message`。
- `ChannelsView.remove`：`channel_not_found` → `workbench.refreshChannels()`、不报错；其余错误照旧
  落 `listError`。
- 结果：掉包重试与「另一台设备已经删掉」都不再在前端变成一个拒绝，行也确实从列表里消失。

### 2. 用例

- `tests/views.spec.js` 两条反向用例改写：原先断言「显示 `channel_not_found` / `schedule_not_found`
  文案」，改为「重拉列表且不显示错误文案」（原用例名 `reports a rejected delete…`）。
- 未改 `lib/api.js`：删除封装与错误码映射此前就有，本次只改视图的判定分支。

### 3. 校验

- `cd web && bun run test`：**30 个 spec / 713 用例**全绿，基线不变（换了两条用例而非加用例，
  因此 `AGENTS.md` / `releasenotes` 的 713 与覆盖率数字无需改动）；`bun run build` 通过。
- 桌面外壳未受影响：这两处调用只发生在网页视图。

## M22 — 删除语义补齐：计算机与文件跟上（2026-11-03）

M21 只覆盖了本轮改过状态码的两个端点，但 `DELETE /api/computers/{id}`（先 `Get`，为空即 404
`computer_not_found`）与 `DELETE /api/files/{id}`（`service.Delete` 里 `Get` 不过即 `ErrNotFound`，
404 `file_not_found`）一直是同一语义——删不到就 404。于是「另一台设备已经删掉」在计算机与文件两屏
仍然会变成一句拒绝，而列表里那一行其实已经不在了。

### 1. 两个视图

- `ComputersView.confirmDeleteCard`：`computer_not_found` → 清掉 `pendingDeleteCard`、`loadComputers()`
  重拉、不写 `computersError`；其余错误照旧 `errorMessage(e.code) || e.message`。
- `FilesView.confirmDelete`：`file_not_found` → 清掉 `pendingDelete`、`load()` 重拉、不写 `error`；
  其余错误保留「行不动、原因就地」的原有行为。
- 结果：四屏（通道 / 调度 / 计算机 / 文件）对「删不到」的判定一致，判据仍是那一个机器码，未改
  `lib/api.js`。

### 2. 用例（713 → 716）

- `tests/files.spec.js`：`keeps the row when the delete is refused` 拆成两条——`file_not_found`
  归入「已消失」并断言重拉 + 行消失 + 无文案；`file_store_error` 断言行留下且显示本地化原因。
- `tests/round4.spec.js`：新增 `treats a computer the server cannot see as already gone`
  （`listComputers` 两次返回不同答案，断言重拉、卡片消失、无 `computer_not_found` 文案）。
- `tests/views.spec.js`：`ChannelsView` 补 `reports a delete refused for any other reason`
  （`forbidden` → 不重拉、显示文案、行还在）；`SchedulesView` 的已消失用例改为先选中该行，
  于是「清掉选中」这条分支也有人走——M21 换掉两条用例时，`ChannelsView` 的兜底分支因此掉出覆盖
  （语句 99.98%），本轮补回。

### 3. 校验

- `cd web && bun run test`：**30 个 spec / 716 用例**全绿。
- `cd web && bun run test:coverage`：语句/行 **100%**、分支 **98.52%**、函数 **99.76%**
  （10524 条语句、1698 个分支），回到 M21 之前的比例。
- `cd web && bun run build` 通过；`AGENTS.md`、`requirements.md`（4.2 新增「删除的幂等语义」）、
  两份 `releasenotes` 的 716 与覆盖率数字已同步。
- 桌面外壳未受影响：改动只落在网页视图与测试。

## M23 — 自动更新：双源选优 / 定时检查 / 平台匹配（2026-11-05）

原需求三点：按网络自动选 GitHub 或 Gitee、定时查 release 并在本地较旧时提示、
按本地操作系统挑 release 类型。澄清后定下：选源只看**可达性 + 延迟**（不采集位置）、
发现新版后由用户确认再**自动验签安装并重启**（保留手动下载）、Gitee 已有同名 release、
启动即查 + 每 24h 一次且可关自动检查 / 跳过版本。

### 1. 新增 Rust 模块 `src/upgrade/`

- `source.rs`：两源并发探测（`tokio::join!`，连接/整体超时 5s/6s）；Gitee 没有稳定的
  `latest/download` 别名，先经公开 release API 解出 `tag_name`（`valid_tag()` 只放行
  `[A-Za-z0-9._-]`）再拼 `releases/download/{tag}/latest.json`。`fastest()` 取延迟最低者、
  平局按声明顺序 GitHub 优先；`ordered_endpoints()` 给出「胜出 → 回落」供插件顺序 failover，
  两源全失败仍留 GitHub 静态清单。主机白名单 + HTTPS + 无 userinfo，重定向后的最终 URL 复查，
  清单资产还要求与来源同源（`matches_host`），杜绝「查 GitHub 却从别处下载」。
- `manifest.rs`：`ReleaseManifest` / `PlatformAsset` 解析（256 KiB 上限、版本必须可 semver）、
  `is_newer()` 用 `semver::Version` 剥 `v` 前缀且本地不可解析时**不**自动升级、
  `platform_key()` 把 `std::env::consts::OS|ARCH` 映射到 Tauri 平台键，
  `select_platform()` 缺键返回 `unsupported_platform`、签名空或 URL 越界返回 `manifest_invalid`。
- `mod.rs`：`UpgradeCode`（13 个机器码，serde 与 `as_str()` 有测试钉住一致）、
  `UpgradeState`（camelCase）、`decide()` / `apply()` 把结果折成状态的纯函数（失败时清掉旧版本
  详情）、`due()`（24h 到期、时钟回拨视为到期）、`should_announce()`（每版本一次、跳过不提醒）；
  `Upgrader` 负责启动延时 8s 首检 + `interval_at` 每 24h、`AtomicBool` 单飞、配置门控、
  持久化 `upgrade_last_checked`、后台通知，以及 `install()` 把探测得到的端点注入
  `UpdaterBuilder::endpoints()` 后 `check()` + `download_and_install()`，Windows 由插件退出、
  其余平台 `app.restart()`。

### 2. 接线

- `Cargo.toml` 加 `tauri-plugin-updater = "2"`（默认 rustls，与代理一致）与 `semver = "1"`；
  `lib.rs` 注册模块并以 `Builder::new().pubkey(upgrade::UPDATER_PUBKEY).build()` 挂插件，
  **公钥常量是运行时唯一真相**，`tauri.conf.json` 的 `plugins.updater.pubkey` 留空（M28 更正：
  仅源码里留空，release 构建时必须一并注入，否则 `tauri build` 报
  `Missing comment in public key`）；`capabilities/default.json` 不动——网页视图拿不到任何
  updater 命令。
- `config.rs` 三个 `#[serde(default)]` 字段；`proxy/mod.rs` 的 `ProxyState` 加
  `Option<Arc<Upgrader>>`，仅真实窗口才构造并启动定时器（无窗口路由器保持静默）；
  `proxy/shell.rs` 加三条 `/__shell/upgrade*` 路由、config 读写两个升级偏好，
  跳过版本字符串用 `valid_tag()` 过滤；4 处测试里的 `ProxyState` 字面量同步补 `upgrade: None`。
- `notify.rs` 抽 `upgrade_notice()` 纯函数（13 语 + `{v}` 替换可无窗口单测），
  `notify_upgrade()` 复用 `remember_link("/settings")` 与既有 `tap` → hash 跳转。
- 外壳文案放新表 `i18n/upgrade.rs`（13 语 × 13 key），`i18n::lookup()` 同时查 `copy` 与
  `upgrade` 两张表、`block_for()` chain 两份键，于是关于页的 `t(key)` 与英文回落语义不变；
  `shell.html` 关于卡片加状态行、来源、检查/升级/下载三个按钮。

### 3. 前端与发布

- `api.js` 三个新封装；`copy/upgrade-copy.js`（13 语 × 18 key）经 `withCopy()` 折进
  `settings` 命名空间，`copy-fallback.spec.js` 把它作为独立命名空间审计；
  `SettingsView.vue` 加更新卡片（版本/来源/检查时间/更新说明/进度/机器码错误、
  检查 / 升级 / 跳过 / 手动下载、自动检查开关），`Sidebar.vue` 加 `available` 时的单色横幅，
  `style.css` 末尾只加令牌化样式与 reduced-motion 关闭规则。
- `release.yml` 仅在 `TAURI_SIGNING_PRIVATE_KEY` 存在时才打开 `createUpdaterArtifacts`
  （本地构建零影响）、Linux 追加 `appimage`；`desktop/scripts/latest-json.mjs` 的
  `collect` 保留 Tauri 原始产物文件名（插件据此推断包类型）并内嵌签名，
  `manifest` 产出各自指向本源的 `latest.json` / `latest-gitee.json`；
  发布 job 追加 Gitee 镜像清单检查（失败不阻断）。

### 4. 用例与校验

- Rust：三个模块共 30 余条 inline 纯逻辑用例 + headless 路由用例（404 / 状态读取 /
  config 往返 / 非法跳过版本）。
- web：新增 `tests/upgrade.spec.js`（20 条，用真 `api.js` + stub fetch 钉住三条路由、
  各机器码文案、失败与无外壳路径、13 语折叠），用例 716 → 748、spec 30 → 31，
  覆盖率语句/行 **100%**、分支 **97.97%**、函数 **99.76%**（10981 语句、1774 分支）。
- `cargo check --all-targets` 通过；`bun run test` / `bun run test:coverage` 全绿。
  **本机 Windows 的 Rust 测试二进制仍因 Tauri 原生依赖入口缺失无法启动**
  （`STATUS_ENTRYPOINT_NOT_FOUND`），`cargo test --lib` 只完成编译，纯逻辑用例留给 CI（Linux）实跑。
- `latest-json.mjs collect|manifest` 用临时样本验证过双源 URL；`release.yml` 经 YAML 解析校验。
- 待外部配置（M25 起改为 secret 注入）：生成 minisign 密钥对，公钥写 secret `UPDATER_PUBKEY`
  （release 构建时由 `desktop/scripts/inject-updater-pubkey.mjs` 写入
  `src/upgrade/mod.rs` 的常量，源码恒为空），私钥/口令写 secrets
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；
  Gitee 镜像上传同样的 6 个下载并把 `latest-gitee.json` 重命名为 `latest.json`；签名已内嵌
  清单，不上传任何 `.sig` 或独立更新包。未完成时客户端自动降级为手动下载。

## M24 — 覆盖率收口：四项 100%（2026-11-05）

用户要求把 v8 覆盖率补到 100%。起点是 M23 的 31 spec / 748 用例（语句与行 100%、
分支 97.97%、函数 99.76%）。先用 `--coverage.reporter=json` 把每个未覆盖分支的
`branchMap.locations` 映射回源码片段，共定位 **36 个分支 + 1 个函数**，分三类处理。

### 1. 补测试（22 条用例，748 → 770）

- **disabled 按钮背后的守卫**：`tests/view-edges.spec.js` 新增
  `guards behind disabled controls` 组。这些按钮在会命中守卫的状态下本身就是
  disabled，`trigger('click')` 到不了处理函数，因此用 `wrapper.vm` 直接调用
  `<script setup>` 内部函数（已验证可访问）：ComputersView 的 4 个提前 return、
  单飞 `create()`、无机器码的 `refresh()` 失败；OrgView 空名提交；PersonaEditor
  未知选中 / 空 id 保存；SchedulesView 空目标 / 无选中历史 / 未知 ticket 状态
  / `v-model` 回写；ThreadView 无 `@` 令牌的 mention 列表与重复订阅时关闭旧流。
- **升级卡片防御臂**：`tests/upgrade.spec.js` 新增 `upgrade defensive arms` 组，
  覆盖空 URL 白名单、未知机器码、无版本号、并发检查/安装、空响应体、无 code 的
  错误、跳过无版本、config 写入被拒——全部仍走真 `api.js` + stub fetch。
- **三元 / setup 的不可达 arm**：`base-dialog.spec.js` spy
  `Element.prototype.querySelector` 制造「无可聚焦控件」以覆盖 `el || panel.value`；
  `components.spec.js` 补一次 light→dark 切换；`use-copy-node.spec.js` 用
  `vi.resetModules()` + 假 window 重新求值模块，覆盖 bootstrap 三元的两个 arm；
  `voice-recorder.spec.js` 用 `createSSRApp` + `renderToString` 在无 window 环境执行
  setup（jsdom 挂载需要 `window.ShadowRoot`，无法直接 stub）；`auth-store.spec.js`
  补 `permissions` getter 的数组分支。
- 顺带修正一处**假阳性**：`SchedulesView` 的 `enabled` 初始为 `false`，
  原有 `setValue(false)` 是 no-op；改为先 `true` 再 `false`，让 v-model handler 真跑。

### 2. 两处死代码清理（不改对外行为）

- `VoiceRecorder.vue`：`v-else` 里的 `recorder.state === 'recording' ? Square : Mic`
  恒为 `Mic`（recording 时走上面的 wave `v-if`），删除三元与 `Square` 导入，
  改为静态 `<Mic v-else />`。
- `auth-store.js`：login / register 在 try 与 catch 中都 `return`，使 `finally`
  之后的函数尾路径永远不可达（v8 记为 2 个分支）。改为单一出口：结果先赋给
  `result`，`finally` 之后统一 `return result`，返回契约与全部断言不变。

### 3. 结果与基线

- `bun run test`：**31 spec / 770 用例**全绿；`bun run build` 通过；lint 无新增告警。
- `bun run test:coverage`：语句 **100%**（10989）、行 **100%**（10956）、
  分支 **100%**（1804）、函数 **100%**（433）。**没有 exclude、没有 ignore 注释**。
- 同步更新 `AGENTS.md`（新增两条覆盖手法与「四项须保持 100%」硬约束）、
  `requirements.md`（第 36 条验收）、三份 `releasenotes` 的基线数字与
  「剩余缺口」表述；M23 的用例数由笔误 749 校正为 748。
- 桌面 Rust 侧不在本次范围（本机 Windows 测试二进制仍无法启动，纯逻辑用例留 CI 实跑）。

## M25 — 验签公钥改由 secret 注入（2026-11-06）

用户要求公钥不再手工写进源码，改用仓库 secret `UPDATER_PUBKEY`，在 release 编译时写入
`desktop/src-tauri/src/upgrade/mod.rs`。

- 新增 `desktop/scripts/inject-updater-pubkey.mjs`：读 `UPDATER_PUBKEY`（去空白后校验为
  单行 base64）与 `TAURI_SIGNING_PRIVATE_KEY`；前者精确替换 `mod.rs` 里的
  `pub const UPDATER_PUBKEY: &str = "…";`，后者才打开 `tauri.conf.json` 的
  `bundle.createUpdaterArtifacts`。经 `GITHUB_OUTPUT` 输出 `pubkey` / `enabled`，
  缺任一 secret 时给 notice/warning 而非让发布失败。源码常量恒为空，公钥不进仓库，
  本地构建不受影响。
- `release.yml`：把原 "Enable signed updater artifacts" 的内联 `node -e` 换成
  "Configure updater signing" step，注入两个 secret 并调用上述脚本；`id: updater`
  与 `enabled` 输出不变，Linux 追加 `appimage` 的逻辑不受影响。构建步骤仍单独把
  `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` 传给 `tauri build`。
- 文档同步：`AGENTS.md`（注入流程与硬约定）、`README.md` / `README_cn.md`
  （`gh secret set UPDATER_PUBKEY` 操作步骤）、`requirements.md` §7.3/§7.4、
  M23 的待外部配置条目、三份 `releasenotes`。
- 验证：`release.yml` 经 YAML 解析校验；注入脚本离线自测 6 个场景全绿——双 secret、
  幂等重注入、仅公钥、仅私钥、两者皆无、非法 `.pub` 文本必须失败且不动文件、
  带空白的合法公钥。

## M26 — 修 CI 的 unreachable 警告与签名私钥格式（2026-11-06）

Linux release 报两处：`src/upgrade/mod.rs:425` unreachable expression 警告，以及打包末尾
`failed to decode base64 key: Invalid padding` 直接失败。

### 1. `app.restart()` 是发散函数

Tauri v2 的 `AppHandle::restart()` 返回 `!`。原写法
`#[cfg(not(windows))] let result: Result<…> = app.restart(); … result` 让 Linux 上的
`result` 恒不可达。改为 `if cfg!(windows) { Ok(snapshot) } else { app.restart() }`：
`!` 直接协变为函数返回类型，后面再无语句；用 `cfg!` 而非 `#[cfg]` 还让两个分支在本机
Windows 编译期都被检查（CI 报的恰是非 Windows 分支）。
`cargo check --all-targets` 已无 warning。

### 2. 私钥 secret 必须是整个 `.key` 文件的 base64

查 tauri-cli `crates/tauri-cli/src/helpers/updater_signature.rs`：`secret_key()` 先对
`TAURI_SIGNING_PRIVATE_KEY` 整体 `STANDARD.decode()`，再把解码文本交给
`SecretKeyBox::from_string()`。因此该变量应放**整个 `.key` 文件的 base64**，明文两行文件、
路径或「只贴第二行」都会失败（用户遇到的是 `Invalid padding`）。

- 新增 `desktop/scripts/prepare-updater-secrets.mjs`：兼容明文文件（自动 base64 编码，
  保留 `untrusted comment` 头与末尾换行）、校验已是 base64 的值解码后确为 minisign 私钥、
  去掉口令里的 CR/LF；把规范化值与口令经 `GITHUB_ENV` 交给构建步骤并 `::add-mask::`。
  格式不对时在构建前 `::error::` 给出 `base64 -w0 … | gh secret set …` 命令，不再等
  4 分钟打包才失败。
- `release.yml` 的 Configure step 依次跑两个脚本；**删除 Build desktop app step 的同名
  step env**（step env 会覆盖 GITHUB_ENV 里的规范化值），改由 GITHUB_ENV 提供。
- 文档（README 中英 / AGENTS / release.yml 头注释）改成
  `base64 -w0 ~/.tauri/agentbuddy.key | gh secret set TAURI_SIGNING_PRIVATE_KEY`。

### 3. 验证

- `cargo check --all-targets` 通过、无 warning；`release.yml` 经 YAML 解析，确认
  Configure step 三个 secret、Build step 无同名 env。
- 新脚本离线 6 场景：明文→base64、已编码直传、路径必须失败且不导出、错误内容 base64
  必须失败、无密钥、CRLF 明文；连同口令清理与 `::add-mask::` 全绿。

## M27 — 复查实际密钥文件，纠正 M26 的私钥格式结论（2026-11-06）

只读复查 WSL2 `/home/lemonjia/.tauri/agentbuddy.key` 与 `.key.pub`（仅结构/权限，未输出
密钥内容）：

- 私钥 348 字节、`0600`；公钥 152 字节、`0644`；两者都是**单行 base64**、无 CRLF、
  无尾随换行；解码后各为两行 minisign 文本（`untrusted comment: … secret/public key`
  + base64 行）。
- 即 `tauri signer generate -w` 写出的文件本身已是 base64。**M26 里「secret 必须是整个
  `.key` 文件的 base64，用 `base64 -w0` 生成」是错误结论**，那样会二次编码。
- 正确值：`TAURI_SIGNING_PRIVATE_KEY` = `.key` 内容，`UPDATER_PUBKEY` = `.key.pub` 内容，
  都直接 `gh secret set NAME < file`（文件无尾随换行，避开网页粘贴带入的空格）。
  用户 CI 的 `Invalid padding` 更可能来自粘贴时的尾随空白或填错文件。

修正：`prepare-updater-secrets.mjs` 的 hint 改回 `gh secret set … < file`，校验加严为
「解码后必须是 comment 含 `secret key` 且第二行为 base64」，据此拒绝公钥 / 二次编码 /
截断值；明文分支同样要求 secret key 头。README 中英、AGENTS.md、release.yml 头注释
全部改为「直接用文件内容，不要再 base64」。离线自测覆盖单行 base64 私钥、明文两行、
公钥误填、二次编码、路径、无密钥、尾随空白与口令 CRLF。

## M28 — 公钥只注入常量、漏掉 tauri.conf.json（2026-11-06）

M27 修好私钥格式后，bundle 阶段又报
`failed to decode pubkey: failed to convert updater pubkey: Missing comment in public key`。

### 1. 根因

本机 `@tauri-apps/cli-win32-x64-msvc` 二进制里可提取到
`failed to decode base64 pubkey` / `failed to load updater pubkey` /
`failed to convert updater pubkey` / `Remember to set plugins > updater > pubkey` /
`The updater secret key … does not match the public key from plugins > updater > pubkey`。
tauri-cli `crates/tauri-cli/src/helpers/updater_signature.rs` 的 `pub_key()`：

```rust
let decoded_publick = decode_key(public_key).context("failed to decode base64 pubkey")?;
let pk_box = PublicKeyBox::from_string(&decoded_publick).context("failed to load updater pubkey")?;
let pk = pk_box.into_public_key().context("failed to convert updater pubkey")?;
```

`createUpdaterArtifacts = true` 时 CLI 读的是 **`tauri.conf.json` 的
`plugins.updater.pubkey`**：先 base64 解码成两行 minisign public key box 再解析，并与签名
私钥配对校验；它完全看不到运行时 `Builder::pubkey()` 注入的 Rust 常量。M25/M27 只把 secret
写进 `src/upgrade/mod.rs`，config 一直是 `""`：解码得空文本 →
`PublicKeyBox::from_string("")` → `Missing comment in public key`。所以即使私钥与公钥 secret
都填对，构建仍必挂。`tauri-plugin-updater::verify_signature()` 同样先 `base64_to_string()`
再 `PublicKey::decode()`，两个消费者要的正好是同一个值，无需转换。

### 2. 修正

- `inject-updater-pubkey.mjs` 把同一个 `UPDATER_PUBKEY` **同时**写入 `mod.rs` 常量与
  `tauri.conf.json` 的 `plugins.updater.pubkey`（两处在源码里仍恒为空）；有签名私钥却无
  公钥时直接 `::error::` fail，不再拖到打包阶段；`createUpdaterArtifacts` 仍只在签名时打开。
- 公钥格式前置校验：单行 base64，解码后必须是两行 public key box（首行
  `untrusted comment: … public key`、不含 `secret key`，第二行解码为 42 字节），据此拒绝
  裸 `RW…` 公钥行、明文两行文本、私钥、路径、二次编码值。
- 文档同步：`release.yml` 头注释、`mod.rs` / `lib.rs` 常量注释、README 中英、两份
  releasenotes、`requirements.md`；`AGENTS.md` 删掉「`plugins.updater.pubkey` 留空」
  这条错误约定、补上两处注入与格式约束；M23 历史条目加 M28 纠错指引。

### 3. 验证

- 离线自测在临时目录复刻 `desktop/src-tauri` 结构，40 条断言全绿：双 secret（两处注入、
  版本号/endpoints 保留、`createUpdaterArtifacts` 打开）、尾随空白、仅公钥、仅私钥失败且
  不改文件、裸公钥行 / 明文两行 / 二次编码 / 私钥 / 路径 / 乱码均失败、缺
  `plugins.updater` 失败、无 secret 时两处保持源码空值。
- `release.yml` 经 YAML 解析；`cargo check --all-targets` 通过、无 warning。

## M29 — 收敛 release assets（对照 v1.3.0 线上实际产物）

> 本轮之后，M23～M28 历史条目中关于 `createUpdaterArtifacts`、Linux
> `appimage`、「签名更新包 + `.sig`」的描述都是**当时的实现记录**，已被本节取代；
> 按实施记录惯例保留不改写。

### 1. 问题

v1.3.0 的 GitHub release 实际挂了 **18 个 assets**，并非文档口径的 6 个：
6 个用户下载、6 个多余更新包/签名（`agentbuddy.app.tar.gz(±.sig)`、
`agentbuddy_1.3.0_amd64.AppImage(±.sig)` 82MB、
`agentbuddy_1.3.0_x64_en-US.msi(±.sig)` 与用户版 msi **字节完全相同**）、
3 个 `updater-*.json` 中间文件、`latest.json`、`latest-gitee.json`、`SHA256SUMS`。
根因是 `release.yml` 的 `files: release-assets/*` 把 `collect` 的中间产物也一起发布，
且 `createUpdaterArtifacts` 让打包器额外生成了一套更新包。

### 2. 收敛

- `.github/workflows/release.yml`：删除签名时给 Linux 追加 `appimage` 的分支；
  三个 Package 步骤在签名开启时用 `bun run tauri signer sign --app-version V`
  直接给自己的 2 个下载签名；`collect` 输出到独立 `meta/` 并上传成
  `agentbuddy-meta-*` artifact，发布目录只收 `agentbuddy-assets-*`；
  `SHA256SUMS` 只对 `agentbuddy-*` 求和；新增 `verify` 步骤；
  `files:` 改 9 条显式白名单 + `fail_on_unmatched_files: true`；
  Gitee 镜像 checklist 改为「上传 6 个下载 + 重命名后的清单，无需 `.sig`」。
- `desktop/scripts/latest-json.mjs`：改为 `collect|manifest|verify` 三子命令。
  `collect` 归一化 `.sig`（兼容 base64 与明文 minisign box）后删除临时文件，
  按平台挑出可安装资产写入内部 meta；`manifest` 汇总出 `platforms`（3 键，指向
  deb / macOS app tarball / msi）与新增 `signatures`（6 项）；`verify` 断言恰好
  9 个文件、两份清单同源同版本、`SHA256SUMS` 只覆盖 6 个下载。
  `platforms` 的选型依据 `tauri-plugin-updater 2.14.1`：Windows 便携 zip 内是裸 exe
  会被当 NSIS，Linux Deb bundle type 走 `dpkg -i`，macOS 固定解包根为 `.app` 的 gz tar。
- `desktop/scripts/inject-updater-pubkey.mjs`：不再写 `bundle.createUpdaterArtifacts`，
  保留公钥双处注入与 `enabled`（现仅门禁显式签名）；
  `prepare-updater-secrets.mjs` 头注释说明两个 env 同时供 `tauri signer sign` 使用。
- `desktop/src-tauri/tauri.conf.json`：`bundle.targets` 去掉 `appimage`。
- Rust 生产逻辑零改动；`manifest.rs` 加一条用例钉住旧客户端忽略新增 `signatures` 字段。
- 文档同步：`README.md` / `README_cn.md`、`releasenotes.md` / `releasenotes_cn.md`、
  `requirements.md`（N7 / 验收 10、34 / 7.3 发布形态）、`AGENTS.md`（发布产物条目）、
  以及 `release.yml` 与两个 mjs 的头注释。

### 3. 验证

- 本地用一次性 minisign 密钥端到端跑通 `bun run tauri signer sign --app-version V`：
  `<asset>.sig` 落在下载旁边、内容为 base64(minisign box)、trusted comment 绑定版本，
  `collect` 正确归一化并删除临时 `.sig`；临时密钥与样本已清理。
- 新增 `web/tests/release-assets.spec.js`：以真实子进程跑 `collect|manifest|verify`
  的离线黑盒用例 15 条，覆盖正常 9 资产 / 三平台同源 URL / 6 项签名 / 无密钥降级，
  以及未知平台、部分签名、孤立 `.sig`、非法签名字节、路径穿越、重复平台、
  版本绑定不符、非法 semver、多余/缺失文件、残缺平台集、跨源 URL、篡改签名等异常路径。
- `release.yml` 经 Bun 内置 YAML 解析；三个 mjs 经 `node --check`；
  桌面端 `cargo test --no-run` 编译校验（本机 Windows 测试二进制仍因 Tauri 原生依赖
  `STATUS_ENTRYPOINT_NOT_FOUND` 无法启动，纯逻辑用例留 CI/Linux 实跑）；
  web 全量 32 spec / 785 用例通过，`test:coverage` 语句/行/分支/函数四项均 **100%**
  （新 spec 不 import `web/src`，不影响基线）。

## M30 — 安全加固：代理的归属边界与执行节点的逃逸面（2026-11-08）

对 Rust 外壳做一次定向审计，只看「一个恶意上游、一个手滑的设置会多拿到什么」。结论是六处，
全部在 `desktop/src-tauri` 内闭合，`agenthub` 与 `web/` 零改动。

### 1. 六处问题

1. **上游可以写外壳自己的 Cookie。** `rewrite_set_cookie` 只改属性、不看名字，因此一份
   `Set-Cookie: ab_proxy=…; Path=/` 会覆盖准入 Cookie（窗口随即被自己的代理拒之门外），
   而 `__Host-` / `__Secure-` 前缀被原样转发成一个浏览器必定拒绝、且不解释的 Cookie。
2. **`Location` 按字符串前缀判源。** `https://hub.example.com.evil.test/x` 与前缀
   `https://hub.example.com` 匹配，于是「别人的主机」被改写到环回源上；端口或 scheme 不同
   也一样误判。
3. **转发路径没有脏路径闸。** `req.uri().path()` 不归一化，`/api/../admin` 会带着 `..` 交给
   上游（或它前面的反向代理）去归一化，等于借用这个代理走出自己只该覆盖的前缀。
4. **外壳自己的响应既没禁缓存也没禁嗅探。** `/__shell/config` 会答「服务端地址、是否忽略证书、
   执行节点是否开启」；代理自造的 JSON 错误也没有 `nosniff`。
5. **白名单只拦 shell，不拦启动器。** `env`、`xargs`、`timeout`、`setsid`、`sudo`、`ssh`、
   `docker`、`make` 这类「运行别人」的程序一旦进白名单，等于把白名单整个作废
   （`env sh -c '…'`）；`.exe` 与大小写写法还是另一条绕过路径。
6. **根目录可以是文件系统根。** `Policy::new` 接受 `/`（或 `C:\`），此时「在根目录内」等于
   「整台机器」，而白名单条目还允许空白/控制字符。

### 2. 收口

- `proxy/forward.rs`
  - `rewrite_set_cookie` 改返回 `Option<String>`：名为 `ab_proxy`（大小写不敏感）、
    以 `__Host-` / `__Secure-` 为前缀、或无名者返回 `None`，`build_response` 直接跳过该条
    （既不转发，也不进 jar，因此也不会被持久化）。
  - `rewrite_location` 改为 **origin** 比对（`url::Url::origin()`：scheme + host + port），
    同源才改写，并保留 path / query / fragment；相对或不可解析的 `Location` 原样交给浏览器。
  - `upstream_json` 统一补 `Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff`。
- `proxy/mod.rs`：新增 `path_is_unsafe`，`..` / `\` / `//` / `%2e` / `%2f` / `%5c` / `%00`
  任一命中即在 `dispatch` 里以 `400 invalid_target` 拒绝（复用既有机器码，不新增词条），
  归一化不再外包给上游。
- `proxy/shell.rs`：`handle()` 拆成 `route()` + `harden()`，**每个** `/__shell/*` 响应
  （含 404、外壳页面、bootstrap 的 303）统一带 `no-store` + `nosniff`，新增路由不会漏。
- `proxy/static_files.rs`：代理输出的 HTML（`index.html`、外壳页）与内嵌资源都带 `nosniff`。
- `executor/policy.rs`
  - 新增 `LAUNCHERS` 拒绝名单（`env` / `sudo` / `doas` / `su` / `xargs` / `timeout` / `setsid` /
    `nohup` / `nice` / `stdbuf` / `chroot` / `unshare` / `nsenter` / `script` / `watch` /
    `flock` / `ssh` / `sshpass` / `docker` / `podman` / `nerdctl` / `buildah` / `make` /
    `cmake` / `ninja` / `gdb` / `expect`）。
  - `SHELLS` 改为**词干**表，新增 `is_forbidden_name`（忽略大小写与一个 `.exe` 后缀），
    `Policy::new` 与**每次** `authorize` 都过这道判定——旧配置或手改 `config.json` 不放行。
  - 白名单条目含空白或控制字符一律拒绝；根目录 canonicalize 后 `parent().is_none()`
    （即 `/`、`C:\`）以 `root_unusable` 拒绝。
- 文档：`AGENTS.md`（桌面外壳：Cookie 归属 / 重定向按源 / 脏路径闸 / 响应头；执行节点拒绝名单）、
  `requirements.md`（F17.10、F17.11、F18.8～F18.11 与验收 37～41）。

### 3. 验证

- 新增桌面端用例 15 条，另扩写 1 条：`forward.rs` 里 Cookie 归属 3 条 + 重定向按源 3 条（含
  `hub.example.com.evil.test` / `@evil.test` / 端口 / scheme 四种伪装）+ OAuth 参数保留；
  `mod.rs` 里真实路径放行 1 条 + 脏路径 1 条 + `dispatch` 层 400 实测 1 条；`shell.rs` 里
  「每个响应都禁缓存禁嗅探」1 条；`static_files.rs` 里 `nosniff` 1 条；`policy.rs` 里启动器 2 条
  （构造拒绝 / 已存储仍拒）+ `.exe` 与大小写 1 条 + 文件系统根 1 条；白名单拒绝用例扩到
  含 `..\`、控制字符与空白。既有 「`session=abc; HttpOnly; SameSite=Lax; Path=/`」
  端到端断言仍通过，说明普通会话 Cookie 的重写没有被这次收口改坏。
- `web/` 零改动：没有新增错误码（脏路径复用 `invalid_target`，执行节点复用
  `command_not_allowed` / `root_unusable`），13 语文案与 `api-usage.spec.js` 白名单不受影响。
- 桌面端编译校验仍走 `cargo test --no-run`（本机 Windows 测试二进制同样因 Tauri 原生依赖
  无法启动，纯逻辑用例留 CI/Linux 实跑）。

## M31 — 覆盖率闸门收口：入口文件也计入（2026-11-08）

`web/src/main.js` 一直被 `vite.config.js` 的 `test.coverage.exclude` 挡在闸门外，报告里的
「100%」其实是「除入口之外的 `src` 100%」。这一轮把入口拉回闸门内，并删掉唯一的 exclude。

### 1. 问题

- `main.js` 里两处 `typeof window !== 'undefined' ? … : …` 是**测试便利**留下的守卫：该文件只由
  `index.html` 以 `<script type="module">` 加载，浏览器里恒有 `window`，两条 else 分支没有任何
  执行路径，分支覆盖永远到不了 100%——于是干脆被 exclude 掉，闸门因此不再覆盖「应用是否真能起来」。
- 这与 `AGENTS.md` 里「禁止用 exclude 绕过」的约定直接冲突：数字是绿的，但绿得没有意义。

### 2. 收口

- `src/main.js`：删掉两处 `typeof window` 守卫，直接
  `setLang(detectLang(window.location.search, window.localStorage))`；文件因此没有分支，
  可以被真实导入并跑到 100%。
- `vite.config.js`：移除 `test.coverage.exclude` 整条，`include` 仍是 `src/**/*.{js,vue}`。
- 新增 `tests/main-bootstrap.spec.js`（`@vitest-environment jsdom`）：`vi.resetModules()` + 再导入
  跑**真入口**，`fetch` 本地桩只回答 `/__shell/config`、`/api/auth/me`（401 `unauthenticated`）
  与 `/api/auth/config`。

### 3. 验证

- 3 条用例：`?lang=ar` → `<html lang=ar dir=rtl>`、`agentbuddy.lang` 落盘、语言推给
  `/__shell/config`、匿名访客被路由守卫送到 `/login`（登录表单真的渲染，不是空 `router-view`
  占位）；无 query 时用 storage 里的 `ja`；两者都没有时按 `navigator.language`；
  `?lang=xx` 这类未知码被 `detectLang` 丢弃后回落浏览器语言，不会半本地化启动。
- `bun run test:coverage`：33 spec / 788 用例全绿，语句/行/分支/函数四项 **100%**
  （11008 语句、1808 分支、433 函数），`main.js` 单独一行也是 100%，且配置里已无 exclude。
- `bun run build` 仍通过；`AGENTS.md` 的基线数字同步更新。

## M32 — 发布脚本纳入覆盖率闸门；图标编码器修真（2026-11-08）

`desktop/scripts/` 的五个脚本跑在三个 CI 主机与 release job 自己的文件上（版本戳、图标、
签名密钥、`latest.json`），但只有 `latest-json.mjs` 有用例，而且是 `web/tests` 里的黑盒
子进程跑法——v8 看不到它们，等于零覆盖率。本轮把它们拉进一个可测量的闸门。

### 1. 问题

1. **四个脚本零测试**：`stamp.mjs` / `make-icon.mjs` / `inject-updater-pubkey.mjs` /
   `prepare-updater-secrets.mjs` 写错一个字段、公钥少写一处、密钥没规范化，都要等到
   release 才暴露；而它们各自把目录写死在 `import.meta.url` 旁，测试也无从下手。
2. **图标编码器产出的是坏 PNG**：`deflateStored` 把 BFINAL 写在 bit 7（`last << 7`），
   zlib 流因此是「非最后块 + adler32 尾巴」，`inflateSync` 直接报
   `unexpected end of file`。容器看着是 PNG，IDAT 永远解不出来；受版本管理的
   `desktop/assets/app-icon.png` 也是同一份坏字节。
3. **web 的 vitest 混版本**：`vitest@2.1.9` + `@vitest/coverage-v8@2.1.8`，每次跑都打印
   "Running mixed versions is not supported"，数字不可信。
4. **`latest-json.mjs` 用法错误返回 0**：`run()` 走 `fail()` 只设 `exitCode`，`main` 却
   返回 0；`verify` 缺参数时进程退出码仍是 0。
5. **两处恒不可达的判定**：`assertSafeName` 的 `path.basename(name) !== name`（`SAFE_NAME`
   已排除 `/`、`\`）、`verifyManifest` 的「signature for unpublished asset」（前一条集合
   比较已经保证了名字集合相同）。它们永远为假，分支覆盖永远到不了 100%。

### 2. 收口

- **`desktop/` 自成一个 Vitest 工程**：`desktop/vitest.config.js` 的
  `coverage.include` 就是 `scripts/**/*.mjs`，与 `web/` 的 `src/**` 闸门互不相干；
  `desktop/package.json` 增加 `test` / `test:coverage`，`vitest` 与 `@vitest/coverage-v8`
  都锁 **2.1.9**（web 同步锁同版本）。
- **脚本改成可导入**（沿用 `latest-json.mjs` 已有的形态）：
  - 导出纯函数 + 一个**无参** `main()`，`process.argv` / `process.env` / `process.cwd()`
    一律走默认参数，测试可注入 `(tauriDir, argv)`、`{iconsDir, assetsDir}`、
    `{root, pubkey, signing, output}`、`{rawKey, rawPassword, envFile, output}`；
  - 失败**抛异常**，由 `main` 统一转成 `::error::` + 返回 1（CLI 再落到 `process.exitCode`）；
  - 末尾统一一句 `runAsEntry(import.meta.url, main)`。
- **新增 `scripts/lib/entry.mjs`**：`isMain(url, argv1)` + `runAsEntry(url, main, {exit})`。
  入口判定从「只有子进程能走到的三行」变成普通函数，`tests/entry.spec.js` 直接注入
  `exit` 桩读回退出码，两条分支（导入 / 是入口）都真实覆盖——**不用 `exclude`，也不用
  `/* v8 ignore */`**（验收 #36 明令禁止）。`main` 刻意不接参数：`runAsEntry` 若传 argv，
  每个脚本里就多出一个只有子进程才走得到的箭头函数体。
- **`make-icon.mjs` 修真**：stored block 头改为 `out.push(last)`（`BFINAL`(bit0) |
  `BTYPE=00`），并用修好的编码器重新生成 `desktop/assets/app-icon.png`（1024×1024，
  IDAT 可 inflate）。`writeIconSet({iconsDir, assetsDir})` 让测试渲染到临时目录。
- **`latest-json.mjs` 收尾**：`run()` 的用法错误改为 `throw`（此前 `main` 会返回 0）；
  平台表收敛为 `UPDATER_ASSET` 单一来源（`isPlatform()` 查它的键，删掉平行的 `PLATFORMS`
  集合与 `no updater asset rule` 死分支）；删掉上面第 5 条的两处恒假判定，并在注释里
  说明为什么原来那条比较已经足够；新增 `main(argv)` 包装与 `run` 导出。
- **用例搬迁**：`web/tests/release-assets.spec.js`（338 行黑盒子进程）升级为
  `desktop/tests/latest-json.spec.js`，改为**进程内**调用 `collect` / `manifest` / `verify`，
  场景不减（9 个资产、双镜像、未签名发布、版本绑定、重复签名、脏 URL、篡改签名、
  畸形 SHA256SUMS、缺失 `platforms`/`signatures` 等），并补齐到分支 100%。
  CLI 入口另由 `desktop/tests/cli.spec.js` 用真子进程钉住 argv / 退出码。
- **接线**：`Makefile` 新增 `desktop-scripts-test` / `desktop-scripts-coverage`，
  `make test` 串上；CI 新增 `scripts` job（ubuntu、bun、无需 Rust）。
- **文档**：`AGENTS.md`（新「发布脚本」小节 + 基线数字 + 命令）、`requirements.md`
  （N8 / N9 与验收 42 / 43）、`README.md` / `README_cn.md`（测试命令）。

### 3. 验证

- `cd desktop && bun run test:coverage`：**7 spec / 103 用例全绿**，语句/行/分支/函数
  **四项 100%**（862 语句、267 分支、50 函数），`scripts/lib/entry.mjs` 也在闸门内；
  配置里没有 `coverage.exclude`，脚本里没有 `/* v8 ignore */`。
- `cd web && bun run test:coverage`：**32 spec / 773 用例全绿**，四项 **100%**
  （10491 语句、1808 分支、433 函数），混版本告警消失。
- 图标回归：`tests/make-icon.spec.js` 用 `node:zlib` 的 `inflateSync` 解开 32 / 128 / 1024
  三档，逐行校验 filter 字节为 0，并校验每个块的 CRC 等于 `crc32(type+data)`；
  `desktop/assets/app-icon.png` 解出 4195328 字节，正好等于 `(1024*4+1)*1024`。
- `tests/cli.spec.js`：`stamp` / `latest-json` 缺参数 → 退出码 1 + `usage:`；两个签名脚本
  空环境 → `::notice::` + 退出码 0；非法密钥 → `::error::` + 退出码 1。

## M33 — 单实例：驻留托盘时再次启动唤回原窗口（2026-11-08）

`background` 默认开启，关窗只是 `hide()`，进程连同环回代理、SSE、会话一起留在托盘里。
此时再双击一次图标，Windows / Linux 会起**第二个进程**：第二个代理绑第二个随机端口、第二枚托盘图标、
一张停在连接页或空白的窗口——用户看到的是「应用被重启了」，而事实上桌面外壳没有单实例保护。

### 1. 问题

1. **重复进程**：`run()` 无条件构建新窗口、新代理、新托盘；`app_config_dir` 里的 `config.json` 被两个进程
   交替写，会话 Cookie 也被两边抢。
2. **不可判定的「已经退出了吗」**：靠「退出时删标记文件」判定会漏掉崩溃、任务管理器结束、断电，
   漏一次就永久多开。必需一条不依赖清理动作的判定。
3. **新依赖不可用**：`tauri-plugin-single-instance` 不在本机 crate 缓存里，加它要动 `Cargo.lock` 与三平台构建，
   而这件事实在不需要平台 API。

### 2. 收口

- **新增 `src-tauri/src/single.rs`**（零新依赖，只用 `std::net` / `std::fs` / 已有的 `rand` + `serde`）：
  - `claim(dir)`：首个进程 `TcpListener::bind("127.0.0.1:0")`（端口由内核挑），把
    `{pid, port, token}` 以 `OpenOptions::create_new`（**原子**，两个同时启动的进程只有一个能建成功）
    写进 `app_config_dir/instance.json`（unix 上 `mode(0o600)`）；再次启动读该文件、带 token 发一句
    `agentbuddy/1 show <token>`，收到 `ok` → `Claim::AlreadyRunning`。
  - `Instance::serve(raise)`：监听线程逐条处理握手，只有「三段、协议名与 token 全等」的请求才唤回窗口；
    行读取上限 256 字节、连接/读写超时 1s，本地随便一个程序弹不出窗口。`accept` 出错时歇 `150ms`，
    不让持续错误变成忙循环。
  - **记录不在退出时删除**：「没人应答的记录就是过期的」——崩溃、正常退出、任务管理器结束用同一条判定，
    代价只是下次启动多一次被拒的连接。空文件 / 非 JSON / `token` 为空或 `port` 为 0 的记录同样按过期处理
    （否则一次写到一半的崩溃会永久关掉单实例保护）。
  - **认领失败不阻止启动**：配置目录不可写、或连续三次争用失败时，退化为 `Instance::detached()`
    （无监听），只可能开出第二张窗口，绝不启动失败。
- **接线 `src/lib.rs`**：`setup()` 的**最前面**（配置、密钥库、托盘、代理之前）调用 `claim`——
  `AlreadyRunning` 直接 `std::process::exit(0)`，第二份不碰任何东西、不显示任何窗口；
  `Primary` 则 `serve` 一个只做 `unminimize` + `show` + `set_focus` 的闭包。
  因为发生在代理启动之前，被唤回的窗口保留原端口、原 Cookie、原页面。
- **无 UI 改动**：`background=false` 时关窗本来就退出进程，再启动自然是新实例，同一套逻辑不需要分支；
  托盘「退出」仍走 `app.exit(0)`（记录留在盘上，下次启动按过期接管）。

### 3. 验证

- `cd desktop/src-tauri && cargo check --all-targets`：通过，零告警。
- `single.rs` 新增 7 条用例（真 socket + 临时目录，不依赖 `AppHandle`）：
  `a_second_launch_raises_the_copy_that_is_already_running`（二次认领 → `AlreadyRunning`，
  首个进程被唤回**恰好一次**，记录未被改写）、`a_record_left_by_a_dead_process_is_taken_over`
  （端口无人监听 → 接管，pid 更新、token 换新）、`a_record_that_cannot_be_used_is_replaced`
  （空文件 / 非 JSON / 空 token 三态）、`only_a_holder_of_the_token_can_raise_the_window`
  （错 token / 缺 token / HTTP 请求 / 空行一律 `no` 且不唤回）、`a_request_names_the_protocol_the_action_and_the_token`
  （10 条畸形行的纯函数表，含 CRLF 与大小写）、`an_unusable_record_reads_as_no_record`、
  `a_directory_that_cannot_be_written_still_starts_the_app`（降级为无监听，`serve` 不 panic）。
- 本机（Windows）Tauri 测试二进制仍因 `STATUS_ENTRYPOINT_NOT_FOUND` 起不来（见 AGENTS.md），
  故把 `single.rs` 原样复制进一个临时 crate（只留 `serde` / `serde_json` / `rand`）跑了一遍：
  **7 条全绿**（1.03s），确认握手、接管与降级路径在真实 socket 上成立；CI 的 Linux job 跑同一份文件。

## M34 — 变更配置时闪现控制台窗口（bug fix，2026-11-08）

切换 light / dark 主题会闪一个黑色命令行窗口：切主题 = 保存设置，保存设置 = 收紧文件权限，
收紧权限 = 起 `icacls`。外壳是 GUI 子系统程序，自身没有控制台，Windows 于是给这个控制台程序
**新开一个控制台窗口**——它随 `icacls` 退出而消失，看起来就是「改个主题弹了一下命令窗口」。

### 1. 根因

- `ConfigStore::save()` → `session::write_private_file()` → `restrict_to_owner()`。后者的 Windows 实现
  用 `std::process::Command::new("icacls")` 收紧 ACL，只重定向了 stdio（`Stdio::null()`），
  **没有给 `CreateProcess` 任何「不要窗口」的标志**；stdio 重定向并不影响控制台的创建。
- 同一缺陷也埋在 `executor/spawn.rs`：执行节点的每条任务都把输出接进管道，却同样会让
  控制台程序弹窗——只是默认关闭、且要服务端下发任务才看得到，所以先被发现的是切主题。
- **只在打包版出现**：`main.rs` 的 `windows_subsystem = "windows"` 只在非 debug 生效；debug 构建
  仍带控制台，子进程会继承它，所以 `tauri dev` 看不到这个窗口。
- 因此修复点不在「主题」，而在「GUI 进程启动子进程」这一层。

### 2. 收口

- **新增 `src-tauri/src/console.rs`**（零新依赖）：`CREATE_NO_WINDOW = 0x0800_0000` 直接写出，
  不为一个标志引入 `windows-sys`；`hide(&mut std::process::Command)` 与
  `hide_async(&mut tokio::process::Command)` 各设一次 `creation_flags`（`std` 与 `tokio` 是两套
  `Command` 类型），非 Windows 为空操作，调用点因此没有 `cfg`。
- **接线两处**：`session.rs` 的 `icacls`（**只加标志**，参数、`Stdio::null()`、退出码日志与
  `eprintln` 行为一律不变），`executor/spawn.rs` 的 `Command::new(request.command.trim())`。
  输出本就只走 `Stdio::piped`，控制台从不参与，隐藏窗口不影响任何回执。
- **源码守卫**（`console.rs` 的用例）：`include_str!` 读 `session.rs` / `executor/spawn.rs`，
  每个 `Command::new(` 之后 400 字符内必须出现 `console::hide`。这类缺陷没有可断言的运行时痕迹
  （标志不对外暴露，闪窗只在有桌面的机器上肉眼可见），读源码是唯一能进 CI 的证明；
  另有一条用例钉住常量值，防止被误写成相邻的 `EXTENDED_STARTUPINFO_PRESENT`（0x0000_0800）。

### 3. 验证

- `cd desktop/src-tauri && cargo check --all-targets`：通过，零告警（含 `#[cfg(test)]` 目标）。
- 本机（Windows）Tauri 测试二进制同样起不来，故把 `console.rs` 连同两个被检查的源文件原样复制
  进一个临时 crate（只留 `tokio`/`process`）实跑：**2 条全绿**，确认常量值与源码守卫都成立；
  CI 的 Linux job 跑同一份文件（`hide` 在那里是空操作，守卫照样读文本）。
- 待实机复核（本地无桌面会话，未跑起打包后的窗口）：Windows 上切 light / dark 主题与执行节点
  跑一条命令时都不再出现控制台窗口，且 `config.json` 的 ACL 仍被收紧（`icacls` 的调用、参数与
  退出码分支均未改动，本项只是「窗口不再存在」）。

## M35 — Threads 单选 / 多选删除（2026-11-09）

列表此前只有「新建」：会话一旦建错或聊完，界面上没有任何删除入口。本轮补 F3.6，
只动 `web/`，外壳零改动（`/api` 前缀代理本就覆盖新增的 DELETE）。

### 1. 收口

- `api.js`：新增 `deleteThread(id)` → `DELETE /api/threads/{id}`（204 空体走 `del` 的
  「无 body 即 null」分支）；`api-usage.spec.js` 由 store 的引用接住，白名单仍为空。
- `workbench-store.js`：`deleteThreads(ids)` 用 `Promise.allSettled` 逐 id 删除、**只重拉一次**列表，
  返回首个真实拒绝码；`not_found` / `thread_not_found` 视为「已经没了」，一个 id 的
  404 不牵连同批其它 id（与 F19 文件的幂等语义一致）。裸状态码（`404` / `405` / `403` / `503`）
  翻译成 `not_found` / `method_not_allowed` / `forbidden` / `feature_unavailable` 再本地化；
  其中裸 `404` 是 mux 的「没有这条路由」，**不**当作已删除，避免点了删除却静默无事发生。
- `ThreadListView.vue`：每卡复选框 + 单卡删除按钮 + 全选 / 清除 / 计数，二次确认复用 `BaseDialog`；
  单数用既有 `deleteConfirm`，复数用带 `{count}` 的新文案。选中集是 `selectedIds` computed
  （与服务端最新列表求交），成功后按刷新结果裁剪、失败时保留未删掉的行以便重试；
  `deleting` 挡住重复提交，拒绝码走 `errors.js` 本地化后显示在页内 banner。
- `copy/thread-copy.js`：13 语各补 7 键（`deleteTitle` / `deleteSelected` /
  `deleteSelectedConfirm` / `selectAll` / `selectThread` / `selectedCount` / `clearSelection`）；
  取消 / 关闭 / 删除按钮复用 `shell-copy.js` 的既有键，不新增机器码。
- `style.css`：复选框 / 工具栏 / 选中态只用已有令牌，label 撑到 44px 触控目标，
  焦点环 2px + 2px offset，RTL 用 `inline-size` / `margin-inline-start`，无新增色值。

### 2. 服务端契约

删除是服务端动作，客户端不做乐观删除也不伪造本地状态：`DELETE /api/threads/{id}` 需 `tasks:write`，
成功 204、不存在或非本人 404 `not_found`（消息历史随外键级联）。契约已写入 `requirements.md` §4.1；
`agenthub` 已同步实现该端点（见其 `requirements.md` §13 / `task.md` M20），无数据库实例时回
503 `feature_unavailable`，客户端按裸状态码翻译后本地化显示。

### 3. 验证

- 新增 `tests/thread-delete.spec.js`（17 条）：单选 / 全选 / 取消 / 对话框自身 v-model 关闭 /
  标题缺省 / 空列表 / 后台刷新后选中集收敛 / 单个与批量删除 / 拒绝与 404 / 端点缺失 /
  重复提交防护 / 13 语键与中文渲染。`api.spec.js` 补 204 + 403，`workbench-store.spec.js` 补批量的
  全成功 / 三种已删除 / 首个拒绝 / 裸状态码 / message 与缺省码回退 / 空选集。
- `bun run test`：**34 spec / 803 用例全绿**；`bun run test:coverage`：语句 / 行 / 分支 / 函数
  **四项 100%**（11314 语句、1876 分支、448 函数），配置无 exclude、无 `v8 ignore`。
- `bun run build` 通过（只有既有的 chunk 体积提示）。

## M36 — Threads 详情页返回列表（F3.7，2026-11-09）

详情页此前没有页内返回出口：从通知深链 `/threads/42` 直达时，只能靠侧栏的 Threads 入口绕回。
本轮只动 `web/`，不改 API、外壳与桌面文案。

### 1. 收口

- `ThreadView.vue`：把内容包进 `.thread-page`，顶部恒显示 `<RouterLink to="/threads">`，
  标签取 `t('backToThreads')`，左箭头 `aria-hidden`；会话内容仍受 `v-if="thread"` 保护，
  因此加载中 / 读取失败 / 深链直达时都能返回。用站内链接而非 `history.back()`，目标确定，
  不依赖外部浏览历史。
- `copy/thread-copy.js`：13 语各补 `backToThreads`，`copy-fallback.spec.js` 自动守卫每语已译
  且不等于英文。
- `style.css`：`.thread-page` 撑满内容区，`.thread` 由固定 `height` 改为 `flex: 1`；
  返回链接复用 `.btn`、44px 触控目标、2px + 2px 焦点环，`ar` 下图标用 `scaleX(-1)` 翻转，
  无新增色值。

### 2. 用例与验证

- `tests/thread-delete.spec.js` 增 2 条：从 `/threads/1` 点返回到 `/threads`，13 语逐个切换时
  链接文案均本地化且 `ar` 下 `<html dir=rtl>`，中文下显示「返回会话」；`getThread` 未返回时
  `.thread` 不渲染而链接仍可点。语言切换用例放在该 spec 的统一 `unmount` 流程里，避免
  `views.spec.js` 里历史挂载的组件在 `document.body.innerHTML` 清空后被语言 ref 触发更新。
- `bun run test`：**34 spec / 805 用例全绿**；`bun run test:coverage`：语句 / 行 / 分支 / 函数
  **四项 100%**（11333 语句、1880 分支、448 函数、11298 行），配置无 exclude、无 `v8 ignore`。
- `bun run build` 通过（只有既有的 chunk 体积提示）。
- 文档同步：`README.md` / `README_cn.md`、`requirements.md`（F3.7 / 验收 46）、
  `AGENTS.md`（测试基线）。

## M37 — Threads 发送后即时回显（2026-11-10）

`POST /api/threads/{id}/messages` 已落库，但打开中的会话页要退出重进才看得到刚发的消息。
根因是 `GET /api/threads/{id}/events` 只在建连时回放一次历史、随后只跟随该快照里的任务：
新发的人类消息不会作为帧推送，而客户端把 POST 回执里的 `message` 丢掉了。

### 1. 收口

- `ThreadView.vue`：抽出 `appendMessage()`（按 `ID` 去重）供 SSE 两类帧与 POST 回执共用；
  `send()` 成功后先把回执消息上屏、清空草稿，再重连 SSE，让新回放把这次发送连带产生的
  任务纳入订阅范围，回放重复帧也不会出现两行。发送被拒时保留草稿、页内显示原因
  （`ApiError.message` 已由 `errors.js` 本地化），`sending` 由 `finally` 复位。
- 不改 API / 外壳 / 服务端：agenthub 的 POST 本就返回 `message`，环回代理按 `/api` 前缀覆盖。

### 2. 用例与验证

- `tests/view-edges.spec.js` 增 4 条：回执即时上屏且重连后回放不重复、空响应不炸、
  发送被拒保留草稿并显示原因、无 `message` 的异常对象也回落为文本。
- `bun run test`：**34 spec / 809 用例全绿**；`bun run test:coverage`：语句 / 行 / 分支 / 函数
  **四项 100%**（11354 语句、1886 分支、447 函数、11319 行），配置无 exclude、无 `v8 ignore`。
- `bun run build` 通过（只有既有的 chunk 体积提示）。
- 文档同步：`AGENTS.md`（测试基线）。

## M38 — Connectors 卡片 Actions 表单宽度溢出（bug fix，2026-11-10）

Connectors 页每张卡片里的 Action / Arguments / Run 挤在一条不换行的 `.row` 里，两个 `<input>`
又没写 `type`，因此匹配不到 `style.css` 的 `input[type='text']` 规则：各自保持浏览器固有宽度
（约 177px）且无法收缩。`grid-2` 卡片内容区只有 290–390px，实测行右边缘最多超出卡片
**102px**，Run 按钮同时被压到 22px。只动 `web/`，不改 API / 文案 / 外壳。

### 1. 收口

- `ConnectorCard.vue`：Actions 行由 `.row` 换成专用 `.connector-actions`，两个输入框补
  `type="text"`，走设计系统的边框 / 高度 / `width: 100%`；13 语文案与错误码均不改。
- `style.css`：`.connector-actions` 用 `flex-wrap: wrap`，输入框 `flex: 1 1 110px` +
  `min-width: 0` 允许收缩，按钮 `flex: none` 不被挤扁；空间不足时 Run 落到第二行，
  用逻辑属性 `margin-inline-start: auto` 对齐行尾、`ar` 下自动镜像。只用已有令牌，
  无新增色值。
- 宽卡片仍是单行紧凑布局；窄卡片换行后两个输入框各约 140px，按钮保持完整宽度。

### 2. 用例与验证

- `tests/style.spec.js` 增 2 条布局守卫：钉住 `flex-wrap` / `min-width: 0` / `flex: none`
  与组件里的 `.connector-actions`、`type="text"`；jsdom 无布局引擎，只守 CSS 契约。
- Chromium 真机实测 420 / 500 / 700 / 900 / 1100 / 1400px 六档宽度，另测 `ar` RTL 与德语
  `Ausführen` / 俄语 `Выполнить` 长按钮：修复前溢出 2–102px，修复后各档溢出均为 0
  且 `scrollWidth === clientWidth`。
- `bun run test`：**34 spec / 811 用例全绿**；`bun run test:coverage`：语句 / 行 / 分支 / 函数
  **四项 100%**（11354 语句、1887 分支、447 函数、11319 行），配置无 exclude、无 `v8 ignore`。
- `bun run build` 通过（只有既有的 chunk 体积提示）。
- 文档同步：`AGENTS.md`（测试基线 + 窄卡片布局约束）。

## M39 — Threads 详情页清理全部消息（2026-11-10）

会话页需要「清理对话框所有消息」且 **13 语全量文案**。客户端单独清本地列表会在重进时复活，
而 M36 的 `DELETE /api/threads/{id}` 会连线程一起删掉，因此两个仓库一起收口：
agentbuddy F3.8 ↔ agenthub `requirements.md` §14 / `task.md` M21。

### 1. 服务端（agenthub）

- 新增 `DELETE /api/threads/{id}/messages`（`tasks:write`）：`threads.Store.ClearMessages`
  先校验归属再按 owner 删除 `thread_messages`，线程 / 参与者 / 任务保留，成功 204 空体；
  他人 / 不存在 → 404 `not_found`，空会话重复清空仍 204。不改迁移 / 错误码 / 权限码。
- `Listeners()`、路由存活探针、`docs-content.js`（143 条、collaboration 25 条）、
  `docs-copy.js` 13 语 `epThreadClear`、两份生成 md 同步；Go 用例覆盖 204 / 404 /
  存储故障 / 无存储 / 幂等，另有 `DATABASE_URL` 门控的 GORM 用例。

### 2. 客户端（agentbuddy）

- `api.js` 新增 `clearThreadMessages(id)`；`workbench-store.js` 新增同名 action，把
  旧服务端 405 等裸状态码归一化为 `method_not_allowed` 等机器码，经 `errors.js` 本地化。
- `ThreadView.vue`：仅当有消息时显示「清空消息」，`BaseDialog` 二次确认；成功后清空本地
  行、显示会话空态并**重建 SSE**（旧流仍跟随删除前快照里的任务，会把消息灌回来）；失败
  保留全部消息并在弹窗内显示本地化原因；`clearing` 防重复提交、取消 / 关闭不发请求。
- `thread-copy.js` 13 语新增 `clearMessages` / `clearMessagesTitle` /
  `clearMessagesConfirm` / `messagesEmpty`；空态从误用的 `listEmpty` 换成 `messagesEmpty`。
  `style.css` 为 `.thread-clear` 补 44px 触控目标与焦点环，不新增色值。

### 3. 用例与验证

- `tests/api.spec.js`：封装 204 / 拒绝双路径；`workbench-store.spec.js`：action 成功 /
  裸状态码归一化 / 异常回落；`thread-delete.spec.js`：清空成功 + SSE 重建、取消 / X 关闭、
  服务端拒绝保留消息并本地化、飞行中防重复、13 语键齐全且中文渲染。
- `bun run test`：**34 spec / 835 用例全绿**；`bun run test:coverage`：语句 / 行 / 分支 /
  函数 **四项 100%**（11524 语句、1920 分支、455 函数、11489 行）；`bun run build` 通过。
- `go build ./...` / `go vet ./...` / `go test ./...` 全绿；agenthub `cd web && bun run test`
  460 用例全绿、`bun run build` 通过；`tests/docs_endpoints_test.go` 双向差集无漂移。
- 文档同步：`requirements.md`（F3.8 / §4.1 / 验收 47）、`task.md`、
  `AGENTS.md`（测试基线）、中英 README。
