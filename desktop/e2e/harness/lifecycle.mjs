// Process / socket / filesystem plumbing for the E2E harness.
//
// Every wait here is bounded and every child process is registered for cleanup.
// The desktop run starts three processes (stub, tauri-driver, app) and one
// WebView; a leaked one would poison the next run's single-instance assertion.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const alive = new Set()

/** Polls a predicate with a deadline instead of sleeping a fixed amount. */
export async function waitFor(predicate, label, timeoutMs = 10_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  const suffix = lastError ? ` (last error: ${lastError.message})` : ''
  throw new Error(`timed out waiting for ${label} after ${timeoutMs}ms${suffix}`)
}

/** Binds port 0 to get a free port, then releases it. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Spawns a child, keeping stdout/stderr tail for a failed run's report. */
export function spawnProcess(command, args = [], options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  })
  const handle = {
    child,
    command,
    args,
    log: [],
    exited: false,
    exitCode: null,
  }
  const collect = (chunk) => {
    const text = chunk.toString()
    handle.log.push(text)
    if (handle.log.length > 40) handle.log.shift()
    if (options.echo) process.stdout.write(text)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.once('exit', (code) => {
    handle.exited = true
    handle.exitCode = code
    alive.delete(handle)
  })
  child.once('error', (error) => {
    handle.error = error
    handle.log.push(`spawn error: ${error.message}`)
  })
  alive.add(handle)
  return handle
}

/** Kills one child (and, on POSIX, its process group). */
export async function stopProcess(handle, { signal = 'SIGTERM', graceMs = 2000 } = {}) {
  if (!handle || handle.exited) return
  const { child } = handle
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else if (child.pid) {
      try { process.kill(-child.pid, signal) } catch { child.kill(signal) }
    } else {
      child.kill(signal)
    }
  } catch { /* already gone */ }
  try {
    await waitFor(() => handle.exited, `${handle.command} to exit`, graceMs)
  } catch {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
  alive.delete(handle)
}

/** Safety net for an interrupted run. */
export async function stopAllProcesses() {
  await Promise.all([...alive].map((handle) => stopProcess(handle)))
}

/** Creates an isolated config directory for the app under test. */
export function makeConfigDir(explicit) {
  const dir = explicit || fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-e2e-'))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best effort */ }
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

/** Reads the single-instance record the app writes into its config dir. */
export function readInstanceRecord(configDir) {
  return readJson(path.join(configDir, 'instance.json'))
}

/**
 * Speaks the shell's single-instance wire protocol on the raw TCP port:
 *   -> "agentbuddy/1 show <token>\n"
 *   <- "ok\n" | "no\n"
 * A wrong token must be refused; this is the same handshake a second launch uses.
 */
export function instanceHandshake(port, token, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let buffer = ''
    const done = (value) => { socket.destroy(); resolve(value) }
    socket.setTimeout(timeoutMs)
    socket.once('error', reject)
    socket.once('timeout', () => reject(new Error('single-instance handshake timed out')))
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (buffer.includes('\n')) done(buffer.split('\n')[0].trim())
    })
    socket.once('connect', () => socket.write(`agentbuddy/1 show ${token}\n`))
  })
}

/** HTTP reachability probe with a bounded deadline. */
export async function waitForHttp(url, { timeoutMs = 10_000, expectStatus = null } = {}) {
  return waitFor(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (expectStatus !== null) return res.status === expectStatus ? res : null
      return res
    } catch {
      return null
    }
  }, `${url} to answer`, timeoutMs)
}

/** Kills the app process named in the single-instance record (driver leaves it behind). */
export function killAppByRecord(configDir) {
  const record = readInstanceRecord(configDir)
  if (!record?.pid) return null
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(record.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(record.pid, 'SIGTERM')
    }
  } catch { /* already gone */ }
  return record.pid
}
