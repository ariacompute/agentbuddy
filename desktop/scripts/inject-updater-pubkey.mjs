#!/usr/bin/env node
// Called by .github/workflows/release.yml immediately before `tauri build`.
//
// The updater's public key is a repository secret, never a committed constant:
//   UPDATER_PUBKEY                  minisign public key (single-line base64)
//   TAURI_SIGNING_PRIVATE_KEY       minisign private key, used by tauri build
//
// This writes the public half into `src/upgrade/mod.rs` so rustc bakes it into
// the binary, and turns on `createUpdaterArtifacts` only when a signing key is
// present. A local build sets neither variable: the constant stays empty and
// "Upgrade now" safely answers `not_configured`.
//
// GITHUB_OUTPUT receives `pubkey` / `enabled` for the rest of the job. Running
// the script locally without it just prints the would-be outputs.

import fs from 'node:fs'

const MOD_RS = 'desktop/src-tauri/src/upgrade/mod.rs'
const CONF = 'desktop/src-tauri/tauri.conf.json'
const DECL = /(pub const UPDATER_PUBKEY: &str = )"[^"]*"(;)/
const key = (process.env.UPDATER_PUBKEY || '').replace(/\s+/g, '')
const signing = Boolean((process.env.TAURI_SIGNING_PRIVATE_KEY || '').trim())
const output = process.env.GITHUB_OUTPUT

const emit = (name, value) => {
  if (output) fs.appendFileSync(output, `${name}=${value}\n`)
  else console.log(`output: ${name}=${value}`)
}
const notice = (message) => console.log(`::notice::${message}`)
const warn = (message) => console.log(`::warning::${message}`)
const fail = (message) => {
  console.error(`::error::${message}`)
  process.exit(1)
}

if (key) {
  // A minisign public key is base64. Rejecting anything else keeps a pasted
  // two-line `.pub` file (or a shell injection) out of the Rust source.
  if (!/^[A-Za-z0-9+/=]+$/.test(key)) {
    fail('UPDATER_PUBKEY must be the single-line base64 minisign public key, not the two-line .pub file')
  }
  const source = fs.readFileSync(MOD_RS, 'utf8')
  if (!DECL.test(source)) fail(`UPDATER_PUBKEY declaration not found in ${MOD_RS}`)
  fs.writeFileSync(MOD_RS, source.replace(DECL, `$1"${key}"$2`))
  console.log(`Injected UPDATER_PUBKEY (${key.length} chars) into ${MOD_RS}`)
  emit('pubkey', 'true')
} else {
  emit('pubkey', 'false')
  notice('No UPDATER_PUBKEY secret; this binary will answer not_configured and offer manual download only')
}

if (signing) {
  const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'))
  conf.bundle = conf.bundle || {}
  conf.bundle.createUpdaterArtifacts = true
  fs.writeFileSync(CONF, `${JSON.stringify(conf, null, 2)}\n`)
  emit('enabled', 'true')
  if (!key) warn('Signing key is set but UPDATER_PUBKEY is not; clients cannot verify the produced archives')
} else {
  // Local `make desktop-build` and unsigned releases keep producing plain
  // bundles, exactly as before the updater existed.
  emit('enabled', 'false')
  notice('No TAURI_SIGNING_PRIVATE_KEY; publishing installers without updater artifacts')
  if (key) warn('UPDATER_PUBKEY is set but no signing key; this release will have no signed updater archives')
}
