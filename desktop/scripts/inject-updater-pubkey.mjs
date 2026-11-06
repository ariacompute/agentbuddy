#!/usr/bin/env node
// Called by .github/workflows/release.yml immediately before `tauri build`.
//
// The updater keypair lives in repository secrets, never in the source tree:
//   UPDATER_PUBKEY                  base64(minisign public key box)
//   TAURI_SIGNING_PRIVATE_KEY       base64(minisign secret key box)
//
// The SAME public key must reach TWO consumers:
//   1. src/upgrade/mod.rs -> runtime verification via `Builder::pubkey()`.
//   2. tauri.conf.json    -> `tauri build` reads `plugins > updater > pubkey`,
//      base64-decodes it, calls minisign's `PublicKeyBox::from_string`, then
//      checks it matches the signing key. Leaving that field empty makes the
//      bundle fail with "failed to convert updater pubkey: Missing comment in
//      public key", even when the runtime constant is set correctly.
//
// This script writes both files; both stay empty in git, so a local build
// without secrets keeps answering `not_configured` and produces plain bundles.
//
// GITHUB_OUTPUT receives `pubkey` / `enabled` for the rest of the job. Running
// the script locally without it just prints the would-be outputs.

import fs from 'node:fs'

const MOD_RS = 'desktop/src-tauri/src/upgrade/mod.rs'
const CONF = 'desktop/src-tauri/tauri.conf.json'
const DECL = /(pub const UPDATER_PUBKEY: &str = )"[^"]*"(;)/
const B64_LINE = /^[A-Za-z0-9+/]+={0,2}$/
const SET_KEY_HINT = 'gh secret set UPDATER_PUBKEY < ~/.tauri/agentbuddy.key.pub'
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

// tauri-cli's `pub_key()` does `base64 decode -> utf8 -> PublicKeyBox::from_string`.
// The decoded text must be a full two-line minisign public key box; a bare
// `RW…` line, an empty string or a double-encoded value is only rejected by
// minisign several minutes into bundling. Catch it here instead.
const isPublicKeyBox = (value) => {
  if (!B64_LINE.test(value)) return false
  const lines = Buffer.from(value, 'base64')
    .toString('utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (lines.length !== 2) return false
  const [comment, keyLine] = lines
  if (!/^untrusted comment: .*public key/i.test(comment)) return false
  if (/secret key/i.test(comment)) return false
  if (!B64_LINE.test(keyLine)) return false
  // 2-byte algorithm + 8-byte key id + 32-byte Ed25519 key.
  return Buffer.from(keyLine, 'base64').length === 42
}

if (signing && !key) {
  fail(`TAURI_SIGNING_PRIVATE_KEY is set but UPDATER_PUBKEY is not; tauri build reads plugins > updater > pubkey and would fail with "Missing comment in public key". Set it with: ${SET_KEY_HINT}`)
}

if (key) {
  if (!isPublicKeyBox(key)) {
    fail(`UPDATER_PUBKEY must be the single-line base64 contents of ~/.tauri/agentbuddy.key.pub, decoding to a two-line minisign public key box ("untrusted comment: ... public key" + key line). A bare key line, the plain two-line text, a secret key, a path or a double-encoded value will not work. Set it with: ${SET_KEY_HINT}`)
  }
  const source = fs.readFileSync(MOD_RS, 'utf8')
  if (!DECL.test(source)) fail(`UPDATER_PUBKEY declaration not found in ${MOD_RS}`)
  fs.writeFileSync(MOD_RS, source.replace(DECL, `$1"${key}"$2`))

  const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'))
  if (!conf.plugins?.updater) fail(`plugins.updater not found in ${CONF}`)
  conf.plugins.updater.pubkey = key
  if (signing) {
    conf.bundle = conf.bundle || {}
    conf.bundle.createUpdaterArtifacts = true
  }
  fs.writeFileSync(CONF, `${JSON.stringify(conf, null, 2)}\n`)
  console.log(`Injected UPDATER_PUBKEY (${key.length} chars) into ${MOD_RS} and ${CONF}`)
  emit('pubkey', 'true')
} else {
  emit('pubkey', 'false')
  notice('No UPDATER_PUBKEY secret; this binary will answer not_configured and offer manual download only')
}

if (signing) {
  // Local `make desktop-build` and unsigned releases keep producing plain
  // bundles, exactly as before the updater existed.
  emit('enabled', 'true')
} else {
  emit('enabled', 'false')
  notice('No TAURI_SIGNING_PRIVATE_KEY; publishing installers without updater artifacts')
  if (key) warn('UPDATER_PUBKEY is set but no signing key; this release will have no signed updater archives')
}
