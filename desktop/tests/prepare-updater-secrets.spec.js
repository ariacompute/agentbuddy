// `tauri build` hands TAURI_SIGNING_PRIVATE_KEY straight to minisign, so the
// secret must be exactly the single-line base64 the `.key` file holds — a pasted
// trailing space is enough to break the release with "Invalid padding", and a
// double-encoded value only surfaces minutes into bundling. These cases pin the
// normalisation and every rejection, and assert that nothing secret is echoed.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  isSecretKeyText,
  main,
  normalizeSigningKey,
  prepareUpdaterSecrets,
} from '../scripts/prepare-updater-secrets.mjs'

const PLAIN = [
  'untrusted comment: minisign encrypted secret key',
  Buffer.alloc(64, 3).toString('base64'),
].join('\n')
const ENCODED = Buffer.from(`${PLAIN}\n`, 'utf8').toString('base64')

const roots = []

function tempFile(name = 'env') {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-secrets-'))
  roots.push(root)
  return join(root, name)
}

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('isSecretKeyText', () => {
  it('accepts the two-line secret key box, whatever the line endings', () => {
    expect(isSecretKeyText(PLAIN)).toBe(true)
    expect(isSecretKeyText(PLAIN.replace(/\n/g, '\r\n'))).toBe(true)
    expect(isSecretKeyText(`UNTRUSTED COMMENT: MINISIGN SECRET KEY\n${PLAIN.split('\n')[1]}`)).toBe(
      true,
    )
    // A trailing newline (the file's own) leaves an empty third line, which is fine.
    expect(isSecretKeyText(`${PLAIN}\n`)).toBe(true)
  })

  it('refuses a single line, a public key box and a non-base64 key line', () => {
    expect(isSecretKeyText(PLAIN.split('\n')[0])).toBe(false)
    expect(isSecretKeyText('untrusted comment: minisign public key\nAAAA')).toBe(false)
    expect(isSecretKeyText('untrusted comment: secret key\n***')).toBe(false)
  })
})

describe('normalizeSigningKey', () => {
  it('passes the single-line base64 secret through untouched', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(normalizeSigningKey(ENCODED)).toBe(ENCODED)
    expect(log).toHaveBeenCalledWith('Accepted the single-line base64 private key')
  })

  it('encodes a plain two-line minisign file, whitespace and CRLF included', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pasted = `\r\n  ${PLAIN.replace(/\n/g, '\r\n')}\r\n\r\n`
    expect(normalizeSigningKey(pasted)).toBe(ENCODED)
    expect(log).toHaveBeenCalledWith('Converted a plain-text minisign key to base64 for tauri build')
  })

  it('refuses a public key or a truncated private key', () => {
    expect(() =>
      normalizeSigningKey('untrusted comment: minisign public key\nAAAA\n'),
    ).toThrow(/looks like a public key or a truncated private key/)
  })

  it('refuses base64 that does not decode to a secret key', () => {
    for (const value of [
      Buffer.from('just some text\n', 'utf8').toString('base64'),
      Buffer.from('untrusted comment: minisign public key\nAAAA\n', 'utf8').toString('base64'),
    ]) {
      expect(() => normalizeSigningKey(value)).toThrow(
        /does not decode to a minisign private key/,
      )
    }
  })

  it('refuses a path or a value with stray whitespace inside', () => {
    for (const value of [
      '~/.tauri/agentbuddy.key',
      '/home/me/.tauri/agentbuddy.key',
      'AAAA AAA=',
      '',
    ]) {
      expect(() => normalizeSigningKey(value)).toThrow(
        /must be the single-line base64 content of the \.key file/,
      )
    }
  })
})

describe('prepareUpdaterSecrets', () => {
  it('answers false and notices when no key is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(prepareUpdaterSecrets({})).toEqual({ signingKey: false })
    expect(log).toHaveBeenCalledWith('output: signing_key=false')
    expect(log).toHaveBeenCalledWith(
      '::notice::No TAURI_SIGNING_PRIVATE_KEY; no signing key is passed to tauri build',
    )
  })

  it('writes the normalised pair into GITHUB_ENV and masks both values', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const envFile = tempFile()
    const output = tempFile('out')
    const result = prepareUpdaterSecrets({
      rawKey: `  ${PLAIN}\r\n`,
      rawPassword: 'pass\r\nword\n',
      envFile,
      output,
    })
    expect(result).toEqual({ signingKey: true })
    expect(readFileSync(envFile, 'utf8')).toBe(
      `TAURI_SIGNING_PRIVATE_KEY=${ENCODED}\nTAURI_SIGNING_PRIVATE_KEY_PASSWORD=password\n`,
    )
    expect(readFileSync(output, 'utf8')).toBe('signing_key=true\n')
    expect(log).toHaveBeenCalledWith(`::add-mask::${ENCODED}`)
    expect(log).toHaveBeenCalledWith('::add-mask::password')
    expect(log).toHaveBeenCalledWith('Wrote normalised signing variables to GITHUB_ENV')
    // The secret itself is never printed, only masked.
    expect(log.mock.calls.flat().join('\n')).not.toContain(PLAIN)
  })

  it('skips the password mask when the key has no passphrase', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const envFile = tempFile()
    prepareUpdaterSecrets({ rawKey: ENCODED, envFile })
    expect(log).not.toHaveBeenCalledWith('::add-mask::undefined')
    expect(readFileSync(envFile, 'utf8')).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\n')
  })

  it('still reports on a local run without GITHUB_ENV or GITHUB_OUTPUT', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(prepareUpdaterSecrets({ rawKey: ENCODED })).toEqual({ signingKey: true })
    expect(log).toHaveBeenCalledWith('GITHUB_ENV is not set; skipping env export (local check)')
    expect(log).toHaveBeenCalledWith('output: signing_key=true')
  })

  it('propagates a bad secret instead of exporting it', () => {
    const envFile = tempFile()
    expect(() => prepareUpdaterSecrets({ rawKey: 'nope!', envFile })).toThrow(
      /must be the single-line base64 content/,
    )
    expect(() => readFileSync(envFile, 'utf8')).toThrow()
  })
})

describe('main', () => {
  it('defaults to process.env', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const saved = {
      key: process.env.TAURI_SIGNING_PRIVATE_KEY,
      output: process.env.GITHUB_OUTPUT,
    }
    delete process.env.TAURI_SIGNING_PRIVATE_KEY
    delete process.env.GITHUB_OUTPUT
    try {
      expect(main()).toBe(0)
    } finally {
      if (saved.key !== undefined) process.env.TAURI_SIGNING_PRIVATE_KEY = saved.key
      if (saved.output !== undefined) process.env.GITHUB_OUTPUT = saved.output
    }
  })

  it('returns 0 for a good secret', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const envFile = tempFile()
    expect(main({ TAURI_SIGNING_PRIVATE_KEY: ENCODED, GITHUB_ENV: envFile })).toBe(0)
    expect(readFileSync(envFile, 'utf8')).toContain(ENCODED)
  })

  it('returns 1 and annotates a bad secret', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(main({ TAURI_SIGNING_PRIVATE_KEY: 'nope' })).toBe(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^::error::TAURI_SIGNING_PRIVATE_KEY does not decode/),
    )
  })
})
