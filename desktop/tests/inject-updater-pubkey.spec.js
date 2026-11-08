// The updater public key has to land in TWO places before `tauri build`
// (upgrade/mod.rs for the runtime check, tauri.conf.json for the bundler), and a
// wrong value is only discovered several minutes into packaging. Every rejection
// path is pinned here, because a release job hits it once and never again.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  CONF,
  MOD_RS,
  injectUpdaterPubkey,
  isPublicKeyBox,
  main,
} from '../scripts/inject-updater-pubkey.mjs'

const MOD_SOURCE = `// Upgrade support.\n\npub const UPDATER_PUBKEY: &str = "";\npub const OTHER: &str = "kept";\n`
const CONF_JSON = {
  productName: 'agentbuddy',
  version: '0.1.0',
  bundle: { active: true },
  plugins: { updater: { endpoints: [], pubkey: '' } },
}

// 2-byte algorithm + 8-byte key id + 32-byte Ed25519 key = 42 bytes.
const KEY_LINE = Buffer.alloc(42, 7).toString('base64')
const BOX = `untrusted comment: minisign public key 4A1B2C3D\n${KEY_LINE}\n`
const PUBKEY = Buffer.from(BOX, 'utf8').toString('base64')

const roots = []

function repo({ mod = MOD_SOURCE, conf = CONF_JSON } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-pubkey-'))
  roots.push(root)
  mkdirSync(join(root, 'desktop/src-tauri/src/upgrade'), { recursive: true })
  if (mod !== null) writeFileSync(join(root, MOD_RS), mod)
  if (conf !== null) writeFileSync(join(root, CONF), `${JSON.stringify(conf, null, 2)}\n`)
  return root
}

const encodeBox = (text) => Buffer.from(text, 'utf8').toString('base64')

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('isPublicKeyBox', () => {
  it('accepts a two-line public key box, CRLF included', () => {
    expect(isPublicKeyBox(PUBKEY)).toBe(true)
    expect(isPublicKeyBox(encodeBox(BOX.replace(/\n/g, '\r\n')))).toBe(true)
    // A trailing blank line before the final newline is tolerated.
    expect(isPublicKeyBox(encodeBox(`${BOX}\n`))).toBe(true)
  })

  it('refuses what minisign would refuse minutes later', () => {
    expect(isPublicKeyBox(KEY_LINE)).toBe(false) // bare key line
    expect(isPublicKeyBox('not base64!')).toBe(false)
    expect(isPublicKeyBox(encodeBox(`untrusted comment: x public key\n${KEY_LINE}\nextra\n`))).toBe(
      false,
    ) // three lines
    expect(isPublicKeyBox(encodeBox(`untrusted comment: no suffix\n${KEY_LINE}\n`))).toBe(false)
    expect(
      isPublicKeyBox(encodeBox(`untrusted comment: public key of the secret key\n${KEY_LINE}\n`)),
    ).toBe(false)
    expect(isPublicKeyBox(encodeBox('untrusted comment: x public key\n***\n'))).toBe(false)
    expect(
      isPublicKeyBox(encodeBox(`untrusted comment: x public key\n${Buffer.alloc(41).toString('base64')}\n`)),
    ).toBe(false) // 41-byte key
  })
})

describe('injectUpdaterPubkey', () => {
  it('writes both files and emits the job outputs', () => {
    const root = repo()
    const output = join(root, 'github-output')
    const result = injectUpdaterPubkey({ root, pubkey: PUBKEY, signing: true, output })

    expect(result).toEqual({ pubkey: true, enabled: true })
    expect(readFileSync(join(root, MOD_RS), 'utf8')).toContain(
      `pub const UPDATER_PUBKEY: &str = "${PUBKEY}";`,
    )
    // Everything else in the file survives the substitution.
    expect(readFileSync(join(root, MOD_RS), 'utf8')).toContain('pub const OTHER: &str = "kept";')
    const conf = JSON.parse(readFileSync(join(root, CONF), 'utf8'))
    expect(conf.plugins.updater.pubkey).toBe(PUBKEY)
    expect(conf.plugins.updater.endpoints).toEqual([])
    expect(conf.bundle).toEqual({ active: true })
    // Signing happens after `tauri build`; the bundler must never re-emit archives.
    expect(readFileSync(join(root, CONF), 'utf8')).not.toContain('createUpdaterArtifacts')
    expect(readFileSync(output, 'utf8')).toBe('pubkey=true\nenabled=true\n')
  })

  it('prints the outputs when there is no GITHUB_OUTPUT (local run)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo()
    expect(injectUpdaterPubkey({ root, pubkey: PUBKEY })).toEqual({ pubkey: true, enabled: false })
    expect(log).toHaveBeenCalledWith('output: pubkey=true')
    expect(log).toHaveBeenCalledWith('output: enabled=false')
    // A key without a signing key still publishes, just unsigned: warn, do not fail.
    expect(log).toHaveBeenCalledWith(
      '::warning::UPDATER_PUBKEY is set but no signing key; this release will have no signatures',
    )
  })

  it('strips the stray whitespace a pasted secret carries', () => {
    const root = repo()
    const result = injectUpdaterPubkey({ root, pubkey: ` ${PUBKEY}\n` })
    expect(result.pubkey).toBe(true)
    expect(readFileSync(join(root, MOD_RS), 'utf8')).toContain(`"${PUBKEY}"`)
  })

  it('needs no files at all when there is no key', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo({ mod: null, conf: null })
    expect(injectUpdaterPubkey({ root, pubkey: '' })).toEqual({ pubkey: false, enabled: false })
    expect(log).toHaveBeenCalledWith('output: pubkey=false')
    expect(log).toHaveBeenCalledWith(
      '::notice::No UPDATER_PUBKEY secret; this binary will answer not_configured and offer manual download only',
    )
  })

  it('refuses a signing key without a public key', () => {
    const root = repo()
    expect(() => injectUpdaterPubkey({ root, pubkey: '', signing: true })).toThrow(
      /UPDATER_PUBKEY is not/,
    )
  })

  it('refuses an unusable public key', () => {
    const root = repo()
    expect(() => injectUpdaterPubkey({ root, pubkey: KEY_LINE })).toThrow(
      /must be the single-line base64 contents/,
    )
  })

  it('refuses a mod.rs without the declaration', () => {
    const root = repo({ mod: '// no constant here\n' })
    expect(() => injectUpdaterPubkey({ root, pubkey: PUBKEY })).toThrow(
      /UPDATER_PUBKEY declaration not found in desktop\/src-tauri\/src\/upgrade\/mod\.rs/,
    )
  })

  it('refuses a tauri.conf.json without plugins.updater', () => {
    const root = repo({ conf: { productName: 'agentbuddy' } })
    expect(() => injectUpdaterPubkey({ root, pubkey: PUBKEY })).toThrow(
      /plugins\.updater not found in desktop\/src-tauri\/tauri\.conf\.json/,
    )
  })
})

describe('main', () => {
  it('returns 0 for a complete pair of secrets and writes the repo', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo()
    const status = main({ UPDATER_PUBKEY: PUBKEY, TAURI_SIGNING_PRIVATE_KEY: 'x' }, root)
    expect(status).toBe(0)
    expect(log).toHaveBeenCalledWith(
      `Injected UPDATER_PUBKEY (${PUBKEY.length} chars) into ${MOD_RS} and ${CONF}`,
    )
  })

  it('defaults to process.env and the working directory', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const saved = process.env.UPDATER_PUBKEY
    delete process.env.UPDATER_PUBKEY
    try {
      // No key in the environment: notices only, no file is opened.
      expect(main()).toBe(0)
    } finally {
      if (saved !== undefined) process.env.UPDATER_PUBKEY = saved
    }
  })

  it('treats an empty environment as "no secrets at all"', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo({ mod: null, conf: null })
    expect(main({}, root)).toBe(0)
  })

  it('returns 1 and annotates the failure instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = repo()
    expect(main({ TAURI_SIGNING_PRIVATE_KEY: 'x' }, root)).toBe(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^::error::TAURI_SIGNING_PRIVATE_KEY is set but UPDATER_PUBKEY is not/),
    )
  })
})
