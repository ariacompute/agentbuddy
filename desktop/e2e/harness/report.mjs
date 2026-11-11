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

/** Base64 PNG from a WebDriver screenshot, saved only on failure. */
export function saveFailureScreenshot(base64, name) {
  if (!base64) return null
  const safe = String(name).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120)
  const file = artifactPath(`failure-${safe}-${Date.now()}.png`)
  try {
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
