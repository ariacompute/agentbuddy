// Result artefacts. Deliberately append-only: Vitest runs globalSetup and the
// specs in different processes, so an in-memory collector would lose everything
// the worker wrote. Screenshots are only written by a failing step.
import fs from 'node:fs'
import path from 'node:path'
import { readE2eConfig } from './config.mjs'

const cfg = readE2eConfig()

/** Never let a session cookie, bearer token or password reach a log file. */
export function redact(value) {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = /^(cookie|authorization|set-cookie|password|email|api[_ -]?key|token)$/i.test(key)
        ? '***'
        : redact(entry)
    }
    return out
  }
  return value
}

export function artifactPath(name) {
  fs.mkdirSync(cfg.artifactsDir, { recursive: true })
  return path.join(cfg.artifactsDir, name)
}

export function appendEvent(event) {
  try {
    fs.mkdirSync(cfg.artifactsDir, { recursive: true })
    fs.appendFileSync(cfg.eventsFile, `${JSON.stringify(redact({ at: new Date().toISOString(), ...event }))}\n`)
  } catch { /* reporting must never break a test */ }
}

export function writeRunSummary(summary) {
  try {
    fs.mkdirSync(cfg.artifactsDir, { recursive: true })
    fs.writeFileSync(cfg.reportFile, JSON.stringify(redact({
      at: new Date().toISOString(),
      platform: process.platform,
      backend: cfg.backend,
      ...summary,
    }), null, 2))
  } catch { /* reporting must never break a test */ }
}

export function readRunSummary() {
  try { return JSON.parse(fs.readFileSync(cfg.reportFile, 'utf8')) } catch { return null }
}

/** Keeps a path safe for the filesystem while preserving Unicode (e.g. CJK) and
 * the `/` subfolder separator. Each `/`-separated segment keeps letters,
 * numbers, dot, underscore and hyphen; everything else becomes `_`. */
export function sanitizePath(name) {
  return String(name)
    .split('/')
    .map((seg) => seg.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120))
    .filter(Boolean)
    .join('/')
}

/** Base64 PNG from a WebDriver screenshot, saved only on failure. */
export function saveFailureScreenshot(base64, name) {
  if (!base64) return null
  const safe = sanitizePath(name)
  const file = artifactPath(`failure-${safe}-${Date.now()}.png`)
  try {
    fs.writeFileSync(file, Buffer.from(base64, 'base64'))
    return file
  } catch {
    return null
  }
}

/** Base64 PNG written to the screenshots directory (default agentbuddy/screenshots),
 * under `<name>.png`. `name` may contain a `/` to create a <lang>/ subfolder. */
export function saveScreenshot(base64, name) {
  if (!base64) return null
  const safe = sanitizePath(name)
  const file = path.join(cfg.screenshotsDir, `${safe}.png`)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(base64, 'base64'))
    return file
  } catch {
    return null
  }
}

/** One line per HTTP request the stub saw, with credentials stripped. */
export function writeRequestLog(requests) {
  const file = artifactPath('requests.jsonl')
  const lines = requests.map((r) => JSON.stringify(redact(r))).join('\n')
  fs.writeFileSync(file, lines ? `${lines}\n` : '')
  return file
}
