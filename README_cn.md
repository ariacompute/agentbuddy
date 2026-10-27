# agentbuddy

[English](README.md) | [中文](README_cn.md)

面向 [agenthub](https://github.com/ariacompute/agenthub)（A2A 互连平台）的桌面客户端。

## 功能

- 按 URL 连接任意 agenthub 服务端。会话保存在 HttpOnly Cookie 中，由环回代理复用，
  工作台始终以同源方式通信。
- Agent、会话线程、任务追踪、审批（HITL 挂起/恢复）、通道（Slack / Teams / Telegram / SMS
  webhook）、连接器（按策略放行的动作），以及语音（录音 → 转写 → 委派）。

## 开发

前置依赖：[bun](https://bun.sh) 1.4+ 与 Rust 工具链（edition 2021）。

```bash
make web-dev      # vite 开发服务器（:5173），/api 代理到 localhost:3500
make desktop-dev  # 用刚构建好的控制台启动外壳
make build        # 控制台 + 当前平台的安装包
```

也可逐步执行：

```bash
cd web && bun install && bun run build      # 构建 web/dist，编译期嵌入二进制
cd desktop && bun install && bun run build  # 针对当前平台执行 tauri build
```

## 测试

```bash
make test                           # 前端 Vitest + 桌面 cargo 测试，全程离线
cd web && bun run test              # Vitest：i18n 完整性、单色守卫、lib 单测
cd desktop/src-tauri && cargo test  # proxy / config / i18n 单测
```

## 发布

通过 [`.github/workflows/release.yml`](.github/workflows/release.yml) 构建并发布安装包：

| 平台          | 便携版                  | 安装包          |
| ------------- | ----------------------- | --------------- |
| Linux x86_64  | `linux-x86_64.tar.gz`   | `amd64.deb`     |
| macOS aarch64 | `macos-aarch64.tar.gz`  | `aarch64.dmg`   |
| Windows x86_64| `windows-x86_64.zip`    | `x64.msi`       |

## 许可证

MIT.

## 工程约定

本仓库遵循 Harness Engineering：

- [`AGENTS.md`](AGENTS.md)：Agent 工程上下文入口与目录索引
- [`requirements.md`](requirements.md)：需求规格（功能边界 / 异常 / 验收，人审后编码）
- [`task.md`](task.md)：实施清单
