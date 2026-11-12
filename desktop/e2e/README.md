# 桌面应用级自动化测试（用户视角）

从**真实用户的角度**测试 agentbuddy：启动打包后的 debug 桌面客户端，在 WebView 里
看元素、点击、输入、读可见文案，观察界面变化；不调用 Vue 内部方法、不读 Pinia store、
不新增任何 IPC 面。覆盖工作台 15 屏与桌面外壳行为，正常与异常双路径，共 13 个 spec /
115 条用例。

## 架构

```
Vitest(独立配置, 串行) ── W3C WebDriver over fetch ──> tauri-driver
        │                                              │
        │                                              └── AgentBuddy(dev 构建)
        │                                                     └─ 连接页 / 工作台 WebView
        ├── /__shell/* 与四前缀回源：页内 fetch（带 bootstrap Cookie）
        ├── 401/403/CSP/SPA 回退：裸 Node fetch（无凭证或 foreign Origin）
        ├── 单实例 / 托盘驻留：spawn 第二进程 + instance.json 原始 TCP 握手
        └── node:http 确定性 stub（含 SSE since 回放、multipart、故障注入）
                    ↑ E2E_BACKEND=live 时整条替换为真实 agenthub
```

Tauri v2 的 `tauri-driver` **不需要在 Cargo.toml 启用 `webdriver` feature**（官方文档：
「without modifying our Tauri application at all」）。唯一的产品侧改动是可选 feature
`e2e-isolation`：仅在该 feature 下读取 `AGENTBUDDY_E2E_CONFIG_DIR`，把
`config.json` / `session.json` / `instance.json` 重定向到临时目录，避免污染用户真实配置。
release 构建不启用该 feature，启动路径与原来完全一致。编排器在连接页保存任何配置**之前**
会先检查 `instance.json` 落在临时目录里，否则立即终止运行。该缝的正常与异常两条路径由
`src-tauri/src/lib.rs` 的 `e2e_config_dir_tests` 覆盖，CI 用
`cargo test --features e2e-isolation e2e_config_dir` 跑它。

## 前置条件

| 平台 | 依赖 |
| --- | --- |
| Linux（权威全量） | `webkit2gtk-driver`（提供 `WebKitWebDriver`）、`xvfb`（提供 `xvfb-run`）、Tauri 的 WebKitGTK/GTK 构建依赖、`cargo install tauri-driver --locked`、Rust stable |
| Windows（best effort） | `msedgedriver`（与 WebView2 运行时版本匹配，可用 `E2E_NATIVE_DRIVER` 指定路径）、`cargo install tauri-driver --locked`、Rust stable |
| 通用 | bun ≥ 1.4.4、Node（Vitest 必须由 Node 启动）、`web/dist/index.html`、带 `e2e-isolation` 构建的 `desktop/src-tauri/target/debug/AgentBuddy[.exe]` |

> AGENTS.md 记录的「本机 Windows 无法启动 Rust 测试二进制」指的是 `cargo test` 的
> test harness 二进制，**不是** dev 构建的桌面应用进程。但本机若没有上述 WebDriver
> 组件，编排器会把桌面用例标记为 skip 并打印具体缺失项；`stub-contract.spec.js`
> 不受影响，始终真实执行。

## 运行

```bash
# 一次性
make e2e-tools                    # cargo install tauri-driver --locked

# 构建（顺序不可颠倒：icons → web/dist → debug 桌面二进制）
make e2e-build

# 默认：确定性 stub，离线
make e2e
# 等价于 cd desktop && bun run test:e2e

# 只要服务端契约（无需 Rust 工具链 / WebDriver）
make e2e-contract

# 真实 agenthub（同一套用例）
E2E_SERVER_URL=http://127.0.0.1:3500 \
E2E_LIVE_EMAIL=ops@example.test \
E2E_LIVE_PASSWORD=... \
make e2e-live
# 等价于 cd desktop && bun run test:e2e:live
```

`make test`（web Vitest + release 脚本 Vitest + cargo test）与 web/desktop 两个
100% 覆盖率闸门**不受影响**：`desktop/vitest.config.js` 只匹配 `tests/**/*.spec.js`
和 `scripts/**/*.mjs`，`web/vite.config.js` 只匹配 `src/**`，本工程的 `e2e/**`
落在两者之外，且自身 `coverage.enabled = false`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `E2E_BACKEND` | `stub` | `stub` 起本地确定性服务端；`live` 连真实 agenthub |
| `E2E_SERVER_URL` | — | live 模式必填，形如 `http://host:port` |
| `E2E_LIVE_EMAIL` / `E2E_LIVE_PASSWORD` | — | live 模式登录凭证 |
| `E2E_LIVE_ALLOW_DESTRUCTIVE` | `0` | live 模式下默认跳过删线程 / 清任务 / 删文件；设为 `1` 前务必使用隔离账号 |
| `E2E_APP_BIN` | `desktop/src-tauri/target/debug/AgentBuddy[.exe]` | dev 构建产物路径 |
| `E2E_DRIVER_URL` | `http://127.0.0.1:4444` | tauri-driver 地址 |
| `E2E_TAURI_DRIVER` | `~/.cargo/bin/tauri-driver` | tauri-driver 二进制 |
| `E2E_NATIVE_DRIVER` | — | 平台 WebDriver 路径（Windows `msedgedriver` / Linux `WebKitWebDriver`） |
| `AGENTBUDDY_E2E_CONFIG_DIR` | 系统临时目录下自动创建 | 显式指定时**不会**在结束时删除 |
| `E2E_ARTIFACTS` | `desktop/e2e/artifacts` | 报告 / 截图 / 请求日志目录 |
| `E2E_TIMEOUT_MS` / `E2E_STARTUP_MS` | `30000` / `120000` | 元素等待 / 启动超时 |
| `E2E_HEADED` | `0` | Linux 下不使用 `xvfb-run` |
| `E2E_CONTRACT_ONLY` | `0` | 只跑 stub 契约用例 |

stub 的固定凭证：`e2e@example.test` / `agentbuddy-e2e`。

## 用例矩阵（13 spec / 115 用例）

| spec | 覆盖 | 正常 | 异常 |
| --- | --- | --- | --- |
| `stub-contract` | 端点、鉴权、SSE `since` 回放、multipart、故障注入、脱敏日志 | 全端点 200、登录换 Cookie、CRUD、`{deleted,kept}` | 401/403/405/503 `feature_off`/500/空态/断连、错误字段名、超限 |
| `connect` | F1 连接页、healthz 探测、证书开关、13 语 / RTL、偏好 | 探测成功并保存地址、13 语表、`ar` 下 `dir=rtl` | 空 / 非法 / 不可达地址各自的本地化提示 |
| `auth` | 登录、注册、OAuth 配置渲染、路由守卫 `?next=` | 登录后回到工作台、深链回跳 | 密码错误、`email_taken`、401 鉴权失败不误报离线 vs 断线离线横幅 |
| `workbench` | F2/F15 agent 卡片、活动流、待审批 | 批准 / 拒绝 / 查看 / 新建会话 | 空态、5xx banner |
| `threads` | F3 列表、新建、@提及、SSE 增量、批量删除、清空消息、返回链接 | 创建 / 发送 / 全选删除 / 清空 / 返回 | 取消二次确认不发请求、列表 5xx、`thread_not_found` |
| `tasks` | F4 状态筛选、追踪 / spans / artifacts、清理全部、resume / cancel | 筛选、`{deleted,kept}` 横幅、取消、恢复 | 旧服务端 405 → `feature_unavailable`、未找到任务 |
| `org-channels` | F6/F16 资源新建、通道增删改开关、投递回执重试 | 新建资源 / 通道 / 切换 / 重试 | 资源 5xx、`delivery_not_retryable` 409 |
| `connectors` | F7/F19 策略确认、动作目录、执行、审批队列 | 原生 confirm、一次一取、执行 park、批准 | 目录读取失败、审批 409、队列 5xx 带重试入口 |
| `computers-schedules` | F11/F13/F17/F18 沙盒水位、试跑、终止、调度四区块、kick / 策略 | 刷新 / 新建 / 试跑 / 终止 / 建目标 / 立即运行 | `sbOffTitle` / `routerOff` 功能关闭态、5xx |
| `persona-knowledge-files` | F8/F10/F14/F19 人格、知识只读、共享文件、语音降级 | 编辑保存、筛选、上传下载删除 | 保存失败、`files_disabled`、16 MiB 音频 / 文件超限 |
| `settings-i18n-theme` | 设置页、13 语 + en 兜底、明暗令牌、RTL、通知设置、无障碍、更新状态 | `<html lang\|dir>`、成对令牌全灰、触控目标 ≥44px、焦点环、reduced-motion 规则 | 升级端点不可用降级 |
| `shell-http` | 代理准入、四前缀回源、SPA 回退、安全头、`/__shell/*` | bootstrap Cookie、配置读写、badge clamp 999、通知 / 执行器 / 升级端点 | 无 token 401、foreign Origin 403、`invalid_count` / `invalid_json` / `disabled` |
| `native-behaviors` | 隔离目录、单实例唤回、后台驻留、托盘角标、深链、更新状态 | 二次启动退出码 0 且不开新代理、握手 `ok` | 错误 token 返回 `no`、恶意 `link` 不导航 |

**定位方式**：`driver/selectors.mjs` 直接读取 `web/src/lib/copy/*-copy.js`，按当前语言
解析按钮 / 标签文案，因此 13 语与 `ar` RTL 共用一套用例，模板里不硬编码自然语言。
二次确认统一走 `BaseDialog` 页脚作用域，避免误点背景页同文案按钮。

**WebDriver 看不到的语义**（OS toast 点击、`is_in_app_path` 的字符黑名单、
一次点击只消费一个深链、13 语托盘角标文案、semver 跳过）由
`desktop/src-tauri/src/{notify,tray,single,upgrade}/*.rs` 里既有的 `#[cfg(test)]`
纯函数用例覆盖；本套件负责把这些行为在真实进程上的可观察部分（HTTP 应答、
hash 不变、进程退出码、角标数值）钉住。

## 双模式差异

- stub 模式：每条用例前重置 fixtures 与故障表，但**保留会话**，避免把 WebView 踢回登录页。
  `/__e2e/*` 控制面可注入 401/403/405/503 `feature_off`/500/超时/断线/空态/慢速 SSE，并推送 SSE 帧。
  故障只影响**下一次**请求：注入后必须用 `remount()`（先离开路由再回来）触发组件重新挂载，
  否则同一个 hash 不会产生 `hashchange`，旧视图不会重新请求。
  功能关闭态要求 `code=feature_unavailable`（503），`unavailable` 只表示旧服务端缺路由（405）。
- live 模式：不启动 stub，连接页直接填 `E2E_SERVER_URL`；故障注入、SSE 推送、
  固定 fixtures 相关断言自动跳过；破坏性操作需 `E2E_LIVE_ALLOW_DESTRUCTIVE=1`
  且必须使用隔离账号，避免污染真实 PostgreSQL。

## 产物

`desktop/e2e/artifacts/`（已 gitignore）：

- `run.json` — 本次运行状态、`backend`、代理 origin、每项前置检查结果、skip 原因
- `session.json` — 供各 spec 重连同一 WebDriver 会话的 URL / sessionId
- `events.jsonl` — 每个用户步骤的成功 / 失败审计
- `requests.jsonl` — stub 收到的请求，仅 `method/path/query/status/at`；Cookie、
  Authorization、密码、邮箱一律脱敏
- `failure-*.png` — **仅失败时**落盘的 WebView 截图

## 验收

1. `make e2e-contract` 在任何机器上全绿（8 条契约用例真实执行）。
2. Linux CI 的 `e2e` job 全量 115 条通过，`run.json` 的 `status` 为 `finished`。
3. `make e2e-live` 在配置好隔离账号与真实 agenthub 后，同一套用例除显式 skip 外通过。
4. `make test`、`cd web && bun run test:coverage`、`cd desktop && bun run test:coverage`
   全部保持原状（语句 / 行 / 分支 / 函数 100%）。
