# agentbuddy 需求说明书

> 行为契约。改代码必须同步本文件、`README.md`（人读手册）与 `task.md`（实施记录）；
> 只改代码不改文档视为未完成。

## 1. 定位与边界

`agentbuddy` 是 **原生桌面客户端**（.NET 10 + Avalonia 11 XAML 界面 + 进程内 Kestrel 环回网关），
**自身无后端、无 WebView、无内嵌网页包**：原生 ViewModel 用 `HttpClient` 访问环回网关，
网关把 `/api`、`/a2a`、`/healthz`、`/.well-known` 转发到 `agenthub`。所有状态、执行、
编排、通道接入与语音处理都在服务端，客户端负责触达与 UI。

- ✅ 做：统一 Agent 工作台、多智能体协作会话、任务与产物追踪、HITL 审批、后台常驻与系统通知、
  多通道触达、外部应用连接器（动作审批网关）、语音交互、13 语与单色视觉。
- ❌ 不做：自研 agent 运行时（BYO agent 由 agenthub registry 承担）、真实计费（预算为派生估算，
  标 `TODO(real)`）、IM 之外的第三方渠道、真实 STT/TTS 与真实通道平台对接（首版为确定性 mock
  适配器，边界以 `TODO(real)` 标注）。

### 1.1 依赖的服务端

- **现有**：`/api/auth/*`、`/api/resources*`、`/api/tasks*`、`/api/threads*`、`/api/workspace`、
  `/api/export/*`、`/a2a`、`/healthz`、`/.well-known/agent.json`。
- **上一轮已落地**（供参照）：`/api/channels*`、`/api/connectors*`、`POST /api/threads/{id}/audio`，
  以及 `registry.Entry.persona` 列（`013_persona.sql`）。
- **本轮（F10–F16）新增**（见 §4）：`/api/computers*`（Agent 计算机，F11）、`/api/schedules*`（目标调度，F13），
  并扩展 `registry.Entry.persona` 角色字段（F10）；新增 `computers` / `schedules` / `knowledge` 表（`017`–`019`）。
- **本轮（调度器）新增**：`POST /api/schedules/{id}/run` 与 `/api/router/*`（13 个端点，见 §4.1），
  对应 agenthub 迁移 `020_router.sql`（8 张表）；服务端开关 `AGENTHUB_ROUTER_ENABLED` 关闭时全部 503
  `feature_unavailable`，前端按「调度器已关闭」降级。
- **本轮（执行沙盒）新增**：`/api/sandboxes*`、`/api/sandbox-providers*`、`/api/sandbox-nodes*`
  （15 个端点，见 §4.1，F17），对应迁移 `021_sandboxes.sql`；控制面未接线时全部 503
  `feature_unavailable`，控制台整屏降级为「沙盒已关闭」。
- **本轮（外壳安全）新增**：外壳自有的 `/__shell/bootstrap?nonce=…`（唯一免 token 的入口）与
  `/__shell/hide`，以及 Cookie 准入、CSP nonce、系统凭据库会话（F18）；它们不经环回代理转发到上游。

## 2. 功能需求

### F1 连接与身份

| 编号 | 需求 |
|---|---|
| F1.1 | 桌面壳内置连接页：服务端地址、忽略自签名证书开关、语言（13 语）、连接测试 |
| F1.2 | 连接测试探测 `{base}/healthz`，15s 超时，失败返回 `empty/invalid/timeout/certificate/unreachable/unexpected` |
| F1.3 | 登录/注册/OAuth（提供方由 `GET /api/auth/config` 决定，无凭据的提供方不渲染） |
| F1.4 | 会话为 agenthub 的 HttpOnly Cookie；前端所有请求 `credentials: 'include'` |
| F1.5 | 路由守卫：`/login` 之外均需登录，未登录带 `?next=` 回跳；**不做权限重定向**——权限由服务端 403 表达，前端就地提示。工作台路由是 `/`，没有 `/workspace` |
| F1.6 | 登录页右上角提供「语言切换」与「light/dark 主题切换」；二者复用 `LanguageSwitcher` / `ThemeToggle`（与 `Topbar` 同一套组件），主题经 `agentbuddy.theme` localStorage 持久、语言经 `agentbuddy.lang` 持久并镜像到 `<html lang|dir>` |
| F1.7 | 会话跨应用重启保持：环回代理把上游 session cookie 存进**系统凭据库**（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service），按 `server` 归属，并在启动/切换服务端时还原进代理的 `reqwest::Jar`；无可用凭据库时回退为仅属主可读的 `session.json` 并告警；首次读取时把旧的明文会话迁入凭据库再删除明文；登出或 cookie 过期时清除副本。`/__shell/config` 的 `sessionBackend`（`keyring` / `file` / `memory`）供设置页显示 |

### F2 Agent 工作台

| 编号 | 需求 |
|---|---|
| F2.1 | `GET /api/workspace` → agent 卡片（形象头像、显示名、头衔、健康态）+ 最近活动流 |
| F2.2 | 待审批分组：`state == input-required` 的任务单独成组，提供「批准 / 拒绝 / 查看」 |
| F2.3 | 连接与健康 chip 读 `/healthz` 的 `status` / `auth`（`session` \| `anonymous` \| `disabled`）/ `database`；设置页另显示服务端 `version` 与 `commit` |

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
| F5.1 | 关闭窗口 = 最小化到托盘（保留环回网关、轮询与 SSE 订阅）；**仅托盘「退出」** 终止进程 |
| F5.2 | 事件聚合：`MonitorService` 轮询 `/api/workspace` + `/api/tasks`（窗口可见 5s / 隐藏 20s / 失败指数退避 5s→30s）；`RealtimeService` 常开订阅线程 / 任务 / 沙盒 / 路由四路 SSE，按事件名分类、记录 `since` 游标，事件突发时以 1s 节流触发一次聚合刷新，避免 N+1 请求 |
| F5.3 | 通知去重纯函数 `NotificationDecider`：幂等键 `taskID:state`（1h 窗口）、同键 30s 静默、每分钟 >8 条合并为摘要、静默期内只入站内通知中心 |
| F5.4 | 系统通知**真实投递**：`NotificationDecider` 判定需要打扰后，工作台经 `POST /__shell/notify` 发一条本地化标题 + 摘要 + 深链（`title` 在发送时用当前语言解析，不是 copy key）。外壳的 `notify_enabled` 与 `notify_quiet_minutes` 由 `ShellControlClient` 读 `/__shell/config` 后喂给决策函数，因此设置页的「通知开关」与「静默期」真的生效。投递为 fire-and-forget：`ok:false`（`disabled` / `quiet` / `no_app` / `denied` / `missing_fields`）是正常回应，降级为应用内红点，不报错、不重试、不阻塞轮询；任何异常都被捕获，绝不产生未观察异常 |
| F5.5 | **托盘角标**：工作台在未读数变化时经 `ShellControlClient.SetBadgeAsync` → `POST /__shell/badge` 推送，fire-and-forget 且吞掉异常。外壳把计数 clamp 到 `999`；tooltip 全平台可见，托盘标题在不支持该能力的平台静默失败，>99 显示 `99+`。**计数留在进程里**，语言切换重建菜单后重新套用，角标不丢；文案是 `TrayService.BadgeText(lang, count)` 纯函数（13 语 `trayUnread`） |
| F5.6 | **toast 深链**：`link` 是站内路径，`DeepLinkQueue` 入队后于用户点击通知时取用，恢复窗口并交给 `NavigationService.NavigateAsync` 完成一次真实路由跳转。只接受单斜杠开头且拒绝 `//host` / `javascript:` / 反斜杠 / 控制字符；路径不经任何 `eval` 或字符串求值；一次点击只消费一次 |
| F5.7 | 静默期以**调用时刻**为锚：`quietUntil = now + minutes*60`，读取与保存都一样；不得以「首次读取设置的时间」为锚（否则长时间开着的窗口算出已过去的窗口，静默形同虚设） |
| F5.8 | 断线重放：`?since=<seq>`；SSE 无 `[DONE]` 哨兵，终态由状态判定；常开连接无整体超时，仅 10s 连接超时 |

### F6 多通道触达

| 编号 | 需求 |
|---|---|
| F6.1 | 通道类型：`slack` / `teams` / `telegram`（入站 webhook + 出站回复）、`sms`（仅出站） |
| F6.2 | 客户端：通道列表、新建/编辑、启用开关、绑定线程与参与者、投递回执列表（方向/状态/错误码）；**出站失败也落一条 `failed` 回执并保留原文**，未送达的回执带「重试」按钮（`POST /api/channels/{id}/deliveries/{did}/retry`，重试成功即原地翻成 `delivered`，不新增回执行），已送达/入站/无原文的不给重试入口（服务端 409），删除/重试失败用本地化文案内联提示而非静默吞错 |
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
| F7.6 | **已落地**：连接器页可按需展开某连接器声明的动作（`getConnectorActions(id)`）——一次展开一次请求，再点折叠不重取；失败显示原因，不画成「没有动作」 |

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

## 2B. 融合标杆项目的扩展特性（F10–F18）

> 下列特性提取自 OpenDots / openmuse / openbot / Octop / openagents / Velozity 六个项目的可借鉴能力，
> agentbuddy 作为纯桌面客户端，agenthub 作为唯一服务端（执行/编排/通道/语音）。真实第三方对接首版为
> 确定性 mock，边界一律标 `TODO(real)`；不新增权限码，全部复用 `tasks:*` / `resources:*`。

### F10 Agent 角色与人格（Persona / MBTI）

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F10.1 | 新增「新建/编辑 Agent」流程：名称、显示名、头衔、角色指令（system prompt）、MBTI 人格模板（16 型 + 互动测验）、头像 | OpenDots Dots、Octop 专家 + MBTI、Velozity AI Workforce |
| F10.2 | 角色数据持久化于 `registry.Entry.persona`（013 已加 `persona JSONB` 列），结构为 `{role, instruction, mbti, avatar_ref, title}`，服务端 `normalizePersona` 统一 trim、长度截断、MBTI 只接受 16 型（不合规一律清空，不猜）；编辑表单五个字段全部可往返保存（`role` 曾在界面上缺席，导致保存时被覆盖为空，已补回） | — |
| F10.3 | 客户端经 `POST/PUT /api/resources` 写入/更新角色字段；列表经 `GET /api/resources` 按 `kind` 分组展示 | — |
| F10.4 | 工作台（F2）与 Threads（F3）按 persona 渲染 Agent 头像/头衔/人格标签，单色下以文本标签区分 | — |

### F11 Agent 计算机 / Computer Use

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F11.1 | 新增「Agent 计算机」视图：共享浏览器、Shell 终端、屏幕镜像三类面板 | OpenDots Dot Computers、openmuse Agent Computer、openbot Computer Use、Octop Browser AI+ / 远程桌面 |
| F11.2 | 服务端经 adapter 承接：复用 `kind=cli`（Shell）/ `kind=mcp`（浏览器自动化），或新增 `/api/computers`（见 §4.1） | — |
| F11.3 | **已落地（F17）**：computers 卡片创建时向服务端申请**真实执行环境租约**（回写 `provider` / `leaseId` / `nodeId` / `expiresAt`），删除先终止租约；浏览器自动化本身由服务端提供方承担，客户端只渲染、不引入子进程 | openbot `cua-driver`、Octop CDP 远程桌面 |
| F11.4 | 人工接管：首版提供「接管」开关（仅 UI 态，不改变执行归属），真实接管待 `TODO(real)`——服务端尚未提供接管通道 | openmuse takeover console、OpenDots 人工接管 |
| F11.5 | **已落地**：计算机卡片区（`listComputers()`）与租约区并列——卡片显示类型/状态/绑定的 agent id/最近动作；删除前先 `getComputer(id)` 复核（列表可能已过期，避免误删刚被重新挂上的卡片），确认后 `deleteComputer(id)` 并重读列表；列表 503 说「已关闭」，其他错误内联显示原因 | — |

### F12 Agent 间协作与共享空间

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F12.1 | 增强 F3 Threads：同一会话内 Agent 可见彼此消息并协作；`@mention` 显式派活（F3.2 已有）或 Agent 按 `input-required` 自主认领 | openagents Workspace、openbot Shared Channels |
| F12.2 | 共享文件：会话内上传/下载代码、文档、产物，落 `thread_assets`（复用 artifacts 机制） | openagents 共享文件 |
| F12.3 | 共享浏览器动作可见：Agent 的计算机操作（F11）以消息类型回显于会话，全员可读 | openagents 共享浏览器 |
| F12.4 | Agent-to-Agent 消息：消息 `origin` 扩展为含 `agent:<id>` 来源标记（`thread_messages.origin` 015 已加列） | openbot Agent-to-Agent |

### F13 目标与主动调度

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F13.1 | 新增「目标 / 周期任务」：目标描述 + 触发器（自然语言或斜杠命令）+ 周期（cron 表达式或间隔） | openmuse Goals、Octop Cron、OpenDots 后台回合、openbot Routines |
| F13.2 | 服务端复用 hub task 状态机推进；调度元数据落 `schedules` 表（见 §4.3 `018_schedules.sql`） | — |
| F13.3 | **已落地**：调度器为「Router 层 + Worker 层」双层结构。cron 到期 / 会话消息 / 渠道 webhook / 手动注入统一入 Trigger 队列并按去重键幂等；程序层规则（来源模式 `off\|candidate\|request_only`、发起者白名单、@提及、关键词、静默时段）先筛，候选再一拍批量一次语义判定（模型不可用时逐条回退规则，绝不放行）；通过的生成 Ticket 交 Worker 执行，复用 hub 任务状态机（`input-required` 即人工介入） | Octop APScheduler、dsh superagent router |
| F13.4 | 主动推送：触发后生成会话消息/任务并走 F5 通知；失败按退避重试（默认 3 次，槽位上限 8） | openmuse 退避告警、Octop 主动推送 |
| F13.5 | **已落地**：订阅直通——Ticket 与 Thread 多对多订阅，同一 Thread 后续事件直接扇出到已订阅 Worker（人类消息优先），支持退订、交回 Router（每条触发仅一次）、Ticket 结束时未读事件回流判定 | dsh superagent router |
| F13.6 | **已落地**：控制台可视化——目标页显示「下次到期倒计时 / 该目标运行历史 / 最近触发流与队列水位」，标注判定结果并可跳转任务，提供立即运行、推进一拍、取消/交回操作；调度事件经 SSE 实时跟随并支持 `since` 回放 | Studio 试跑、observability 分层 |
| F13.7 | **已落地**：控制台消费全部调度端点——`listRouterPolicies` 渲染来源模式/白名单/关键词并由 `saveRouterPolicy(source, patch)` 回写（来源在路径里，正文只承载可编辑的那一半）；触发行 `getRouterTrigger`、工单行 `getRouterTicket` 按需取详情，再点折叠；`subscribeRouterEvents(0, …)` 的帧去抖合并成一次重载；线程侧 `dropRouterSubscription(threadId)` 退订，`not_found` 视为已达目的 | — |

### F14 技能与知识库

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F14.1 | `kind=skill` 资源扩展：版本号、是否共享、依赖；客户端经 `GET/PUT /api/resources` 管理 | openbot Local Skills、Octop 自我进化 |
| F14.2 | 技能自动蒸馏（规划）：将完成任务对话蒸馏为可复用技能，**首版仅记录触发点**，真实蒸馏标 `TODO(real)` | Octop 自我进化、openbot 自动蒸馏 |
| F14.3 | per-agent 知识库（Company Brain）：`knowledge` 表存储向量/文本切片，检索经 mock RAG 返回确定性片段；真实嵌入/检索标 `TODO(real)` | Octop Company Brain、Velozity Company Brain |
| F14.4 | 知识库与 persona 绑定（F10.2），在 Threads 委派时作为上下文注入 | — |
| F14.5 | **已落地**：独立知识库屏（`/knowledge`，侧栏有入口）——按 agent 过滤 `listKnowledge(agentId?)`，只读列出片段正文与来源引用；`feature_unavailable` 显示「该服务端功能已关闭」而不是空列表，其他错误显示原因 | — |

### F15 建议与富结果

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F15.1 | 富结果卡片：消息/产物以结构化卡片渲染（文本/文件/音频/浏览器截图/表单），复用 F4.2 artifacts 卡片 | OpenDots CopilotKit Cards、openmuse 内联卡片 |
| F15.2 | 主动建议（Ideas）：基于会话上下文生成带**来源证据**的建议，用户可编辑/接受/驳回 | openmuse Ideas |
| F15.3 | 建议以普通会话消息形态呈现（单色、文本标签），不引入额外浮层；证据以引用块展示 | — |

### F16 多用户 / 团队与云协作（服务端能力，客户端仅消费）

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F16.1 | 多用户/团队：由 agenthub 服务端提供账号与隔离（会话 Cookie + RBAC 权限矩阵，共享 admin token 已移除），agentbuddy 客户端**不内置账号体系**，仅消费 `GET /api/auth/me` 与权限 | Octop 多用户、云协作 |
| F16.2 | 云协作 / 实例互联：由 agenthub 服务端承担，客户端经既有 `/api` 端点读取跨实例专家/会话，不在客户端实现联邦 | openagents Network、Octop 云协作 |
| F16.3 | 客户端职责限定为：按服务端返回的可见资源渲染，不缓存跨用户状态 | — |

### F17 执行环境沙盒与执行节点

大脑（agenthub 控制面）与双手（执行环境）分离后，agentbuddy 承担两件事：把执行环境**看清楚**，
并可选地把自己变成一台**执行节点**（BYOM）。两类能力默认不产生任何特权。

| 编号 | 需求 | 借鉴来源 |
|---|---|---|
| F17.1 | 「计算机」屏升级为**执行环境控制台**：页头节点胶囊 + 刷新；节点状态条（在线/离线/未启用 + 最后心跳 + 前往设置）；五指标水位条（活跃租约/待执行/在线节点/最近执行/上次清扫） | router 控制台同款 |
| F17.2 | **沙盒类型目录**按隔离层分组横向排布（容器 / 用户态内核 / microVM / 进程沙盒 / 平台层 / 远端节点 / off），每项显示隔离强度与可用性徽标；不可用项给原因且保持可读对比度 | E2B、microsandbox、Daytona、CubeSandbox、OpenHands 对比 |
| F17.3 | **租约卡片网格**：类型、状态胶囊、租约 id、所属 agent、作用域、执行后端、到期倒计时（≤3 分钟加粗而非变色）、执行次数；底部 44px 三操作：试跑 / 续租 / 终止（终止需二次确认） | — |
| F17.4 | **审计抽屉**：右侧滑出，顶部租约 id，表格列命令摘要 / 退出码 / 耗时 / 时间 / `dry_run` 标记，失败行左缘 2px 实心竖条；抽屉内可直接试跑一条命令并就地看回执 | — |
| F17.5 | **未接线语义**：服务端无控制面时整屏显示「沙盒已关闭」+ 一句如何开启，不渲染零值水位条、不显示错误横幅 | `feature_unavailable` |
| F17.6 | **执行节点**（可选，**默认关闭**）：设置页开关 + 风险说明 + 确认；工作根目录（绝对路径）、命令白名单（逐行、精确匹配、禁 shell 与启动器、条目只能是裸命令名）、并发上限、节点 id（只读）、可选 API key、在线状态与最近拒绝原因 | BYOM |
| F17.7 | 节点只在**本地 .NET 进程**执行：不经 shell、只跑白名单精确命令、只允许根目录内路径（含符号链接解析后仍须在根内、文件系统根永不可用）、超时**终止整棵进程组**、输出边读边截断（内存有界）；Avalonia 视图**不获得**任何文件系统或命令执行能力（窗口能力以委托注入，ViewModel 保持 Headless 可测）。进程组语义仅 unix 具备（负 pgid TERM → 250ms 宽限 → KILL → `wait()` 收尸）；Windows 没有等价原语，如实退回直接子进程终止并在代码与文档中明确标注，而不是假装已清场 | — |
| F17.8 | 节点生命周期：开启后注册 → 心跳 → 长轮询领任务 → 执行 → 回传；退出即停止，重启自动重新上线；间歇在线不算故障，服务端据此显示离线 | — |
| F17.9 | 客户端不自建沙盒、不做类型探测：目录、可用性与原因全部来自服务端，客户端只渲染 | 单一事实来源 |

### F18 环回代理准入与内容安全

环回代理监听 `127.0.0.1`，本机任何进程都能访问；没有准入时
`http://127.0.0.1:<port>/api/...` 就是一条免认证、通往用户 agenthub 会话的通道。F18 把
「只有本窗口能用」变成可验证的边界，并让会话令牌离开明文文件。

| 编号 | 需求 |
|---|---|
| F18.1 | 每次启动生成 256 位 token 与一个**一次性** nonce（TTL 60s）；窗口打开 `/__shell/bootstrap?nonce=…` 兑换 `ab_proxy` Cookie（`HttpOnly; SameSite=Strict; Path=/`）后 `303` 落到 `/`。token 只存在于网关内存与 Cookie，绝不进入 UI 代码、绝不转发上游 |
| F18.2 | 除 bootstrap 外的所有路由（`/api`、`/a2a`、`/__shell/*`）都要求该 Cookie，原生客户端可用 `Authorization: Bearer`；外来 `Origin` 在任何鉴权之前以 `403 proxy_origin_refused` 拒绝，无 token 为 `401 proxy_unauthorized`。出向请求由 `FilterProxyCookie` 剥掉 `ab_proxy`（**大小写不敏感**），token 绝不转发上游 |
| F18.3 | nonce 只在**匹配时**消费：错猜不消耗有效 nonce（否则本机一次错误请求就能让窗口永久打不开），重发 nonce 使旧 URL 失效，过期 nonce 一律丢弃 |
| F18.4 | 网关**不输出 HTML**，因此不再需要逐响应 CSP nonce、SPA 回退 `index.html`、主题预绘制脚本或版本戳注入；连接页与关于页是 Avalonia 原生窗口，主题由 `RequestedThemeVariant` 在启动时设定，语言与版本由 ViewModel 绑定 |
| F18.5 | 转发上游时只丢逐跳头，上游的 `Content-Security-Policy` / `Strict-Transport-Security` / `X-Frame-Options` 原样透传；`Set-Cookie` 丢 `Secure`/`Domain`/原 `Path`、`SameSite=None → Lax`、补 `; Path=/` 并保留 `HttpOnly`；`Location` 按 **origin**（scheme + host + port）比较后改写，不是字符串前缀 |
| F18.6 | 会话凭据存系统凭据库（F1.7）；设置页显示 `sessionBackend`，回退到文件时给出可读告警 |
| F18.7 | 无窗口的测试路由器（`auth: None`）保持原转发行为；关闭准入时 `/__shell/bootstrap` 返回 404 |
| F18.8 | **上游 `Set-Cookie` 不得越权**：名为 `ab_proxy` 或带 `__Host-` / `__Secure-` 前缀的 Cookie 整条丢弃；只有 `agenthub_session` 写入凭据库，其余（OAuth state / PKCE verifier）只转发不落盘；凭据库写失败只记日志，不得把已成功的登录变成 502 |
| F18.9 | **转发路径白名单**：`IsForwardablePath` 拒绝含 `..`、`\` 或 `//` 的路径（`//host` 会改掉 base-URI 的 authority，`/api/../x` 会跑出前缀），命中即 `400 invalid` |
| F18.10 | **端口与宿主**：Kestrel 绑 `127.0.0.1:0` 后从 `IServerAddressesFeature` 读回实际端口，禁止「探测空闲端口→关闭→再绑」的竞争；`AddServerHeader = false`；`ContentRootPath` 钉在 `AppContext.BaseDirectory`，当前目录的 `appsettings.json` 不影响宿主；网关自身 JSON 响应带 `Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff` |
| F18.11 | **有界读取**：JSON 响应 ≤16MiB、SSE 单事件 ≤1MiB（逐字节分帧，超长行整行丢弃）、更新包 ≤512MiB；文件下载返回活流并在 `Dispose` 时释放 response，不再整包读进内存 |
| F18.12 | **原子私有写**：`config.json` 写同目录私有临时文件（Unix 建即 `0600`、Windows 先 `icacls`）后 `File.Move(overwrite: true)`；读取时损坏或 >1MiB 回落默认值，不阻塞启动；两条写配置路由共用 `ValidatePatch`，`executorApiKey` 合并前摘出、只进凭据库 |

### F19 共享文件与连接器审批队列

两项能力都靠服务端提供，客户端只负责把「能做什么」和「还欠一个决定」变成可操作的界面。

| 编号 | 需求 |
|---|---|
| F19.1 | **共享文件屏**（`/files`）：侧栏独立入口（`FolderOpen`）；虚线拖拽区 + 点击选择，拖入时描边变实线；上传中显示等宽进度条与百分比，失败就在框内给出本地化原因与重试 |
| F19.2 | 文件表：名称（含 MIME 小字）、大小（KiB/MiB）、上传时间、操作；操作列提供**下载**（普通链接到 `/api/files/{id}/content`，带 `download` 属性，响应体不经 JS）与**删除**（行内二次确认，取消即撤销） |
| F19.3 | 空态与关闭态分离：没有文件是「还没有文件」+ 上传按钮；服务端 `files_disabled` 是「该服务端已关闭共享文件」且不显示拖拽区——**不能把关闭显示成空列表** |
| F19.4 | 上限提示来自服务端返回的 `maxBytes`，客户端在发送前先挡一次超限（不必上传完整份才被拒） |
| F19.5 | **审批队列**（连接器页内区块）：标题带计数徽标与刷新；每条显示连接器名、等宽动作名、参数摘要（超长省略 + `title` 悬浮全文）、请求时间；右侧「批准」（实心）/「拒绝」（描边） |
| F19.6 | 决策后**重新拉取队列**而不是本地猜测：批准 = 服务端 resume 真跑一次，拒绝 = cancel；失败的决策保留该行并在行上方给出本地化原因（`connector_approval_closed` / `connector_approval_not_found`），不做乐观删除 |
| F19.7 | 无待审批时整块只留一行说明；有内容时列表内部滚动，不撑高页面 |

---

## 3. 非功能需求

| 编号 | 需求 |
|---|---|
| N1 | **单色**：UI 只落在 `#000000 ↔ #FFFFFF` 明度轴，零色相；`AgentBuddy.Guards` 扫描全部 `.axaml`（hex 三通道相等 / 色相词黑名单），控件模板只引用 `DynamicResource Brush.*` |
| N2 | **13 语**：`en zh zh-TW es fr de it ru ja ko pt ar hi`；`Core/I18n/copy.json` 与外壳菜单共用同一语言集，`AgentBuddy.Guards` 强制每语言每 key 已译且不等于英文 |
| N3 | **RTL**：仅 `ar`；`window.FlowDirection = RightToLeft`，布局使用逻辑属性，禁止绝对左右定位 |
| N4 | **错误只传机器码**：ViewModel 只存 `ErrorCode`（`error.code`），`ErrorText` 按 code 查 copy |
| N5 | **无障碍**：触控目标 ≥44px；焦点环 2px + 2px offset；不声明过渡动画，`ReducedMotionService` 打 `reduce-motion` 标记 |
| N6 | **SSE 真流式**：`ResponseHeadersRead` + 字节流拷贝，强制 `accept-encoding: identity`，禁整体超时（仅 10s 连接超时） |
| N7 | 三平台：Linux（deb + 便携 tar.gz）、macOS（dmg + app 便携 tar.gz，aarch64）、Windows（msi + 便携 zip）；不产出 appimage，每次 release 恰好 9 个 assets |

## 4. 服务端契约（本轮新增）

### 4.1 端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/channels` | `tasks:read` | 通道列表 |
| POST | `/api/channels` | `tasks:write` | 新建通道 |
| GET | `/api/channels/{id}` | `tasks:read` | 单个通道（编辑回显） |
| PUT | `/api/channels/{id}` | `tasks:write` | 编辑（名称、启用、绑定线程、参与者、签名密钥环境变量名） |
| DELETE | `/api/channels/{id}` | `tasks:write` | 删除 |
| POST | `/api/channels/{id}/webhook` | **public** | 平台入站，签名校验 |
| POST | `/api/channels/{id}/deliver` | `tasks:write` | 出站发送一条消息；失败也落 `failed` 回执并保留原文 |
| GET | `/api/channels/{id}/deliveries` | `tasks:read` | 投递回执（方向 / 状态 / 错误码 / 时间） |
| POST | `/api/channels/{id}/deliveries/{did}/retry` | `tasks:write` | 重试一条未送达的**出站**回执：原地翻成 `delivered`，不新增行；已送达 / 入站 / 无原文 → 409 `delivery_not_retryable`，回执不存在 → 404 `delivery_not_found` |
| GET | `/api/connectors` | `resources:read` | `kind=mcp` 资源 + 策略 |
| PUT | `/api/connectors/{id}/policy` | `resources:write` | 设置 `allowed`/`ask`/`off` |
| GET | `/api/connectors/{id}/actions` | `resources:read` | 动作历史 |
| POST | `/api/connectors/{id}/actions` | `resources:write` | 执行动作（ask → park） |
| POST | `/api/threads/{id}/audio` | `tasks:write` | 语音上传（multipart） |
| GET | `/api/computers` | `resources:read` | Agent 计算机会话列表（F11） |
| POST | `/api/computers` | `resources:write` | 新建计算机会话（browser/shell/screen） |
| GET | `/api/computers/{id}` | `resources:read` | 计算机会话详情 + 最近动作回显 |
| DELETE | `/api/computers/{id}` | `resources:write` | 删除会话：先终止其执行租约再删行（F17） |
| GET | `/api/schedules` | `tasks:read` | 目标/周期任务列表（F13） |
| POST | `/api/schedules` | `tasks:write` | 新建目标/周期任务 |
| PUT | `/api/schedules/{id}` | `tasks:write` | 启停/编辑调度 |
| DELETE | `/api/schedules/{id}` | `tasks:write` | 删除调度 |
| POST | `/api/schedules/{id}/run` | `tasks:write` | 立即触发一次（不等 cron 到点），返回 202 Trigger |
| GET | `/api/router/stats` | `tasks:read` | 调度水位（待判定 / 运行中 / 待人工 / 本批数量 / 节拍） |
| GET/POST | `/api/router/triggers` | `tasks:read` / `tasks:write` | 触发流列表（`source`/`disposition`/`thread`/`ticket`/`limit`）；手动注入，重复投递返回 200 `{duplicate:true}` |
| GET | `/api/router/triggers/{id}` | `tasks:read` | 单条触发 + 判定 + 归属工单 |
| GET | `/api/router/tickets` | `tasks:read` | 工单列表（`state`/`open`/`limit`） |
| GET | `/api/router/tickets/{id}` | `tasks:read` | 工单详情（订阅 / 每次运行 / 判定 / 原始触发） |
| POST | `/api/router/tickets/{id}/cancel` | `tasks:write` | 结束工单并停止其任务 |
| POST | `/api/router/tickets/{id}/handback` | `tasks:write` | 交回一条触发（每条仅一次，否则 409） |
| DELETE | `/api/router/threads/{id}/subscription` | `tasks:write` | 取消该会话上的全部订阅 |
| GET/PUT | `/api/router/policies`、`/api/router/policies/{source}` | `tasks:read` / `tasks:write` | 读 / 改写各类来源的程序层规则 |
| POST | `/api/router/passes` | `tasks:write` | 立即推进一拍 |
| GET | `/api/router/events` | `tasks:read` | 调度事件流（SSE，`?since=<seq>&subject=`，先回放再实时） |
| GET | `/api/sandboxes` | `resources:read` | 可见租约列表 + 实例默认档案（F17） |
| GET | `/api/sandboxes/{id}` | `resources:read` | 租约 + 最近 50 条执行审计 |
| GET | `/api/sandboxes/stats` | `resources:read` | 五指标：活跃租约 / 待执行 job / 在线节点 / 最近执行 / 上次清扫 |
| GET | `/api/sandboxes/events` | `resources:read` | 执行环境事件流（SSE，`?since=<seq>`，先回放再实时） |
| POST | `/api/sandboxes/{id}/exec` | `resources:write` | **试跑**：直接执行一条命令（不经 router，审计标 `dry_run`） |
| POST | `/api/sandboxes/{id}/renew` | `resources:write` | 续租（超出 MaxTTL 返回 409 `sandbox_lease_lost`） |
| DELETE | `/api/sandboxes/{id}` | `resources:write` | 终止：销毁环境、关闭租约（204） |
| GET | `/api/sandbox-providers` | `resources:read` | 类型目录，按隔离层分组，含可用性与原因 |
| POST | `/api/sandbox-providers/refresh` | `resources:write` | 立即重探所有后端（运维动作） |
| GET/POST | `/api/sandbox-nodes` | `resources:read` / `resources:write` | 本机节点列表 / 注册（id 校验：非法 400 `bad_request`，他人 id 404） |
| DELETE | `/api/sandbox-nodes/{id}` | `resources:write` | 撤销节点（不销毁其租约，下次调用透明重建） |
| POST | `/api/sandbox-nodes/{id}/heartbeat` | `tasks:write` | 心跳，返回节点与 `pollHint` |
| GET | `/api/sandbox-nodes/{id}/jobs` | `tasks:write` | 长轮询领任务（`?wait=<sec>`，空闲 204；轮询本身即心跳） |
| POST | `/api/sandbox-nodes/{id}/jobs/{jobId}` | `tasks:write` | 回传结果（非本节点领取的 job 返回 404） |

> **F10 / F12 / F14 复用既有端点**：角色字段走 `POST/PUT /api/resources`（扩展 `persona`）、协作走
> `GET/POST /api/threads*`（`origin` 015 已加列）、技能走既有 `kind=skill` 资源，**不新增端点**；知识库
> （F14.3）首版经 `persona` 内的 `knowledge_ref` 关联，真实 RAG 检索标 `TODO(real)`。

> **不新增权限码**：全部复用 `tasks:read` / `tasks:write` / `resources:read` / `resources:write`，
> 避免「新权限需同步 `authz.AllPermissions` + 前端 `PERMISSIONS` + `enums-copy` 13 语」的连锁改动。
> 新增端点路径均落在 `/api` 前缀下，确保被 agentbuddy 环回代理覆盖，无需改桌面端转发逻辑。

### 4.2 新增机器码

`channel_disabled`、`channel_not_found`、`channel_signature_missing`、`channel_signature_invalid`、
`channel_timestamp_expired`、`channel_payload_invalid`、`delivery_failed`、`delivery_not_found`（回执不存在）、
`delivery_not_retryable`（已送达 / 入站 / 无原文）、`connector_not_found`、`connector_action_denied`、
`connector_policy_off`、`audio_too_large`、`audio_unsupported`、`audio_transcribe_failed`、`speech_disabled`、
`computer_not_found`、`schedule_not_found`、`schedule_invalid`、`skill_distill_disabled`、
`feature_unavailable`（computers / schedules / knowledge 未接线时的统一哨兵，取代原
`computer_disabled` / `knowledge_unavailable`）。
调度器（F13）：`router_ticket_not_found`、`router_trigger_not_found`、`router_thread_not_found`（404）、
`router_policy_invalid`（400）、`router_ticket_closed`、`router_handback_exhausted`、`router_resource_unset`（409）。
沙盒（F17）：`sandbox_disabled`、`sandbox_unsupported`、`sandbox_unknown_provider`、`sandbox_policy_denied`、
`sandbox_timeout`、`sandbox_node_offline`、`sandbox_lease_lost`、`sandbox_limit_reached`。
外壳（F18）：`proxy_unauthorized`、`proxy_origin_refused` 由代理直接返回，不进错误码表与文案表。

**删除的幂等语义（F6 / F11 / F13 / F19）**：`DELETE` 不由服务端用状态码替客户端保证幂等——对调用方
看不见的 id 一律回 404 并带对应的 `channel_not_found` / `computer_not_found` / `schedule_not_found` /
`file_not_found`。通道、计算机、调度与文件四屏把该码读作「已经没了」：关掉确认框、重拉列表、不弹拒绝；
其余失败仍就地显示本地化文案且行不消失。

登记两处：`agenthub/internal/httputil/json.go` 的 `Code*` 常量，以及 agentbuddy
`desktop/src/AgentBuddy.Core/Contracts/Codes.cs` 的 `ErrorCodes` + `I18n/copy.json`
里 13 语的 `errors.*` 文案（`Codes.cs` 的 `All` 数组由静态守卫钉住完整键集）。

### 4.3 迁移（agenthub，幂等，编号接 `016` 之后）

> `013_persona` / `014_channels` / `015_thread_origin` 为上一轮已落地迁移（已存在于仓库，列出供参照）；
> 本轮新增自 `017` 起，全部 `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`，并同步 `store_test.go` 的 `want`
> 文件名清单（agenthub 硬性约束：文件名被测试钉死）。

| 文件 | 内容 |
|---|---|
| `013_persona.sql` | （已存在）`ALTER TABLE resources ADD COLUMN IF NOT EXISTS persona JSONB;` |
| `014_channels.sql` | （已存在）`channels` + `channel_messages`（`external_ref` 唯一键） |
| `015_thread_origin.sql` | （已存在）`ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT '';` |
| `017_computers.sql` | `computers`（agent_id, kind∈browser/shell/screen, session_ref, status, last_action, created_at） |
| `018_schedules.sql` | `schedules`（goal, trigger, cron_expr, enabled, next_run, owner, last_run_at, last_status） |
| `019_knowledge.sql` | `knowledge`（agent_id, chunk_text, source_ref, created_at）；真实向量检索标 `TODO(real)` |
| `020_router.sql` | （已存在）调度器八表：触发器 / 工单 / 订阅 / 判定 / 策略 / 事件 |
| `021_sandboxes.sql` | `sandbox_leases`（归属/资源/作用域/provider/state/ref/expires_at）、`sandbox_execs`（命令摘要、退出码、耗时、输出 sha256、`dry_run`）、`sandbox_nodes`（id/归属/名称/能力/status/last_seen_at）、`sandbox_jobs`（完成后的审计行）、`sandbox_events`（seq/kind/subject/lease_id/payload）；并给 `computers` 增 `provider`/`lease_id`/`node_id`/`expires_at` |
| `022_task_ownership.sql` | `tasks` 及子表归属列 `owner_id`（`''` = 系统产生） |
| `023_knowledge_owner.sql` | `knowledge.owner_id` |
| `024_resource_visibility.sql` | `resources.visibility`（**默认 `restricted`，不回填**；越权读取/调用一律 404） |
| `025_audit_log.sql` | 只追加审计账本（哈希链，应用只 `INSERT`） |
| `026_rls_policies.sql` | 八表 RLS 策略（fail-closed，`AGENTHUB_RLS=enforce` 默认） |
| `027_audit_permission.sql` | 新增权限码 `audit:read`（控制台 `/audit` 屏使用） |

## 5. 异常与降级

| 场景 | 行为 |
|---|---|
| 服务端不可达 | 轮询指数退避 5s→30s，UI 置 offline chip，保留上次成功数据 |
| 会话过期（服务端可达但 401/403） | 记 `authExpired` 而非 `offline`：保留数据，显示「会话已过期，请重新登录」横幅 + 重登按钮；`NavigationService` 守卫复核后转登录页。只有网络错误或网关 502/503 才置 offline |
| 资源不可见（`visibility` 默认 `restricted` 且不回填） | 越权读取/调用一律 404（不泄露存在性）：列表收敛到可见项，不弹错误、不提示「权限不足」 |
| SSE 断连 | 以最后一次 `seq` 重连 `?since=`，回放后接实时 |
| 系统通知未授权 | `ok:false` → 降级为应用内红点，不重复弹权限 |
| 麦克风不可用/拒绝 | 隐藏录音按钮，保留文本输入，UI 明示模式 |
| 通道签名校验失败 | 401 + `channel_signature_invalid`，记 `channel_messages` 失败行 |
| 重试未送达回执（F6） | 成功 → 200，回执原地翻 `delivered`、不新增行；回执不存在 404 `delivery_not_found`；已送达 / 入站 / 无原文 409 `delivery_not_retryable`；提供方失败 502 `delivery_failed` 且回执保持可重试 |
| 语音超限/格式不支持 | 413 `audio_too_large` / 415 `audio_unsupported` |
| 连接器策略 `off` | 403 `connector_policy_off`，动作不执行 |
| 网关未就绪 / 服务端未配置 | 连接页显示 `shell_unavailable` 并保留服务端地址表单，不白屏、不吞掉已保存配置 |
| 计算机会话不存在 / 能力未接线 | 404 `computer_not_found` / 503 `feature_unavailable`，视图回退到只读占位 |
| 调度不存在/表达式非法 | 404 `schedule_not_found` / 400 `schedule_invalid`，前端内联提示 |
| 调度器开关关闭（F13） | `/api/router/*` 与 `/api/schedules/{id}/run` 返回 503 `feature_unavailable`；目标页显示「调度器已关闭」灰字，不隐藏目标列表本身 |
| 工单/触发/会话不存在（F13） | 404 `router_ticket_not_found` / `router_trigger_not_found` / `router_thread_not_found`，列表保留并内联提示 |
| 工单已结束或交回次数用尽（F13） | 409 `router_ticket_closed` / `router_handback_exhausted`，按钮置灰而非弹窗 |
| 路由规则非法（F13） | 400 `router_policy_invalid`，保留上一次成功保存的规则 |
| 目标未配置执行者（F13） | 409 `router_resource_unset`，提示先去资源页指定 Worker |
| 知识库未接线（mock 缺数据） | 503 `feature_unavailable`，建议降级为无上下文委派 |
| 技能蒸馏未启用 | 403 `skill_distill_disabled`，仅记录触发点不产出技能 |
| 服务端未接线执行控制面（F17） | 全部 `/api/sandbox*` 返回 503 `feature_unavailable`；控制台整屏显示「沙盒已关闭」+ 开启命令，不渲染零值水位条、不出错误横幅 |
| 配置的执行后端跑不起来（F17） | 目录项 `available:false` + 原因（如「未安装 bwrap」），执行返回 `sandbox_unsupported`；**不静默降级**到宿主 |
| 沙盒策略拒绝 / 超时（F17） | 400 `sandbox_policy_denied` / 504 `sandbox_timeout`；抽屉内联提示，保留租约 |
| 租约已终止或已过期（F17） | 409 `sandbox_lease_lost`；按钮按租约状态置灰（`terminated`/`expired` 只允许关闭抽屉） |
| 租约上限（F17） | 409 `sandbox_limit_reached`，可重试语义，提示稍后再试而非报错 |
| 执行节点离线（F17） | 503 `sandbox_node_offline`；节点胶囊显示离线，卡片保留 |
| 节点开启参数非法（F17） | 400 + `code`：`root_unusable`（空/相对/不存在）、`command_not_allowed`（路径/含空格/shell）、`server_not_configured`；设置页内联显示对应 13 语文案 |
| 节点执行越界（F17） | 任务请求根目录外路径 → `dir_outside_root`；请求未授权环境变量 → `env_not_allowed`；命令起不来 → `spawn_failed`。三者回传服务端，均不使任务进入 `failed` 之外的额外副作用 |

## 6. 验收标准

1. `cd desktop && dotnet build agentbuddy.sln -warnaserror` 全绿且 **0 警告 0 错误**。
2. `cd desktop && dotnet test agentbuddy.sln` 全绿（四个 xUnit 项目；`AgentBuddy.Guards` 含单色
   XAML、13 语键集与英文兜底、模板无硬编码文案、冻结端点常量可达性、共享控件复用守卫）。
3. `make dotnet-smoke` 全绿（真 Kestrel 环回网关 + 真上游 socket）。
4. agenthub：`go build ./... && go vet ./... && go test -race ./...` 全绿，其中
   `TestEmbeddedMigrationsAreOrderedAndIdempotent` 与 `TestListenersCoverRoutes` 通过。
5. 关闭窗口 → 最小化到托盘，SSE 可重连；托盘「退出」→ 进程终止。
6. 任务完成后收到系统通知（或降级红点），点击深链到对应任务。
7. 语音：录音 → 上传 → transcript 入会话 → agent 回复 → TTS 音频可回放。
8. 连接器 `ask` 策略：动作 park 到 `input-required`，审批后 resume 且**不二次 park**。
9. 通道：伪造签名的 webhook 被拒（401 + `channel_signature_invalid`），合法签名生成 thread 消息。
10. 三平台 CI 产出 6 个下载、两份清单与 SHA256SUMS，发布前 `verify` 断言恰好 9 个 assets。
11. 角色（F10）：新建 Agent 写入 `persona`（角色/指令/MBTI/头像），工作台与 Threads 正确渲染人格标签。
12. Agent 计算机（F11/F17）：`POST /api/computers` 真实申请执行环境租约并回显 `provider` / `leaseId` / `nodeId` / `expiresAt`；`DELETE` 先终止租约再删行；视图自身不引入子进程。
13. 目标调度（F13）：cron 保存即算出下次到期，到期后自动触发并回写最近运行时间 / 状态 / 下次到期；「立即运行」返回 202 Trigger，「推进一拍」触发一轮判定与派单；目标页可见水位（待判定 / 运行中 / 待人工 / 本批数量）、该目标运行历史与最近触发流，点击任务链接跳到 `/tasks/:id`；调度器关闭时相关区块显示灰字而非报错弹窗。
14. 技能/知识库（F14）：`kind=skill` 资源可管理版本/共享；知识库查询返回 mock 片段（`knowledge_unavailable` 时降级）。
15. 协作共享空间（F12）：会话内 `@mention` 派活与 Agent 自主认领均落 `thread_messages`（`origin` 标记来源）。
16. 富结果（F15）：带证据的建议以会话消息卡片呈现，单色与 13 语文案完整。
17. 会话持久化（F1.7）：登录后完全退出应用再启动，自动以已登录态进入工作台（session cookie 从系统凭据库还原），无需重新登录；无可用凭据库时回退到 owner-only `session.json` 并告警，设置页显示 `sessionBackend`；登出或过期后副本被清除，重启回到登录页。
18. 执行环境控制台（F17）：水位条五项与 `/api/sandboxes/stats` 一致；目录按层分组且不可用项写出原因；租约卡片显示到期倒计时（≤3 分钟加粗）；点击卡片打开审计抽屉，试跑一条命令后回执就地可见且刷新后仍在；终止需二次确认且确认后列表刷新。
19. 未接线语义（F17）：服务端关闭沙盒时整屏显示「沙盒已关闭」与开启命令，**不**出现错误横幅、**不**出现零值水位条。
20. 执行节点（F17）：默认关闭；开启需确认风险；根目录非绝对路径 / 白名单含 shell / 未选服务端时保存被拒并显示对应 13 语原因；节点 id 只读可见；关闭开关后节点立即停止心跳。
21. 环回网关准入（F18）：每次启动生成 256 位 token 与一次性 nonce；窗口经 `/__shell/bootstrap?nonce=…` 兑换 `HttpOnly; SameSite=Strict; Path=/` 的 Cookie 后 303 落到 `/`；`/api`、`/a2a`、`/__shell/*` 一律要求该 Cookie（原生客户端可用 Bearer）；外来 `Origin` 在任何鉴权之前以 `403 proxy_origin_refused` 拒绝；token 只存在于网关内存与 Cookie，绝不进入 UI 代码，也绝不被转发上游；错猜 nonce 不消耗有效 nonce（本机一次错误请求不能让窗口永久打不开），重发 nonce 使旧 URL 失效。
22. 无 HTML 输出（F18）：网关不再发 CSP、不再做 SPA 回退、不再注入主题预绘制脚本或版本戳；连接页与关于页是原生窗口。转发上游时只丢逐跳头，上游 `Content-Security-Policy` / `Strict-Transport-Security` / `X-Frame-Options` 原样透传。
23. 会话存储（F18）：会话 Cookie 写入系统凭据库（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service）；无可用凭据库时回退为仅属主可读的 `session.json` 并在日志告警；旧的明文会话在首次读取时迁入凭据库并删除明文；`/__shell/config` 暴露 `sessionBackend`（`keyring` / `file` / `memory`）。
24. 登录表单校验（F1）：邮箱与密码为空、注册模式下两次密码不一致或未填显示名时，提交按钮保持 disabled，且**在输入框内回车同样被拦截**（`submit()` 自查 `canSubmit`），不发请求、不回显错误码。
25. 通道重试（F6）：出站失败落 `failed` 回执并保留原文；点重试 → 200 且该回执原地变 `delivered`（不新增行）；已送达 / 入站 / 无原文 → 409 `delivery_not_retryable`；提供方仍失败 → 502 `delivery_failed` 且回执保持可重试。
26. 可见性（M3）：`visibility=restricted` 且无授权的资源不出现在任何列表；直接调用返回 404 而非 403，空列表不提示「权限不足」。
27. 通知投递（F5.4）：任务 `completed` / `input-required` / `failed` 时工作台向 `/__shell/notify` 发送**已本地化的标题**（不是 `notifyResult` 这类 copy key）与深链；外壳 `notify_enabled=false` 或处于静默期时不发；`ok:false` 不报错、不重试、不影响站内通知中心。
28. 桌面密钥与文件权限（F18）：执行节点 API key 在凭据库可用时写入凭据库，`config.json` 中该字段为空，重启后 `load()` 回填且节点仍能认证；无凭据库时保留在 owner-only `config.json`；会话文件与配置文件均**创建即 `0600`**（unix），Windows 用 `icacls /inheritance:r /grant:r <user>:F` 显式收紧，失败只记一次日志。
29. 超时清场（F17.7）：unix 下超时后先对整棵进程组 TERM、250ms 宽限后 KILL，孙进程不残留；`pid <= 1` 或 `kill` 失败时降级为直接子进程 `start_kill`，绝不向自身组发信号。Windows 无组语义，明确退回直接子进程终止。
30. 跨进程冒烟：`make dotnet-smoke` 用真实 socket 跑通「真实上游 → Kestrel 环回网关 → bootstrap nonce → Cookie → `/api` 转发 → SSE 真流式 → `/__shell/notify` → 外来 Origin 403」；`AgentBuddy.Core.Tests` 另覆盖 401 透传与断连不被误判为会话过期；全部只走 `127.0.0.1`，不触外网。
31. 登录与人格（F1.3 / F10.2）：选择 OAuth 提供方后打开系统默认浏览器跳转，不抛异常；Agent 人格表单可编辑 `role` 并在保存后再次打开仍在（不再被覆盖为空）。
32. 自动更新（F19）：两源并发探测择优与单源失败回落有纯函数用例；semver 比较、OS/arch →
    平台键映射、无匹配降级、24h 到期与跳过版本均有用例；`GET /__shell/upgrade` 与两条 POST
    在无窗口路由器下有正常 + 异常用例。
33. 更新卡片、侧栏横幅、关于页均按机器码渲染 13 语本地文案；`AgentBuddy.Guards` 的
    「冻结端点常量全部可达」守卫白名单仍为空，13 语键集与英文兜底守卫全绿。
34. 发布流程生成 `latest.json`（GitHub URL）与 `latest-gitee.json`（Gitee URL），
    `ab-tool manifest|verify` 有离线正常 + 异常用例；6 个下载全部签名、签名内嵌清单，
    发布集合钉住 9 个 assets；未配置签名密钥时同样发布 9 个文件，仅 `platforms`/`signatures` 为空。
35. 未配置公钥时「立即升级」返回 `not_configured` 且不下载任何包；Avalonia 视图未获得
    文件系统、命令执行或更新安装权限，一切经 `/__shell/*` 控制面。
36. `dotnet test --collect:"XPlat Code Coverage"` 出 Cobertura 报告；静态守卫是硬门槛，
    新增功能必须补正常 + 异常双路径用例，**不得**用 exclude / ignore 绕过。
37. 执行节点命令准入（F17.6/F17.7）：`node` 这类裸名可执行；`../evil/node`、`/bin/node`、
    `C:\x\node.exe`、`node --flag`、`sh`、`sh.exe`、`env`、`sudo`、`xargs`、`docker`、`ssh`
    一律 `command_not_allowed`；白名单条目同规则校验；工作目录的兄弟前缀（`root-evil`）与
    指向根外的符号链接都判 `dir_outside_root`；文件系统根判 `root_unusable`。
38. 上游 Cookie 越权（F18.8）：上游下发 `ab_proxy=…`、`__Host-*`、`__Secure-*` 时该条
    **不出现在**客户端响应里；`agenthub_session` 被改写后转发并写入凭据库；`oauth_state`
    只转发不落盘。
39. 有界读取（F18.11）：>1MiB 的单个 SSE 事件与超长未换行行被整段丢弃且不破坏后续分帧；
    >16MiB 的 JSON 响应按空响应处理而不是 OOM；下载返回活流并在释放时关闭连接。
40. 通知文本（F5.4）：标题/正文只经环境变量或 argv 传入系统通知，**绝不**拼进
    PowerShell / AppleScript 源码；单行限长；深链队列上限 20 条、单条 ≤512 字符。
41. 配置与凭据（F18.12）：`config.json` 写入不经过「先删后建」，目录内不残留 `.tmp`
    文件；损坏/超大配置回落默认值且应用仍能启动；凭据助手超过 5s 即被杀，锁住的钥匙串
    不挂住请求；`POST /__shell/executor` 与 `POST /__shell/config` 对根目录/白名单的拒绝
    行为完全一致，且两条路径都不可能把 API key 写进 `config.json`。
42. 更新验签（F19）：公钥盒 42 字节、签名盒 74 字节、`Ed` 标记与 8 字节 key id 必须两侧一致；
    `ED`（预哈希）、篡改负载、截断盒、空负载、空公钥一律拒绝；安装包文件名必须是纯文件名。

## 7. 自动更新（F19）

### 7.1 功能边界

- 桌面外壳自行检查 `github.com/ariacompute/agentbuddy` 与 `gitee.com/ariacompute/agentbuddy`
  的 release；**并发探测**两源更新清单的可达性与响应延迟，取可用且最快者，单源失败自动回落到
  另一源。不采集用户位置、不读出口 IP、不依赖第三方定位服务。
- 启动时检查一次（窗口就绪后延时 8s），之后每 24 小时一次；设置页提供手动检查。自动检查可关闭、
  特定版本可跳过，偏好持久化在 `config.json`。时钟回拨视为到期，`AtomicBool` 等价的单飞挡住并发检查/安装。
- 本地版本较老时给出系统通知（点击到 `/settings`）与设置页卡片、侧栏横幅、关于页状态；
  用户确认「立即升级」后由 `UpgradeService` 自行验签、下载、按平台安装并重启；始终保留「手动下载」。
- 验签是 **minisign 兼容的 Ed25519**：`MinisignVerifier` 解析 key box 与签名盒，
  `ab-tool sign` 用同一格式签发；公钥为空时一律 `not_configured`，绝不安装未验签包。
- 按本地 OS + CPU 架构匹配 `platform_key(OS, ARCH)` 到平台键；无匹配包时明确提示并给手动下载入口。
- 界面不直接访问文件系统或更新源：一切更新状态与动作经 `/__shell/upgrade*` 控制面。

### 7.2 接口契约

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/__shell/upgrade` | GET | 返回 `UpgradeState`（camelCase） |
| `/__shell/upgrade/check` | POST | 手动检查（`force=true`，忽略自动检查开关） |
| `/__shell/upgrade/install` | POST | 用户确认后验签、下载、安装、重启 |
| `/__shell/config` | GET/POST | 读写 `upgradeAutoCheck` / `upgradeSkippedVersion` |

`UpgradeState.status` 是机器码：`idle | checking | up_to_date | available |
unsupported_platform | downloading | installing | not_configured | network_failed |
manifest_invalid | signature_failed | busy | unavailable`。界面不得解析自然语言，只按机器码查
本地文案；`source` 为 `github` / `gitee`；`downloadUrl` 与清单资产 URL 均须经主机白名单校验
（HTTPS、GitHub/Gitee 及其下载 CDN，且与清单来源一致）。三条路由继承 `ab_proxy` Cookie 与
`Origin` 准入；Avalonia 视图只发 HTTP，不获得任何 updater 权限。

### 7.3 发布形态

- 每次 release 恰好 9 个 assets：6 个下载（Linux deb + 便携 tar.gz、macOS dmg + app
  便携 tar.gz、Windows msi + 便携 zip）、`latest.json`、`latest-gitee.json`、`SHA256SUMS`。
  **不发布**独立签名更新包、`.sig`、`updater-*.json` 或 AppImage。
  三条构建 leg 各跑 `dotnet publish -r <rid> --self-contained true`，再分别用
  WiX v4（msi，作者文件由 `ab-tool wix` 生成）、`dpkg-deb`（deb）、`hdiutil`（dmg）封装。
- `latest.json`：`version`（纯 semver，无 `v`）、`notes`、`pub_date`、
  `platforms[平台键].{url,signature}`、可选 `signatures[文件名]`（6 项）。
  `platforms` 只指向客户端能安装的资产：`linux-x86_64 → deb`、
  `darwin-aarch64 → macos-aarch64.tar.gz`、`windows-x86_64 → msi`；dmg、Linux tar.gz、
  Windows zip 仅供手动下载。客户端忽略未知字段，清单格式向前兼容。
- 6 个下载由各构建 leg 用 `ab-tool sign` 签名（minisign 兼容 Ed25519，trusted comment
  绑定版本），base64 签名内嵌两份清单；`.sig` 只走独立元数据 artifact，绝不进入发布目录。
  两份清单分别写 GitHub / Gitee 自己的资产 URL；Gitee 镜像上传同样 6 个下载，
  并把 `latest-gitee.json` 重命名为 `latest.json`，**不再上传 `.sig`**。
- 发布前 `ab-tool verify` 断言目录恰好是这 9 个文件、两份清单同源且版本一致、
  `SHA256SUMS` 只覆盖 6 个下载；发布步骤再用显式白名单 + `fail_on_unmatched_files` 兜底。
  未配置签名密钥时 `platforms`/`signatures` 为空，客户端走手动下载。
- 验签公钥来自仓库 secret `UPDATER_PUBKEY`：release 构建前由 `ab-tool inject-pubkey`
  写入 `Shell/Upgrade/Pubkey.g.cs` 的 `PublicKey` 常量（仓库里保持空）。
  私钥 secret `UPDATER_PRIVATE_KEY` 只在 CI 内由 `ab-tool sign` 读取，绝不进仓库或日志。
- 本轮不扩充发布矩阵：仅 `linux-x86_64` / `darwin-aarch64` / `windows-x86_64`；
  其他平台走 `unsupported_platform` 降级。

### 7.4 异常与降级

- 两源都不可达 → `network_failed`，状态卡片可重试，不重试风暴、不阻塞窗口。
- 清单畸形 / 版本不可解析 / 签名缺失 / 资产 URL 落在白名单外 → `manifest_invalid`。
- 公钥未配置（缺 secret `UPDATER_PUBKEY`，源码常量为空）→ 检查与手动下载照常，安装返回
  `not_configured`；`latest.json` 无 platforms 键时客户端走「不支持平台」。
- 并发检查/安装 → `busy`，由 `AtomicBool` 单飞挡住，不会重复下载。
- 系统通知失败或 `notify_enabled=false` → 只影响提醒，不影响卡片状态；深链一次点击消费一次。
