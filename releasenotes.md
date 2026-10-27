# agentbuddy Release Notes

agentbuddy is the Tauri v2 desktop client for agenthub. It opens the agenthub
workbench (registry / registries / sources / trace / topology / channels /
connectors / threads / tasks) against whichever server the user points it at,
over a loopback proxy that rewrites `/api`, `/a2a`, `/healthz` and `/.well-known`.

## 0.1.0 — First release

- **Desktop shell** (Rust + Tauri v2): loopback axum proxy, tray with a Quit
  that really exits the process, system notifications via
  `tauri-plugin-notification`, and an inline connection/about screen. No backend,
  no database — agenthub is the server.
- **Workbench** (Vue 3 + Vite, bun): eight screens — Login, Workspace, Thread,
  TaskTrace, Org, Channels, Connectors, Settings — with a sidebar/topbar,
  language switcher (13 languages), light/dark theme, persona avatars and a
  notification center.
- **Channels**: bind Slack / Teams / Telegram / SMS surfaces to threads; view
  deliveries and configure signing keys (env-var name only).
- **Connectors**: list `kind=mcp` resources, set the `off / ask_first / allowed`
  policy, and fire actions; `ask_first` surfaces an in-app HITL approval card.
- **Speech**: record a voice clip, upload it (multipart) to
  `POST /api/threads/{id}/audio`, and play back the agent's TTS reply.
- **Monochrome UI**: every surface is pure greyscale (hex channels equal, no hue
  words), enforced by a Vitest style guard.
- **Cross-platform build**: `deb` + portable tarball (Linux), `dmg` + portable
  tarball (macOS aarch64), `msi` + portable zip (Windows), plus `SHA256SUMS`.
- **Tests**: Vitest (i18n completeness, monochrome, connector-policy, monitor,
  notifications, voice) and `cargo test` (proxy, config, i18n).
