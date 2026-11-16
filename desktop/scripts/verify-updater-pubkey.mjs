#!/usr/bin/env node
// Read-only guard for the updater public key's cross-file contract.
//
// The same key must reach TWO files before `tauri build`:
//   • desktop/src-tauri/src/upgrade/mod.rs → the runtime constant
//   • desktop/src-tauri/tauri.conf.json   → plugins.updater.pubkey
//
// M25–M28 fixed the same omission four times (only the constant injected, only
// the config injected, wrong encoding, ...); a mismatch surfaced minutes into
// bundling as "Missing comment in public key". This script is the single place
// that compares the two, and every workflow calls it before compiling:
//   • ci.yml (desktop + e2e) → both files must be empty; a key never enters git.
//   • release.yml            → after injection, both must hold the same key.
//
// It never prints the key itself: a mismatch names the files and whether each
// side was empty, which is everything needed to fix it.

import fs from 'node:fs'
import path from 'node:path'
import { runAsEntry } from './lib/entry.mjs'
import { CONF, DECL, MOD_RS, isPublicKeyBox } from './inject-updater-pubkey.mjs'

const trim = (value) => String(value).trim()
const describe = (value) => (value ? 'a non-empty value' : 'an empty value')
const truthy = (value) => /^(1|true|yes)$/i.test(trim(value ?? ''))

/**
 * Read the two consumers without modifying either. Throws when a file is
 * missing the declaration or the plugin config, so a renamed constant or a
 * reshaped tauri.conf.json fails here instead of silently matching "".
 */
function readPubkeys({ root = process.cwd() } = {}) {
  const modRs = path.resolve(root, MOD_RS)
  const confPath = path.resolve(root, CONF)
  const source = fs.readFileSync(modRs, 'utf8')
  const match = source.match(DECL)
  if (!match) throw new Error(`UPDATER_PUBKEY declaration not found in ${MOD_RS}`)

  let conf
  try {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'))
  } catch {
    throw new Error(`${CONF} is not valid JSON`)
  }
  const updater = conf && conf.plugins && conf.plugins.updater
  if (!updater || typeof updater.pubkey !== 'string') {
    throw new Error(`plugins.updater.pubkey not found in ${CONF}`)
  }

  return { source: match[2], config: updater.pubkey }
}

/**
 * Compare the two values and enforce the expected state.
 *
 * `expectKey` distinguishes the two callers:
 *   false → the committed tree (both empty). A key in git is a leak.
 *   true  → right after injection (both non-empty, identical, usable).
 *
 * Returns `{ configured }` so the summary can say which state was proven.
 */
function verifyUpdaterPubkey({ root = process.cwd(), expectKey = false } = {}) {
  const { source, config } = readPubkeys({ root })
  const sourceKey = trim(source)
  const configKey = trim(config)

  if (sourceKey !== configKey) {
    throw new Error(
      sourceKey && configKey
        ? `UPDATER_PUBKEY mismatch: ${MOD_RS} and ${CONF} both hold a non-empty key but the values differ`
        : `UPDATER_PUBKEY mismatch: ${MOD_RS} holds ${describe(sourceKey)} while ${CONF} holds ${describe(configKey)}`,
    )
  }

  const configured = sourceKey !== ''
  if (expectKey && !configured) {
    throw new Error(
      `UPDATER_PUBKEY is not configured: ${MOD_RS} and ${CONF} are both empty, but an injected key is required`,
    )
  }
  if (!expectKey && configured) {
    throw new Error(
      `UPDATER_PUBKEY must stay out of the source tree: ${MOD_RS} and ${CONF} hold a matching non-empty key, but this check expects an empty pair`,
    )
  }
  if (configured && !isPublicKeyBox(sourceKey)) {
    throw new Error(
      `UPDATER_PUBKEY is not a valid minisign public key box: ${MOD_RS} and ${CONF} agree, but the value cannot verify a download`,
    )
  }

  return { configured }
}

function main(env = process.env, root = process.cwd()) {
  try {
    const { configured } = verifyUpdaterPubkey({
      root,
      expectKey: truthy(env.EXPECT_UPDATER_PUBKEY),
    })
    const message = configured
      ? 'updater pubkey contract holds (same key in upgrade/mod.rs and tauri.conf.json)'
      : 'updater pubkey contract holds (both files empty; no key in the source tree)'
    console.log(`::notice::${message}`)
    if (env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `### updater pubkey contract\n\n- ${message}\n- commit: \`${env.GITHUB_SHA || 'unknown'}\`\n`,
      )
    }
    return 0
  } catch (error) {
    console.error(`::error::${error.message}`)
    return 1
  }
}

runAsEntry(import.meta.url, main)

export { readPubkeys, verifyUpdaterPubkey, main }
