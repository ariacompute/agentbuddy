#!/usr/bin/env node
// Called by .github/workflows/release.yml before `tauri build`.
//
// `tauri signer generate -w <file>` already writes the key files as SINGLE-LINE
// base64: base64-decoding them yields the two-line minisign text
// ("untrusted comment: ... secret key" + the key's base64 line).
// tauri-cli does exactly that decode and hands the result to
// SecretKeyBox::from_string. So TAURI_SIGNING_PRIVATE_KEY must be the CONTENT
// of the .key file verbatim — running `base64 -w0` on it would double-encode.
// A trailing space/newline added when pasting into the GitHub UI is enough to
// produce "failed to decode base64 key: Invalid padding".
//
// Normalise whitespace, accept a plain two-line minisign file as well, reject
// paths / public keys / double-encoded values early, and pass the result to the
// rest of the job through GITHUB_ENV. `tauri build` no longer signs anything;
// the same two env vars are read by `bun run tauri signer sign` after packaging.
// Nothing secret is ever printed.

import fs from 'node:fs'

const rawKey = process.env.TAURI_SIGNING_PRIVATE_KEY || ''
const rawPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''
const envFile = process.env.GITHUB_ENV
const output = process.env.GITHUB_OUTPUT

const fail = (message) => {
  console.error(`::error::${message}`)
  process.exit(1)
}
const notice = (message) => console.log(`::notice::${message}`)
const emitOutput = (name, value) => {
  if (output) fs.appendFileSync(output, `${name}=${value}\n`)
  else console.log(`output: ${name}=${value}`)
}
const SET_KEY_HINT =
  'set it with: gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/agentbuddy.key'
const B64_LINE = /^[A-Za-z0-9+/]+={0,2}$/

/** A decoded minisign *secret* key: comment line + base64 key line. */
const isSecretKeyText = (text) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return (
    lines.length >= 2 &&
    /^untrusted comment:.*secret key/i.test(lines[0]) &&
    B64_LINE.test(lines[1].trim())
  )
}

if (!rawKey.trim()) {
  emitOutput('signing_key', 'false')
  notice('No TAURI_SIGNING_PRIVATE_KEY; no signing key is passed to tauri build')
} else {
  const text = rawKey.replace(/\r\n/g, '\n').trim()
  let normalized

  if (text.startsWith('untrusted comment:')) {
    if (!isSecretKeyText(text)) {
      fail(`TAURI_SIGNING_PRIVATE_KEY looks like a public key or a truncated private key; ${SET_KEY_HINT}`)
    }
    // Plain minisign file (older CLI versions): encode the whole thing.
    normalized = Buffer.from(`${text}\n`, 'utf8').toString('base64')
    console.log('Converted a plain-text minisign key to base64 for tauri build')
  } else if (B64_LINE.test(text) && text.length % 4 === 0) {
    let decoded = ''
    try {
      decoded = Buffer.from(text, 'base64').toString('utf8')
    } catch (error) {
      fail(`TAURI_SIGNING_PRIVATE_KEY is not valid base64 (${error.message}); ${SET_KEY_HINT}`)
    }
    if (!isSecretKeyText(decoded)) {
      fail(`TAURI_SIGNING_PRIVATE_KEY does not decode to a minisign private key (double-encoded value, public key or truncated?); ${SET_KEY_HINT}`)
    }
    normalized = text
    console.log('Accepted the single-line base64 private key')
  } else {
    fail(`TAURI_SIGNING_PRIVATE_KEY must be the single-line base64 content of the .key file (or plain minisign text), not a path, a public key or a value with stray whitespace; ${SET_KEY_HINT}`)
  }

  const password = rawPassword.replace(/[\r\n]/g, '')
  if (!envFile) {
    console.log('GITHUB_ENV is not set; skipping env export (local check)')
  } else {
    // The normalised value may differ from the raw secret, so mask explicitly.
    console.log(`::add-mask::${normalized}`)
    if (password) console.log(`::add-mask::${password}`)
    fs.appendFileSync(envFile, `TAURI_SIGNING_PRIVATE_KEY=${normalized}\n`)
    fs.appendFileSync(envFile, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${password}\n`)
    console.log('Wrote normalised signing variables to GITHUB_ENV')
  }
  emitOutput('signing_key', 'true')
}
