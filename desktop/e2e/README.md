# Desktop application-level end-to-end testing (user perspective)

Test agentbuddy from the perspective of a real user: launch the packaged debug desktop
client, inspect elements, click, type, and read visible text inside the WebView, and
observe UI changes. We do not call Vue internals, do not read the Pinia store, and do not
add any new IPC surface. Coverage spans the 15 workbench screens plus desktop-shell
behaviors, across both happy and error paths, for a total of 13 specs / 115 cases.

## Architecture

```
Vitest (standalone config, serial) ── W3C WebDriver over fetch ──> tauri-driver
        │                                              │
        │                                              └── AgentBuddy (dev build)
        │                                                     └─ connect page / workbench WebView
        ├── /__shell/* and four-prefix upstream: in-page fetch (with bootstrap Cookie)
        ├── 401/403/CSP/SPA fallback: bare Node fetch (no credentials or foreign Origin)
        ├── single-instance / tray residency: spawn second process + raw TCP handshake on instance.json
        └── node:http deterministic stub (SSE since replay, multipart, fault injection)
                    ↑ When E2E_BACKEND=live, the entire stub is replaced by a real agenthub
```

Tauri v2's `tauri-driver` does **not** require enabling the `webdriver` feature in
Cargo.toml (official docs: "without modifying our Tauri application at all"). The only
product-side change is the optional `e2e-isolation` feature: only under this feature is
`AGENTBUDDY_E2E_CONFIG_DIR` read, redirecting `config.json` / `session.json` /
`instance.json` to a temporary directory so the user's real configuration is not polluted.
Release builds do not enable this feature, and the startup path is exactly the same as
before. Before the orchestrator lets the connect page save any config, it first checks
that `instance.json` landed in the temporary directory, otherwise it aborts immediately.
The happy and error paths of this seam are covered by `src-tauri/src/lib.rs`'s
`e2e_config_dir_tests`; CI runs it with
`cargo test --features e2e-isolation e2e_config_dir`.

## Prerequisites

| Platform | Dependencies |
| --- | --- |
| Linux (authoritative full run) | `webkit2gtk-driver` (provides `WebKitWebDriver`), `xvfb` (provides `xvfb-run`), Tauri WebKitGTK/GTK build deps (see install block below), `tauri-driver` (installed idempotently on demand by `make e2e`), Rust stable |
| Windows (best effort) | WebView2 runtime (Evergreen), `msedgedriver` (matching the WebView2 runtime version; resolved from PATH or via `E2E_NATIVE_DRIVER`), `tauri-driver` (auto-installed likewise), Rust stable |
| Common | bun ≥ 1.4.4, Node (Vitest must be launched by Node), `web/dist/index.html`, `desktop/src-tauri/target/debug/AgentBuddy[.exe]` built with `e2e-isolation` |

> The "this machine's Windows cannot launch the Rust test binary" noted in AGENTS.md
> refers to `cargo test`'s test-harness binary, **not** the dev-built desktop application
> process. But if the WebDriver components above are missing on this machine, the
> orchestrator marks the desktop cases as skipped and prints the specific missing items;
> `stub-contract.spec.js` is unaffected and always runs for real.

**Linux build dependencies (Ubuntu / Debian / WSL2)** — the Tauri v2 crate links
WebKitGTK, GTK, D-Bus, appindicator and friends, so install these *before*
`make e2e-build`:

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev libdbus-1-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev
```

(If your Tauri pins `webkit2gtk-4.0` instead of `4.1`, substitute that package name.
`webkit2gtk-driver` and `xvfb` from the table are the *runtime* WebDriver/display,
separate from these *build* libraries.)

## Running

```bash
# Default: deterministic stub, offline. Idempotently installs tauri-driver, then
# builds in the order icons → web/dist → debug desktop binary and runs the full
# user journeys.
make e2e

# Install drivers only / build only (can be run separately, but usually not needed)
make e2e-tools  # skips if already installed; no repeated network
make e2e-build

# Server-contract only (no Rust toolchain / WebDriver needed)
make e2e-contract

# Real agenthub (same set of cases; fixture-only journeys explicitly skip)
E2E_SERVER_URL=http://127.0.0.1:3500 \
E2E_LIVE_EMAIL=ops@example.test \
E2E_LIVE_PASSWORD=... \
make e2e-live
```

> `cd desktop && bun run test:e2e` runs only the tests, **without building the desktop
> app or installing drivers**; to run the desktop cases use `make e2e`. When skipped, the
> orchestrator prints the reason and the failed prerequisites directly to the terminal;
> the full checklist is still written to `artifacts/run.json`.

`make test` (web Vitest + release-script Vitest + cargo test) and the web/desktop 100%
coverage gates **are unaffected**: `desktop/vitest.config.js` only matches
`tests/**/*.spec.js` and `scripts/**/*.mjs`, and `web/vite.config.js` only matches
`src/**`. This project's `e2e/**` falls outside both, and its own `coverage.enabled =
false`.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `E2E_BACKEND` | `stub` | `stub` starts a local deterministic server; `live` connects to a real agenthub |
| `E2E_SERVER_URL` | — | Required in live mode, e.g. `http://host:port` |
| `E2E_LIVE_EMAIL` / `E2E_LIVE_PASSWORD` | — | Live-mode login credentials |
| `E2E_LIVE_ALLOW_DESTRUCTIVE` | `0` | In live mode, destructive ops (delete thread / clear task / delete file) are skipped by default; set to `1` only with an isolated account |
| `E2E_APP_BIN` | `desktop/src-tauri/target/debug/AgentBuddy[.exe]` | dev build artifact path |
| `E2E_DRIVER_URL` | `http://127.0.0.1:4444` | tauri-driver address |
| `E2E_TAURI_DRIVER` | `~/.cargo/bin/tauri-driver` (resolved via PATH if absent) | tauri-driver binary |
| `E2E_NATIVE_DRIVER` | — (falls back to a PATH-resolved `msedgedriver` / `WebKitWebDriver`) | Platform WebDriver path; if set but the file is missing, the harness falls back to a same-named binary found on PATH |
| `AGENTBUDDY_E2E_CONFIG_DIR` | auto-created under system temp | When set explicitly it is **not** deleted at the end |
| `E2E_ARTIFACTS` | `desktop/e2e/artifacts` | reports / request-log directory |
| `E2E_TIMEOUT_MS` / `E2E_STARTUP_MS` | `30000` / `120000` | element wait / startup timeout |
| `E2E_HEADED` | `0` | On Linux, do not use `xvfb-run` |
| `E2E_CONTRACT_ONLY` | `0` | Run only the stub contract cases |
| `E2E_SCREENSHOTS_DIR` | `agentbuddy/screenshots` (repo root) | screenshot output directory for `shoot.mjs` |

stub fixed credentials: `e2e@example.test` / `agentbuddy-e2e`.

## Case matrix (13 specs / 115 cases)

| spec | Coverage | Happy | Error |
| --- | --- | --- | --- |
| `stub-contract` | endpoints, auth, SSE `since` replay, multipart, fault injection, redacted logs | all endpoints 200, login swaps Cookie, CRUD, `{deleted,kept}`, delete approvals by `taskId` | 401/403/405/503 `feature_off`/500/empty/down, second decision 409, error field names, limits |
| `connect` | F1 connect page, healthz probe, cert toggle, 13 languages / RTL, preferences | successful probe and saved address, 13-language table, `ar` sets `dir=rtl` | empty / invalid / unreachable address each with localized message |
| `auth` | login, registration, OAuth config render, route guard `?next=` | return to workbench after login, deep-link bounce-back | wrong password, `email_taken`, 401 auth failure must not misreport offline vs disconnected offline banner |
| `workbench` | F2/F15 agent cards, activity feed, pending approvals | approve / reject / view / new thread | empty state, 5xx banner |
| `threads` | F3 list, create, @mention, SSE delta, batch delete, clear messages, back link | create / send / select-all delete / clear / back | cancel second confirm sends no request, list 5xx, `thread_not_found` |
| `tasks` | F4 status filter, trace / spans / artifacts, clear all, resume / cancel | filter, `{deleted,kept}` banner, cancel, resume | old server 405 → `feature_unavailable`, task not found |
| `org-channels` | F6/F16 resource create, channel CRUD toggle, delivery receipt retry | create resource / channel / toggle / retry | resource 5xx, `delivery_not_retryable` 409 |
| `connectors` | F7/F19 policy confirm, action catalog, execute, approval queue | native confirm, one-at-a-time fetch, execute park, approve | catalog read failure, approval 409, queue 5xx with retry entry |
| `computers-schedules` | F11/F13/F17/F18 sandbox water level, dry run, terminate, schedule four blocks, kick / policy | refresh / create / dry-run / terminate / create target / run now | `sbOffTitle` / `routerOff` feature-off state, 5xx |
| `persona-knowledge-files` | F8/F10/F14/F19 persona, knowledge read-only, shared files, voice fallback | edit save, filter, upload download delete | save failure, `files_disabled`, 16 MiB audio / file limit |
| `settings-i18n-theme` | settings page, 13 languages + en fallback, light/dark tokens, RTL, notification settings, accessibility, update status | `<html lang\|dir>`, paired tokens all gray, touch targets ≥44px, focus ring, reduced-motion rules | upgrade endpoint unavailable degrades |
| `shell-http` | proxy admission, four-prefix upstream, SPA fallback, security headers, `/__shell/*` | bootstrap Cookie, config read/write, badge clamp 999, notify / executor / upgrade endpoints | no token 401, foreign Origin 403, `invalid_count` / `invalid_json` / `disabled` |
| `native-behaviors` | isolated dir, single-instance recall, background residency, tray badge, deep link, update status | second launch exit code 0 and no new proxy, handshake `ok` | wrong token returns `no`, malicious `link` does not navigate |

**Locators**: `driver/selectors.mjs` reads `web/src/lib/copy/*-copy.js` directly and
resolves button / label text by the current language, so the 13 languages and `ar` RTL
share one set of cases with no hardcoded natural language in templates. Second confirms go
through the `BaseDialog` footer scope to avoid mis-clicking a same-text button on the
background page.

**Semantics WebDriver cannot see** (OS toast clicks, the `is_in_app_path` character
blacklist, one click consumes only one deep link, 13-language tray badge text, semver
skip) are covered by the existing `#[cfg(test)]` pure-function cases in
`desktop/src-tauri/src/{notify,tray,single,upgrade}/*.rs`; this suite is responsible for
pinning the observable parts of those behaviors on a real process (HTTP responses,
unchanged hash, process exit code, badge value).

## Dual-mode differences

- stub mode: each case resets fixtures and the fault table but **keeps the session**, to
  avoid kicking the WebView back to the login page. The `/__e2e/*` control plane can
  inject 401/403/405/503 `feature_off`/500/timeout/disconnect/empty/slow SSE and push SSE
  frames. A fault affects only the **next** request: after injecting, you must use
  `remount()` (leave the route then return) to trigger a component remount, otherwise the
  same hash produces no `hashchange` and the old view does not re-request. Feature-off
  states require `code=feature_unavailable` (503); `unavailable` only means the old server
  lacks the route (405). Multi-view cases (`tasks` / `connectors` / `computers-schedules`
  / `settings`) all `open()` with a `remount()` first, otherwise the previous case's
  cached action catalog, expanded panel, or scroll position pollutes the next.
  `navigateHash()` zeroes the inner `.content` scroll container: hash routes do not
  auto-reset scroll, otherwise the controls at the top of a new page fall outside the
  viewport. The focus ring is a CSSOM declaration check (2px `outline` + 2px offset):
  under WebKit, programmatic `focus()` does not guarantee `:focus-visible`, and reading
  computed style yields a false 0px.
- live mode: the stub is not started; the connect page is filled directly with
  `E2E_SERVER_URL`. Journeys that depend on deterministic fixtures (hardcoded `thread-1` /
  `task-2` / approval queue, fixed row counts, fault injection, SSE push) are uniformly
  marked `it.skipIf` by `e2eContext().fixtures` — an **explicit skip** in the report, not
  a silent pass after an empty run. Assertions unrelated to data still validate against
  the real server contract; for example an empty JSON-RPC envelope is
  `404 / -32601 method_not_found` on agenthub rather than the stub's 200, and the settings
  version label must be resolved in the current language with a real `/healthz` value.
  Destructive operations require `E2E_LIVE_ALLOW_DESTRUCTIVE=1` and an isolated account to
  avoid polluting the real PostgreSQL. The file-upload case uses a unique temp filename
  each time and best-effort cleans up in `finally` to avoid an `EPERM` from a lingering
  Windows handle that would make the next journey falsely fail.

## Screenshot generation (live mode only)

`shoot.mjs` runs only `specs/screenshots.spec.js`: it reuses the globalSetup live path
(build → start tauri-driver → open desktop session → connect to the real server → log in),
then re-attaches to the single logged-in session and captures one light-theme
real-desktop screenshot for each of the 15 routes in English (en) and Chinese (zh) — 30
PNGs total — written to `agentbuddy/screenshots/<lang>/<NN>_<feature>.png`. Each file name
is prefixed with a zero-padded index (`01_`, `02_`, …) following the route order
Login, Workbench, Threads, Thread, Tasks, Task, Organisation, Channels, Connectors,
Computers, Schedules, Knowledge, Files, Persona, Settings. The `<feature>` part uses the
feature's own language (English feature name / Chinese `navXxx` copy, e.g.
`en/02_Workbench.png`, `zh/02_工作台.png`); the directory is separate from
`desktop/e2e/artifacts`.

Prerequisites are the same as the "Running" section: the debug binary with `e2e-isolation`,
`tauri-driver`, `webkit2gtk-driver` (provides `WebKitWebDriver`), `xvfb` for headless runs,
and a reachable `E2E_SERVER_URL`.

Steps:

1. **Build the debug desktop binary** (with `e2e-isolation`; when `web/dist` already
   exists only the Rust build is needed):

   ```bash
   make e2e-build
   # or Rust only: cd desktop/src-tauri && cargo build --features e2e-isolation
   ```

2. **Install the Linux WebDriver, a virtual display, and `tauri-driver`** (Ubuntu / Debian):

   ```bash
   # runtime WebDriver + virtual display
   sudo apt-get update
   sudo apt-get install -y webkit2gtk-driver xvfb
   # webkit2gtk-driver provides WebKitWebDriver; xvfb provides xvfb-run for headless runs.

   # tauri-driver — installs idempotently (skips if already present); falls back to
   # `cargo install tauri-driver --version '^2'` if the Make target is unavailable.
   make e2e-tools
   ```

   The harness resolves `WebKitWebDriver` and `tauri-driver` from PATH; set
   `E2E_NATIVE_DRIVER` only to override the native driver explicitly. For a visible
   window instead of the xvfb headless display, set `E2E_HEADED=1`.

   **Chinese (`zh`) text**: the WebKitGTK webview renders with system fonts, so a
   machine without CJK fonts produces `zh/*.png` full of tofu boxes / garbled glyphs
   (the `en/*.png` are unaffected because Latin fonts exist). Install them once and
   refresh fontconfig:

   ```bash
   sudo apt-get install -y fonts-noto-cjk fonts-wqy-zenhei fonts-wqy-microhei
   fc-cache -fv
   ```

   then re-run `shoot.mjs`.

3. **Start the real agenthub and ensure `E2E_SERVER_URL` is reachable**, then run the
   entry point. The login account is read from `E2E_LIVE_EMAIL` / `E2E_LIVE_PASSWORD`
   (no committed defaults — set them in your environment before running):

   ```bash
   E2E_SERVER_URL=http://localhost:3500 node desktop/e2e/shoot.mjs

   # for a visible window instead of xvfb:
   E2E_HEADED=1 E2E_SERVER_URL=http://localhost:3500 node desktop/e2e/shoot.mjs
   ```

The exit code reflects the number of failures (non-zero if any screen fails); a
single-screen failure only writes a failure screenshot and records it in `events.jsonl`,
without affecting the rest. The `:id` routes (`/threads/:id`, `/tasks/:id`) resolve a real
id at runtime from `/api/threads` / `/api/tasks`; if none is found, it falls back to a
placeholder and still captures one.

## Artifacts

`desktop/e2e/artifacts/` (gitignored):

- `run.json` — this run's status, `backend`, proxy origin, each prerequisite check result, skip reason
- `session.json` — URL / sessionId for each spec to re-attach to the same WebDriver session
- `events.jsonl` — success / failure audit of each user step
- `requests.jsonl` — requests the stub received, only `method/path/query/status/at`; Cookie, Authorization, password, and email are all redacted
- `failure-*.png` — WebView screenshots written **only on failure**

## Acceptance

1. `make e2e-contract` is green on any machine (8 contract cases run for real).
2. The Linux CI `e2e` job passes all 115 cases; `run.json`'s `status` is `finished`.
3. `make e2e-live`, after configuring an isolated account and a real agenthub, passes the
   same set of cases except the explicit skips.
4. `make test`, `cd web && bun run test:coverage`, and `cd desktop && bun run
   test:coverage` all remain unchanged (statement / line / branch / function 100%).
