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

const TAURI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri')
const VERSION = process.argv[2]

const SEMVER = /^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/
if (!VERSION || !SEMVER.test(VERSION)) {
  console.error('usage: stamp.mjs <semver>')
  process.exit(1)
}

function bumpCargo() {
  const p = resolve(TAURI_DIR, 'Cargo.toml')
  const txt = readFileSync(p, 'utf8')
  const next = txt.replace(/^version = "[^"]*"/m, `version = "${VERSION}"`)
  if (next === txt) {
    console.error('stamp: Cargo.toml version line not found')
    process.exit(1)
  }
  writeFileSync(p, next)
}

function bumpTauri() {
  const p = resolve(TAURI_DIR, 'tauri.conf.json')
  const txt = readFileSync(p, 'utf8')
  const next = txt.replace(/"version":\s*"[^"]*"/, `"version": "${VERSION}"`)
  if (next === txt) {
    console.error('stamp: tauri.conf.json version field not found')
    process.exit(1)
  }
  writeFileSync(p, next)
}

bumpCargo()
bumpTauri()
console.log(`stamped agentbuddy ${VERSION} into Cargo.toml + tauri.conf.json`)
