// Every script under `scripts/` ends with the same three lines: "if this file is
// the process entry point, run main() and publish the exit code". A spec imports
// the module, so those lines can only be exercised by starting the script the way
// the Makefile and the release workflow do — as a process. That is what this file
// does, which is why the guard carries a `v8 ignore` marker instead of an exclude.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))

/** Run a script the way a shell would: no inherited GITHUB_* variables. */
function run(script, args = []) {
  return spawnSync(process.execPath, [resolve(SCRIPTS, 'scripts', script), ...args], {
    encoding: 'utf8',
    env: {},
  })
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
})
