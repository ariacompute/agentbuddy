// The same minisign public key must live in two files before `tauri build`
// (upgrade/mod.rs for the runtime check, tauri.conf.json for the bundler). A
// mismatch used to surface minutes into packaging, so this spec pins every way
// the read-only guard can pass or fail — including the "key leaked into git"
// direction the CI jobs rely on.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { CONF, MOD_RS } from '../scripts/inject-updater-pubkey.mjs'
import { main, readPubkeys, verifyUpdaterPubkey } from '../scripts/verify-updater-pubkey.mjs'

// 2-byte algorithm + 8-byte key id + 32-byte Ed25519 key = 42 bytes.
const KEY_LINE = Buffer.alloc(42, 7).toString('base64')
const BOX = `untrusted comment: minisign public key 4A1B2C3D\n${KEY_LINE}\n`
const PUBKEY = Buffer.from(BOX, 'utf8').toString('base64')

const modSource = (key = '') =>
  `// Upgrade support.\n\npub const UPDATER_PUBKEY: &str = "${key}";\npub const OTHER: &str = "kept";\n`
const confJson = (pubkey = '') => ({
  productName: 'agentbuddy',
  plugins: { updater: { endpoints: [], pubkey } },
})

const roots = []

function repo({ mod = modSource(), conf = confJson() } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-verify-pubkey-'))
  roots.push(root)
  mkdirSync(join(root, 'desktop/src-tauri/src/upgrade'), { recursive: true })
  if (mod !== null) writeFileSync(join(root, MOD_RS), mod)
  if (conf !== null) {
    writeFileSync(join(root, CONF), typeof conf === 'string' ? conf : `${JSON.stringify(conf, null, 2)}\n`)
  }
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('readPubkeys', () => {
  it('reads both consumers without touching them', () => {
    const root = repo()
    expect(readPubkeys({ root })).toEqual({ source: '', config: '' })
    expect(readPubkeys({ root })).toEqual(readPubkeys({ root }))
  })

  it('refuses a mod.rs without the declaration', () => {
    const root = repo({ mod: '// no constant here\n' })
    expect(() => readPubkeys({ root })).toThrow(
      /UPDATER_PUBKEY declaration not found in desktop\/src-tauri\/src\/upgrade\/mod\.rs/,
    )
  })

  it('refuses a tauri.conf.json that is not JSON', () => {
    const root = repo({ conf: '{ not json' })
    expect(() => readPubkeys({ root })).toThrow(/is not valid JSON/)
  })

  it('refuses a JSON document with no plugins block', () => {
    const root = repo({ conf: 'null' })
    expect(() => readPubkeys({ root })).toThrow(/plugins\.updater\.pubkey not found/)
  })

  it('refuses a JSON document with plugins but no updater', () => {
    const root = repo({ conf: { plugins: {} } })
    expect(() => readPubkeys({ root })).toThrow(/plugins\.updater\.pubkey not found/)
  })

  it('refuses a non-string pubkey', () => {
    const root = repo({ conf: { plugins: { updater: { pubkey: 5 } } } })
    expect(() => readPubkeys({ root })).toThrow(/plugins\.updater\.pubkey not found/)
  })

  it('defaults to the working directory', () => {
    const root = repo()
    const cwd = process.cwd()
    process.chdir(root)
    try {
      expect(readPubkeys()).toEqual({ source: '', config: '' })
    } finally {
      process.chdir(cwd)
    }
  })
})

describe('verifyUpdaterPubkey', () => {
  it('accepts the committed empty pair', () => {
    const root = repo()
    expect(verifyUpdaterPubkey({ root })).toEqual({ configured: false })
  })

  it('accepts a matching injected key', () => {
    const root = repo({ mod: modSource(PUBKEY), conf: confJson(PUBKEY) })
    expect(verifyUpdaterPubkey({ root, expectKey: true })).toEqual({ configured: true })
  })

  it('ignores the whitespace a pasted secret carries', () => {
    const root = repo({ mod: modSource(` ${PUBKEY} `), conf: confJson(`${PUBKEY}\n`) })
    expect(verifyUpdaterPubkey({ root, expectKey: true })).toEqual({ configured: true })
  })

  it('refuses a key in only the constant', () => {
    const root = repo({ mod: modSource(PUBKEY) })
    expect(() => verifyUpdaterPubkey({ root, expectKey: true })).toThrow(
      /mod\.rs holds a non-empty value while desktop\/src-tauri\/tauri\.conf\.json holds an empty value/,
    )
  })

  it('refuses a key in only the config', () => {
    const root = repo({ conf: confJson(PUBKEY) })
    expect(() => verifyUpdaterPubkey({ root, expectKey: true })).toThrow(
      /mod\.rs holds an empty value while desktop\/src-tauri\/tauri\.conf\.json holds a non-empty value/,
    )
  })

  it('refuses two different non-empty keys without echoing either', () => {
    const other = Buffer.from(`untrusted comment: minisign public key FFFF\n${Buffer.alloc(42, 9).toString('base64')}\n`, 'utf8').toString('base64')
    const root = repo({ mod: modSource(PUBKEY), conf: confJson(other) })
    let message = ''
    try {
      verifyUpdaterPubkey({ root, expectKey: true })
    } catch (error) {
      message = error.message
    }
    expect(message).toMatch(/both hold a non-empty key but the values differ/)
    expect(message).not.toContain(PUBKEY)
    expect(message).not.toContain(other)
  })

  it('refuses an empty pair when a key was expected', () => {
    const root = repo()
    expect(() => verifyUpdaterPubkey({ root, expectKey: true })).toThrow(
      /UPDATER_PUBKEY is not configured/,
    )
  })

  it('refuses a leaked key in the committed tree', () => {
    const root = repo({ mod: modSource(PUBKEY), conf: confJson(PUBKEY) })
    expect(() => verifyUpdaterPubkey({ root })).toThrow(/must stay out of the source tree/)
  })

  it('refuses a matching value that is not a minisign box', () => {
    const root = repo({ mod: modSource('not-a-key'), conf: confJson('not-a-key') })
    expect(() => verifyUpdaterPubkey({ root, expectKey: true })).toThrow(
      /not a valid minisign public key box/,
    )
  })

  it('defaults to the working directory and the committed empty pair', () => {
    const root = repo()
    const cwd = process.cwd()
    process.chdir(root)
    try {
      expect(verifyUpdaterPubkey()).toEqual({ configured: false })
    } finally {
      process.chdir(cwd)
    }
  })
})

describe('main', () => {
  it('returns 0 for the committed empty pair and records it in the summary', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo()
    const summary = join(root, 'summary.md')
    expect(main({ GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: 'abc123' }, root)).toBe(0)
    expect(log).toHaveBeenCalledWith(
      '::notice::updater pubkey contract holds (both files empty; no key in the source tree)',
    )
    const written = readFileSync(summary, 'utf8')
    expect(written).toContain('### updater pubkey contract')
    expect(written).toContain('both files empty')
    expect(written).toContain('commit: `abc123`')
  })

  it('returns 0 for an injected key and survives a missing commit', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo({ mod: modSource(PUBKEY), conf: confJson(PUBKEY) })
    const summary = join(root, 'summary.md')
    expect(main({ EXPECT_UPDATER_PUBKEY: 'true', GITHUB_STEP_SUMMARY: summary }, root)).toBe(0)
    expect(log).toHaveBeenCalledWith(
      '::notice::updater pubkey contract holds (same key in upgrade/mod.rs and tauri.conf.json)',
    )
    const written = readFileSync(summary, 'utf8')
    expect(written).toContain('same key')
    expect(written).toContain('commit: `unknown`')
  })

  it('treats 1 and yes as "a key is expected"', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo({ mod: modSource(PUBKEY), conf: confJson(PUBKEY) })
    expect(main({ EXPECT_UPDATER_PUBKEY: '1' }, root)).toBe(0)
    expect(main({ EXPECT_UPDATER_PUBKEY: 'YES' }, root)).toBe(0)
  })

  it('returns 1 and annotates a mismatch without a key', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = repo({ mod: modSource(PUBKEY) })
    expect(main({}, root)).toBe(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^::error::UPDATER_PUBKEY mismatch: /),
    )
    expect(error.mock.calls[0][0]).not.toContain(PUBKEY)
  })

  it('returns 1 when the files are unreadable', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = repo({ mod: null })
    expect(main({}, root)).toBe(1)
    expect(error.mock.calls[0][0]).toMatch(/^::error::/)
  })

  it('defaults to process.env and the working directory', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo()
    const cwd = process.cwd()
    const savedExpect = process.env.EXPECT_UPDATER_PUBKEY
    const savedSummary = process.env.GITHUB_STEP_SUMMARY
    delete process.env.EXPECT_UPDATER_PUBKEY
    delete process.env.GITHUB_STEP_SUMMARY
    process.chdir(root)
    try {
      expect(main()).toBe(0)
    } finally {
      process.chdir(cwd)
      if (savedExpect !== undefined) process.env.EXPECT_UPDATER_PUBKEY = savedExpect
      if (savedSummary !== undefined) process.env.GITHUB_STEP_SUMMARY = savedSummary
    }
  })
})
