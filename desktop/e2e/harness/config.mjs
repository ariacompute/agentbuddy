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
 * Reads the run configuration. In stub mode `serverUrl` is filled in later by
 * the orchestrator once the stub has been bound to an ephemeral port.
 */
export function readE2eConfig(env = process.env) {
  const backend = (env.E2E_BACKEND || 'stub').toLowerCase()
  if (backend !== 'stub' && backend !== 'live') {
    throw new Error(`E2E_BACKEND must be 'stub' or 'live', got '${backend}'`)
  }
  const artifactsDir = env.E2E_ARTIFACTS || path.join(E2E_ROOT, 'artifacts')
  return {
    backend,
    serverUrl: backend === 'live' ? (env.E2E_SERVER_URL || '') : '',
    credentials: backend === 'live'
      ? { email: env.E2E_LIVE_EMAIL || '', password: env.E2E_LIVE_PASSWORD || '' }
      : { ...STUB_CREDENTIALS },
    allowDestructive: backend === 'stub' ? true : truthy(env.E2E_LIVE_ALLOW_DESTRUCTIVE),
    appBinary: env.E2E_APP_BIN || path.join(SRC_TAURI, 'target', 'debug', exe('AgentBuddy')),
    driverUrl: env.E2E_DRIVER_URL || 'http://127.0.0.1:4444',
    driverBin: env.E2E_TAURI_DRIVER || path.join(os.homedir(), '.cargo', 'bin', exe('tauri-driver')),
    nativeDriver: env.E2E_NATIVE_DRIVER || '',
    configDir: env.AGENTBUDDY_E2E_CONFIG_DIR || path.join(os.tmpdir(), `agentbuddy-e2e-${process.pid}`),
    artifactsDir,
    sessionFile: path.join(artifactsDir, 'session.json'),
    reportFile: path.join(artifactsDir, 'run.json'),
    eventsFile: path.join(artifactsDir, 'events.jsonl'),
    webDist: path.join(WEB_ROOT, 'dist', 'index.html'),
    timeoutMs: Number(env.E2E_TIMEOUT_MS || 30_000),
    startupMs: Number(env.E2E_STARTUP_MS || 120_000),
    headed: truthy(env.E2E_HEADED),
    skipWebdriver: truthy(env.E2E_CONTRACT_ONLY),
  }
}

/**
 * Checks everything a desktop run needs before we spawn a single process.
 * A failed check does not fail the suite: the orchestrator marks the run
 * skipped with a human-readable reason, while the stub's own contract specs
 * (which need no toolchain) still run and stay meaningful on a bare Windows box.
 */
export async function preflight(cfg, serverUrl) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  add('server URL', /^https?:\/\/\S+$/i.test(serverUrl), serverUrl)
  add('web bundle', fs.existsSync(cfg.webDist), cfg.webDist)
  add('desktop binary', fs.existsSync(cfg.appBinary), cfg.appBinary)
  add('tauri-driver', fs.existsSync(cfg.driverBin) || !!which('tauri-driver'), cfg.driverBin)

  if (process.platform === 'win32') {
    const edge = cfg.nativeDriver || which('msedgedriver')
    add('msedgedriver', !!edge, edge || 'not on PATH; set E2E_NATIVE_DRIVER')
  } else if (process.platform === 'linux') {
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

  const failed = checks.filter((c) => !c.ok)
  return {
    ok: failed.length === 0,
    checks,
    reason: failed.map((c) => `${c.name}: ${c.detail}`).join('; '),
  }
}
