// The release pipeline is the one part of agentbuddy that cannot be exercised
// from the workbench: it runs on three CI hosts and its output is a set of
// files on a GitHub release. These tests drive the real `latest-json.mjs` as a
// subprocess against temporary fixtures, so a regression in signing, manifest
// assembly or the "exactly nine assets" guard fails `bun run test` locally.
//
// Everything is black-box: the helper is a `#!`-prefixed CLI script, which
// Vitest's SSR transform cannot import directly, and no file from web/src is
// involved, so the coverage baseline stays untouched.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(here, '../../desktop/scripts/latest-json.mjs')
const VERSION = '1.4.0'
const LEGS = [
  {
    key: 'linux-x86_64',
    assets: ['agentbuddy-amd64-1.4.0.deb', 'agentbuddy-linux-x86_64-1.4.0.tar.gz'],
  },
  {
    key: 'darwin-aarch64',
    assets: ['agentbuddy-aarch64-1.4.0.dmg', 'agentbuddy-macos-aarch64-1.4.0.tar.gz'],
  },
  {
    key: 'windows-x86_64',
    assets: ['agentbuddy-x64-1.4.0.msi', 'agentbuddy-windows-x86_64-1.4.0.zip'],
  },
]

const roots = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-release-'))
  roots.push(root)
  const assets = join(root, 'assets')
  const meta = join(root, 'meta')
  mkdirSync(assets)
  mkdirSync(meta)
  return { root, assets, meta }
}

function plainBox(version = VERSION, file = 'asset') {
  return [
    'untrusted comment: signature from tauri secret key',
    'RUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=',
    `trusted comment: timestamp:1791649051\tfile:${file}\tversion:${version}`,
    'DDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==',
  ].join('\n')
}

/** What `tauri signer sign` writes: base64 of a minisign signature box. */
function signatureFile(version = VERSION, file = 'asset') {
  return Buffer.from(`${plainBox(version, file)}\n`, 'utf8').toString('base64')
}

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

function expectOk(result, label) {
  expect(result.status, `${label}: ${result.stderr || result.stdout}`).toBe(0)
}

function expectFail(result, label, message) {
  expect(result.status, `${label} should fail`).toBe(1)
  expect(result.stderr).toContain(message)
}

/** Build three legs, merge their downloads, then assemble the release. */
function buildRelease({ signed = true, sigVersion = VERSION } = {}) {
  const ws = workspace()
  for (const leg of LEGS) {
    const out = join(ws.root, `out-${leg.key}`)
    mkdirSync(out)
    for (const asset of leg.assets) {
      writeFileSync(join(out, asset), `fixture:${asset}`)
      if (signed) writeFileSync(join(out, `${asset}.sig`), signatureFile(sigVersion, asset))
      copyFileSync(join(out, asset), join(ws.assets, asset))
    }
    expectOk(run('collect', leg.key, out, ws.meta), `collect ${leg.key}`)
  }
  expectOk(run('manifest', ws.assets, ws.meta, VERSION), 'manifest')
  const sums = [
    ...LEGS[0].assets,
    ...LEGS[1].assets,
    ...LEGS[2].assets,
  ]
    .map((name) => {
      const hash = createHash('sha256').update(`fixture:${name}`).digest('hex')
      return `${hash}  ${name}`
    })
    .join('\n')
  writeFileSync(join(ws.assets, 'SHA256SUMS'), `${sums}\n`)
  return ws
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('release asset helper (signature normalisation)', () => {
  it('accepts a plain minisign box and stores it base64-encoded', () => {
    const ws = workspace()
    const out = join(ws.root, 'out')
    mkdirSync(out)
    for (const asset of LEGS[0].assets) writeFileSync(join(out, asset), 'fixture')
    const box = plainBox(VERSION, LEGS[0].assets[0])
    for (const asset of LEGS[0].assets) {
      writeFileSync(join(out, `${asset}.sig`), `${plainBox(VERSION, asset)}\n`)
    }
    expectOk(run('collect', LEGS[0].key, out, ws.meta), 'collect plain box')
    const meta = JSON.parse(readFileSync(join(ws.meta, 'linux-x86_64.json'), 'utf8'))
    expect(Buffer.from(meta.signatures[LEGS[0].assets[0]], 'base64').toString('utf8')).toBe(
      `${box}\n`,
    )
  })

  it('rejects an empty or malformed .sig file', () => {
    const empty = workspace()
    const out = join(empty.root, 'out')
    mkdirSync(out)
    for (const asset of LEGS[0].assets) {
      writeFileSync(join(out, asset), 'fixture')
      writeFileSync(join(out, `${asset}.sig`), '   ')
    }
    expectFail(run('collect', LEGS[0].key, out, empty.meta), 'collect', 'empty signature')

    const bad = workspace()
    const badOut = join(bad.root, 'out')
    mkdirSync(badOut)
    for (const asset of LEGS[0].assets) {
      writeFileSync(join(badOut, asset), 'fixture')
      writeFileSync(join(badOut, `${asset}.sig`), 'bm90IGEgc2lnbmF0dXJl')
    }
    expectFail(run('collect', LEGS[0].key, badOut, bad.meta), 'collect', 'not a minisign signature box')
  })

  it('accepts a v-prefixed tag and rejects a non-semver tag', () => {
    const ws = buildRelease()
    expectOk(run('manifest', ws.assets, ws.meta, 'v1.4.0'), 'manifest with v tag')
    expectOk(run('verify', ws.assets, 'v1.4.0'), 'verify with v tag')
    expectFail(run('manifest', ws.assets, ws.meta, 'winter'), 'manifest', 'not a semver release tag')
    expectFail(run('verify', ws.assets, 'winter'), 'verify', 'not a semver release tag')
  })
})

describe('release asset helper (normal path)', () => {
  it('publishes exactly nine assets, no .sig and no updater-*.json', () => {
    const ws = buildRelease()
    const files = readdirSync(ws.assets).sort()
    expect(files).toEqual(
      [
        ...LEGS.flatMap((leg) => leg.assets),
        'SHA256SUMS',
        'latest-gitee.json',
        'latest.json',
      ].sort(),
    )
    expect(files.filter((name) => name.endsWith('.sig'))).toEqual([])
    expect(files.filter((name) => name.startsWith('updater-'))).toEqual([])
    expectOk(run('verify', ws.assets, VERSION), 'verify')
    for (const leg of LEGS) {
      expect(existsSync(join(ws.root, `out-${leg.key}`, `${leg.assets[0]}.sig`))).toBe(false)
    }
  })

  it('points each platform at an installable asset on its own mirror', () => {
    const ws = buildRelease()
    for (const [file, host] of [
      ['latest.json', 'github.com'],
      ['latest-gitee.json', 'gitee.com'],
    ]) {
      const body = JSON.parse(readFileSync(join(ws.assets, file), 'utf8'))
      expect(body.version).toBe(VERSION)
      expect(Object.keys(body.platforms).sort()).toEqual(
        ['darwin-aarch64', 'linux-x86_64', 'windows-x86_64'].sort(),
      )
      expect(Object.keys(body.signatures).sort()).toEqual(
        LEGS.flatMap((leg) => leg.assets).sort(),
      )
      const base = `https://${host}/ariacompute/agentbuddy/releases/download/v${VERSION}`
      expect(body.platforms['linux-x86_64'].url).toBe(`${base}/agentbuddy-amd64-1.4.0.deb`)
      expect(body.platforms['darwin-aarch64'].url).toBe(
        `${base}/agentbuddy-macos-aarch64-1.4.0.tar.gz`,
      )
      expect(body.platforms['windows-x86_64'].url).toBe(`${base}/agentbuddy-x64-1.4.0.msi`)
      for (const [key, entry] of Object.entries(body.platforms)) {
        const asset = entry.url.slice(base.length + 1)
        expect(body.signatures[asset], `${file}:${key}`).toBe(entry.signature)
      }
    }
  })

  it('still publishes nine assets with empty manifests when signing is unavailable', () => {
    const ws = buildRelease({ signed: false })
    expectOk(run('verify', ws.assets, VERSION), 'verify unsigned')
    for (const file of ['latest.json', 'latest-gitee.json']) {
      const body = JSON.parse(readFileSync(join(ws.assets, file), 'utf8'))
      expect(body.platforms).toEqual({})
      expect(body.signatures).toEqual({})
    }
  })
})

describe('release asset helper (failure paths)', () => {
  it('rejects an unknown platform key in collect', () => {
    const ws = workspace()
    const out = join(ws.root, 'out')
    mkdirSync(out)
    expectFail(run('collect', 'plan9-ppc', out, ws.meta), 'collect', 'unknown platform key')
  })

  it('rejects a partially signed leg', () => {
    const ws = workspace()
    const out = join(ws.root, 'out')
    mkdirSync(out)
    for (const asset of LEGS[0].assets) writeFileSync(join(out, asset), 'fixture')
    writeFileSync(join(out, `${LEGS[0].assets[0]}.sig`), signatureFile())
    expectFail(run('collect', LEGS[0].key, out, ws.meta), 'collect', 'partially signed release')
  })

  it('rejects a .sig without a matching download', () => {
    const ws = workspace()
    const out = join(ws.root, 'out')
    mkdirSync(out)
    writeFileSync(join(out, 'stray.sig'), signatureFile())
    expectFail(run('collect', LEGS[0].key, out, ws.meta), 'collect', 'no matching download asset')
  })

  it('rejects duplicate platform metadata and unknown platforms', () => {
    const ws = buildRelease()
    writeFileSync(
      join(ws.meta, 'dupe.json'),
      JSON.stringify({ platform: 'linux-x86_64', updaterAsset: null, signature: '', signatures: {} }),
    )
    expectFail(run('manifest', ws.assets, ws.meta, VERSION), 'manifest', 'duplicate platform')
    writeFileSync(
      join(ws.meta, 'dupe.json'),
      JSON.stringify({ platform: 'haiku-x86_64', updaterAsset: null, signature: '', signatures: {} }),
    )
    expectFail(run('manifest', ws.assets, ws.meta, VERSION), 'manifest', 'unknown platform')
  })

  it('rejects an unsafe signature key and a missing signature', () => {
    const ws = buildRelease()
    const safe = readFileSync(join(ws.meta, 'linux-x86_64.json'), 'utf8')
    const meta = JSON.parse(safe)
    writeFileSync(
      join(ws.meta, 'linux-x86_64.json'),
      JSON.stringify({ ...meta, signatures: { '../../evil.deb': meta.signature } }),
    )
    expectFail(run('manifest', ws.assets, ws.meta, VERSION), 'manifest', 'unsafe asset name')
    writeFileSync(
      join(ws.meta, 'linux-x86_64.json'),
      JSON.stringify({ ...meta, signature: 'YmFk' }),
    )
    expectFail(run('manifest', ws.assets, ws.meta, VERSION), 'manifest', 'no matching signature')
  })

  it('rejects a signature bound to a different version', () => {
    const ws = workspace()
    for (const leg of LEGS) {
      const out = join(ws.root, `out-${leg.key}`)
      mkdirSync(out)
      for (const asset of leg.assets) {
        writeFileSync(join(out, asset), 'fixture')
        writeFileSync(join(out, `${asset}.sig`), signatureFile('9.9.9', asset))
        copyFileSync(join(out, asset), join(ws.assets, asset))
      }
      expectOk(run('collect', leg.key, out, ws.meta), 'collect')
    }
    expectFail(run('manifest', ws.assets, ws.meta, VERSION), 'manifest', 'binds version 9.9.9')
  })

  it('rejects extra files, missing files and stale checksums', () => {
    const extra = buildRelease()
    writeFileSync(join(extra.assets, 'updater-linux-x86_64.json'), '{}')
    expectFail(run('verify', extra.assets, VERSION), 'verify', 'unexpected release assets')

    const missing = buildRelease()
    rmSync(join(missing.assets, 'agentbuddy-x64-1.4.0.msi'))
    expectFail(run('verify', missing.assets, VERSION), 'verify', 'unexpected release assets')

    const stale = buildRelease()
    writeFileSync(join(stale.assets, 'SHA256SUMS'), 'deadbeef  agentbuddy-x64-1.4.0.msi\n')
    expectFail(run('verify', stale.assets, VERSION), 'verify', 'malformed SHA256SUMS line')
  })

  it('rejects a partial platform set, cross-mirror URLs and tampered signatures', () => {
    const partial = buildRelease()
    const file = join(partial.assets, 'latest.json')
    const body = JSON.parse(readFileSync(file, 'utf8'))
    delete body.platforms['windows-x86_64']
    writeFileSync(file, JSON.stringify(body))
    expectFail(run('verify', partial.assets, VERSION), 'verify', 'partial platform set')

    const cross = buildRelease()
    const crossFile = join(cross.assets, 'latest.json')
    const crossBody = JSON.parse(readFileSync(crossFile, 'utf8'))
    crossBody.platforms['linux-x86_64'].url = crossBody.platforms['linux-x86_64'].url.replace(
      'github.com',
      'gitee.com',
    )
    writeFileSync(crossFile, JSON.stringify(crossBody))
    expectFail(run('verify', cross.assets, VERSION), 'verify', 'cross-mirror or unsafe URL')

    const tampered = buildRelease()
    const tamperedFile = join(tampered.assets, 'latest.json')
    const tamperedBody = JSON.parse(readFileSync(tamperedFile, 'utf8'))
    tamperedBody.platforms['linux-x86_64'].signature = 'YmFk'
    writeFileSync(tamperedFile, JSON.stringify(tamperedBody))
    expectFail(run('verify', tampered.assets, VERSION), 'verify', 'signature does not match')
  })

  it('rejects signatures without any updater platform', () => {
    const ws = buildRelease({ signed: false })
    const file = join(ws.assets, 'latest.json')
    const body = JSON.parse(readFileSync(file, 'utf8'))
    body.signatures['agentbuddy-amd64-1.4.0.deb'] = signatureFile()
    writeFileSync(file, JSON.stringify(body))
    expectFail(run('verify', ws.assets, VERSION), 'verify', 'signatures without any updater platform')
  })
})
