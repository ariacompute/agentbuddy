// Vitest globalSetup: build/verify → stub (or live server) → tauri-driver →
// desktop session → first-run connect → sign in. Everything is torn down in a
// `finally`, including the app process that tauri-driver leaves behind.
//
// The session is published as a JSON artifact rather than handed through
// Vitest's in-process `provide`: globalSetup and the specs live in different
// processes, and the specs only need serializable URLs/ids to re-attach.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { preflight, readE2eConfig, which } from './config.mjs'
import {
  freePort, killAppByRecord, makeConfigDir, removeDir, spawnProcess, stopAllProcesses,
  stopProcess, waitFor, waitForHttp, writeJson,
} from './lifecycle.mjs'
import { appendEvent, writeRequestLog, writeRunSummary } from './report.mjs'
import { startStub } from '../stub/server.mjs'
import { openDesktopSession } from '../driver/session.mjs'

// tauri-driver binds its own WebDriver endpoint on `--port`, but the native
// driver it spawns (WebKitWebDriver / msedgedriver) uses a hardcoded secondary
// port (4445) that `--port` cannot move. A leaked process from an interrupted
// run keeps one of those ports bound, so the next New Session hangs until the
// startup timeout. Kill the leftovers synchronously before spawning a fresh
// driver, then verify 4445 is actually bindable.
const NATIVE_DRIVER_PORT = 4445

function killStaleDrivers(appName) {
  const win = process.platform === 'win32'
  const names = win
    ? ['tauri-driver.exe', 'msedgedriver.exe', appName]
    : ['tauri-driver', 'WebKitWebDriver', 'webkit2gtk-driver', 'msedgedriver', appName]
  for (const name of names) {
    if (!name) continue
    try {
      spawnSync(win ? 'taskkill' : 'pkill', win ? ['/F', '/IM', name] : ['-9', '-f', name], {
        stdio: 'ignore', timeout: 5_000,
      })
    } catch { /* best effort: pkill/taskkill may be absent or match nothing */ }
  }
}

/** Resolves true when `port` can be bound on loopback right now. */
function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

let cfg = null
let stub = null
let driver = null
let wd = null
let ownsConfigDir = false
let cleaned = false
let sessionInfo = null

/** What every spec imports to decide whether it can run and how to attach. */
export function loadSession() {
  const file = readE2eConfig().sessionFile
  const fallback = { skipped: true, reason: 'E2E global setup did not publish a session', backend: 'stub' }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function publish(info) {
  sessionInfo = info
  writeJson(cfg.sessionFile, info)
}

function baseInfo(serverUrl, check, skipped, reason) {
  return {
    skipped,
    reason,
    checks: check.checks,
    backend: cfg.backend,
    serverUrl,
    stubUrl: stub?.url || '',
    proxyOrigin: '',
    driverUrl: cfg.driverUrl,
    sessionId: '',
    configDir: cfg.configDir,
    appBinary: cfg.appBinary,
    artifactsDir: cfg.artifactsDir,
    timeoutMs: cfg.timeoutMs,
    allowDestructive: cfg.allowDestructive,
  }
}

async function cleanup(status, extra = {}) {
  if (cleaned) return
  cleaned = true
  try { if (wd) await wd.delete() } catch { /* session already gone */ }
  if (cfg?.configDir) killAppByRecord(cfg.configDir)
  if (driver) await stopProcess(driver)
  await stopAllProcesses()
  try { if (stub) await stub.close() } catch { /* already closed */ }
  try {
    if (stub) writeRequestLog(stub.state.requests)
  } catch { /* reporting must never break cleanup */ }
  writeRunSummary({
    status,
    backend: cfg?.backend,
    appBinary: cfg?.appBinary,
    serverUrl: sessionInfo?.serverUrl,
    proxyOrigin: sessionInfo?.proxyOrigin,
    checks: sessionInfo?.checks,
    ...extra,
  })
  if (ownsConfigDir && cfg?.configDir) removeDir(cfg.configDir)
  appendEvent({ event: 'teardown', status })
}

export async function setup() {
  cfg = readE2eConfig()
  fs.mkdirSync(cfg.artifactsDir, { recursive: true })
  try { fs.writeFileSync(cfg.eventsFile, '') } catch { /* fresh log */ }
  appendEvent({ event: 'setup', backend: cfg.backend, platform: process.platform })
  writeRunSummary({ status: 'starting', backend: cfg.backend })

  try {
    let serverUrl = cfg.serverUrl
    if (cfg.backend === 'stub') {
      stub = await startStub({ port: 0 })
      serverUrl = stub.url
      appendEvent({ event: 'stub-started', url: serverUrl })
    }

    const check = await preflight(cfg, serverUrl)
    const skipped = cfg.skipWebdriver || !check.ok
    const reason = cfg.skipWebdriver
      ? 'E2E_CONTRACT_ONLY=1 (stub contract specs only)'
      : check.reason
    publish(baseInfo(serverUrl, check, skipped, reason))
    if (skipped) {
      // Vitest only prints `↓` for a skipped suite. Surface the reason here so
      // the terminal explains itself instead of sending the reader to run.json.
      const missing = check.checks.filter((c) => !c.ok)
      const headline = cfg.skipWebdriver
        ? reason
        : `${missing.length} preflight check(s) failed`
      const detail = missing.length
        ? `\n${missing.map((c) => `  - ${c.name}: ${c.detail}`).join('\n')}`
        : '\n  (no preflight failure; skipped by request)'
      console.warn(
        `\nagentbuddy e2e: desktop journeys skipped — ${headline}${detail}\n` +
        'The stub contract specs still run. See desktop/e2e/README.md and artifacts/run.json for the full checklist.\n'
      )
      // The stub stays up: its own contract specs need no Rust toolchain and are
      // genuinely useful on a machine that cannot run the desktop binary.
      writeRunSummary({ status: 'skipped-desktop', reason, checks: check.checks })
      appendEvent({ event: 'preflight', ok: false, reason })
      return
    }
    appendEvent({ event: 'preflight', ok: true })

    ownsConfigDir = !process.env.AGENTBUDDY_E2E_CONFIG_DIR
    makeConfigDir(cfg.configDir)

    // Leaked drivers from interrupted runs hold tauri-driver's own port and the
    // native WebDriver's hardcoded 4445 (which `--port` cannot move), so the next
    // New Session would hang for the full startup timeout. Kill synchronously,
    // then wait for 4445 to become bindable and fail fast if a foreign process
    // still owns it — instead of spending 120s on an opaque timeout. With an
    // explicit E2E_DRIVER_URL the driver is managed externally, so leave it alone.
    if (!process.env.E2E_DRIVER_URL) {
      killStaleDrivers(path.basename(cfg.appBinary))
      try {
        await waitFor(
          () => portIsFree(NATIVE_DRIVER_PORT),
          `port ${NATIVE_DRIVER_PORT} to be released`,
          5_000,
        )
      } catch {
        throw new Error(
          `port ${NATIVE_DRIVER_PORT} is still in use after killing stale drivers. ` +
          'tauri-driver binds its native WebDriver there, independent of --port. ' +
          'Free it with `pkill -9 -f WebKitWebDriver` (or msedgedriver) and retry.',
        )
      }
    }

    // tauri-driver inherits the isolated config dir and passes it to the app it
    // spawns. On Linux a headless run needs a display for WebKitGTK.
    //
    // Bind a free port instead of assuming 4444 is available: a leaked
    // tauri-driver from an interrupted run holds the default port, which would
    // make every subsequent run fail to bind and then time out at New Session.
    const args = []
    let command = cfg.driverBin
    let driverUrl = cfg.driverUrl
    if (!process.env.E2E_DRIVER_URL) {
      const port = await freePort()
      driverUrl = `http://127.0.0.1:${port}`
      cfg.driverUrl = driverUrl
    }
    const portMatch = driverUrl.match(/:(\d+)(?:\/|$)/)
    if (portMatch) args.push('--port', portMatch[1])
    if (cfg.nativeDriver) args.push('--native-driver', cfg.nativeDriver)
    const xvfb = process.platform === 'linux' && !cfg.headed ? which('xvfb-run') : null
    if (xvfb) {
      args.unshift('-a', cfg.driverBin)
      command = xvfb
    }
    driver = spawnProcess(command, args, {
      env: { ...process.env, AGENTBUDDY_E2E_CONFIG_DIR: cfg.configDir },
    })
    try {
      await waitForHttp(`${cfg.driverUrl}/status`, { timeoutMs: cfg.startupMs })
    } catch (error) {
      const tail = (driver?.log || []).join('').trim()
      throw new Error(
        `${error.message}\n` +
        `tauri-driver did not start. command=${command} args=${JSON.stringify(args)}\n` +
        (tail
          ? `tauri-driver output:\n${tail}\n`
          : '(no output captured — the binary may be missing, fail to launch, or need a different port)')
      )
    }
    appendEvent({ event: 'driver-ready', url: cfg.driverUrl })

    // openDesktopSession checks that instance.json lands in the isolated dir
    // (i.e. the binary really has the e2e-isolation feature) *before* the
    // connect form is allowed to save anything.
    const opened = await openDesktopSession(cfg, serverUrl)
    wd = opened.wd
    publish({
      ...baseInfo(serverUrl, check, false, ''),
      proxyOrigin: opened.proxyOrigin,
      sessionId: wd.sessionId,
      connection: opened.connection,
    })
    appendEvent({ event: 'session-ready', proxyOrigin: opened.proxyOrigin, sessionId: wd.sessionId })
    writeRunSummary({ status: 'running', proxyOrigin: opened.proxyOrigin, checks: check.checks })
  } catch (error) {
    // /status already answered, so tauri-driver itself is alive; a failure here means
    // the New Session (app launch) hung or the app crashed. Surface tauri-driver's
    // stderr so the real cause — missing/invalid binary, no display, a zombie
    // single-instance, or a capability error — is visible instead of a bare 120s timeout.
    const tail = (driver?.log || []).slice(-40).join('').trim()
    const reason = tail ? `${error.message}\n\ntauri-driver output:\n${tail}` : error.message
    await cleanup('setup-failed', { reason })
    throw new Error(reason)
  }
}

export async function teardown() {
  await cleanup(sessionInfo?.skipped ? 'skipped-desktop' : 'finished')
}

// Vitest 2.x's loadGlobalSetupFile() prefers a `default` export and, when it
// finds one, ignores the named `teardown` entirely. Exporting setup as default
// here would therefore leave every run's processes and WebDriver session alive.
// Keep only the named setup/teardown pair so cleanup is registered.
