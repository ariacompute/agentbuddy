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
  default on first run. The workbench sends an in-app path with each one
  (`{"title","body","link"}`), and clicking the toast actually navigates there: the
  shell parks the path, and on a body click (`tap`) restores the window and assigns
  `window.location.hash`, which is a real route change for the hash-based workbench.
  Only same-origin paths are accepted (`//host`, `javascript:` and control
  characters are refused), the value is JSON-encoded before it reaches `eval`, and
  a click consumes it once.
- **Auto-update**: at startup and then once every 24 hours the shell probes both
  `github.com/ariacompute/agentbuddy` and `gitee.com/ariacompute/agentbuddy` in
  parallel, using whichever mirror answers fastest — no IP or location lookup, and
  a failed mirror falls back to the other. Semver comparison plus OS/architecture
  matching pick the signed package for this machine. A newer release raises a
  system notification (clicking it opens Settings) and shows a settings card, a
  sidebar banner and an About-page status. "Upgrade now" lets
  `tauri-plugin-updater` verify the minisign signature, install and restart;
  automatic checks can be switched off and a version skipped. Platforms without a
  published package get a manual-download link instead of a retry loop.
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
- **Proxy admission control**: binding to `127.0.0.1` keeps the network out, not
  the machine, so the port is no longer enough on its own. Each launch mints a
  256-bit token and a single-use bootstrap nonce; the window opens
  `/__shell/bootstrap?nonce=…`, receives
  `ab_proxy=<token>; HttpOnly; SameSite=Strict` and is redirected to `/`. Every
  other route — `/api`, `/a2a`, `/__shell/*`, the static bundle — requires that
  cookie, or `Authorization: Bearer` for a native client, and a request whose
  `Origin` names another site is refused before the cookie is inspected. The
  token never enters JavaScript (so an injected script cannot read it) and is
  stripped from anything forwarded upstream. A wrong guess at the nonce does not
  spend it: guessing 256 bits is hopeless, while clearing it would let any local
  process deny the window its one startup.
- **Content security policy**: the window opens a plain loopback origin, so the
  CSP in `tauri.conf.json` never reaches those responses — the proxy sends its
  own, `script-src 'self'` plus a fresh nonce per response, which is why the
  first-paint theme script lives in `web/public/theme-init.js` instead of inline.
  Policies the server chose are forwarded untouched: only hop-by-hop headers are
  dropped, so upstream `Content-Security-Policy`, `Strict-Transport-Security` and
  `X-Frame-Options` survive.
- **Credential store**: the saved session cookie is bearer-equivalent, so it goes
  to Windows Credential Manager (DPAPI), macOS Keychain or Linux Secret Service,
  per server URL. When no store answers — a headless box, a locked keychain — the
  shell falls back to an owner-only `session.json`, logs the fact, and reports the
  backend as `sessionBackend` through `/__shell/config`. An existing plaintext
  session is migrated on first read and then deleted.

## 3. Workbench

- **Vue 3 + Vite (bun)** workbench hosted by the shell, with a left sidebar +
  right content layout.
- **Screens**: the original eight — Login, Workspace, Threads, TaskTrace, Org,
  Channels, Connectors and Settings — plus the agent-capability screens, with
  Threads and Tasks each gaining a dedicated list view alongside their detail
  views, and Schedules growing from a goal list into a scheduler console. Persona
  and Knowledge now have sidebar entries: both had a route and a screen, but only
  `/persona` was reachable by typing the URL and the knowledge screen did not
  exist at all.
- **No orphan wrappers**: every named export of `lib/api.js` must be referenced by
  at least one screen, enforced by `tests/api-usage.spec.js` with an empty
  allow-list. `tests/round4.spec.js` pins each screen→endpoint pairing with both a
  success and a failure case, so "the wrapper exists but nothing calls it" fails
  the build instead of hiding.
- **Screen wiring**: the Org catalogue can register a resource from the UI
  (`POST /api/resources`), the Connectors screen lists a connector's declared
  actions on demand (`GET /api/connectors/{id}/actions`), the Computers screen
  lists agent computer cards and deletes one after re-reading it
  (`GET /api/computers`, `GET/DELETE /api/computers/{id}`), the Scheduler shows
  the router's intake policies and saves them
  (`GET /api/router/policies`, `PUT /api/router/policies/{source}`), triggers and
  tickets expand into their body and verdict, live router frames refresh the lists,
  and a thread composer offers `@` mention candidates from the agents that have
  spoken and can stop delegating (`DELETE /api/router/subscriptions/{threadId}`).
- **Deletes mean gone**: agenthub answers 404 — no longer 204 — when a delete targets an
  id the caller cannot see, so a goal, channel, computer or file removed on another
  machine comes back as `schedule_not_found` / `channel_not_found` / `computer_not_found` /
  `file_not_found`. All four screens take that as "already done" and reload, instead of
  raising a refusal in front of a row that no longer exists; every other failure still
  surfaces with localized copy and leaves the row in place.
- **i18n & theme**: a language switcher (13 languages) and light/dark theme,
  persona avatars and a notification center.

## 4. Channels, Connectors & Speech

- **Channels**: bind Slack / Teams / Telegram / SMS surfaces to threads; view
  deliveries and configure signing keys (env-var name only). A failed delivery
  carries a retry action (`POST /api/channels/{id}/deliveries/{did}/retry`), a
  delivered one offers none, and every channel error renders localized copy
  instead of the raw code.
- **Connectors**: list `kind=mcp` resources, set the `off / ask_first / allowed`
  policy, and fire actions; `ask_first` surfaces an in-app HITL approval card.
- **Speech**: record a voice clip, upload it (multipart) to
  `POST /api/threads/{id}/audio`, and play back the agent's TTS reply.

## 5. Agent Capability Views

Mirroring agenthub's F10–F16, the workbench gains views over the agent capability
surface. The scheduler drives agenthub's real trigger router; the rest are
deterministic scaffolds, with deep behaviours still marked `TODO(real)` on the
server side:

- **Execution environments**: the Computers screen is now a console over agenthub's
  sandbox control plane — a provider catalogue grouped by isolation layer with each
  backend's availability *and its reason*, a five-metric water level (active leases /
  queued jobs / online nodes / recent runs / last sweep), lease cards with an expiry
  countdown, and an audit drawer with a try-it runner. Revoking a lease asks first;
  a screen with the feature switched off says "sandboxes are off" and how to turn it
  on, rather than drawing a water level of zero.
- **Scheduler**: reads agenthub's trigger router instead of a mock ticker — a
  water-level strip (to decide / running / awaiting a person / last batch /
  last pass), the goal's run history as a timeline that links into the real
  task trace, and the recent trigger stream with the verdict on every row
  (`GET /api/router/stats`, `/triggers`, `/tickets`). "Run now" fires one goal
  (`POST /api/schedules/{id}/run`), "Run a pass" asks for a single beat
  (`POST /api/router/passes`), and a run in flight can be cancelled or handed
  back. When the server has the scheduler switched off, the screen says so
  instead of reporting a healthy row of zeros.
- **Goals**: creates, edits and deletes proactive goals — goal / cron
  expression / enabled (`GET/POST/PUT/DELETE /api/schedules`), with the cron
  expression validated on save.
- **Persona editor**: edits an agent's persona profile — role, instruction, MBTI,
  avatar and title — and persists it to agenthub through the resource update
  endpoint.

## 6. Execution Node (BYOM)

Settings gains an **Execution node** block, off by default. Turning it on asks for
confirmation first, because it lets the server run commands on this machine under the
user's identity. What it does *not* do is as important as what it does:

- **no shell** — the argv is executed directly; only an exact name from the allow list is
  accepted, so `sh`, `bash` and `cmd` are refused by construction;
- **one root** — the working root must be an absolute path, and nothing outside it can be
  read, written or run;
- **bounded** — a timeout kills the process group, output is truncated, concurrency is
  capped;
- **visible** — node id, last heartbeat and the last refusal reason are shown in the block,
  localised from the machine code the shell returns.

The node lives in the Rust process. The web view only reads its state through
`/__shell/executor`, so a compromised console page gains no filesystem or command access.

## 7. Auth & Offline Resilience

- The workbench distinguishes an expired session from a server that is down, so
  it prompts a re-login instead of reporting a false offline state, and returns
  to the login page on sign-out.
- **Quiet hours are counted from the moment you set them.** The period used to be
  anchored to when the settings were first read, so "mute for 30 minutes" on a tab
  that had been open for two hours produced a window already in the past and never
  muted anything. Both reading and saving now anchor at the current time.

## 8. Cross-platform Build & Release

- `deb` + portable tarball (Linux), `dmg` + portable tarball (macOS aarch64),
  `msi` + portable zip (Windows), plus `SHA256SUMS`.
- With `UPDATER_PUBKEY` and `TAURI_SIGNING_PRIVATE_KEY` set as repository secrets,
  the public key is injected into `desktop/src-tauri/src/upgrade/mod.rs` before
  `tauri build` and compiled into the binary (never committed), and the release
  carries signed updater archives, `latest.json` (GitHub asset URLs) and
  `latest-gitee.json` (Gitee asset URLs). Gitee mirrors rename the latter to
  `latest.json` and upload the very same archives and `.sig` files; each manifest
  only ever points at its own mirror. Without the signing key, the six original
  assets are published exactly as before and clients fall back to manual download.
- Building from source on Linux also needs `libdbus-1-dev` and `pkg-config`: the
  session lives in the Secret Service, which is reached over D-Bus. Windows and
  macOS need nothing extra — Credential Manager and Keychain are part of the OS.

## 9. Tests

- Vitest covers i18n completeness, the monochrome guard, connector policy,
  monitor, notifications, voice, the auth guard and shell root, the modal and
  the recorder, the API client (one case per endpoint wrapper, so a moved route
  fails here rather than on one screen), plus a suite per view (filters, budget,
  persona switching, goal create/toggle/delete plus every failure path, schedule
  water level and countdown, channel create/delete/retry and the SMS-only
  destination field, the execution-environment console and its lease actions,
  sign-in and sign-up, one screen→endpoint suite with both the success and the
  failure path, an export-usage guard over `lib/api.js`, and a suite for the
  branches the happy paths never took, plus the shared-files screen and the
  connector approval queue, and a follow-up pass over the arms a happy path never
  takes: a failure with no machine code, a row missing its MIME type or name, an
  approval without arguments, and the upgrade card with all three shell routes,
  every status machine code and the no-shell path). A final pass calls the
  handlers behind disabled controls directly (early returns, empty bodies,
  unknown machine codes) and server-renders the no-`window` setup branch.
  **31 spec files, 770 cases**, all offline.
- `bun run test:coverage` (v8, `make web-coverage`) reports **100%** of statements,
  lines, branches and functions (10989 statements, 1804 branches, 433 functions).
  No defensive arm is left untested and no file is excluded from the report.
- `cargo test` covers the proxy (admission control, the nonce handshake, cookie
  rewriting, streaming, the origin gate), config (language fallback, per-server
  session storage, the plaintext migration), i18n (every locale carries every key
  in English order, codes pinned to `web/src/lib/languages.js`) and the tray
  mapping — 180 cases, including this round's tray badge (`badge_text` /
  `title_for`: zero, `99+`, one assertion per language) and five for static
  file serving (the real `app_version_stamp()` shape instead of a copy of its
  format string; a client route answered with the shell and a **per-response**
  CSP nonce; a missing asset as a 404 rather than the SPA fallback; immutable
  caching for `assets/` against `no-cache` everywhere else; the about page's
  boot `page`). They run on
  Linux (WSL2) and in CI; the Windows test binary cannot start in this environment,
  so there they are compile-verified only. CI now writes the Linux run into
  `GITHUB_STEP_SUMMARY` and uploads `desktop-test.log`, and
  `make desktop-test-report` produces the same summary locally.
