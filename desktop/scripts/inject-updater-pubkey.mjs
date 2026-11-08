#!/usr/bin/env node
// Called by .github/workflows/release.yml immediately before `tauri build`.
//
// The updater keypair lives in repository secrets, never in the source tree:
//   UPDATER_PUBKEY                  base64(minisign public key box)
//   TAURI_SIGNING_PRIVATE_KEY       base64(minisign secret key box)
//
// The SAME public key must reach TWO consumers:
//   1. src/upgrade/mod.rs -> runtime verification via `Builder::pubkey()`.
//   2. tauri.conf.json    -> `plugins > updater > pubkey`, read by the plugin
//      config at build time and kept in sync with the runtime constant.
//
// Signing no longer happens inside `tauri build`: the release workflow signs
// the six published downloads afterwards with `tauri signer sign`. Therefore
// `bundle.createUpdaterArtifacts` is NEVER set — doing so would make the
// bundler emit a second, redundant set of updater archives and .sig files
// (including an 80+ MB Linux AppImage).
//
// This script writes both files; both stay empty in git, so a local build
// without secrets keeps answering `not_configured` and produces plain bundles.
//
// GITHUB_OUTPUT receives `pubkey` / `enabled` for the rest of the job. `enabled`
// now only gates the explicit signing step; running the script locally without
// GITHUB_OUTPUT just prints the would-be outputs.

import fs from 'node:fs'
import path from 'node:path'
import { runAsEntry } from './lib/entry.mjs'

const MOD_RS = 'desktop/src-tauri/src/upgrade/mod.rs'
const CONF = 'desktop/src-tauri/tauri.conf.json'
const DECL = /(pub const UPDATER_PUBKEY: &str = )"[^"]*"(;)/
const B64_LINE = /^[A-Za-z0-9+/]+={0,2}$/
const SET_KEY_HINT = 'gh secret set UPDATER_PUBKEY < ~/.tauri/agentbuddy.key.pub'

const notice = (message) => console.log(`::notice::${message}`)
const warn = (message) => console.log(`::warning::${message}`)
const emit = (output, name, value) => {
  if (output) fs.appendFileSync(output, `${name}=${value}\n`)
  else console.log(`output: ${name}=${value}`)
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

/**
 * Write `pubkey` into upgrade/mod.rs and tauri.conf.json under `root`, emitting
 * the job outputs. Throws on every unusable input so the CLI can turn it into a
 * `::error::` annotation with exit 1 (and a test can assert the message).
 */
function injectUpdaterPubkey({ root = process.cwd(), pubkey = '', signing = false, output = '' } = {}) {
  const key = String(pubkey || '').replace(/\s+/g, '')
  const modRs = path.resolve(root, MOD_RS)
  const confPath = path.resolve(root, CONF)

  if (signing && !key) {
    throw new Error(`TAURI_SIGNING_PRIVATE_KEY is set but UPDATER_PUBKEY is not; the client would refuse to verify any signed download. Set it with: ${SET_KEY_HINT}`)
  }

  if (key) {
    if (!isPublicKeyBox(key)) {
      throw new Error(`UPDATER_PUBKEY must be the single-line base64 contents of ~/.tauri/agentbuddy.key.pub, decoding to a two-line minisign public key box ("untrusted comment: ... public key" + key line). A bare key line, the plain two-line text, a secret key, a path or a double-encoded value will not work. Set it with: ${SET_KEY_HINT}`)
    }
    const source = fs.readFileSync(modRs, 'utf8')
    if (!DECL.test(source)) throw new Error(`UPDATER_PUBKEY declaration not found in ${MOD_RS}`)
    fs.writeFileSync(modRs, source.replace(DECL, `$1"${key}"$2`))

    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'))
    if (!conf.plugins?.updater) throw new Error(`plugins.updater not found in ${CONF}`)
    conf.plugins.updater.pubkey = key
    // Deliberately no `bundle.createUpdaterArtifacts`: the six published
    // downloads are signed explicitly after `tauri build`.
    fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`)
    console.log(`Injected UPDATER_PUBKEY (${key.length} chars) into ${MOD_RS} and ${CONF}`)
    emit(output, 'pubkey', 'true')
  } else {
    emit(output, 'pubkey', 'false')
    notice('No UPDATER_PUBKEY secret; this binary will answer not_configured and offer manual download only')
  }

  if (signing) {
    // Gates `bun run tauri signer sign` in the packaging steps; `tauri build`
    // itself still produces plain bundles.
    emit(output, 'enabled', 'true')
  } else {
    emit(output, 'enabled', 'false')
    notice('No TAURI_SIGNING_PRIVATE_KEY; publishing the six downloads unsigned, clients offer manual download')
    if (key) warn('UPDATER_PUBKEY is set but no signing key; this release will have no signatures')
  }

  return { pubkey: Boolean(key), enabled: Boolean(signing) }
}

function main(env = process.env, root = process.cwd()) {
  try {
    injectUpdaterPubkey({
      root,
      pubkey: env.UPDATER_PUBKEY,
      signing: Boolean((env.TAURI_SIGNING_PRIVATE_KEY || '').trim()),
      output: env.GITHUB_OUTPUT,
    })
    return 0
  } catch (error) {
    console.error(`::error::${error.message}`)
    return 1
  }
}

runAsEntry(import.meta.url, main)

export { MOD_RS, CONF, isPublicKeyBox, injectUpdaterPubkey, main }
