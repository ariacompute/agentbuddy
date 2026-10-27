# agentbuddy 需求说明书

> 行为契约。改代码必须同步本文件、`README.md`（人读手册）与 `task.md`（实施记录）；
> 只改代码不改文档视为未完成。

## 1. 定位与边界

`agentbuddy` 是 **桌面客户端**（Tauri v2 外壳 + Vue 3 工作台），**自身无后端**：所有状态、执行、
编排、通道接入与语音处理都在 `agenthub` 服务端。客户端负责触达与 UI。

- ✅ 做：统一 Agent 工作台、多智能体协作会话、任务与产物追踪、HITL 审批、后台常驻与系统通知、
  多通道触达、外部应用连接器（动作审批网关）、语音交互、13 语与单色视觉。
- ❌ 不做：自研 agent 运行时（BYO agent 由 agenthub registry 承担）、真实计费（预算为派生估算，
  标 `TODO(real)`）、IM 之外的第三方渠道、真实 STT/TTS 与真实通道平台对接（首版为确定性 mock
  适配器，边界以 `TODO(real)` 标注）。

### 1.1 依赖的服务端

- **现有**：`/api/auth/*`、`/api/resources*`、`/api/tasks*`、`/api/threads*`、`/api/workspace`、
  `/api/export/*`、`/a2a`、`/healthz`、`/.well-known/agent.json`。
- **本轮新增**（见 §4）：`/api/channels*`、`/api/connectors*`、`POST /api/threads/{id}/audio`，
  以及 `registry.Entry.persona` 字段。

## 2. 功能需求

### F1 连接与身份

| 编号 | 需求 |
|---|---|
| F1.1 | 桌面壳内置连接页：服务端地址、忽略自签名证书开关、语言（13 语）、连接测试 |
| F1.2 | 连接测试探测 `{base}/healthz`，15s 超时，失败返回 `empty/invalid/timeout/certificate/unreachable/unexpected` |
| F1.3 | 登录/注册/OAuth（提供方由 `GET /api/auth/config` 决定，无凭据的提供方不渲染） |
| F1.4 | 会话为 agenthub 的 HttpOnly Cookie；前端所有请求 `credentials: 'include'` |
| F1.5 | 路由守卫：`/login` 之外均需登录；权限不足转 `/workspace` |

### F2 Agent 工作台

| 编号 | 需求 |
|---|---|
| F2.1 | `GET /api/workspace` → agent 卡片（形象头像、显示名、头衔、健康态）+ 最近活动流 |
| F2.2 | 待审批分组：`state == input-required` 的任务单独成组，提供「批准 / 拒绝 / 查看」 |
| F2.3 | 连接与健康 chip：`/healthz` 的 `status` / `auth` / `database` |

### F3 协作会话 Threads

| 编号 | 需求 |
|---|---|
| F3.1 | 会话列表 / 新建 / 详情（消息 + 参与者） |
| F3.2 | 输入框支持 `@mention` 委派；`@` 触发候选 agent 列表 |
| F3.3 | 实时：打开会话时保持 `GET /api/threads/{id}/events` 长连接，增量追加 |
| F3.4 | 消息来源标记：`origin` ∈ 空（文本）/ `voice` / 通道类型，以文本标签呈现 |
| F3.5 | 右侧任务面板：本会话关联的 A2A 任务，可展开状态 / 产物 / 追踪 |

### F4 任务与产物追踪

| 编号 | 需求 |
|---|---|
| F4.1 | 状态机 `submitted / working / input-required / completed / failed / canceled / unknown`，以文本标签 + 灰度阶梯呈现 |
| F4.2 | spans 分层列表（名称、耗时、状态）；artifacts 卡片（文本直展、文件显示大小、音频内联播放） |
| F4.3 | `input-required` 时提供审批输入与 `POST /api/tasks/{id}/resume`；取消走 `POST /api/tasks/{id}/cancel` |
| F4.4 | 危险操作二次确认 |

### F5 后台常驻与通知（Muse/dots 对齐项）

| 编号 | 需求 |
|---|---|
| F5.1 | 关闭窗口 = 最小化到托盘（保留环回代理与事件循环）；**仅托盘「退出」** 终止进程 |
| F5.2 | 事件聚合：轮询 `/api/workspace` + `/api/tasks`（可见 5s / 隐藏 20s / 失败指数退避 5s→30s）+ 对非终态任务按需开 per-task SSE（**并发上限 6**，LRU 淘汰） |
| F5.3 | 通知去重纯函数 `decide()`：幂等键 `taskID:state`（1h 窗口，与 `HTTPNotifier` 对齐）、同键 30s 静默、每分钟 >8 条合并为摘要、静默期内只入站内中心 |
| F5.4 | 系统通知经环回端点 `POST /__shell/notify`；未获权限 `ok:false` 时降级为应用内红点 |
| F5.5 | 托盘角标显示未读计数，点击通知深链到对应会话 / 任务 |
| F5.6 | 断线重放：`?since=<seq>`；SSE 无 `[DONE]` 哨兵，终态由状态判定 |

### F6 多通道触达

| 编号 | 需求 |
|---|---|
| F6.1 | 通道类型：`slack` / `teams` / `telegram`（入站 webhook + 出站回复）、`sms`（仅出站） |
| F6.2 | 客户端：通道列表、新建/编辑、启用开关、绑定线程与参与者、投递回执列表（方向/状态/错误码） |
| F6.3 | 服务端入站：`POST /api/channels/{id}/webhook` 为 **public**，靠平台签名校验 |
| F6.4 | Slack：`X-Slack-Signature` = HMAC-SHA256(`v0:{ts}:{body}`)，5 分钟重放窗；Teams：HMAC；Telegram：`X-Telegram-Bot-Api-Secret-Token`。一律 `hmac.Equal` 常量时间比较 |
| F6.5 | `external_ref` 唯一键幂等去重；复用既有 `RateLimit` |
| F6.6 | 入站消息 → `thread_messages`（带 `origin`）→ 按绑定参与者 `Hub.Send` 委派 → 回复回投通道 |
| F6.7 | 出站失败只落 `channel_messages` 状态供 UI 重试，**绝不改变任务状态**；全仓无重试循环 |

### F7 外部应用连接器

| 编号 | 需求 |
|---|---|
| F7.1 | 连接器即 `kind=mcp` 的 registry 资源，**不新建表** |
| F7.2 | 动作策略 `allowed` / `ask` / `off`，默认 `off`；策略持久化在资源上（jsonb，无迁移） |
| F7.3 | `POST /api/connectors/{id}/actions` 执行动作；`ask` 时任务 park 到 `input-required`，客户端审批后 `resume` |
| F7.4 | **二次 park 防护**：resume 后不得再次 park（服务端注入已批准标记，透传到 `InvokeRequest.Metadata`） |
| F7.5 | 客户端：连接器列表、能力与健康、策略切换（需确认）、待审批动作队列 |

### F8 语音交互

| 编号 | 需求 |
|---|---|
| F8.1 | 客户端 `MediaRecorder` 采集 → `POST /api/threads/{id}/audio`（multipart，字段名 `audio`） |
| F8.2 | 服务端：STT → transcript 落 `thread_messages`（`origin='voice'`）→ 委派 → TTS 音频作为 artifact |
| F8.3 | 上传上限 16 MiB（`MaxBytesReader` + `multipart.MaxMemory` 8 MiB），超限 `audio_too_large` |
| F8.4 | 首版为确定性 mock STT/TTS（离线、无网络、无子进程），真实对接标 `TODO(real)` |
| F8.5 | 音频 artifact 用 `FileContent.Bytes`（base64 内联）；真实接入改 `URI` |
| F8.6 | 降级：`getUserMedia` 不可用或拒绝 → 隐藏录音按钮、保留文本输入，UI 明示（不报错） |

### F9 只读洞察

| 编号 | 需求 |
|---|---|
| F9.1 | 组织图：`/api/resources` 按 kind 分组，灰度阶梯 + 文本标签区分状态与健康（禁止仅靠颜色） |
| F9.2 | 技能册：`kind=skill` + capabilities |
| F9.3 | 预算：由 `/api/tasks` 派生（任务数、状态分布、产物字节、span 时长），固定展示「派生估算，非真实计费」 |

## 3. 非功能需求

| 编号 | 需求 |
|---|---|
| N1 | **单色**：UI 只落在 `#000000 ↔ #FFFFFF` 明度轴，零色相；`web/tests/style.spec.js` 强制（hex 三通道相等 / hsl 中性 / 色相词黑名单） |
| N2 | **13 语**：`en zh zh-TW es fr de it ru ja ko pt ar hi`；前端 copy 表 + Rust 外壳 `copy.rs` 双向齐全；`copy-fallback.spec.js` 强制每语言每 key 已译且不等于英文 |
| N3 | **RTL**：仅 `ar`；布局一律逻辑属性（`margin-inline` / `inset-inline`） |
| N4 | **错误只传机器码**：store 只存 `error.code`，文案全部本地化 |
| N5 | **无障碍**：触控目标 ≥44px；焦点环 2px + 2px offset；`prefers-reduced-motion: reduce` 下禁全部动效 |
| N6 | **SSE 真流式**：环回代理 `Body::from_stream`，强制 `accept-encoding: identity`，禁整体超时 |
| N7 | 三平台：Linux（deb/appimage）、macOS（dmg+app，aarch64）、Windows（msi） |

## 4. 服务端契约（本轮新增）

### 4.1 端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/channels` | `tasks:read` | 通道列表 |
| POST | `/api/channels` | `tasks:write` | 新建通道 |
| PUT | `/api/channels/{id}` | `tasks:write` | 编辑（名称、启用、绑定线程、参与者、签名密钥环境变量名） |
| DELETE | `/api/channels/{id}` | `tasks:write` | 删除 |
| POST | `/api/channels/{id}/webhook` | **public** | 平台入站，签名校验 |
| GET | `/api/channels/{id}/deliveries` | `tasks:read` | 投递回执 |
| GET | `/api/connectors` | `resources:read` | `kind=mcp` 资源 + 策略 |
| PUT | `/api/connectors/{id}/policy` | `resources:write` | 设置 `allowed`/`ask`/`off` |
| GET | `/api/connectors/{id}/actions` | `resources:read` | 动作历史 |
| POST | `/api/connectors/{id}/actions` | `resources:write` | 执行动作（ask → park） |
| POST | `/api/threads/{id}/audio` | `tasks:write` | 语音上传（multipart） |

> **不新增权限码**：全部复用 `tasks:read` / `tasks:write` / `resources:read` / `resources:write`，
> 避免「新权限需同步 `authz.AllPermissions` + 前端 `PERMISSIONS` + `enums-copy` 13 语」的连锁改动。

### 4.2 新增机器码

`channel_disabled`、`channel_not_found`、`channel_signature_missing`、`channel_signature_invalid`、
`channel_timestamp_expired`、`channel_payload_invalid`、`delivery_failed`、`connector_not_found`、
`connector_action_denied`、`connector_policy_off`、`audio_too_large`、`audio_unsupported`、
`audio_transcribe_failed`、`speech_disabled`。

登记三处：`internal/httputil/json.go` 的 `Code*` 常量、agentbuddy `web/src/lib/errors.js` 的
`CODE_KEYS`、`web/src/lib/copy/errors-copy.js` 的 13 语。

### 4.3 新增迁移（agenthub，幂等）

| 文件 | 内容 |
|---|---|
| `013_persona.sql` | `ALTER TABLE resources ADD COLUMN IF NOT EXISTS persona JSONB;` |
| `014_channels.sql` | `channels` + `channel_messages`（`external_ref` 唯一键） |
| `015_thread_origin.sql` | `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT '';` |

## 5. 异常与降级

| 场景 | 行为 |
|---|---|
| 服务端不可达 | 轮询指数退避 5s→30s，UI 置 offline chip，保留上次成功数据 |
| SSE 断连 | 以最后一次 `seq` 重连 `?since=`，回放后接实时 |
| 系统通知未授权 | `ok:false` → 降级为应用内红点，不重复弹权限 |
| 麦克风不可用/拒绝 | 隐藏录音按钮，保留文本输入，UI 明示模式 |
| 通道签名校验失败 | 401 + `channel_signature_invalid`，记 `channel_messages` 失败行 |
| 语音超限/格式不支持 | 413 `audio_too_large` / 415 `audio_unsupported` |
| 连接器策略 `off` | 403 `connector_policy_off`，动作不执行 |
| 控制台 bundle 缺失 | 外壳显示 `consoleMissing`（不白屏） |

## 6. 验收标准

1. `cd web && bun run test` 全绿（含 `style.spec.js` 单色守卫、`copy-fallback.spec.js` 13 语完整性）。
2. `cd web && bun run build` 产出 `web/dist/index.html`。
3. `cd desktop/src-tauri && cargo test` 全绿；`cargo check --all-targets` 通过。
4. agenthub：`go build ./... && go vet ./... && go test -race ./...` 全绿，其中
   `TestEmbeddedMigrationsAreOrderedAndIdempotent` 与 `TestListenersCoverRoutes` 通过。
5. 关闭窗口 → 最小化到托盘，SSE 可重连；托盘「退出」→ 进程终止。
6. 任务完成后收到系统通知（或降级红点），点击深链到对应任务。
7. 语音：录音 → 上传 → transcript 入会话 → agent 回复 → TTS 音频可回放。
8. 连接器 `ask` 策略：动作 park 到 `input-required`，审批后 resume 且**不二次 park**。
9. 通道：伪造签名的 webhook 被拒（401 + `channel_signature_invalid`），合法签名生成 thread 消息。
10. 三平台 CI 产出 deb / dmg / msi 与 SHA256SUMS。
