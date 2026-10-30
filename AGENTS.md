# AGENTS.md — agentbuddy（统一 Agent 工作台桌面客户端）

工程上下文入口，渐进式披露：本文件只给骨架与硬性约束；配置细节看 `README.md`，
行为契约看 `requirements.md`，实施记录看 `task.md`。

## 概述

`agentbuddy` 是 **Tauri v2 桌面外壳 + Vue 3 工作台前端**的桌面客户端（Linux / Windows / macOS）。
**自身无后端、无数据库**：它把 `http://127.0.0.1:<随机端口>` 上的相对请求环回转发到用户配置的
`agenthub` 服务端，从而复用 agenthub 的认证、A2A 编排、注册中心与任务状态机。

- 后端（别人的）：`agenthub`（Go 1.27 + PostgreSQL）。本仓库 **不 import** agenthub，只经 HTTP 对话。
- 前端：Vue 3.5 + Vite 5（**bun 1.4.4+** 运行时，弃用 npm/Node）；八屏工作台；**13 种语言**；
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
```

外壳只认**前缀**（`/api`、`/a2a`、`/healthz`、`/.well-known`），其余路径一律 SPA 回退到 `index.html`，
因此**服务端新增 `/api/*` 端点不需要改桌面端代码**（本轮新增的 `/api/channels*`、
`/api/connectors*`、`/api/threads/{id}/audio` 全部被 `/api` 覆盖）。

## 目录

```
web/                        Vue 3 工作台（bun + vite）
  src/App.vue               全局壳：镜像 <html lang|dir>、启动 ActivityMonitor
  src/router.js             8 条路由 + 登录守卫
  src/style.css             唯一全局样式表（单色令牌 + 全站样式）
  src/lib/                  语言、copy、api、stores、monitor、notifications、voice
  src/views/                8 屏
  src/components/           共享组件
  tests/                    Vitest（含 style 单色守卫、copy-fallback 13 语完整性）
desktop/
  src-tauri/src/            Rust：config / proxy / tray / notify / i18n
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
- **测试**：`cd desktop/src-tauri && cargo test`。

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
make desktop-install  # @tauri-apps/cli
make desktop-dev      # web-build + tauri dev
make desktop-build    # web-build + tauri build（宿主平台安装包）
make desktop-test     # cargo test
make desktop-check    # cargo check --all-targets
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
   agenthub `go build` + `go vet` + `go test -race ./...`。
4. 改动行为时同步三件套：`README.md`、`requirements.md`、`task.md`；只改代码不改文档视为未完成。
5. 渐进式披露：本文件保持精简，领域细节写在各自子目录或代码注释中。
