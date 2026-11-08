# agentbuddy

[English](README.md) | [中文](README_cn.md)

面向 [agenthub](https://github.com/ariacompute/agenthub)（A2A 互连平台）的
**.NET 10 / Avalonia 原生桌面客户端**。没有 WebView、没有内嵌网页包、没有本地后端：
XAML 界面通过进程内环回网关把 `/api`、`/a2a`、`/healthz`、`/.well-known`
转发到用户配置的服务端。

## 功能

- 按 URL 连接任意 agenthub 服务端。会话保存在 HttpOnly Cookie 中，由环回代理复用，
  工作台始终以同源方式通信。
- Agent、会话线程、任务追踪、审批（HITL 挂起/恢复）、通道（Slack / Teams / Telegram / SMS
  webhook）、连接器（按策略放行的动作），以及语音（录音 → 转写 → 委派）。
- 自动更新：并发探测 GitHub 与 Gitee，取可用且最快的一源，失败自动切到另一源；启动即查、
  此后每天一次，按本地操作系统与 CPU 架构匹配签名安装包，一键验签升级后重启。设置里可关闭
  自动检查，也可跳过某个版本。

## 快照

工作台首页 —— 你可达的每个智能体、它们正在做的事、以及等待你处理的事项：

![agentbuddy 工作台](workbench_cn.png)

## 图示

三张可交互图分别说明运行时架构、一次 A2A 委派与任务状态机。每张都是单文件 HTML，
可在线打开；也可以 clone 仓库后直接打开 `docs/diagrams/` 里的文件，无需服务端，
离线效果一致。

| 图示 | 可交互 | 静态预览 |
| --- | --- | --- |
| 运行时架构 | [打开](https://ariacompute.github.io/agentbuddy/diagrams/agenthub-agentbuddy.architecture.html) | [PNG](diagrams/agenthub-agentbuddy.architecture.png) |
| 一次 A2A 委派（`message/send` → `tasks/resume`） | [打开](https://ariacompute.github.io/agentbuddy/diagrams/agenthub-agentbuddy.sequence.html) | [PNG](diagrams/agenthub-agentbuddy.sequence.png) |
| 任务状态机 | [打开](https://ariacompute.github.io/agentbuddy/diagrams/agenthub-agentbuddy.lifecycle.html) | [PNG](diagrams/agenthub-agentbuddy.lifecycle.png) |

![AgentHub + AgentBuddy 运行时架构](diagrams/agenthub-agentbuddy.architecture.png)

## 开发

前置依赖：**.NET 10 SDK**（版本由 `desktop/global.json` 钉住）。不需要 Node、Rust 工具链，
也没有前端构建步骤。

```bash
make dotnet-install   # 校验 SDK 并还原 desktop/agentbuddy.sln
make dotnet-icons     # 从 desktop/assets/app-icon.png 派生 png/ico/icns
make dotnet-build     # 编译整个解决方案，警告即错误
make dotnet-publish RID=win-x64   # 自包含发布（linux-x64 / osx-arm64 / win-x64）
```

也可以不经过 `make`：

```bash
cd desktop
dotnet restore agentbuddy.sln
dotnet run --project tools/AgentBuddy.Build -- icons
dotnet build agentbuddy.sln -warnaserror
dotnet run --project src/AgentBuddy.App/AgentBuddy.App.csproj   # 启动原生窗口
```

`ab-tool`（`desktop/tools/AgentBuddy.Build`）是唯一的构建 CLI：
`icons`、`stamp <semver>`、`inject-pubkey`、`sign`、`wix`、`manifest`、`verify`。
`Directory.Build.props` 是唯一版本源（`make stamp VERSION=1.2.3`）。

## 测试

```bash
make test              # dotnet test agentbuddy.sln，全程离线
make dotnet-coverage   # 四个测试项目的 Cobertura 覆盖率
make dotnet-smoke      # 真 socket 环回网关冒烟，只连回环地址
```

四个 xUnit 项目取代旧的前端/桌面双套测试：

- `AgentBuddy.Core.Tests`——13 语兜底、端点契约、配置、SSE 分帧、
  `MonitorService` 与 `RealtimeService` 的正常/异常双路径。
- `AgentBuddy.Shell.Tests`——bootstrap 准入、`Set-Cookie`/`Location` 改写、流式转发、
  凭据回退、执行节点策略、升级选源/验签失败、通知深链与托盘角标。
  `GatewaySmokeTests` 用真实 Kestrel 环回网关与上游 HTTP 桩跑真 socket，
  不出 `127.0.0.1`。
- `AgentBuddy.App.Tests`——Avalonia.Headless 下的 ViewModel、路由守卫、
  文件传输、语音与通知深链。
- `AgentBuddy.Guards`——静态扫描：13 语键集、单色 `.axaml`、模板无硬编码文案、
  冻结端点常量全部可达、主题字典成对、构建/发布只用 .NET。

## 发布

通过 [`.github/workflows/release.yml`](.github/workflows/release.yml) 构建并发布安装包。
三个平台各自跑一次自包含 `dotnet publish`，再分别用 WiX v4（msi）、`dpkg-deb`（deb）、
`hdiutil`（dmg）封装安装包并另出一份便携包。每次 release 恰好 9 个 assets：
下表 6 个下载，加 `latest.json`、`latest-gitee.json` 与 `SHA256SUMS`。
**不再发布**独立的签名更新包、`.sig` 或 `updater-*.json`。

| 平台          | 便携版                  | 安装包          |
| ------------- | ----------------------- | --------------- |
| Linux x86_64  | `linux-x86_64.tar.gz`   | `amd64.deb`     |
| macOS aarch64 | `macos-aarch64.tar.gz`  | `aarch64.dmg`   |
| Windows x86_64| `windows-x86_64.zip`    | `x64.msi`       |

### 签名更新（一次性配置）

签名是 minisign 兼容的 Ed25519 key box，由 `ab-tool` 生成与验证，
不依赖 Tauri signer 或任何更新插件。可用任意 minisign 工具（例如 `minisign -G`）生成密钥对；
私钥盒为 74 字节（`Ed` + 8 字节 key id + 32 字节种子 + 32 字节公钥），
公钥盒为 42 字节（`Ed` + key id + 32 字节公钥）。

两个仓库 secret 原样保存 key box —— 两行文本盒或它的 base64 包装，**不要二次 base64**：

```bash
gh secret set UPDATER_PUBKEY < agentbuddy.key.pub
gh secret set UPDATER_PRIVATE_KEY < agentbuddy.key
```

`release.yml` 依次调用 `ab-tool inject-pubkey`（写入 `Upgrade/Pubkey.g.cs`）、
`ab-tool sign`（签 6 个下载）、`ab-tool manifest`（生成两份清单）、
`ab-tool verify`（发布前断言恰好 9 个文件）。未配置密钥时 9 个文件照常发布，
只是 `platforms`/`signatures` 为空，客户端返回 `not_configured`，绝不安装未验签的包。
Gitee 镜像上传同样 6 个下载，并把 `latest-gitee.json` 改名为 `latest.json`。

## 执行环境

「计算机」屏是执行环境控制台的只读视图：按隔离层分组的后端目录（容器 / 用户态内核 / microVM /
进程沙盒 / 平台层 / 远端节点 / off）、每一项的可用性与不可用原因、五指标水位条、带倒计时的租约卡片，
以及可试跑命令的审计抽屉。全部数据来自 agenthub——桌面端不探测运行时，也不自行判断哪种后端安全。

### 作为执行节点（可选，默认关闭）

设置 → **执行节点** 允许这台机器为服务端执行命令，限制由桌面端在本地强制：

- **不经 shell**——argv 直接执行，只接受白名单里精确匹配的命令名；
- **一个根目录**——配置的绝对路径之外不可读取、写入或执行；
- **有界**——unix 下超时终止**整棵进程组**（TERM → 250ms 宽限 → KILL，孙进程无法留下）、
  输出截断、并发数受限；Windows 没有进程组语义，退回只杀直接子进程并如实说明，不假装已清场；
- **可撤销**——关掉开关立即停止，服务端随即显示离线。

## 对比

| 能力 | agentbuddy | OpenDots | openmuse | openbot | Octop | openagents | Velozity |
|---|---|---|---|---|---|---|---|
| 形态 | .NET 10 / Avalonia 原生桌面 | Web+移动模板 | RN/Expo/Web 应用 | Electron 桌面 | 自托管单进程 | Agent 协作 OS | 云端 AI Office（SaaS） |
| 后端 | agenthub（可自托管）| CopilotKit runtime | CopilotKit runtime | 本地 Agent CLI | Octop Harness | Network SDK（可自托管） | 闭源云端 |
| 多 Agent | 角色经 `persona`（F10） | 专用 Dots | 单一个人 Agent | 多个持久 Agent | 专家团队 + AgentTeams | 任意 Agent 同一工作区 | 用户自建 AI 劳动力 |
| 计算机使用 | 租约沙盒：docker（默认）、gVisor、Kata、bubblewrap、托管运行时或登记的节点（F17） | OpenBot 容器 | Playwright 浏览器 | Computer Use（cua） | Browser AI+ / 远程桌面 | 共享浏览器 | 未公开 |
| 人机协同 | HITL 挂起/恢复（F4） | Approve & save/run | 发送前审查 | 全权限（预览期） | 工具审批 + PII 脱敏 | @提及 / 自主认领 | 人类 + Agent 协作 |
| 调度 | 触发路由器：cron / 会话 / 渠道 / 手动 → 规则 → 批量语义判定 → 工单 → 执行者（F13） | 后台回合 | 目标与监控 | Webhook 例程 | 自然语言 Cron | 频道认领 | 智能排程 |
| 技能 / 知识库 | `kind=skill` + mock RAG（F14） | 自动学习 | — | 本地技能 | Company Brain | — | Company Brain |
| 通道 | Slack / Teams / Telegram / SMS（F6） | Slack | Gmail / Calendar | 桌面 / 移动 | IM 全渠道 | 工作区线程 | 聊天 + 语音舱 |
| 语音 | 录音 → 转写 → 委派（F8） | WebRTC 通话 | — | 移动端 WebRTC | — | — | 语音 / 视频舱 |
| 执行隔离 | 服务端租约；本桌面也可作为节点（BYOM） | — | — | — | — | — | — |
| 自托管 | 是（桌面 + agenthub） | Docker | Docker / Render | 本地 / 服务器 | 单进程 | 自托管网络 | 否（SaaS） |

## 许可证

MIT.

## 工程约定

本仓库遵循 Harness Engineering：

- [`AGENTS.md`](AGENTS.md)：Agent 工程上下文入口与目录索引
- [`requirements.md`](requirements.md)：需求规格（功能边界 / 异常 / 验收，人审后编码）
- [`task.md`](task.md)：实施清单
