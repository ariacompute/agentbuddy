# agentbuddy

[English](README.md) | [中文](README_cn.md)

A desktop client for the [agenthub](https://github.com/ariacompute/agenthub) A2A
interconnection platform.

## Features

- Connect to any agenthub server by URL. The session lives in an HttpOnly cookie
  and is reused by the loopback proxy, so the workbench just talks same-origin.
- Agents, threads, task tracing, approvals (HITL park/resume), channels
  (Slack / Teams / Telegram / SMS webhooks), connectors (policy-gated actions),
  and voice (record → transcribe → delegate).
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

Prerequisites: [bun](https://bun.sh) 1.4+ and a Rust toolchain (edition 2021).

```bash
make web-dev      # vite dev server on :5173, proxies /api to localhost:3500
make desktop-dev  # run the shell against the freshly built console
make build        # console + a host-platform installer
```

Or build step by step with bun only (no `make`). The Tauri icons are derived
from `desktop/assets/app-icon.png` and live under `desktop/src-tauri/icons/`
(git-ignored build artefacts — see `.gitignore`), so run `bun run icons`
before `tauri build` / `tauri dev`:

```bash
cd web && bun install && bun run build  # build web/dist, embedded into the binary
cd desktop && bun install
bun run icons                           # derive Tauri icons from assets/app-icon.png
bun run build                           # tauri build for the host platform
# bun run dev                           # dev mode also needs `bun run icons` first
```

## Test

```bash
make test                           # web Vitest + release-script Vitest + desktop cargo tests, fully offline
cd web && bun run test              # Vitest: i18n completeness, monochrome guard, lib units
cd web && bun run test:coverage     # same suite, plus a v8 coverage report
cd desktop && bun run test          # release-time scripts: icons, stamp, signing, latest.json
cd desktop && bun run test:coverage # same suite, plus a v8 coverage report over scripts/
cd desktop/src-tauri && cargo test  # proxy / config / i18n units
make smoke                          # both cross-process smoke tests (see below)
```

`make smoke` runs the two tests that talk over a real socket, on `127.0.0.1`
only — nothing leaves the machine:

- `make web-smoke` — the real API client and Pinia store against a `node:http`
  stub: `refreshAll()` reaches every endpoint, the OS-toast POST arrives with a
  localised title, a 401 becomes `authExpired`, and a closed socket becomes
  `offline` (never "session expired").
- `make desktop-smoke` — a real upstream `TcpListener` plus a real `axum::serve`
  proxy driven by a real `reqwest` client: no token → 401, bootstrap nonce →
  Cookie, `/api` forwarded with the upstream `Set-Cookie` rewritten,
  `/__shell/notify` answers with a machine code, foreign `Origin` → 403.

## Release

Publishes installers through [`.github/workflows/release.yml`](.github/workflows/release.yml).
Each release has exactly nine assets: the six downloads below, `latest.json`,
`latest-gitee.json` and `SHA256SUMS`. There is no separate updater archive,
no `.sig` asset and no `updater-*.json` on the release page.

| Platform      | Portable                | Installer        |
| ------------- | ----------------------- | ---------------- |
| Linux x86_64  | `linux-x86_64.tar.gz`   | `amd64.deb`      |
| macOS aarch64 | `macos-aarch64.tar.gz`  | `aarch64.dmg`    |
| Windows x86_64| `windows-x86_64.zip`    | `x64.msi`        |

### Signed updates (one-time setup)

```bash
cd desktop
bun install
mkdir -p ~/.tauri
bunx tauri signer generate -w ~/.tauri/agentbuddy.key
```

Enter a password when prompted. The CLI prints the public key and writes
`~/.tauri/agentbuddy.key` (private) and `~/.tauri/agentbuddy.key.pub`. With a
Rust-only toolchain, `cargo install tauri-cli --version '^2' --locked` plus
`cargo tauri signer generate -w ~/.tauri/agentbuddy.key` works as well.

All three values live in repository secrets. Both key files are already
single-line base64 — use their contents verbatim:

```bash
gh secret set UPDATER_PUBKEY < ~/.tauri/agentbuddy.key.pub
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/agentbuddy.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## Execution environments

The console's **Computers** screen is an execution-environment control plane viewer: the
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
| Form | Tauri v2 desktop + Vue 3 workbench | Web+Mobile template | RN/Expo/Web app | Electron desktop | Self-hosted single process | Agent collaboration OS | Cloud AI Office (SaaS) |
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
