// Vitest globalSetup: build/verify → stub (or live server) → tauri-driver →
// desktop session → first-run connect → sign in. Everything is torn down in a
// `finally`, including the app process that tauri-driver leaves behind.
//
// The session is published as a JSON artifact rather than handed through
// Vitest's in-process `provide`: globalSetup and the specs live in different
// processes, and the specs only need serializable URLs/ids to re-attach.
import fs from 'node:fs'
import { preflight, readE2eConfig, which } from './config.mjs'
import {
  killAppByRecord, makeConfigDir, removeDir, spawnProcess, stopAllProcesses,
  stopProcess, waitForHttp, writeJson,
} from './lifecycle.mjs'
import { appendEvent, writeRequestLog, writeRunSummary } from './report.mjs'
import { startStub } from '../stub/server.mjs'
import { openDesktopSession } from '../driver/session.mjs'

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

    // tauri-driver inherits the isolated config dir and passes it to the app it
    // spawns. On Linux a headless run needs a display for WebKitGTK.
    const args = []
    let command = cfg.driverBin
    if (cfg.nativeDriver) args.push('--native-driver', cfg.nativeDriver)
    const xvfb = process.platform === 'linux' && !cfg.headed ? which('xvfb-run') : null
    if (xvfb) {
      args.unshift('-a', cfg.driverBin)
      command = xvfb
    }
    driver = spawnProcess(command, args, {
      env: { ...process.env, AGENTBUDDY_E2E_CONFIG_DIR: cfg.configDir },
    })
    await waitForHttp(`${cfg.driverUrl}/status`, { timeoutMs: cfg.startupMs })
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
    await cleanup('setup-failed', { reason: error.message })
    throw error
  }
}

export async function teardown() {
  await cleanup(sessionInfo?.skipped ? 'skipped-desktop' : 'finished')
}

// Vitest 2.x's loadGlobalSetupFile() prefers a `default` export and, when it
// finds one, ignores the named `teardown` entirely. Exporting setup as default
// here would therefore leave every run's processes and WebDriver session alive.
// Keep only the named setup/teardown pair so cleanup is registered.
