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
| F3.6 | **会话删除（单选 / 多选）**：列表默认**不渲染**卡片复选框，只显示一个「全选」；勾选「全选」才进入选择模式——所有卡片同时出现复选框并全部被选中，母框随之转为 indeterminate 状可再逐卡取消以收窄批次；取消「全选」或「清除选择」退出模式、复选框整体消失回到默认态。另有单卡删除按钮；N 个选中走同一套二次确认（`BaseDialog`，单数 / 复数文案分别带 `{count}` 占位），确认后逐个 `DELETE /api/threads/{id}`，全部结束再 `GET /api/threads` 重拉列表。**不做乐观删除**。选中集始终与服务端最新列表求交：后台刷新删掉的 id 不再计数、不再发送；删除失败的行保留选中以便重试，并在页内 banner 显示本地化机器码。13 语全量文案（`copy/thread-copy.js`），触控目标 ≥44px、逻辑属性、单色令牌；取消 / 关闭确认框或重复点击确认不得发出第二个请求 |
| F3.7 | **详情页返回列表**：`/threads/:id` 顶部恒显示一个站内返回链接（`RouterLink to="/threads"`），点击回到 Threads 列表；文案 `thread.backToThreads` 在 `copy/thread-copy.js` 13 语全量落地，由 `copy-fallback.spec.js` 守卫。链接在 `thread` 数据加载中 / 读取失败 / 通知深链直达时仍可见，不使用 `history.back()` 以免落到应用外或无关页面；复用 `.btn` 与单色令牌，触控目标 ≥44px、焦点环 2px + 2px offset，`ar` 下箭头翻转，布局不引入方向性物理属性。无新增 API 与错误码 |
| F3.8 | **清理会话全部消息**：详情页（仅当已有消息时）提供「清空消息」入口，点开 `BaseDialog` 二次确认（13 语 `clearMessages*` / `messagesEmpty`）；确认后经 store 调 `DELETE /api/threads/{id}/messages`，成功后清空本地列表、重建 SSE 流以免旧流把已删除行 / 旧任务回复灌回，失败保留全部消息并在弹窗内显示经 `errors.js` 本地化的机器码。取消 / 关闭 / 重复点击确认不得发出第二个请求；线程、参与者与任务均保留，触控目标 ≥44px、逻辑属性、单色令牌。服务端契约见 `agenthub/requirements.md` §14 |

### F4 任务与产物追踪

| 编号 | 需求 |
|---|---|
| F4.1 | 状态机 `submitted / working / input-required / completed / failed / canceled / unknown`，以文本标签 + 灰度阶梯呈现 |
| F4.2 | spans 分层列表（名称、耗时、状态）；artifacts 卡片（文本直展、文件显示大小、音频内联播放） |
| F4.3 | `input-required` 时提供审批输入与 `POST /api/tasks/{id}/resume`；取消走 `POST /api/tasks/{id}/cancel` |
| F4.4 | 危险操作二次确认 |
| F4.5 | **清理全部任务（服务端删除）**：Tasks 页在有任务时于页头给出「清理全部」入口（无任务时不渲染，空态仍是既有 `listEmpty`），`BaseDialog` 二次确认真实删除。删除走 **`DELETE /api/tasks`**（agenthub 契约见其 `requirements.md` §15）：只删调用者**已结束**的记录并级联 artifacts / spans / pending / push / events / push_records，在途（submitted / working / input-required / unknown）保留，响应 `{deleted, kept}`。前端**不自认列表已空**，成功后重读 `/api/tasks`；`kept > 0` 时页头横幅说明「{count} 个任务仍在进行，记录已保留」。失败按机器码本地化：弹窗不关、在原处给出原因，且 `clearing` 守卫保证一次确认只发一个请求（按钮同时 disabled，守卫由 `wrapper.vm` 直接调用覆盖）。旧服务端无此路由返回 405，store 归一为 `feature_unavailable`，界面说「服务端未开启」而不是打印 405。13 语 `clearAll` / `clearAllTitle` / `clearAllBody` / `clearAllKept`（`copy-fallback.spec.js` 守卫），触控目标 ≥44px、逻辑属性、单色令牌。无新增错误码 |
| F4.6 | **详情页返回列表**：`/tasks/:id` 顶部恒显示一个站内返回链接（`RouterLink to="/tasks"`），点击回到 Tasks 列表；文案 `task.backToTasks` 在 `copy/task-copy.js` 13 语全量落地，由 `copy-fallback.spec.js` 守卫。链接在任务加载中 / 读取失败 / 通知深链直达时仍可见，不使用 `history.back()`；复用 `.btn` 与单色令牌，触控目标 ≥44px、焦点环 2px + 2px offset，`ar` 下箭头翻转，布局不引入方向性物理属性。无新增 API 与错误码 |

### F5 后台常驻与通知（Muse/dots 对齐项）

| 编号 | 需求 |
|---|---|
| F5.1 | 关闭窗口 = 最小化到托盘（保留环回代理与事件循环）；**仅托盘「退出」** 终止进程 |
| F5.2 | 事件聚合：轮询 `/api/workspace` + `/api/tasks`（可见 5s / 隐藏 20s / 失败指数退避 5s→30s）+ 对非终态任务按需开 per-task SSE（**并发上限 6**，LRU 淘汰） |
| F5.3 | 通知去重纯函数 `decide()`：幂等键 `taskID:state`（1h 窗口，与 `HTTPNotifier` 对齐）、同键 30s 静默、每分钟 >8 条合并为摘要、静默期内只入站内中心 |
| F5.4 | 系统通知**真实投递**：`decide()` 判定需要打扰后，工作台经环回端点 `POST /__shell/notify` 发一条本地化标题 + 摘要 + 深链（`title` 在发送时用当前语言解析，不是 copy key）。外壳的 `notify_enabled` 与 `notify_quiet_minutes` 由工作台读 `/__shell/config` 后喂给 `decide({settings:{enabled, quietUntil}})`，因此设置页的「通知开关」与「静默期」真的生效，而不只是写进配置文件。投递为 fire-and-forget：`ok:false`（`disabled` / `quiet` / `no_app` / `denied` / `missing_fields`）是正常回应，降级为应用内红点，不报错、不重试、不阻塞轮询；纯 Web 构建没有 `/__shell`，请求失败被静默吞掉 |
| F5.5 | **托盘角标（已实现）**：工作台在未读数变化时经 `setTrayBadge(count)` → `POST /__shell/badge` 推送，fire-and-forget（纯 Web 构建没有该端点，失败静默）。外壳把计数存在 `ProxyState.unread` 并 clamp 到 `999`；tooltip 全平台可见，`set_title` 在不支持标题的平台静默失败，>99 显示 `99+`。**计数留在进程里**，语言切换重建菜单后重新套用，角标不丢；文案是 `badge_text(lang, count)` 纯函数（13 语 `trayUnread`） |
| F5.6 | **toast 深链（已实现）**：`link` 是站内路径，外壳入队后于 `ActionPerformed::action_id() == "tap"` 时取用，`unminimize` + `show` + `set_focus` 并 `window.location.hash = '#/…'`（工作台是 `createWebHashHistory`，即一次真实路由跳转）。只接受单斜杠开头且拒绝 `//host` / `javascript:` / 反斜杠 / 控制字符；路径经 JSON 编码后才进 `eval`；一次点击只消费一次 |
| F5.7 | 静默期以**调用时刻**为锚：`quietUntil = now + minutes*60*1000`，读取与保存都一样；不得以「首次读取设置的时间」为锚（否则长时间开着的页面算出已过去的窗口，静默形同虚设） |
| F5.8 | 断线重放：`?since=<seq>`；SSE 无 `[DONE]` 哨兵，终态由状态判定 |
| F5.9 | **单实例（已实现）**：窗口关闭后驻留托盘时再次启动应用（双击图标 / 快捷方式 / 命令行），必须**唤回已在运行的那一份**——`unminimize` + `show` + `set_focus`，页面、代理端口、SSE 与会话全部保持原样；不得起第二个进程（第二个环回代理、第二个托盘图标、一张空窗口）。判定走 `app_config_dir/instance.json` 的 `{pid, port, token}` 与环回握手（`agentbuddy/1 show <token>` → `ok`），**记录不在退出时删除**：无人应答即视为过期，崩溃与正常退出同一条判定。认领失败（目录不可写 / 连续争用）不阻止启动，只退化为可能开出第二张窗口。`background=false` 时关闭窗口本就退出进程，再次启动自然是新实例，同一套逻辑无需分支 |

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
| F17.6 | **执行节点**（可选，**默认关闭**）：设置页开关 + 风险说明 + 确认；工作根目录（绝对路径）、命令白名单（逐行、精确匹配、禁 shell）、并发上限、节点 id（只读）、可选 API key、在线状态与最近拒绝原因 | BYOM |
| F17.7 | 节点只在**本地 Rust 进程**执行：不经 shell、只跑白名单精确命令、只允许根目录内路径、超时**终止整棵进程组**、输出截断；网页视图**不获得**任何文件系统或命令执行能力。进程组语义仅 unix 具备（`process_group(0)` + `kill(-pgid)`，TERM → 250ms 宽限 → KILL → `wait()` 收尸）；Windows 没有等价原语，退回 `kill_on_drop` + 直接子进程 `start_kill`，并在代码中明确标注不支持，而不是假装已清场 | — |
| F17.8 | 节点生命周期：开启后注册 → 心跳 → 长轮询领任务 → 执行 → 回传；退出即停止，重启自动重新上线；间歇在线不算故障，服务端据此显示离线 | — |
| F17.9 | 客户端不自建沙盒、不做类型探测：目录、可用性与原因全部来自服务端，客户端只渲染 | 单一事实来源 |
| F17.10 | 拒绝名单在 shell 之外还覆盖**启动器**（`env` / `sudo` / `xargs` / `timeout` / `setsid` / `nohup` / `nice` / `stdbuf` / `chroot` / `unshare` / `nsenter` / `script` / `watch` / `ssh` / `docker` / `make` / `gdb` / …）：允许 `env` 不是允许 `env`，是允许 `env sh -c '…'`。判定忽略大小写与一个 `.exe` 后缀；`Policy::new` 与**每次** `authorize` 双重复核，旧配置或手改 `config.json` 进来的条目同样不放行 | — |
| F17.11 | 工作根目录必须是绝对路径、存在且为目录，且**不能是文件系统根**（`/`、`C:\`）：那只意味着「整台机器」，不是沙盒边界；白名单条目不得含空白或控制字符 | — |

### F18 环回代理准入与内容安全

环回代理监听 `127.0.0.1`，本机任何进程都能访问；没有准入时
`http://127.0.0.1:<port>/api/...` 就是一条免认证、通往用户 agenthub 会话的通道。F18 把
「只有本窗口能用」变成可验证的边界，并让会话令牌离开明文文件。

| 编号 | 需求 |
|---|---|
| F18.1 | 每次启动生成 256 位 token 与一个**一次性** nonce（TTL 60s）；窗口打开 `/__shell/bootstrap?nonce=…` 兑换 `ab_proxy` Cookie（`HttpOnly; SameSite=Strict; Path=/`）后 `303` 落到 `/`。token 只存在于代理内存与 Cookie，绝不进入 JS、绝不转发上游 |
| F18.2 | 除 bootstrap 外的所有路由（`/api`、`/a2a`、静态资源、`/__shell/*`）都要求该 Cookie，原生客户端可用 `Authorization: Bearer`；外来 `Origin` 在任何鉴权之前以 `403 proxy_origin_refused` 拒绝，无 token 为 `401 proxy_unauthorized` |
| F18.3 | nonce 只在**匹配时**消费：错猜不消耗有效 nonce（否则本机一次错误请求就能让窗口永久打不开），重发 nonce 使旧 URL 失效，过期 nonce 一律丢弃 |
| F18.4 | 代理为自己输出的 HTML 发 `Content-Security-Policy`，`script-src 'self' 'nonce-<每响应随机>'`（不含 `unsafe-inline`）；首屏主题解析外置为 `web/public/theme-init.js`；外壳注入的版本戳脚本声明该 nonce；`style-src` 保留 `'unsafe-inline'`（Vue 的逐元素样式无法用 nonce 覆盖，且内联样式不能执行） |
| F18.5 | 转发上游时只丢逐跳头，上游的 `Content-Security-Policy` / `Strict-Transport-Security` / `X-Frame-Options` 原样透传 |
| F18.6 | 会话凭据存系统凭据库（F1.7）；设置页显示 `sessionBackend`，回退到文件时给出可读告警 |
| F18.7 | 无窗口的测试路由器（`auth: None`）保持原转发行为；关闭准入时 `/__shell/bootstrap` 返回 404 |
| F18.8 | 上游 `Set-Cookie` 不得写外壳自己的 Cookie：名为 `ab_proxy`（大小写不敏感）、以 `__Host-` / `__Secure-` 为前缀、或没有名字的一律**整条丢弃**（不转发也不落凭据库）；准入 Cookie 只由 bootstrap 发放 |
| F18.9 | `Location` 按 **origin**（scheme + host + port）比对配置的服务端之后才改写为 `self_url`，并原样保留 path / query / fragment（OAuth 回调的 `code`、`state` 靠这条）；前缀相同但源不同者（`https://hub.example.com.evil.test/x`、`https://hub.example.com@evil.test/x`、端口不同、scheme 不同）一律不改写；相对 `Location` 与不可解析值原样交给浏览器 |
| F18.10 | 转发前先过脏路径闸：`..`、`\`、`//` 以及 `%2e` / `%2f` / `%5c` / `%00` 任一命中即以 `400 invalid_target` 拒绝，**不让归一化发生在上游**（否则 `/api/../admin` 会走出挂载前缀）；查询串不参与判断，也不因编码差异漏判 |
| F18.11 | `/__shell/*` 的**每个**响应（含 404 与外壳页面）与代理自造的每个 JSON 机器码都带 `Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff`；代理输出的 HTML 与内嵌资源带 `nosniff`；上游响应的缓存头与安全头仍原样透传，不由外壳代改 |

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
| N1 | **单色**：UI 只落在 `#000000 ↔ #FFFFFF` 明度轴，零色相；`web/tests/style.spec.js` 强制（hex 三通道相等 / hsl 中性 / 色相词黑名单） |
| N2 | **13 语**：`en zh zh-TW es fr de it ru ja ko pt ar hi`；前端 copy 表 + Rust 外壳 `copy.rs` 双向齐全；`copy-fallback.spec.js` 强制每语言每 key 已译且不等于英文 |
| N3 | **RTL**：仅 `ar`；布局一律逻辑属性（`margin-inline` / `inset-inline`） |
| N4 | **错误只传机器码**：store 只存 `error.code`，文案全部本地化 |
| N5 | **无障碍**：触控目标 ≥44px；焦点环 2px + 2px offset；`prefers-reduced-motion: reduce` 下禁全部动效 |
| N6 | **SSE 真流式**：环回代理 `Body::from_stream`，强制 `accept-encoding: identity`，禁整体超时 |
| N7 | 三平台：Linux（deb + 便携 tar.gz）、macOS（dmg + app 便携 tar.gz，aarch64）、Windows（msi + 便携 zip）；不产出 appimage，每次 release 恰好 9 个 assets |
| N8 | **发布脚本可测**：`desktop/scripts/**`（stamp / make-icon / 签名 / latest-json）由 `desktop/` 自己的 Vitest 工程覆盖，四项 100%；脚本形态为「导出纯函数 + 无参 `main()` + 末尾一句 `runAsEntry(import.meta.url, main)`」，入口判定在 `scripts/lib/entry.mjs`，**不得**用 `exclude` 或 `/* v8 ignore */` 换取数字 |
| N9 | **图标编码器产出的是真 PNG**：`make-icon.mjs` 生成的 PNG 其 IDAT 必须能被标准 inflater 解开（stored block 头为 `BFINAL`(bit0)｜`BTYPE=00`），`assets/app-icon.png` 与编码器输出一致 |
| N10 | **子进程不弹控制台**：外壳是 GUI 进程（自身无控制台），它启动的每个子进程（`icacls` 收紧文件权限、执行节点的任务）都以 `CREATE_NO_WINDOW` 创建，桌面不出现黑色命令窗口；输出仍经 `Stdio::piped` 回传 |

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
| DELETE | `/api/threads/{id}` | `tasks:write` | 删除自有会话（含消息历史）：204 空体；不存在 / 非本人 → 404 `not_found`（F3.6，多选时客户端逐 id 调用） |
| DELETE | `/api/threads/{id}/messages` | `tasks:write` | 清空自有会话的全部消息，会话 / 参与者 / 任务保留：204 空体；不存在 / 非本人 → 404 `not_found`（F3.8；旧服务端 405 归一化为 `method_not_allowed`） |
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

**删除的幂等语义（F3 / F6 / F11 / F13 / F19）**：`DELETE` 不由服务端用状态码替客户端保证幂等——对调用方
看不见的 id 一律回 404 并带对应的 `not_found`（会话）/ `channel_not_found` / `computer_not_found` /
`schedule_not_found` / `file_not_found`。会话、通道、计算机、调度与文件各屏把该码读作「已经没了」：关掉确认框、
重拉列表、不弹拒绝；其余失败仍就地显示本地化文案且行不消失。会话批量删除用 `Promise.allSettled`：
单个 404 不影响同批其它 id，首个真实拒绝码交给 `errors.js` 本地化。服务端若没有删除端点而只回
裸状态码（`404` / `405` / `403` / `503`），客户端先翻译成对应机器码，其中裸 `404` 不算「已经没了」，
以免点了删除却静默无事发生。

登记三处：`internal/httputil/json.go` 的 `Code*` 常量、agentbuddy `web/src/lib/errors.js` 的
`CODE_KEYS`、`web/src/lib/copy/errors-copy.js` 的 13 语（调度器文案集中在
`copy/scheduler-copy.js`，由这两张表合并进来）。

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
| 会话过期（服务端可达但 401/403） | 记 `authExpired` 而非 `offline`：保留数据，显示「会话已过期，请重新登录」横幅 + 重登按钮；`App.vue` 复核后转登录页。只有网络错误或代理 502/503 才置 offline |
| 资源不可见（`visibility` 默认 `restricted` 且不回填） | 越权读取/调用一律 404（不泄露存在性）：列表收敛到可见项，不弹错误、不提示「权限不足」 |
| SSE 断连 | 以最后一次 `seq` 重连 `?since=`，回放后接实时 |
| 系统通知未授权 | `ok:false` → 降级为应用内红点，不重复弹权限 |
| 麦克风不可用/拒绝 | 隐藏录音按钮，保留文本输入，UI 明示模式 |
| 通道签名校验失败 | 401 + `channel_signature_invalid`，记 `channel_messages` 失败行 |
| 重试未送达回执（F6） | 成功 → 200，回执原地翻 `delivered`、不新增行；回执不存在 404 `delivery_not_found`；已送达 / 入站 / 无原文 409 `delivery_not_retryable`；提供方失败 502 `delivery_failed` 且回执保持可重试 |
| 语音超限/格式不支持 | 413 `audio_too_large` / 415 `audio_unsupported` |
| 连接器策略 `off` | 403 `connector_policy_off`，动作不执行 |
| 控制台 bundle 缺失 | 外壳显示 `consoleMissing`（不白屏） |
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
21. 环回代理准入（F18）：每次启动生成 256 位 token 与一次性 nonce；窗口经 `/__shell/bootstrap?nonce=…` 兑换 `HttpOnly; SameSite=Strict; Path=/` 的 Cookie 后 303 落到 `/`；`/api`、`/a2a`、`/__shell/*` 与静态资源一律要求该 Cookie（原生客户端可用 Bearer）；外来 `Origin` 在任何鉴权之前以 `403 proxy_origin_refused` 拒绝；token 只存在于代理内存与 Cookie，绝不进入 JS，也绝不被转发上游；无窗口的测试路由器（`auth: None`）保持原转发行为；错猜 nonce 不消耗有效 nonce（本机一次错误请求不能让窗口永久打不开），重发 nonce 使旧 URL 失效。
22. 内容安全策略（F18）：代理为自己输出的 HTML 发 `Content-Security-Policy`，`script-src 'self' 'nonce-<每响应随机>'`（不含 `unsafe-inline`）；首屏主题解析外置为 `web/public/theme-init.js`；外壳注入的版本戳脚本声明该 nonce；转发上游时只丢逐跳头，上游 `Content-Security-Policy` / `Strict-Transport-Security` / `X-Frame-Options` 原样透传。
23. 会话存储（F18）：会话 Cookie 写入系统凭据库（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service）；无可用凭据库时回退为仅属主可读的 `session.json` 并在日志告警；旧的明文会话在首次读取时迁入凭据库并删除明文；`/__shell/config` 暴露 `sessionBackend`（`keyring` / `file` / `memory`）。
24. 登录表单校验（F1）：邮箱与密码为空、注册模式下两次密码不一致或未填显示名时，提交按钮保持 disabled，且**在输入框内回车同样被拦截**（`submit()` 自查 `canSubmit`），不发请求、不回显错误码。
25. 通道重试（F6）：出站失败落 `failed` 回执并保留原文；点重试 → 200 且该回执原地变 `delivered`（不新增行）；已送达 / 入站 / 无原文 → 409 `delivery_not_retryable`；提供方仍失败 → 502 `delivery_failed` 且回执保持可重试。
26. 可见性（M3）：`visibility=restricted` 且无授权的资源不出现在任何列表；直接调用返回 404 而非 403，空列表不提示「权限不足」。
27. 通知投递（F5.4）：任务 `completed` / `input-required` / `failed` 时工作台向 `/__shell/notify` 发送**已本地化的标题**（不是 `notifyResult` 这类 copy key）与深链；外壳 `notify_enabled=false` 或处于静默期时不发；`ok:false` 不报错、不重试、不影响站内通知中心。
28. 桌面密钥与文件权限（F18）：执行节点 API key 在凭据库可用时写入凭据库，`config.json` 中该字段为空，重启后 `load()` 回填且节点仍能认证；无凭据库时保留在 owner-only `config.json`；会话文件与配置文件均**创建即 `0600`**（unix），Windows 用 `icacls /inheritance:r /grant:r <user>:F` 显式收紧，失败只记一次日志。
29. 超时清场（F17.7）：unix 下超时后先对整棵进程组 TERM、250ms 宽限后 KILL，孙进程不残留；`pid <= 1` 或 `kill` 失败时降级为直接子进程 `start_kill`，绝不向自身组发信号。Windows 无组语义，明确退回直接子进程终止。
30. 跨进程冒烟：`make smoke` 用真实 socket 跑通两条链路——「工作台 store → 真实 `node:http` 桩」（含 401 透传与断连不被误判为会话过期）与「真实上游 → 外壳代理 → bootstrap nonce → Cookie → `/api` 转发 → `/__shell/notify` → 外来 Origin 403」；全部只走 `127.0.0.1`，不触外网。
31. 登录与人格（F1.3 / F10.2）：点击 OAuth 提供方按钮即 `window.open` 跳转，不抛异常；Agent 人格表单可编辑 `role` 并在保存后再次打开仍在（不再被覆盖为空）。
32. 自动更新（F19）：两源并发探测择优与单源失败回落有纯函数用例；semver 比较、OS/arch →
    平台键映射、无匹配降级、24h 到期与跳过版本均有用例；`GET /__shell/upgrade` 与两条 POST
    在无窗口路由器下有正常 + 异常用例。
33. 更新卡片、侧栏横幅、关于页均按机器码渲染 13 语本地文案；`api-usage.spec.js` 白名单仍为空；
    `copy-fallback.spec.js` 与桌面 `i18n/upgrade.rs` 的 13 语键集守卫全绿。
34. 发布流程生成 `latest.json`（GitHub URL）与 `latest-gitee.json`（Gitee URL），
    `latest-json.mjs collect|manifest|verify` 有离线正常 + 异常用例；6 个下载全部签名、
    签名内嵌清单，发布集合钉住 9 个 assets；未配置签名密钥时同样发布 9 个文件，
    仅 `platforms`/`signatures` 为空。
35. 未配置公钥时「立即升级」返回 `not_configured` 且不下载任何包；WebView 未获得 updater 权限。
36. v8 覆盖率四项（语句 / 行 / 分支 / 函数）均 **100%**。界面上按钮 disabled 因而点不到的
   守卫分支须通过直接调用处理函数、服务端渲染等手段真实覆盖，**不得**用 `exclude` / ignore
   注释绕过；`api-usage.spec.js` 白名单仍为空。
37. 代理 Cookie 归属（F18.8）：上游回 `ab_proxy=…`、`__Host-sid=…`、`__Secure-sid=…` 或无名 Cookie 时，
   响应里不出现该 `Set-Cookie`，窗口仍以原 token 通过准入；普通会话 Cookie 照常重写。
38. 重定向按源比对（F18.9）：`https://hub.example.com.evil.test/steal`、`https://hub.example.com@evil.test/steal`、
   端口或 scheme 不同者都**不**被改写到环回源；同源跳转保留 path / query / fragment。
39. 脏路径闸（F18.10）：`/api/../__shell/config`、`/api/%2e%2e/x`、`/api//x` 等以 `400 invalid_target`
   在到达上游之前被拒；`/api/resources`、`/api/tasks/42/artifacts/1`、`/.well-known/agent.json`
   等真实路径照常转发。
40. 响应头（F18.11）：`/__shell/config`、`/__shell/executor`、外壳页面、404 与 `POST /__shell/*`
   都带 `no-store` + `nosniff`；代理自造的 JSON 错误同样带这两个头；含 CSP 的 HTML 仍带 `nosniff`。
41. 执行节点拒绝扫尾（F17.10 / F17.11）：白名单含 `env` / `sudo` / `xargs` / `timeout` / `docker` / `make`
   或它们的 `.exe`、任意大小写写法在保存时即以 `command_not_allowed` 拒绝；已写入 `config.json`
   的同名条目在 `authorize` 处仍被拒，而同一列表里的 `git` 照常可跑；根目录填 `/` 或 `C:\` 以
   `root_unusable` 拒绝。
42. 发布脚本闸门（N8）：`cd desktop && bun run test:coverage` 四项 **100%**（含 `scripts/lib/entry.mjs`
    的入口判定）；脚本以导入方式被测，入口行为另由 `tests/cli.spec.js` 的真子进程钉住退出码；
    配置里没有 `coverage.exclude`，脚本里没有 `/* v8 ignore */`。
43. 图标容器（N9）：`make-icon.mjs` 生成的 PNG/ICO/ICNS 的 IDAT 用 `node:zlib` 的 `inflateSync`
   可解、逐行 filter 字节为 0、块 CRC 与 `crc32(type+data)` 一致；`desktop/assets/app-icon.png`
   由同一编码器生成（1024×1024，可解码）。
44. 单实例（F5.9）：`background` 开启时关窗（驻留托盘）后再次启动，**不出现第二个进程 / 托盘图标**，
   原窗口被唤回且仍停在关闭前的页面（代理端口、SSE、会话均未重建）；首个进程被 `kill` 后再次启动
   正常成为新实例（遗留记录被接管，token 换新）；空文件 / 非 JSON / 无 token 的损坏记录同样被接管；
   只有携带记录中 token 的握手能唤回窗口，其余请求得到非 `ok` 回应且不唤回。
45. 无控制台闪现（N10）：Windows 上切换 light / dark 主题（即一次 `/__shell/config` 保存，会调
   `icacls /inheritance:r /grant:r <user>:F` 收紧 `config.json`）与执行节点跑一条任务，都**不出现
   命令窗口**；`icacls` 的退出码与失败日志行为不变；`console.rs` 的源码守卫要求 `session.rs` /
   `executor/spawn.rs` 里每个 `Command::new` 附近都有 `console::hide`（漏掉即在 CI 红）。
46. 会话详情返回（F3.7）：从列表进入 `/threads/:id` 后点击返回链接回到 `/threads`；13 语下链接
   均为已本地化文案，非英语语种不等于英文回落，`ar` 下为 RTL；`getThread` 未返回时链接仍在且
   可跳转；`copy-fallback.spec.js` 与 v8 覆盖率四项 100% 保持全绿。
47. 清理会话全部消息（F3.8）：有消息时显示清空入口，确认后本地所有行消失、显示会话空态、
   旧 SSE 被关闭且新流接到空历史；取消 / 关闭 / 重复点击不产生第二个请求；服务端拒绝时保留
   全部消息并显示本地化机器码；13 语按钮 / 标题 / 正文 / 空态齐全且不等于英文回落，
   `copy-fallback.spec.js`、接线守卫与 v8 覆盖率四项 100% 保持全绿。
48. 清理全部任务（F4.5）：有任务时页头出现「清理全部」，确认后发出**一个** `DELETE /api/tasks`，
   列表按响应后的重读结果渲染 —— 全删完则显示空态且入口消失，服务端保留了在途任务时列表仍有它们、
   并显示「{count} 个任务仍在进行，记录已保留」；取消 / 关闭弹窗不发请求；
   服务端拒绝（如 `forbidden`）时弹窗不关、原处显示本地化原因，再点一次可重试；
   请求在途时重复点击只产生一次调用；旧服务端 405 显示为「服务端未开启」；
   清理后筛选复位「全部」；13 语文案齐全且不等于英文回落。
49. 任务详情返回（F4.6）：从列表进入 `/tasks/:id` 后点击返回链接回到 `/tasks`；13 语下链接均为
   已本地化文案且 `ar` 为 RTL；`getTask` 未返回或返回失败时链接仍在且可跳转；
   `copy-fallback.spec.js` 与 v8 覆盖率四项 100% 保持全绿。

## 7. 自动更新（F19）

### 7.1 功能边界

- 桌面外壳自行检查 `github.com/ariacompute/agentbuddy` 与 `gitee.com/ariacompute/agentbuddy`
  的 release；**并发探测**两源更新清单的可达性与响应延迟，取可用且最快者，单源失败自动回落到
  另一源。不采集用户位置、不读出口 IP、不依赖第三方定位服务。
- 启动时检查一次（窗口就绪后延时），之后每 24 小时一次；设置页提供手动检查。自动检查可关闭、
  特定版本可跳过，偏好持久化在 `config.json`。
- 本地版本较老时给出系统通知（点击到 `/settings`）与设置页卡片、侧栏横幅、关于页状态；
  用户确认「立即升级」后由 `tauri-plugin-updater` 验签、下载、安装并重启；始终保留「手动下载」。
- 按本地 OS + CPU 架构匹配 `latest.json` 的 Tauri 平台键；无匹配包时明确提示并给手动下载入口。
- 纯 Web 构建没有 `/__shell`，所有更新请求静默失败，卡片显示「此构建未配置自动更新」。

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
（HTTPS、GitHub/Gitee 及其下载 CDN，且与清单来源一致）。三条新路由继承 `ab_proxy` Cookie 与
`Origin` 准入，不新增 IPC 面、不给 WebView 任何 updater 权限。

### 7.3 发布形态

- 每次 release 恰好 9 个 assets：6 个下载（Linux deb + 便携 tar.gz、macOS dmg + app
  便携 tar.gz、Windows msi + 便携 zip）、`latest.json`、`latest-gitee.json`、`SHA256SUMS`。
  **不发布**独立签名更新包、`.sig`、`updater-*.json` 或 AppImage；`bundle.createUpdaterArtifacts`
  恒为关闭。
- `latest.json`：`version`（纯 semver，无 `v`）、`notes`、`pub_date`、
  `platforms[平台键].{url,signature}`、新增可选 `signatures[文件名]`（6 项）。
  `platforms` 只能指向插件能安装的已有资产：`linux-x86_64 → deb`、
  `darwin-aarch64 → macos-aarch64.tar.gz`、`windows-x86_64 → msi`；dmg、Linux tar.gz、
  Windows zip 仅供手动下载。旧客户端没有 `deny_unknown_fields`，忽略 `signatures` 即可兼容。
- 6 个下载由各构建 leg 用 `tauri signer sign --app-version V` 直接签名（trusted comment
  绑定版本），base64 签名内嵌两份清单；`collect` 消费临时 `.sig` 后删除，元数据走独立
  artifact，绝不进入发布目录。两份清单分别写 GitHub / Gitee 自己的资产 URL；Gitee 镜像
  上传同样 6 个下载，并把 `latest-gitee.json` 重命名为 `latest.json`，**不再上传 `.sig`**。
- 发布前 `latest-json.mjs verify` 断言目录恰好是这 9 个文件、两份清单同源且版本一致、
  `SHA256SUMS` 只覆盖 6 个下载；发布步骤再用显式白名单兜底。未配置签名密钥时
  `platforms`/`signatures` 为空，客户端走手动下载。
- 验签公钥来自仓库 secret `UPDATER_PUBKEY`：release 构建前由
  `desktop/scripts/inject-updater-pubkey.mjs` 同时写入 `src/upgrade/mod.rs` 的
  `UPDATER_PUBKEY`（运行时验签）与 `tauri.conf.json` 的 `plugins.updater.pubkey`
  （插件默认配置，与运行时常量保持一致）；两处在源码里都留空、公钥不进仓库。
- 本轮不扩充发布矩阵：仅 `linux-x86_64` / `darwin-aarch64` / `windows-x86_64`；
  其他平台走 `unsupported_platform` 降级。

### 7.4 异常与降级

- 两源都不可达 → `network_failed`，状态卡片可重试，不重试风暴、不阻塞窗口。
- 清单畸形 / 版本不可解析 / 签名缺失 / 资产 URL 落在白名单外 → `manifest_invalid`。
- 公钥未配置（缺 secret `UPDATER_PUBKEY`，源码常量为空）→ 检查与手动下载照常，安装返回
  `not_configured`；`latest.json` 无 platforms 键时客户端走「不支持平台」。
- 并发检查/安装 → `busy`，由 `AtomicBool` 单飞挡住，不会重复下载。
- 系统通知失败或 `notify_enabled=false` → 只影响提醒，不影响卡片状态；深链一次点击消费一次。
