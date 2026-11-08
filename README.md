# agentbuddy

[English](README.md) | [中文](README_cn.md)

A **native .NET 10 / Avalonia** desktop client for the
[agenthub](https://github.com/ariacompute/agenthub) A2A interconnection platform.

## Features

- Connect to any agenthub server by URL. The session lives in an HttpOnly cookie
  and is reused by the loopback proxy, so the workbench just talks same-origin.
- Agents, threads, task tracing, approvals (HITL park/resume), channels
  (Slack / Teams / Telegram / SMS webhooks), connectors (policy-gated actions),
  and voice (record → transcribe → delegate).
- Live updates stay scoped: only the sandbox and router streams are always on,
  while a thread or task detail subscribes to its own entity stream and closes it
  on the way out — one stream per entity, never a template path.
- Automatic updates: GitHub and Gitee are probed in parallel and the fastest
  reachable mirror wins, with failover to the other. Checks run on startup and
  daily; the signed installer is matched to the local OS/CPU and a one-click
  verified upgrade restarts the app. Automatic checks can be turned off and a
  version skipped in Settings.

## Snapshot

The Workbench home screen — every agent you can reach, what they are doing,
and what is waiting on you:

![agentbuddy workbench](workbench.png)

## Diagrams

Three interactive diagrams cover the runtime architecture, one A2A delegation
and the task state machine. Each is a single self-contained HTML file: open it
online, or clone the repo and open `docs/diagrams/` locally with no server.

| Diagram | Interactive | Static preview |
| --- | --- | --- |
| Runtime architecture | [Open](https://ariacompute.github.io/agentbuddy/diagrams/agenthub-agentbuddy.architecture.en.html) | [PNG](diagrams/agenthub-agentbuddy.architecture.en.png) |
| One A2A delegation (`message/send` → `tasks/resume`) | [Open](https://ariacompute.github.io/agentbuddy/diagrams/agenthub-agentbuddy.sequence.en.html) | [PNG](diagrams/agenthub-agentbuddy.sequence.en.png) |
| Task state machine | [Open](https://ariacompute.github.io/agentbuddy/diagrams/agenthub-agentbuddy.lifecycle.en.html) | [PNG](diagrams/agenthub-agentbuddy.lifecycle.en.png) |

![English runtime architecture diagram](diagrams/agenthub-agentbuddy.architecture.en.png)

## Develop

Prerequisites: the **.NET 10 SDK** (pinned by `desktop/global.json`). No Node,
no Rust toolchain and no frontend build is needed.

```bash
make dotnet-install              # verify the SDK and restore desktop/agentbuddy.sln
make dotnet-icons                # derive png/ico/icns from desktop/assets/app-icon.png
make dotnet-build                # build the whole solution, warnings are errors
make dotnet-publish RID=win-x64  # self-contained publish (linux-x64 / osx-arm64 / win-x64)
```

Or directly, without `make`:

```bash
cd desktop
dotnet restore agentbuddy.sln
dotnet run --project tools/AgentBuddy.Build -- icons
dotnet build agentbuddy.sln -warnaserror
dotnet run --project src/AgentBuddy.App/AgentBuddy.App.csproj   # launch the native window
```

`ab-tool` (`desktop/tools/AgentBuddy.Build`) is the single build CLI:
`icons`, `stamp <semver>`, `inject-pubkey`, `sign`, `wix`, `manifest`, `verify`.
`Directory.Build.props` is the single version source (`make stamp VERSION=1.2.3`).

## Test

```bash
make test             # dotnet test agentbuddy.sln — fully offline
make dotnet-coverage  # Cobertura coverage for all four test projects
make dotnet-smoke     # real-socket loopback gateway smoke, loopback only
```

394 cases in total — Core 143 / Shell 207 / App 33 / Guards 11 — at 98.97% line
and 90.21% branch coverage across 34 source files; what is still uncovered is
platform-exclusive or defensive.

Four xUnit projects replace the old frontend/desktop split:

- `AgentBuddy.Core.Tests` — 13-language fallback, endpoint contract, config,
  SSE framing and its byte caps, `MonitorService` and `RealtimeService` normal +
  failure paths, and the per-entity stream lifecycle: a path claimed concurrently
  opens one stream, a claimed-but-unpublished path reports success and opens
  nothing, and a cancelled pump untracks without throwing.
- `AgentBuddy.Shell.Tests` — bootstrap admission, `Set-Cookie`/`Location`
  rewriting, streaming forward, credential fallback, executor policy,
  upgrade source race / signature failure, deep links and tray badge.
  `GatewaySmokeTests` starts a real Kestrel loopback gateway and an upstream
  HTTP stub over real sockets (nothing leaves `127.0.0.1`).
- `AgentBuddy.App.Tests` — Avalonia.Headless ViewModels, route guard,
  file transfer, voice, notification deep links, and one full assembly pass that
  raises the real window, tray and composition root on a dedicated UI thread.
- `AgentBuddy.Guards` — static scans: 13-language key parity, monochrome
  `.axaml`, no hardcoded template text, every frozen endpoint constant
  referenced, theme dictionaries paired, build/release tooling is .NET only.

## Release

Publishes installers through [`.github/workflows/release.yml`](.github/workflows/release.yml).
Each of the three matrix legs runs a self-contained `dotnet publish` for its RID,
then wraps it with WiX v4 (msi), `dpkg-deb` (deb) or `hdiutil` (dmg) plus a portable
archive. Each release has exactly nine assets: the six downloads below, `latest.json`,
`latest-gitee.json` and `SHA256SUMS`. There is no separate updater archive,
no `.sig` asset and no `updater-*.json` on the release page.

| Platform      | Portable                | Installer        |
| ------------- | ----------------------- | ---------------- |
| Linux x86_64  | `linux-x86_64.tar.gz`   | `amd64.deb`      |
| macOS aarch64 | `macos-aarch64.tar.gz`  | `aarch64.dmg`    |
| Windows x86_64| `windows-x86_64.zip`    | `x64.msi`        |

### Signed updates (one-time setup)

Signatures are minisign-compatible Ed25519 boxes, produced and verified by
`ab-tool`; no Tauri signer or plugin is involved. Generate a key pair with any
minisign tool (for example `minisign -G`), or with `ab-tool sign` plus a
74-byte secret box (`Ed` + 8-byte key id + 32-byte seed + 32-byte public key).
The matching 42-byte public key box (`Ed` + key id + 32-byte public key) is
what the client embeds at build time.

Two repository secrets hold the key boxes verbatim — the two-line text box or
its base64 wrapper, never base64-encoded twice:

```bash
gh secret set UPDATER_PUBKEY < agentbuddy.key.pub
gh secret set UPDATER_PRIVATE_KEY < agentbuddy.key
```

`release.yml` calls `ab-tool inject-pubkey` (writes `Upgrade/Pubkey.g.cs`),
`ab-tool sign` for each of the six downloads, `ab-tool manifest` for the two
mirrors, and `ab-tool verify` to assert exactly nine assets before publishing.
With no key configured the nine files are still published with empty
`platforms`/`signatures`; the client reports `not_configured` and never installs
an unverified package. Gitee mirrors upload the same six downloads plus
`latest-gitee.json` renamed to `latest.json`.

## Execution environments

The workbench's **Computers** screen is an execution-environment control plane viewer: the
provider catalogue grouped by isolation layer (container / user-space kernel / microVM /
process / platform / remote / off) with each backend's availability and the reason it is
unavailable, a five-metric water level, lease cards with a countdown, and an audit drawer
with a try-it runner. Everything is read from agenthub — the desktop never probes a runtime
and never decides which backend is safe.

### Serving as an execution node (optional, off by default)

Settings → **Execution node** lets this machine run commands for the server, inside limits
the desktop enforces locally:

- **no shell** — the argv is executed directly, and only an exact name from the allow list
  is accepted;
- **one root** — nothing outside the configured absolute directory can be read, written or
  run;
- **bounded** — a timeout kills the whole process group on unix (TERM, a 250ms grace, then
  KILL, so a grandchild cannot outlive the job), output is truncated, and the number of
  concurrent jobs is capped. Windows has no process groups, so it falls back to killing
  the direct child and says so instead of pretending;
- **revocable** — the switch stops the node immediately, and the server shows it offline.

## Comparison

| Capability | agentbuddy | OpenDots | openmuse | openbot | Octop | openagents | Velozity |
|---|---|---|---|---|---|---|---|
| Form | .NET 10 / Avalonia native desktop | Web+Mobile template | RN/Expo/Web app | Electron desktop | Self-hosted single process | Agent collaboration OS | Cloud AI Office (SaaS) |
| Backend | agenthub (self-host) | CopilotKit runtime | CopilotKit runtime | Local agent CLIs | Octop Harness | Network SDK (self-host) | Closed cloud |
| Multi-agent | Roles via `persona` (F10) | Specialist Dots | Single personal agent | Many persistent agents | Expert teams + AgentTeams | Any agent in one workspace | User-built AI workforce |
| Computer use | Leased sandbox: docker (default), gVisor, Kata, bubblewrap, hosted runtime or a node you enrolled (F17) | OpenBot container | Playwright browser | Computer Use (cua) | Browser AI+ / remote desktop | Shared browser | Not public |
| Human-in-loop | HITL park/resume (F4) | Approve & save/run | Review before send | Full access (preview) | Tool approval + PII redact | @mention / autonomous | Human + agent collab |
| Scheduling | Trigger router: cron / thread / channel / manual → rules → batched assessor → ticket → worker (F13) | Background turns | Goals & tracking | Webhook routines | Natural-language cron | Channel pickup | Smart scheduling |
| Skills / Knowledge | `kind=skill` + mock RAG (F14) | Auto-learn | — | Local skills | Company Brain | — | Company Brain |
| Channels | Slack / Teams / Telegram / SMS (F6) | Slack | Gmail / Calendar | Desktop / Mobile | IM omnichannel | Workspace threads | Chat + voice cabins |
| Voice | Record → transcribe → delegate (F8) | WebRTC calls | — | Mobile WebRTC | — | — | Voice / video cabins |
| Execution isolation | Server-side leases; this desktop can also serve as a node (BYOM) | — | — | — | — | — | — |
| Self-host | Yes (desktop + agenthub) | Docker | Docker / Render | Local / server | Single process | Self-host network | No (SaaS) |

## License

MIT.

## Engineering conventions

This repository follows Harness Engineering:

- [`AGENTS.md`](AGENTS.md): entry point and directory index for agent engineering context
- [`requirements.md`](requirements.md): requirement spec (scope / errors / acceptance, reviewed by a human before coding)
- [`task.md`](task.md): implementation checklist
