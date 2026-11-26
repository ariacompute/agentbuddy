// One place for every E2E knob. Everything else in desktop/e2e imports this
// shape, never `process.env` directly, so a spec cannot silently disagree with
// the orchestrator about which backend it is driving.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E_ROOT = fileURLToPath(new URL('../', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const DESKTOP_ROOT = path.join(REPO_ROOT, 'desktop')
export const WEB_ROOT = path.join(REPO_ROOT, 'web')
export const SRC_TAURI = path.join(DESKTOP_ROOT, 'src-tauri')

/** The workbench's 13 languages; `ar` is the only RTL one. */
export const LANGUAGES = ['en', 'zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'pt', 'ar', 'hi']
export const isRTL = (lang) => lang === 'ar'

/** Credentials the stub accepts. Live runs must supply their own. */
export const STUB_CREDENTIALS = { email: 'e2e@example.test', password: 'agentbuddy-e2e' }

const truthy = (v) => v === '1' || v === 'true' || v === 'yes'
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name)

/**
 * Which platform owns the authoritative result.
 *
 * The desktop journeys drive a real WebView through `tauri-driver`, and only the
 * Linux path (WebKitGTK + xvfb) is the one CI runs and a green run is supposed
 * to mean. Windows (WebView2 + msedgedriver) works often enough to be useful
 * locally, but it is *advisory*: letting its result count as equal evidence
 * would make "E2E green" mean two different things depending on who ran it.
 * So the advisory path needs an explicit opt-in, and the report says which kind
 * of result this run produced.
 */
export function desktopPlatformDecision(platform = process.platform, env = process.env) {
  if (platform === 'linux') return { allowed: true, authoritative: true, reason: '' }
  const name = platform === 'win32' ? 'Windows (WebView2)' : platform
  if (truthy(env.E2E_ALLOW_BEST_EFFORT)) {
    return {
      allowed: true,
      authoritative: false,
      reason: `${name} is a best-effort platform (E2E_ALLOW_BEST_EFFORT=1): the result is advisory, Linux is authoritative`,
    }
  }
  return {
    allowed: false,
    authoritative: false,
    reason: `${name} is best-effort only; set E2E_ALLOW_BEST_EFFORT=1 to run the advisory journeys (Linux is authoritative)`,
  }
}

/**
 * Refuses a skipped desktop run when the caller said it must not be skipped.
 *
 * In CI every desktop suite is `describe.skipIf(info.skipped)`, so a run where
 * preflight failed is indistinguishable from a green one: all of them skipped
 * and exit code 0. `E2E_REQUIRE_DESKTOP=1` is how the job says "a skip is a
 * failure here", and this is the single place that turns it into one.
 */
export function requireDesktopOrThrow(cfg, skipped, reason) {
  if (!cfg?.requireDesktop || !skipped) return
  throw new Error(
    `desktop journeys were skipped (${reason || 'no reason recorded'}) but E2E_REQUIRE_DESKTOP=1 forbids a skipped run`,
  )
}

/** Locates a binary on PATH, or returns null. */
export function which(bin) {
  if (path.isAbsolute(bin) || bin.includes(path.sep)) return fs.existsSync(bin) ? bin : null
  const needle = exe(bin)
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, needle)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Resolves the platform WebDriver (Windows `msedgedriver` / Linux `WebKitWebDriver`).
 * An explicit `E2E_NATIVE_DRIVER` that does not exist is ignored in favour of one
 * found on PATH, so a misconfigured absolute path does not silently break
 * `tauri-driver` startup with a cryptic "can not find the supplied binary path".
 */
export function resolveNativeDriver(env = process.env) {
  const explicit = env.E2E_NATIVE_DRIVER
  if (explicit && fs.existsSync(explicit)) return explicit
  return which('msedgedriver') || which('WebKitWebDriver') || which('webkit2gtk-driver') || ''
}

/**
 * Reads the run configuration. In stub mode `serverUrl` is filled in later by
 * the orchestrator once the stub has been bound to an ephemeral port.
 *
 * `platform` is a parameter so the platform policy can be exercised off Linux;
 * every caller passes the default.
 */
export function readE2eConfig(env = process.env, platform = process.platform) {
  const backend = (env.E2E_BACKEND || 'stub').toLowerCase()
  if (backend !== 'stub' && backend !== 'live') {
    throw new Error(`E2E_BACKEND must be 'stub' or 'live', got '${backend}'`)
  }
  const artifactsDir = env.E2E_ARTIFACTS || path.join(E2E_ROOT, 'artifacts')
  const screenshotsDir = env.E2E_SCREENSHOTS_DIR || path.join(REPO_ROOT, 'screenshots')
  const policy = desktopPlatformDecision(platform, env)
  return {
    backend,
    serverUrl: backend === 'live' ? (env.E2E_SERVER_URL || '') : '',
    credentials: backend === 'live'
      ? { email: env.E2E_LIVE_EMAIL || '', password: env.E2E_LIVE_PASSWORD || '' }
      : { ...STUB_CREDENTIALS },
    allowDestructive: backend === 'stub' ? true : truthy(env.E2E_LIVE_ALLOW_DESTRUCTIVE),
    appBinary: env.E2E_APP_BIN || path.join(SRC_TAURI, 'target', 'debug', exe('AgentBuddy')),
    driverUrl: env.E2E_DRIVER_URL || 'http://127.0.0.1:4444',
    driverBin: env.E2E_TAURI_DRIVER || which('tauri-driver') || path.join(os.homedir(), '.cargo', 'bin', exe('tauri-driver')),
    nativeDriver: resolveNativeDriver(env),
    configDir: env.AGENTBUDDY_E2E_CONFIG_DIR || path.join(os.tmpdir(), `agentbuddy-e2e-${process.pid}`),
    artifactsDir,
    screenshotsDir,
    sessionFile: path.join(artifactsDir, 'session.json'),
    reportFile: path.join(artifactsDir, 'run.json'),
    eventsFile: path.join(artifactsDir, 'events.jsonl'),
    webDist: path.join(WEB_ROOT, 'dist', 'index.html'),
    timeoutMs: Number(env.E2E_TIMEOUT_MS || 30_000),
    startupMs: Number(env.E2E_STARTUP_MS || 120_000),
    headed: truthy(env.E2E_HEADED),
    // Contract-only means "no WebDriver": the stub contract and the cross-repo
    // contract run, every desktop journey and every desktop prerequisite is out
    // of scope. Live contract-only is how CI checks a real agenthub.
    skipWebdriver: truthy(env.E2E_CONTRACT_ONLY),
    // The platform policy, resolved once: `authoritative` is what the report
    // publishes, `bestEffortAllowed` is what the preflight can refuse on.
    platform,
    authoritative: policy.authoritative,
    bestEffortAllowed: policy.allowed,
    platformReason: policy.reason,
    requireDesktop: truthy(env.E2E_REQUIRE_DESKTOP),
  }
}

/**
 * Checks everything a desktop run needs before we spawn a single process.
 * A failed check does not fail the suite: the orchestrator marks the run
 * skipped with a human-readable reason, while the contract specs (which need no
 * toolchain) still run and stay meaningful on a bare Windows box.
 *
 * Contract-only runs skip the desktop half entirely, so they only require a
 * reachable server (plus live credentials); asking for a binary or a driver
 * there would report failures that have nothing to do with the contract.
 */
export async function preflight(cfg, serverUrl) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })
  const summarize = () => {
    const failed = checks.filter((c) => !c.ok)
    return {
      ok: failed.length === 0,
      checks,
      reason: failed.map((c) => `${c.name}: ${c.detail}`).join('; '),
    }
  }

  add('server URL', /^https?:\/\/\S+$/i.test(serverUrl), serverUrl)

  // Contract-only runs drive the API with plain fetch: no WebView, no binary,
  // no driver. Checking those would turn a green cross-repo contract into a
  // page of red preflight lines that say nothing about the contract.
  if (cfg.skipWebdriver) {
    if (cfg.backend === 'live') {
      add('live credentials', !!cfg.credentials.email && !!cfg.credentials.password, cfg.credentials.email || 'E2E_LIVE_EMAIL missing')
      let reachable = false
      try {
        const res = await fetch(`${serverUrl.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(5000) })
        reachable = res.ok
      } catch { /* the check below reports it */ }
      add('live /healthz', reachable, `${serverUrl}/healthz`)
    }
    return summarize()
  }

  add('web bundle', fs.existsSync(cfg.webDist), cfg.webDist)
  add('desktop binary', fs.existsSync(cfg.appBinary), cfg.appBinary)
  add('tauri-driver', fs.existsSync(cfg.driverBin) || !!which('tauri-driver'), cfg.driverBin)

  // Linux is the platform whose result counts. Everywhere else the journeys are
  // advisory and need an explicit opt-in, so "the suite was green" cannot mean
  // the WebView2 path once and the WebKitGTK path the next time.
  if (!cfg.bestEffortAllowed) add('authoritative platform', false, cfg.platformReason)

  if (cfg.platform === 'win32') {
    const edge = cfg.nativeDriver || which('msedgedriver')
    add('msedgedriver', !!edge, edge || 'not on PATH; set E2E_NATIVE_DRIVER')
  } else if (cfg.platform === 'linux') {
    const webkit = cfg.nativeDriver || which('WebKitWebDriver') || which('webkit2gtk-driver')
    add('WebKitWebDriver', !!webkit, webkit || 'install webkit2gtk-driver')
    if (!cfg.headed) add('xvfb-run', !!which('xvfb-run'), which('xvfb-run') || 'install xvfb')
  } else {
    add('platform', false, 'tauri-driver direct mode supports Windows and Linux only')
  }

  if (cfg.backend === 'live') {
    add('live credentials', !!cfg.credentials.email && !!cfg.credentials.password, cfg.credentials.email || 'E2E_LIVE_EMAIL missing')
    let reachable = false
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(5000) })
      reachable = res.ok
    } catch { /* the check below reports it */ }
    add('live /healthz', reachable, `${serverUrl}/healthz`)
  }

  return summarize()
}
