// Every script under `scripts/` ends with the same three lines: "if this file is
// the process entry point, run main() and publish the exit code". A spec imports
// the module, so those lines can only be exercised by starting the script the way
// the Makefile and the release workflow do — as a process. That is what this file
// does, which is why the guard carries a `v8 ignore` marker instead of an exclude.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(SCRIPTS)

/** Run a script the way a shell would: no inherited GITHUB_* variables. */
function run(script, args = [], { cwd, env = {} } = {}) {
  return spawnSync(process.execPath, [resolve(SCRIPTS, 'scripts', script), ...args], {
    encoding: 'utf8',
    env,
    ...(cwd ? { cwd } : {}),
  })
}

// 2-byte algorithm + 8-byte key id + 32-byte Ed25519 key = 42 bytes.
const KEY_LINE = Buffer.alloc(42, 7).toString('base64')
const PUBKEY = Buffer.from(
  `untrusted comment: minisign public key 4A1B2C3D\n${KEY_LINE}\n`,
  'utf8',
).toString('base64')

/** A throwaway repo root holding the two public-key consumers. */
function fixture({ modKey = '', confKey = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-cli-pubkey-'))
  mkdirSync(join(root, 'desktop/src-tauri/src/upgrade'), { recursive: true })
  writeFileSync(
    join(root, 'desktop/src-tauri/src/upgrade/mod.rs'),
    `pub const UPDATER_PUBKEY: &str = "${modKey}";\n`,
  )
  writeFileSync(
    join(root, 'desktop/src-tauri/tauri.conf.json'),
    `${JSON.stringify({ plugins: { updater: { pubkey: confKey } } }, null, 2)}\n`,
  )
  return root
}

describe('script entry points', () => {
  it('stamp answers a usage error with exit code 1', () => {
    const result = run('stamp.mjs')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('usage: stamp.mjs <semver>')
  })

  it('latest-json answers a usage error with exit code 1', () => {
    const result = run('latest-json.mjs')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('usage: latest-json.mjs collect')
  })

  it('inject-updater-pubkey notices the missing secret and exits 0', () => {
    const result = run('inject-updater-pubkey.mjs')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::notice::No UPDATER_PUBKEY secret')
    expect(result.stdout).toContain('output: enabled=false')
  })

  it('prepare-updater-secrets notices the missing secret and exits 0', () => {
    const result = run('prepare-updater-secrets.mjs')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::notice::No TAURI_SIGNING_PRIVATE_KEY')
    expect(result.stdout).toContain('output: signing_key=false')
  })

  it('prepare-updater-secrets fails loudly on an unusable secret', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(SCRIPTS, 'scripts', 'prepare-updater-secrets.mjs')],
      { encoding: 'utf8', env: { TAURI_SIGNING_PRIVATE_KEY: '~/.tauri/agentbuddy.key' } },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '::error::TAURI_SIGNING_PRIVATE_KEY must be the single-line base64 content',
    )
  })

  it('verify-updater-pubkey accepts the committed empty pair', () => {
    const result = run('verify-updater-pubkey.mjs', [], { cwd: REPO })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::notice::updater pubkey contract holds')
  })

  it('verify-updater-pubkey accepts a matching injected key', () => {
    const root = fixture({ modKey: PUBKEY, confKey: PUBKEY })
    try {
      const result = run('verify-updater-pubkey.mjs', [], {
        cwd: root,
        env: { EXPECT_UPDATER_PUBKEY: 'true' },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('same key in upgrade/mod.rs and tauri.conf.json')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('verify-updater-pubkey refuses a key written to only one file', () => {
    const root = fixture({ modKey: PUBKEY })
    try {
      const result = run('verify-updater-pubkey.mjs', [], { cwd: root })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('::error::UPDATER_PUBKEY mismatch')
      expect(result.stderr).not.toContain(PUBKEY)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
