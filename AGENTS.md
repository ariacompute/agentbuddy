# AGENTS.md — agentbuddy（统一 Agent 工作台桌面客户端）

工程上下文入口，渐进式披露：本文件只给骨架与硬性约束；配置细节看 `README.md`，
行为契约看 `requirements.md`，实施记录看 `task.md`。

## 概述

`agentbuddy` 是 **Tauri v2 桌面外壳 + Vue 3 工作台前端**的桌面客户端（Linux / Windows / macOS）。
**自身无后端、无数据库**：它把 `http://127.0.0.1:<随机端口>` 上的相对请求环回转发到用户配置的
`agenthub` 服务端，从而复用 agenthub 的认证、A2A 编排、注册中心与任务状态机。

- 后端（别人的）：`agenthub`（Go 1.27 + PostgreSQL）。本仓库 **不 import** agenthub，只经 HTTP 对话。
- 前端：Vue 3.5 + Vite 5（**bun 1.4.4+** 运行时，弃用 npm/Node）；13 屏工作台；**13 种语言**；
  **纯黑/白/灰单色**；无 UI 组件库、无 CSS 框架，样式全部手写于单个 `web/src/style.css`。
- 桌面外壳：`desktop/src-tauri`（**Rust + Tauri v2**，出向 TLS 由 rustls + webpki-roots ≥1.0.10 校验），**不含后端、不含数据库**，用环回反向代理把
  同一份工作台对着用户指定的服务端打开；外壳自有文案同样 13 语。

## 架构（两端协作）

```
┌───────────────────────────────┐          ┌──────────────────────────────────┐
│ agentbuddy 桌面客户端           │          │ agenthub 服务端（常驻）             │
│  ── 触达 / UI 层 ──             │   SSE /  │  ── 执行 / 编排层 ──               │
│  • 窗口 / 托盘 / 系统通知        │   HTTP   │  • agent 长驻运行时（adapter）      │
│  • 语音采集与播放               │ ───────► │  • 任务推进 / HITL park-resume     │
│  • avatar / persona 渲染        │ ◄─────── │  • SSE Broker、push                │
│  • 轮询聚合（无全局事件流）      │          │  • channels / connectors / speech  │
└───────────────────────────────┘          └──────────────────────────────────┘
         │                                              │
         └── loopback proxy（axum, 127.0.0.1:0）────────┘
             └─ /__shell/notify ──► 系统通知（标题由工作台按当前语言解析）
```

外壳只认**前缀**（`/api`、`/a2a`、`/healthz`、`/.well-known`），其余路径一律 SPA 回退到 `index.html`，
因此**服务端新增 `/api/*` 端点不需要改桌面端代码**（本轮新增的 `/api/channels*`、
`/api/connectors*`、`/api/threads/{id}/audio` 全部被 `/api` 覆盖）。

## 目录

```
web/                        Vue 3 工作台（bun + vite）
  src/App.vue               全局壳：镜像 <html lang|dir>、启动 ActivityMonitor
  src/router.js             13 条路由 + 登录守卫
  src/style.css             唯一全局样式表（单色令牌 + 全站样式）
  src/lib/                  语言、copy、api、stores、monitor、notifications、voice
  src/lib/copy/scheduler-copy.js  调度器文案（13 语，合并进 hub / errors 命名空间）
  src/views/                13 屏（SchedulesView 含调度水位 / 运行历史 / 触发流三区块）
  src/components/           共享组件
  tests/                    Vitest（含 style 单色守卫、copy-fallback 13 语完整性；
                            smoke.e2e.spec.js 用真 socket + node:http 桩跑真客户端）
desktop/
  src-tauri/src/            Rust：config / session / proxy / executor / tray / notify / i18n
  src-tauri/assets/         shell.html（连接页 + 关于页）
  frontend-stub/            启动占位页（tauri.conf.json 的 frontendDist）
```

## 硬性约定

### 前端（web/）

- **文案**：`src/lib/copy/*-copy.js`，13 语（`en zh zh-TW es fr de it ru ja ko pt ar hi`）。
  `use-copy.js` 的 `resolve()` 用 `{...copy.en, ...copy[lang]}` 浅合并 + **en 兜底**。
  **禁止在模板里硬编码自然语言**。
- **主题**：`:root` 为暗色基础值，`[data-theme='light']` 在文件末尾**成对**翻转同一批令牌；
  **默认主题为 light**（无存储偏好时），由 `web/index.html` 预绘制脚本与 `ThemeToggle` 设定
  `document.documentElement.dataset.theme='light'`，`agentbuddy.theme` 持久用户选择。
  新增颜色必须两处都写，禁止硬编码色值。
- **单色禁令**：UI 不得出现任何有彩色相，一律落在 `#000 ↔ #fff` 明度轴；
  `tests/style.spec.js` 自动校验（hex 三通道相等 + rgb/hsl 中性 + 色相词黑名单）。
- **RTL**：`ar` 下 `document.documentElement.dir = 'rtl'`，布局一律逻辑属性
  （`margin-inline` / `inset-inline`）。
- **无障碍**：触控目标 ≥44px；焦点环 2px + 2px offset；`prefers-reduced-motion: reduce` 下禁全部动效。
- **错误**：store 只存 `error.code`；文案经 `errors.js` + `copy/errors-copy.js` 本地化。
  新增错误码须登记三处（服务端 `httputil.Code*`、前端 `CODE_KEYS`、`errors-copy.js` 13 语）。
- **测试**：`cd web && bun run test`（Vitest）。**勿用裸 `bun test`**（Bun 原生 runner 不加载
  `vitest.config.js`，无 jsdom 环境）。新增功能须补**正常 + 异常**双路径用例。
  覆盖率走 `bun run test:coverage`（v8，配置在 `vite.config.js` 的 `test.coverage`，只输出
  `text-summary` + `text`，不写报告目录），当前基线：语句/行 **100%**、分支 **94.77%**、函数 **98.35%**
  （8951 条语句、1398 个分支）；回落时先看报告里的未覆盖行再补用例。
- **系统通知**：工作台只经 `notifyShell()` → `POST /__shell/notify` 投递（`{title, body, link}`），
  标题在发送瞬间用 `useCopy('workspace')` 解析（**不能传 copy key**），且必须 fire-and-forget
  （`Promise.resolve(...).catch()`）；外壳的 `notify_enabled` / `notify_quiet_minutes` 由
  `shell-settings.js` 读出后喂给 `decide()`，两条设置才真正生效。纯 Web 构建没有 `/__shell`，
  请求失败静默吞掉。

### 桌面外壳（desktop/）

- **环回代理**：`TcpListener::bind("127.0.0.1:0")`；axum `Router::new().fallback(dispatch)`；
  转发前缀 `/api` `/a2a` `/healthz` `/.well-known`。
- **SSE 必须真流式**：`reqwest` 字节流 → `Body::from_stream`；强制 `accept-encoding: identity`；
  **禁止整体超时**（仅 `CONNECT_TIMEOUT = 10s`）。
- **Cookie 重写**：丢 `Secure` / `Domain` / 原 `Path`，`SameSite=None` → `Lax`，补 `; Path=/`；
  保留 `HttpOnly`。
- **关闭行为**：`CloseRequested` 时读取 `config.background`——为 `true`（默认）则
  `api.prevent_close()` + `window.hide()`（保留在托盘运行）；为 `false` 则放行关闭，
  应用随之退出（外壳无其他窗口）。**仅托盘「退出」恒走 `app.exit(0)`**。
  该偏好由 `/__shell/config` 落盘，连接页与工作台「设置」页均可改。
- **内嵌前端为 `../../web/dist`**：`build.rs` 保证目录存在（`rust-embed` 目录缺失会编译失败）。
- **外壳文案 13 语**：`src-tauri/src/i18n/copy.rs`，语言代码集必须与 `web/src/lib/languages.js` 一致。
- **托盘菜单语言跟随应用**：Rust 无法读取浏览器 `localStorage`，故工作台在 `setLang` 时把
  `agentbuddy.lang` 经 `/__shell/config` 推送到外壳 `config.lang`，托盘据此重建（`tray::refresh`）；
  连接页 `connect()` 同样会同步。即托盘语言 = 应用的 `agentbuddy.lang`，而非外壳独立设置。
- **代理准入（三件套，缺一不可）**：每次启动生成 256 位 token 与**一次性 nonce**；窗口经
  `GET /__shell/bootstrap?nonce=…` 兑换 `HttpOnly; SameSite=Strict; Path=/` 的 `ab_proxy` Cookie 后
  `303 → /`。除 bootstrap 外**所有**路径（含 `/api`、`/a2a`、`/__shell/*` 与静态资源）都必须带该
  Cookie（原生客户端可用 `Authorization: Bearer`）；`Origin` 与 `self_url` 不符者**先于鉴权**以
  `403 proxy_origin_refused` 拒绝。token 只在代理内存与 Cookie 里，绝不进 JS、绝不转发上游。
- **每响应 CSP nonce**：代理输出的每个 HTML 都带 `Content-Security-Policy`，
  `script-src 'self' 'nonce-<每响应随机>'`（**不含** `unsafe-inline`）；注入的内联脚本必须声明该 nonce。
  转发上游时只丢逐跳头，上游 CSP / HSTS / X-Frame-Options 原样透传。
- **凭据只进凭据库**：agenthub 会话与执行节点 API key 一律存操作系统凭据库
  （`session.rs` 的 `Keyring`，密钥用 `secret:<name>` 账户），`config.json` 里该字段留空、`load()` 回填；
  无凭据库时才回退到文件，且文件**创建即 `0600`**（`write_private_file`，不「先写后改」），
  Windows 用 `icacls /inheritance:r /grant:r <user>:F` 显式收紧。日志只记「已迁移/回退」，
  绝不打印密钥、Cookie 或 URL 里的 userinfo。
- **执行节点（BYOM）**：`src-tauri/src/executor/` 让本机可选地成为 agenthub 的执行节点，**默认关闭**，
  开启必须先经 `window.confirm` 确认。安全边界全部落在 `policy.rs` / `spawn.rs` / `procgroup_*.rs`：
  命令按**精确名**白名单匹配（`sh` / `bash` / `cmd` 在构造上拒绝）、**绝不拼 shell**（argv 直 exec）、
  工作根目录必须绝对路径且只能在其内读写执行、环境变量按白名单直传、输出截断、并发有上限；
  超时由 `terminate_tree()` 收场——unix 下 `process_group(0)` 使子进程成为组长，
  对 `-pgid` 先 TERM、250ms 宽限后 KILL、再 `wait()` 收尸，**孙进程不残留**；`pgid <= 1` 或信号被拒
  时降级为直接子进程 `start_kill`。Windows 无进程组语义，如实退回直接子进程终止（不伪装已支持）。
  状态与开关只经 `GET|POST /__shell/executor` 暴露，**网页视图不获得任何文件系统或命令执行权限**；
  拒绝原因是机器码（`root_unusable` / `command_not_allowed` / …），由工作台 13 语本地化。
- **测试**：`cd desktop/src-tauri && cargo test`。本机（Windows）测试二进制因 Tauri 原生依赖
  入口缺失无法启动，只能 `cargo test --no-run` 做编译校验；纯逻辑用例（i18n 表、托盘映射、
  会话存取、执行节点的白名单/根目录/超时/截断）不依赖 AppHandle，在 CI 上一跑即知。
  `i18n/copy.rs` 用 `include_str!` 读 `web/src/lib/languages.js` 钉住 13 语代码集，改语言清单会在此处报错。
  **CI 跑 `cargo test` 前必须先 `make icons`**：`tauri::generate_context!` 在编译期读 `icons/`，
  而该目录被 gitignore，缺了连 `cargo check` 都过不去（`make desktop-test` / `make desktop-check`
  已依赖 `icons`，裸 `cargo test` 不会代劳）。

### 服务端（agenthub，改动需谨慎）

- 迁移幂等，新增走新文件（`013` 起）；`store_test.go` 的 `want` 切片钉住文件名清单，必须同步。
- 新路由必须同时登记 `handlers/listen.go` 的 `Listeners()` 与 `listen_test.go` 的 `probes`。
- 不新增权限码：通道 / 连接器 / 语音复用 `tasks:read` / `tasks:write` / `resources:*`。

## 常用命令

```bash
make web-install      # bun install
make web-dev          # vite dev（:5173，代理 /api 到 localhost:3500）
make web-build        # 产出 web/dist（外壳内嵌它）
make web-test         # vitest
make web-coverage     # vitest + v8 覆盖率
make desktop-install  # @tauri-apps/cli
make desktop-dev      # web-build + tauri dev
make desktop-build    # web-build + tauri build（宿主平台安装包）
make desktop-test     # cargo test
make desktop-check    # cargo check --all-targets
make web-smoke        # 真 socket + node:http 桩（store 与 api.js）
make desktop-smoke    # 真上游 + 真 axum 代理（bootstrap → 转发 → 通知）
make smoke            # 上面两条
make icons            # 从 assets/app-icon.png 派生全部尺寸
make stamp VERSION=x  # 同步版本号到 Cargo.toml / tauri.conf.json
make test             # web-test + desktop-test
make clean
```

## 开发流程（硬性要求）

1. **Plan 模式产出 `requirements.md`**（功能边界 / API / 表结构 / 异常 / 验收标准），
   人工审核通过后再创建 `task.md` 分步实施。
2. **实现与单元测试同步**：新增功能必须补单测，覆盖正常与异常路径。
3. **合入前校验全绿**：前端 `bun run build` + `bun run test`；桌面 `cargo check` + `cargo test`；
   agenthub `go build` + `go vet` + `go test -race ./...`；涉及代理 / api.js / 通知链路时加跑 `make smoke`。
4. 改动行为时同步三件套：`README.md`、`requirements.md`、`task.md`；只改代码不改文档视为未完成。
5. 渐进式披露：本文件保持精简，领域细节写在各自子目录或代码注释中。
