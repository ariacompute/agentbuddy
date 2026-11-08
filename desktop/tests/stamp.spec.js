// `make stamp VERSION=x.y.z` is the local equivalent of the release workflow's
// sed: one command, two sources of truth (Cargo.toml for the crate, tauri.conf.json
// for the bundler). A silent mismatch ships a binary whose about screen disagrees
// with its package version, so every failure mode is pinned here.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { main, parseVersion, stamp } from '../scripts/stamp.mjs'

const CARGO = `[package]
name = "agentbuddy"
version = "0.1.0"
description = "Desktop shell"
`
const CONF = `{
  "productName": "agentbuddy",
  "version": "0.1.0",
  "identifier": "com.ariacompute.agentbuddy"
}
`

const roots = []

/** A throwaway `src-tauri` directory; the real one is never touched. */
function tauriDir({ cargo = CARGO, conf = CONF } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-stamp-'))
  roots.push(root)
  if (cargo !== null) writeFileSync(join(root, 'Cargo.toml'), cargo)
  if (conf !== null) writeFileSync(join(root, 'tauri.conf.json'), conf)
  return root
}

const read = (root, name) => readFileSync(join(root, name), 'utf8')

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('parseVersion', () => {
  it('accepts a release version and a pre-release tag', () => {
    expect(parseVersion('1.4.0')).toBe('1.4.0')
    expect(parseVersion('1.4.0-beta.1')).toBe('1.4.0-beta.1')
    expect(parseVersion(' 2.0.0 ')).toBe('2.0.0')
  })

  it('refuses anything that is not a semver', () => {
    for (const bad of ['', 'winter', '1.4', 'v1.4.0', 'latest', undefined, null]) {
      expect(() => parseVersion(bad)).toThrow(/usage: stamp\.mjs <semver>/)
    }
  })
})

describe('stamp', () => {
  it('writes the version into both files and answers it back', () => {
    const root = tauriDir()
    expect(stamp(root, '1.4.0')).toBe('1.4.0')
    expect(read(root, 'Cargo.toml')).toContain('version = "1.4.0"')
    expect(read(root, 'Cargo.toml')).toContain('description = "Desktop shell"')
    expect(read(root, 'tauri.conf.json')).toContain('"version": "1.4.0"')
    expect(read(root, 'tauri.conf.json')).toContain('"identifier": "com.ariacompute.agentbuddy"')
  })

  it('leaves the crate name and every other line alone', () => {
    const root = tauriDir()
    stamp(root, '9.9.9')
    expect(read(root, 'Cargo.toml').split('\n')[1]).toBe('name = "agentbuddy"')
    expect(JSON.parse(read(root, 'tauri.conf.json')).productName).toBe('agentbuddy')
  })

  it('fails when Cargo.toml has no version line', () => {
    const root = tauriDir({ cargo: '[package]\nname = "agentbuddy"\n' })
    expect(() => stamp(root, '1.4.0')).toThrow(/Cargo\.toml version line not found/)
    // The tauri file is only written after Cargo.toml succeeded.
    expect(read(root, 'tauri.conf.json')).toContain('"version": "0.1.0"')
  })

  it('fails when tauri.conf.json has no version field', () => {
    const root = tauriDir({ conf: '{ "productName": "agentbuddy" }\n' })
    expect(() => stamp(root, '1.4.0')).toThrow(/tauri\.conf\.json version field not found/)
  })

  it('fails before writing anything when the version itself is invalid', () => {
    const root = tauriDir()
    expect(() => stamp(root, 'winter')).toThrow(/usage/)
    expect(read(root, 'Cargo.toml')).toContain('version = "0.1.0"')
  })
})

describe('main', () => {
  it('stamps the injected directory and returns 0', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = tauriDir()
    expect(main(root, ['1.4.0'])).toBe(0)
    expect(log).toHaveBeenCalledWith('stamped agentbuddy 1.4.0 into Cargo.toml + tauri.conf.json')
    expect(read(root, 'Cargo.toml')).toContain('version = "1.4.0"')
  })

  it('takes the version from the process argv when none is injected', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = tauriDir()
    // vitest's own argv never parses as a semver, so the run stops at the usage
    // check without writing — which is exactly what the defaulted argv must do.
    expect(main(root)).toBe(1)
    expect(read(root, 'Cargo.toml')).toContain('version = "0.1.0"')
  })

  it('prints the reason and returns 1 instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = tauriDir({ cargo: null })
    expect(main(root, ['1.4.0'])).toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/usage|ENOENT|not found/))
  })
})
