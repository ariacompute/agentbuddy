// agentbuddy version stamper (zero-dependency, mirrors scripts/make-icon.mjs).
//
// Usage: bun scripts/stamp.mjs <semver>
//
// Writes the given version into Cargo.toml and tauri.conf.json so the release
// build (and the desktop about screen) carry the tagged version, without a
// hand-edit that can drift between the two sources of truth. The CI workflow
// does the same edit with sed; this exists for local `make stamp VERSION=x.y.z`
// builds where no tag is checked out.
//
// Usage: bun scripts/stamp.mjs   (or: node scripts/stamp.mjs)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runAsEntry } from './lib/entry.mjs'

const TAURI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri')

const SEMVER = /^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/

/** A release tag is a version, not a string: `winter` and `1.4` are refused. */
function parseVersion(raw) {
  const version = String(raw || '').trim()
  if (!SEMVER.test(version)) throw new Error('usage: stamp.mjs <semver>')
  return version
}

/**
 * Replace the single version line in `file`. Throws instead of exiting so the
 * caller (CLI or test) decides what a missing line means.
 */
function replaceIn(file, pattern, replacement, missing) {
  const text = readFileSync(file, 'utf8')
  const next = text.replace(pattern, replacement)
  if (next === text) throw new Error(missing)
  writeFileSync(file, next)
}

/**
 * Stamp `version` into `<tauriDir>/Cargo.toml` and `<tauriDir>/tauri.conf.json`.
 * Both files are the source of truth for a different consumer (cargo, the
 * bundler), so both are written or the run fails loudly.
 */
function stamp(tauriDir, rawVersion) {
  const version = parseVersion(rawVersion)
  replaceIn(
    resolve(tauriDir, 'Cargo.toml'),
    /^version = "[^"]*"/m,
    `version = "${version}"`,
    'stamp: Cargo.toml version line not found',
  )
  replaceIn(
    resolve(tauriDir, 'tauri.conf.json'),
    /"version":\s*"[^"]*"/,
    `"version": "${version}"`,
    'stamp: tauri.conf.json version field not found',
  )
  return version
}

function main(tauriDir = TAURI_DIR, argv = process.argv.slice(2)) {
  try {
    const version = stamp(tauriDir, argv[0])
    console.log(`stamped agentbuddy ${version} into Cargo.toml + tauri.conf.json`)
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}

runAsEntry(import.meta.url, main)

export { TAURI_DIR, parseVersion, stamp, main }
