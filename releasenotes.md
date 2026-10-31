# agentbuddy Release Notes

agentbuddy is the Tauri v2 desktop client for agenthub. It opens the agenthub
workbench — Workspace, Threads, Tasks, Org, Channels, Connectors, Computers,
Schedules, Persona and Settings — against whichever server the user points it at,
over a loopback proxy that rewrites `/api`, `/a2a`, `/healthz` and `/.well-known`.

## 1. Platform Overview

- **Desktop client, not a server**: agentbuddy owns no backend and no database.
  It is a Tauri v2 shell (Rust) around the agenthub web workbench, reusing
  agenthub's authentication, A2A orchestration, registry and task state machine.
- **Loopback proxy**: a Rust axum proxy bound to `127.0.0.1:0` forwards only the
  prefixes `/api`, `/a2a`, `/healthz` and `/.well-known` to the user-configured
  agenthub server; every other path falls back to the embedded SPA `index.html`.
  Adding a new `/api/*` endpoint on the server needs no desktop code change.
- **13 languages**: en / zh / zh-TW / es / fr / de / it / ru / ja / ko / pt / ar /
  hi; the shell's own copy is kept in sync with the workbench language set.
- **Pure monochrome UI**: every surface is pure greyscale (hex channels equal, no
  hue words), enforced by a Vitest style guard.

## 2. Desktop Shell

- **Tray & quit**: a tray icon with Open / Settings / About / Quit; Quit really
  exits the process.
- **System notifications**: delivered via `tauri-plugin-notification`; enabled by
  default on first run.
- **Session persistence**: the agenthub session cookie is persisted across app
  restarts — saved per server URL and resumed in the cookie jar on launch — so a
  server switch or relaunch does not force a re-login.
- **Theme**: the app defaults to the light theme, with a toggle on the
  connection/about page that sets the persisted `agentbuddy.theme`.
- **Version stamp**: a `vX.Y.Z@commit` stamp (built from the latest git tag plus
  the short commit) is shown on the login and About screens.
- **Close behaviour**: on window close the shell reads the `background`
  preference — when on (default) the window is hidden and the app stays resident
  in the tray; when off the app exits. Only the tray Quit ever force-exits.

## 3. Workbench

- **Vue 3 + Vite (bun)** workbench hosted by the shell, with a left sidebar +
  right content layout.
- **Screens**: the original eight — Login, Workspace, Threads, TaskTrace, Org,
  Channels, Connectors and Settings — plus three new agent-capability screens,
  with Threads and Tasks each gaining a dedicated list view alongside their
  detail views.
- **i18n & theme**: a language switcher (13 languages) and light/dark theme,
  persona avatars and a notification center.

## 4. Channels, Connectors & Speech

- **Channels**: bind Slack / Teams / Telegram / SMS surfaces to threads; view
  deliveries and configure signing keys (env-var name only).
- **Connectors**: list `kind=mcp` resources, set the `off / ask_first / allowed`
  policy, and fire actions; `ask_first` surfaces an in-app HITL approval card.
- **Speech**: record a voice clip, upload it (multipart) to
  `POST /api/threads/{id}/audio`, and play back the agent's TTS reply.

## 5. Agent Capability Views

Mirroring agenthub's F10–F16, the workbench gains three views over the agent
capability surface (all deterministic scaffolds on the server side; deep
behaviours remain `TODO(real)`):

- **Computers**: lists and creates per-agent `browser` / `shell` / `screen`
  sandboxes (`GET/POST /api/computers`, `GET /api/computers/{id}`).
- **Schedules**: creates, edits and deletes proactive goals — goal / cron
  expression / enabled (`GET/POST/PUT/DELETE /api/schedules`).
- **Persona editor**: edits an agent's persona profile — role, instruction, MBTI,
  avatar and title — and persists it to agenthub through the resource update
  endpoint.

## 6. Auth & Offline Resilience

- The workbench distinguishes an expired session from a server that is down, so
  it prompts a re-login instead of reporting a false offline state, and returns
  to the login page on sign-out.

## 7. Cross-platform Build & Release

- `deb` + portable tarball (Linux), `dmg` + portable tarball (macOS aarch64),
  `msi` + portable zip (Windows), plus `SHA256SUMS`.

## 8. Tests

- Vitest (i18n completeness, monochrome, connector-policy, monitor,
  notifications, voice) and `cargo test` (proxy, config, i18n).
