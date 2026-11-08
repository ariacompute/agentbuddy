# agentbuddy Release Notes

agentbuddy is the **.NET 10 / Avalonia native** desktop client for agenthub. It
opens the agenthub workbench — Workspace, Threads, Tasks, Org, Channels,
Connectors, Computers, Schedules, Persona, Knowledge, Files and Settings —
against whichever server the user points it at, over an in-process loopback
gateway that forwards `/api`, `/a2a`, `/healthz` and `/.well-known`.

## 1. Platform Overview

- **Native client, not a server**: agentbuddy owns no backend, no database and no
  WebView. The XAML UI talks to an in-process Kestrel loopback gateway with
  `HttpClient`, reusing agenthub's authentication, A2A orchestration, registry
  and task state machine.
- **Loopback gateway**: bound to `127.0.0.1:0`, it forwards only the prefixes
  `/api`, `/a2a`, `/healthz` and `/.well-known` to the configured agenthub server.
  Other paths are the `/__shell/*` local control plane (or a plain 404) — there
  is no SPA fallback and no embedded `index.html`. Adding a new `/api/*` endpoint
  on the server needs no desktop code change.
- **13 languages**: en / zh / zh-TW / es / fr / de / it / ru / ja / ko / pt / ar /
  hi; one `copy.json` resource with English shallow-merge fallback, shared by
  the views and the tray menu. Arabic sets `FlowDirection=RightToLeft`.
- **Pure monochrome UI**: every surface is pure greyscale, enforced by the
  `AgentBuddy.Guards` static XAML scan; control templates only reference
  `DynamicResource Brush.*` keys.

## 2. Desktop Shell

- **Tray & quit**: a tray icon with Open / Settings / About / Quit; Quit really
  exits the process.
- **System notifications**: delivered through the platform's native channel
  (Windows toast / macOS notification centre / Linux D-Bus), enabled by default.
  The workbench sends an in-app path with each one (`{"title","body","link"}`);
  the shell parks it in `DeepLinkQueue`, and a toast click restores the window and
  hands the path to `NavigationService`. Only a single leading slash is accepted
  (`//host`, `javascript:`, backslashes and control characters are refused),
  and a click consumes the entry exactly once.
- **Auto-update**: at startup and then once every 24 hours the shell probes both
  `github.com/ariacompute/agentbuddy` and `gitee.com/ariacompute/agentbuddy` in
  parallel, using whichever mirror answers fastest — no IP or location lookup, and
  a failed mirror falls back to the other. Semver comparison plus OS/architecture
  matching pick the signed package for this machine. A newer release raises a
  system notification (clicking it opens Settings) and shows a settings card, a
  sidebar banner and an About-page status. "Upgrade now" lets `UpgradeService`
  verify the minisign-compatible Ed25519 signature, install and restart;
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
  `ab_proxy=<token>; HttpOnly; SameSite=Strict` and is redirected to `/`.   Every
  other route — `/api`, `/a2a`, `/__shell/*` — requires that
  cookie, or `Authorization: Bearer` for a native client, and a request whose
  `Origin` names another site is refused before the cookie is inspected. The
  token never enters UI code and is stripped from anything forwarded upstream.
  A wrong guess at the nonce does not spend it: guessing 256 bits is hopeless,
  while clearing it would let any local process deny the window its one startup.
- **No HTML is served**: with no WebView there is no per-response CSP nonce, no
  first-paint theme script and no version-stamp injection. The connection and
  About pages are native Avalonia windows; the theme is set via
  `RequestedThemeVariant` and the version stamp is a ViewModel binding.
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

- **Avalonia XAML + MVVM** native workbench, with a shared top bar, a left
  sidebar and a content region. Six shared controls (page header, top bar,
  sidebar, file transfer, voice, task actions) are reused across 17 views.
- **Screens**: the original eight — Login, Workspace, Threads, TaskTrace, Org,
  Channels, Connectors and Settings — plus the agent-capability screens, with
  Threads and Tasks each gaining a dedicated list view alongside their detail
  views, and Schedules growing from a goal list into a scheduler console. Persona
  and Knowledge now have sidebar entries: both had a route and a screen, but only
  `/persona` was reachable by typing the URL and the knowledge screen did not
  exist at all.
- **No orphan endpoints**: every frozen constant in `Core/Contracts/Endpoints.cs`
  must be referenced outside its own definition, enforced by `AgentBuddy.Guards`
  with an empty allow-list. Each screen declares `EndpointsUsed`, and the App
  tests pin the normal and failure paths, so "the constant exists but nothing
  calls it" fails the build instead of hiding.
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

The node lives in the .NET host process. The Avalonia view only reads its state
through `/__shell/executor`, and even the window-only capabilities (file pickers,
audio capture) are injected as delegates into headless-testable ViewModels —
the UI gains no filesystem or command-execution permission.

## 7. Auth & Offline Resilience

- The workbench distinguishes an expired session from a server that is down, so
  it prompts a re-login instead of reporting a false offline state, and returns
  to the login page on sign-out.
- **Quiet hours are counted from the moment you set them.** The period used to be
  anchored to when the settings were first read, so "mute for 30 minutes" on a tab
  that had been open for two hours produced a window already in the past and never
  muted anything. Both reading and saving now anchor at the current time.

## 8. Cross-platform Build & Release

- Six downloads: `deb` + portable tarball (Linux), `dmg` + portable tarball
  (macOS aarch64), `msi` + portable zip (Windows). Together with `latest.json`,
  `latest-gitee.json` and `SHA256SUMS` that is exactly nine assets per release.
- Each of the three matrix legs runs `dotnet publish -r <rid> --self-contained
  true`; WiX v4 (its authoring generated deterministically by `ab-tool wix`),
  `dpkg-deb` and `hdiutil` produce the installers, plus one portable archive each.
- With `UPDATER_PUBKEY` and `UPDATER_PRIVATE_KEY` set as repository secrets,
  `ab-tool inject-pubkey` writes the public key into `Shell/Upgrade/Pubkey.g.cs`
  and `ab-tool sign` signs each of the six downloads with a minisign-compatible
  Ed25519 box. The base64 signatures live inside `latest.json` (GitHub asset URLs)
  and `latest-gitee.json` (Gitee asset URLs): `platforms` points at the
  installable asset for each OS, `signatures` covers all six. No extra updater
  archive, `.sig` file or `updater-*.json` is published, and no AppImage or
  duplicate MSI is built. Gitee mirrors upload the same six downloads plus
  `latest-gitee.json` renamed to `latest.json`; each manifest only ever points at
  its own mirror. `ab-tool verify` refuses to publish unless the set is exactly
  these nine files. Without the signing key the same nine files ship with empty
  `platforms`/`signatures` and clients fall back to manual download.
- Building from source needs only the .NET 10 SDK pinned by `desktop/global.json`.
  On Linux the credential fallback uses the Secret Service over D-Bus; Windows
  Credential Manager and macOS Keychain are part of the OS.

## 9. Tests

- Four xUnit projects replace the old frontend/desktop split; **91 cases**, all
  offline, with a normal and a failure path for every new capability.
  `AgentBuddy.Core.Tests` covers 13-language fallback, endpoint contracts,
  config, SSE framing, `MonitorService` and `RealtimeService` (classification,
  `since` replay, reconnect backoff and bounded ring).
  `AgentBuddy.Shell.Tests` covers bootstrap admission (including wrong-guess
  nonce preservation), Cookie/Location rewriting, streaming forward, credential
  fallback, executor policy, upgrade source race / signature failure, deep links
  and tray badge; `GatewaySmokeTests` runs a real Kestrel loopback gateway and
  an upstream HTTP stub over real sockets, with SSE arriving incrementally.
  `AgentBuddy.App.Tests` covers Avalonia.Headless ViewModels, the route guard,
  numbered detail routes, file transfer, voice and notification deep links.
- `AgentBuddy.Guards` is the hard gate: 13-language key parity with real
  translations, monochrome `.axaml` scan, no hardcoded template text, every
  frozen endpoint constant referenced (empty allow-list), all 17 views mapped by
  the `ViewLocator`, shared-control reuse, paired theme dictionaries, .NET-only
  build/release wiring and the exactly-nine-assets release contract.
- `dotnet build agentbuddy.sln -warnaserror` is **0 warnings / 0 errors**;
  `dotnet test --collect:"XPlat Code Coverage"` produces a Cobertura report and
  CI uploads both coverage and the test log. Static guards — not line coverage —
  are the gate, so a chromatic colour or an untranslated key fails the build.
- Release verification ran locally too: a self-contained `win-x64` publish fed
  `ab-tool wix`, and WiX 4.0.6 built a real MSI from the generated 369-component
  authoring; a one-off minisign key signed six downloads, `ab-tool manifest`
  emitted both mirrors and `ab-tool verify` asserted exactly nine assets.

## 10. Security Hardening

- **The loopback port is no longer guessed.** Kestrel binds `127.0.0.1:0` and the
  actual port is read back from `IServerAddressesFeature`. The old
  bind-close-rebind dance left a window where another local process could take
  the port; `AddServerHeader` is off and the content root is pinned to the
  install directory so a stray `appsettings.json` cannot reshape the host.
- **A hostile server cannot plant credentials.** Upstream `Set-Cookie` values
  named `ab_proxy` (the gateway's own token) or carrying the `__Host-` /
  `__Secure-` prefixes are dropped outright, and only `agenthub_session` is
  written to the credential store — OAuth state and the PKCE verifier are
  forwarded but never persisted. A locked keychain now logs instead of turning a
  successful login into a 502.
- **Redirects are matched by origin, not by string prefix.** The old
  `StartsWith("https://hub.example.com")` check also matched
  `https://hub.example.com.evil.test`; the rewrite now compares scheme, host and
  port. Forwarded paths carrying `..`, a backslash or a doubled slash are
  refused with `400 invalid`, because `//host` rewrites the base URI's authority.
- **`config.json` is written atomically.** Content goes to a private temp file in
  the same directory (mode `0600` on Unix, `icacls` on Windows) and is then
  renamed over the target; the old delete-then-create lost the file on a failed
  write and left a permissive window. A corrupt or oversized config falls back to
  defaults instead of blocking startup.
- **`POST /__shell/executor` now shares the config route's validation.** It used
  to hand the raw body to `ApplyPatchAsync`, which skipped the root check,
  allowed a shell in the allowlist, and would happily write `executorApiKey` into
  `config.json` in plaintext. Both routes now run `ValidatePatch`, and the key is
  lifted out before the patch is merged.
- **Executor commands must be bare names.** `Path.GetFileName` used to decide the
  allowlist match while the original string was spawned, so `../evil/node` or
  `C:\Windows\System32\node.exe` rode in on an allowlisted basename. Commands
  must equal their own file name, and shells plus a launcher denylist (`env`,
  `sudo`, `xargs`, `timeout`, `setsid`, `docker`, `ssh`, …) are refused by
  construction. Roots and working directories are resolved through symlinks
  before the containment check, and stdout/stderr are read through a bounded
  buffer instead of `ReadToEndAsync` (a command that printed a gigabyte used to
  be buffered in full before truncation).
- **Notification text never reaches script source.** The Windows fallback now
  reads `AB_NOTIFY_TITLE` / `AB_NOTIFY_BODY` from the environment, macOS passes
  the strings as `osascript` run arguments, and Linux adds `--` before them. All
  three are clipped to one line. The deep-link queue is capped at 20 entries.
- **Every stream is bounded.** JSON responses stop at 16 MiB, a single SSE event
  at 1 MiB (framing is byte-wise, so an endless line is dropped whole and the
  next event still parses), update packages at 512 MiB, and file downloads
  return a live stream that owns its response instead of a buffered
  `MemoryStream`.
- **Signature verification is strict.** Both boxes must be exactly 42 / 74 bytes
  with the `Ed` marker and an identical 8-byte key id; the prehashed `ED`
  algorithm is refused rather than answered differently, and an installer that
  is not a plain file name is rejected before anything is written.
- 82 new cases pin all of the above (`ProxyHardeningTests`,
  `ExecutorHardeningTests`, `ConfigPatchHardeningTests`, `UpgradeHardeningTests`,
  `NotificationHardeningTests`, `CredentialHardeningTests`, `TrayHardeningTests`,
  `StreamBoundTests`, `ResponseBoundTests`, `ConfigBoundTests`) — 174 total, all
  offline, still 0 warnings.