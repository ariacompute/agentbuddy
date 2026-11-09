// The release pipeline is the one part of agentbuddy that cannot be exercised
// from the workbench: it runs on three CI hosts and its output is a set of files
// on a GitHub release. These tests drive the real `latest-json.mjs` in-process
// against temporary fixtures, so a regression in signing, manifest assembly or
// the "exactly nine assets" guard fails the suite locally.
//
// The module already exports every subcommand and keeps its side effects behind
// the `isMain` guard, so the specs can call collect/manifest/verify directly and
// stay inside the coverage gate. The process entry point itself (argv parsing,
// `usage:`, exit code) is pinned by tests/cli.spec.js.
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collect,
  expectedAssetNames,
  main,
  manifest,
  normalizeSignature,
  verify,
  versionOf,
} from '../scripts/latest-json.mjs'

const VERSION = '1.4.0'
const LEGS = [
  {
    key: 'linux-x86_64',
    assets: ['AgentBuddy-amd64-1.4.0.deb', 'AgentBuddy-linux-x86_64-1.4.0.tar.gz'],
  },
  {
    key: 'darwin-aarch64',
    assets: ['AgentBuddy-aarch64-1.4.0.dmg', 'AgentBuddy-macos-aarch64-1.4.0.tar.gz'],
  },
  {
    key: 'windows-x86_64',
    assets: ['AgentBuddy-x64-1.4.0.msi', 'AgentBuddy-windows-x86_64-1.4.0.zip'],
  },
]
const ALL_DOWNLOADS = LEGS.flatMap((leg) => leg.assets)

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

function expectThrows(fn, pattern) {
  expect(fn).toThrow(pattern)
}

/** One build leg: its two downloads, optionally with a sibling `.sig` each. */
function leg(ws, { key, assets }, { signed = true, sigVersion = VERSION } = {}) {
  const out = join(ws.root, `out-${key}`)
  mkdirSync(out)
  for (const asset of assets) {
    writeFileSync(join(out, asset), `fixture:${asset}`)
    if (signed) writeFileSync(join(out, `${asset}.sig`), signatureFile(sigVersion, asset))
    copyFileSync(join(out, asset), join(ws.assets, asset))
  }
  return out
}

/** Build three legs, merge their downloads, then assemble the release. */
function buildRelease({ signed = true, sigVersion = VERSION } = {}) {
  const ws = workspace()
  for (const one of LEGS) collect(one.key, leg(ws, one, { signed, sigVersion }), ws.meta)
  manifest(ws.assets, ws.meta, VERSION)
  const sums = ALL_DOWNLOADS.map((name) => {
    const hash = createHash('sha256').update(`fixture:${name}`).digest('hex')
    return `${hash}  ${name}`
  }).join('\n')
  writeFileSync(join(ws.assets, 'SHA256SUMS'), `${sums}\n`)
  return ws
}

/** Rewrite one manifest in place, so `verify` sees the tampered body. */
function tamper(ws, file, edit) {
  const path = join(ws.assets, file)
  const body = JSON.parse(readFileSync(path, 'utf8'))
  edit(body)
  writeFileSync(path, JSON.stringify(body))
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RELEASE_NOTES
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('versionOf / expectedAssetNames', () => {
  it('accepts a v-prefixed tag and rejects a non-semver tag', () => {
    expect(versionOf('v1.4.0')).toBe('1.4.0')
    expect(versionOf('1.4.0-rc.1')).toBe('1.4.0-rc.1')
    expect(() => versionOf('winter')).toThrow(/not a semver release tag: winter/)
    expect(() => versionOf(undefined)).toThrow(/not a semver release tag/)
  })

  it('names exactly the six published downloads', () => {
    expect(expectedAssetNames('1.4.0').sort()).toEqual(ALL_DOWNLOADS.slice().sort())
  })
})

describe('normalizeSignature', () => {
  it('accepts a plain minisign box and stores it base64-encoded', () => {
    const box = plainBox(VERSION, ALL_DOWNLOADS[0])
    expect(Buffer.from(normalizeSignature(box, 'x'), 'base64').toString('utf8')).toBe(`${box}\n`)
  })

  it('keeps a base64 box as it is', () => {
    const encoded = signatureFile()
    expect(normalizeSignature(`${encoded}\n `, 'x')).toBe(encoded)
  })

  it('rejects an empty or malformed .sig', () => {
    expectThrows(() => normalizeSignature('   ', 'x'), /x: empty signature/)
    expectThrows(() => normalizeSignature(undefined, 'x'), /x: empty signature/)
    // base64 of "not a signature" — decodes, but to something that is not a box.
    expectThrows(() => normalizeSignature('bm90IGEgc2lnbmF0dXJl', 'x'), /not a minisign signature box/)
    // The untrusted line is right, the trusted comment is missing.
    expectThrows(
      () => normalizeSignature('untrusted comment: signature from tauri', 'x'),
      /not a minisign signature box/,
    )
    expectThrows(() => normalizeSignature('hello', 'x'), /not a minisign signature box/)
  })
})

describe('collect', () => {
  it('picks the installable asset, carries both signatures and deletes the .sig files', () => {
    const ws = workspace()
    const out = leg(ws, LEGS[0])
    collect(LEGS[0].key, out, ws.meta)
    const meta = JSON.parse(readFileSync(join(ws.meta, 'linux-x86_64.json'), 'utf8'))
    expect(meta.platform).toBe('linux-x86_64')
    expect(meta.updaterAsset).toBe(LEGS[0].assets[0])
    expect(meta.signature).toBe(meta.signatures[LEGS[0].assets[0]])
    expect(Object.keys(meta.signatures).sort()).toEqual(LEGS[0].assets.slice().sort())
    for (const asset of LEGS[0].assets) {
      expect(existsSync(join(out, `${asset}.sig`))).toBe(false)
    }
    expect(console.log).toHaveBeenCalledWith(
      'latest-json: collected linux-x86_64 -> AgentBuddy-amd64-1.4.0.deb (2 signed assets)',
    )
  })

  it('writes empty metadata for an unsigned leg (manual download)', () => {
    const ws = workspace()
    collect(LEGS[0].key, leg(ws, LEGS[0], { signed: false }), ws.meta)
    const meta = JSON.parse(readFileSync(join(ws.meta, 'linux-x86_64.json'), 'utf8'))
    expect(meta).toEqual({
      platform: 'linux-x86_64',
      updaterAsset: null,
      signature: '',
      signatures: {},
    })
    expect(console.log).toHaveBeenCalledWith(
      'latest-json: collected linux-x86_64 without signatures (manual download)',
    )
  })

  it('rejects an unknown platform key', () => {
    const ws = workspace()
    expectThrows(() => collect('plan9-ppc', ws.assets, ws.meta), /unknown platform key: plan9-ppc/)
  })

  it('rejects a missing asset directory', () => {
    const ws = workspace()
    expectThrows(() => collect('linux-x86_64', join(ws.root, 'nope'), ws.meta), /does not exist/)
  })

  it('rejects a .sig without a matching download', () => {
    const ws = workspace()
    const out = join(ws.root, 'out')
    mkdirSync(out)
    writeFileSync(join(out, 'stray.sig'), signatureFile())
    expectThrows(() => collect('linux-x86_64', out, ws.meta), /no matching download asset/)

    // A signature whose name looks like a download but whose asset is absent.
    const orphan = workspace()
    const orphanOut = join(orphan.root, 'out')
    mkdirSync(orphanOut)
    writeFileSync(
      join(orphanOut, `${LEGS[0].assets[0]}.sig`),
      signatureFile(VERSION, LEGS[0].assets[0]),
    )
    expectThrows(() => collect('linux-x86_64', orphanOut, orphan.meta), /no matching download asset/)
  })

  it('rejects a partially signed leg', () => {
    const ws = workspace()
    const out = join(ws.root, 'out')
    mkdirSync(out)
    for (const asset of LEGS[0].assets) writeFileSync(join(out, asset), 'fixture')
    writeFileSync(join(out, `${LEGS[0].assets[0]}.sig`), signatureFile())
    expectThrows(() => collect('linux-x86_64', out, ws.meta), /partially signed release/)
  })

  it('needs exactly one installable asset per leg', () => {
    const two = workspace()
    const out = join(two.root, 'out')
    mkdirSync(out)
    const deb = ['AgentBuddy-amd64-1.4.0.deb', 'AgentBuddy-amd64-1.4.1.deb']
    for (const asset of deb) {
      writeFileSync(join(out, asset), 'fixture')
      writeFileSync(join(out, `${asset}.sig`), signatureFile(VERSION, asset))
    }
    expectThrows(() => collect('linux-x86_64', out, two.meta), /found 2/)

    // A signed leg whose downloads cannot be installed by the updater at all.
    const none = workspace()
    const onlyTar = join(none.root, 'out')
    mkdirSync(onlyTar)
    writeFileSync(join(onlyTar, 'AgentBuddy-linux-x86_64-1.4.0.tar.gz'), 'fixture')
    writeFileSync(
      join(onlyTar, 'AgentBuddy-linux-x86_64-1.4.0.tar.gz.sig'),
      signatureFile(VERSION, 'AgentBuddy-linux-x86_64-1.4.0.tar.gz'),
    )
    expectThrows(() => collect('linux-x86_64', onlyTar, none.meta), /found 0/)
  })
})

describe('manifest', () => {
  it('publishes both mirrors, each pointing only at its own host', () => {
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
      expect(Object.keys(body.signatures).sort()).toEqual(ALL_DOWNLOADS.slice().sort())
      const base = `https://${host}/ariacompute/agentbuddy/releases/download/v${VERSION}`
      expect(body.platforms['linux-x86_64'].url).toBe(`${base}/AgentBuddy-amd64-1.4.0.deb`)
      expect(body.platforms['darwin-aarch64'].url).toBe(
        `${base}/AgentBuddy-macos-aarch64-1.4.0.tar.gz`,
      )
      expect(body.platforms['windows-x86_64'].url).toBe(`${base}/AgentBuddy-x64-1.4.0.msi`)
      for (const [key, entry] of Object.entries(body.platforms)) {
        const asset = entry.url.slice(base.length + 1)
        expect(body.signatures[asset], `${file}:${key}`).toBe(entry.signature)
      }
      expect(body.notes).toBe('')
    }
  })

  it('takes the release notes from the environment', () => {
    const ws = buildRelease()
    process.env.RELEASE_NOTES = 'Fixes the proxy cookie rewrite.'
    manifest(ws.assets, ws.meta, VERSION)
    const body = JSON.parse(readFileSync(join(ws.assets, 'latest.json'), 'utf8'))
    expect(body.notes).toBe('Fixes the proxy cookie rewrite.')
  })

  it('accepts a v-prefixed tag', () => {
    const ws = buildRelease()
    manifest(ws.assets, ws.meta, 'v1.4.0')
    expect(JSON.parse(readFileSync(join(ws.assets, 'latest.json'), 'utf8')).version).toBe(VERSION)
  })

  it('rejects a non-semver tag', () => {
    const ws = buildRelease()
    expectThrows(() => manifest(ws.assets, ws.meta, 'winter'), /not a semver release tag/)
  })

  it('publishes empty manifests when there is no meta directory', () => {
    const ws = workspace()
    for (const asset of ALL_DOWNLOADS) writeFileSync(join(ws.assets, asset), 'fixture')
    manifest(ws.assets, join(ws.root, 'no-meta'), VERSION)
    for (const file of ['latest.json', 'latest-gitee.json']) {
      const body = JSON.parse(readFileSync(join(ws.assets, file), 'utf8'))
      expect(body.platforms).toEqual({})
      expect(body.signatures).toEqual({})
    }
    expect(console.log).toHaveBeenCalledWith(
      'latest-json: no meta directory; publishing unsigned installers',
    )
    expect(console.log).toHaveBeenCalledWith(
      'latest-json: no signed platform; clients will offer manual download',
    )
  })

  it('ignores files in the meta directory that are not leg metadata', () => {
    const ws = buildRelease()
    writeFileSync(join(ws.meta, 'notes.txt'), 'not json')
    manifest(ws.assets, ws.meta, VERSION)
    expect(JSON.parse(readFileSync(join(ws.assets, 'latest.json'), 'utf8')).version).toBe(VERSION)
  })

  it('rejects duplicate and unknown platforms', () => {
    const ws = buildRelease()
    const clean = { platform: 'linux-x86_64', updaterAsset: null, signature: '', signatures: {} }
    writeFileSync(join(ws.meta, 'dupe.json'), JSON.stringify(clean))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /duplicate platform/)

    writeFileSync(join(ws.meta, 'dupe.json'), JSON.stringify({ ...clean, platform: 'haiku-x86_64' }))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /unknown platform haiku-x86_64/)
  })

  it('rejects metadata that disagrees with the published files', () => {
    const ws = buildRelease()
    const metaPath = join(ws.meta, 'linux-x86_64.json')
    const clean = JSON.parse(readFileSync(metaPath, 'utf8'))

    writeFileSync(
      metaPath,
      JSON.stringify({ ...clean, signatures: { '../../evil.deb': clean.signature } }),
    )
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /unsafe asset name/)

    writeFileSync(metaPath, JSON.stringify({ ...clean, updaterAsset: 42 }))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /unsafe asset name/)

    writeFileSync(
      metaPath,
      JSON.stringify({ ...clean, signatures: { 'AgentBuddy-arm64-1.4.0.deb': clean.signature } }),
    )
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /is not published/)

    writeFileSync(metaPath, JSON.stringify({ ...clean, signatures: { [clean.updaterAsset]: 'YmFkZ' } }))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /signature is not base64/)

    writeFileSync(
      metaPath,
      JSON.stringify({ ...clean, signatures: { [clean.updaterAsset]: 'YWJjZA==' } }),
    )
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /not a minisign signature box/)

    writeFileSync(metaPath, JSON.stringify({ ...clean, updaterAsset: 'AgentBuddy-arm64-1.4.0.deb' }))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /updater asset .* is not published/)

    writeFileSync(metaPath, JSON.stringify({ ...clean, signature: 'YWJjZA==' }))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /has no matching signature/)

    writeFileSync(metaPath, JSON.stringify({ ...clean, updaterAsset: null, signature: '' }))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /signatures without an updater asset/)

    writeFileSync(metaPath, JSON.stringify(clean))
  })

  it('rejects a signature bound to a different version', () => {
    const ws = workspace()
    for (const one of LEGS) collect(one.key, leg(ws, one, { sigVersion: '9.9.9' }), ws.meta)
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /binds version 9.9.9/)
  })

  it('accepts a box whose trusted comment cannot be read, and binds no version', () => {
    const ws = workspace()
    for (const one of LEGS) {
      const out = join(ws.root, `out-${one.key}`)
      mkdirSync(out)
      for (const asset of one.assets) {
        writeFileSync(join(out, asset), `fixture:${asset}`)
        // validateSignature accepts the trusted comment case-insensitively while
        // signedVersion looks for the exact spelling, so this box is valid but
        // carries no `version:` binding — the release must not be refused for it.
        const box = plainBox(VERSION, asset)
          .split('\n')
          .map((line) => (line.startsWith('trusted comment:') ? 'Trusted comment: unsigned' : line))
          .join('\n')
        writeFileSync(join(out, `${asset}.sig`), Buffer.from(box).toString('base64'))
        copyFileSync(join(out, asset), join(ws.assets, asset))
      }
      collect(one.key, out, ws.meta)
    }
    manifest(ws.assets, ws.meta, VERSION)
    expect(Object.keys(JSON.parse(readFileSync(join(ws.assets, 'latest.json'), 'utf8')).signatures))
      .toHaveLength(6)
  })

  it('reads a leg without signatures and one whose key is not a download', () => {
    const ws = buildRelease()
    writeFileSync(join(ws.meta, 'linux-aarch64.json'), JSON.stringify({ platform: 'linux-aarch64' }))
    manifest(ws.assets, ws.meta, VERSION)
    // The extra leg contributes nothing: the release keeps its three platforms.
    expect(Object.keys(JSON.parse(readFileSync(join(ws.assets, 'latest.json'), 'utf8')).platforms))
      .toHaveLength(3)

    rmSync(join(ws.meta, 'linux-aarch64.json'))
    writeFileSync(
      join(ws.meta, 'notes.json'),
      JSON.stringify({
        platform: 'linux-aarch64',
        updaterAsset: null,
        signature: '',
        signatures: { 'notes.txt': signatureFile() },
      }),
    )
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /signed asset notes\.txt is not published/)
  })

  it('rejects the same asset signed by two legs', () => {
    const ws = buildRelease()
    const shared = LEGS[0].assets[0]
    const duplicate = {
      platform: 'linux-aarch64',
      updaterAsset: shared,
      signature: signatureFile(VERSION, shared),
      signatures: { [shared]: signatureFile(VERSION, shared) },
    }
    writeFileSync(join(ws.meta, 'linux-aarch64.json'), JSON.stringify(duplicate))
    expectThrows(() => manifest(ws.assets, ws.meta, VERSION), /duplicate signature for/)
  })
})

describe('verify', () => {
  it('accepts exactly nine assets', () => {
    const ws = buildRelease()
    expect(readdirSync(ws.assets).sort()).toEqual(
      [...ALL_DOWNLOADS, 'SHA256SUMS', 'latest-gitee.json', 'latest.json'].sort(),
    )
    expect(readdirSync(ws.assets).filter((name) => name.endsWith('.sig'))).toEqual([])
    expect(() => verify(ws.assets, VERSION)).not.toThrow()
    expect(() => verify(ws.assets, 'v1.4.0')).not.toThrow()
    expect(console.log).toHaveBeenCalledWith('latest-json: verified exactly nine release assets')
  })

  it('rejects a missing asset directory and a non-semver tag', () => {
    const ws = buildRelease()
    expectThrows(() => verify(join(ws.root, 'nope'), VERSION), /does not exist/)
    expectThrows(() => verify(ws.assets, 'winter'), /not a semver release tag/)
  })

  it('rejects extra files and missing files', () => {
    const extra = buildRelease()
    writeFileSync(join(extra.assets, 'updater-linux-x86_64.json'), '{}')
    expectThrows(() => verify(extra.assets, VERSION), /unexpected release assets/)

    const missing = buildRelease()
    rmSync(join(missing.assets, 'AgentBuddy-x64-1.4.0.msi'))
    expectThrows(() => verify(missing.assets, VERSION), /unexpected release assets/)
  })

  it('rejects malformed and incomplete checksums', () => {
    const malformed = buildRelease()
    writeFileSync(join(malformed.assets, 'SHA256SUMS'), 'deadbeef  AgentBuddy-x64-1.4.0.msi\n')
    expectThrows(() => verify(malformed.assets, VERSION), /malformed SHA256SUMS line/)

    const short = buildRelease()
    writeFileSync(
      join(short.assets, 'SHA256SUMS'),
      `${'0'.repeat(64)}  AgentBuddy-x64-1.4.0.msi\n`,
    )
    expectThrows(() => verify(short.assets, VERSION), /must cover exactly the six downloads/)
  })

  it('rejects a manifest that announces another version', () => {
    const ws = buildRelease()
    tamper(ws, 'latest.json', (body) => {
      body.version = '9.9.9'
    })
    expectThrows(() => verify(ws.assets, VERSION), /version 9\.9\.9 != 1\.4\.0/)
  })

  it('rejects a partial platform set and a cross-mirror URL', () => {
    const partial = buildRelease()
    tamper(partial, 'latest.json', (body) => {
      delete body.platforms['windows-x86_64']
    })
    expectThrows(() => verify(partial.assets, VERSION), /partial platform set/)

    const cross = buildRelease()
    tamper(cross, 'latest.json', (body) => {
      body.platforms['linux-x86_64'].url = body.platforms['linux-x86_64'].url.replace(
        'github.com',
        'gitee.com',
      )
    })
    expectThrows(() => verify(cross.assets, VERSION), /cross-mirror or unsafe URL/)
  })

  it('rejects an unknown or unpublished asset in a platform URL', () => {
    const unknown = buildRelease()
    tamper(unknown, 'latest.json', (body) => {
      body.platforms['linux-x86_64'].url = body.platforms['linux-x86_64'].url.replace(
        'AgentBuddy-amd64-1.4.0.deb',
        'AgentBuddy-arm64-1.4.0.deb',
      )
    })
    expectThrows(() => verify(unknown.assets, VERSION), /unknown asset/)

    const unpublished = buildRelease()
    tamper(unpublished, 'latest.json', (body) => {
      body.signatures['AgentBuddy-arm64-1.4.0.deb'] = signatureFile()
    })
    expectThrows(() => verify(unpublished.assets, VERSION), /expected signatures for all six/)
  })

  it('rejects a tampered signature and a signature without a platform', () => {
    const tampered = buildRelease()
    tamper(tampered, 'latest.json', (body) => {
      body.platforms['linux-x86_64'].signature = 'YmFk'
    })
    expectThrows(() => verify(tampered.assets, VERSION), /signature does not match/)

    const unsigned = buildRelease({ signed: false })
    tamper(unsigned, 'latest.json', (body) => {
      body.signatures['AgentBuddy-amd64-1.4.0.deb'] = signatureFile()
    })
    expectThrows(() => verify(unsigned.assets, VERSION), /signatures without any updater platform/)
  })

  it('rejects a signatures map that is not made of minisign boxes', () => {
    // "YmFkZ" is 5 base64 characters, so it can never be a signature box: the
    // platform entry and the map have to agree for verify to look at the value.
    const notBase64 = buildRelease()
    tamper(notBase64, 'latest.json', (body) => {
      body.platforms['linux-x86_64'].signature = 'YmFkZ'
      body.signatures['AgentBuddy-amd64-1.4.0.deb'] = 'YmFkZ'
    })
    expectThrows(() => verify(notBase64.assets, VERSION), /signature is not base64/)

    // An asset that is not installable still has to carry a real signature box.
    const notABox = buildRelease()
    tamper(notABox, 'latest.json', (body) => {
      body.signatures['AgentBuddy-windows-x86_64-1.4.0.zip'] = Buffer.from('hello').toString(
        'base64',
      )
    })
    expectThrows(() => verify(notABox.assets, VERSION), /not a minisign signature box/)
  })

  it('reads a manifest that omits platforms and signatures as an unsigned release', () => {
    const ws = buildRelease({ signed: false })
    for (const file of ['latest.json', 'latest-gitee.json']) {
      tamper(ws, file, (body) => {
        delete body.platforms
        delete body.signatures
      })
    }
    expect(() => verify(ws.assets, VERSION)).not.toThrow()
  })
})

describe('main (CLI)', () => {
  it('dispatches collect, manifest and verify', () => {
    const ws = workspace()
    const out = leg(ws, LEGS[0])
    expect(main(['collect', LEGS[0].key, out, ws.meta])).toBe(0)
    expect(main(['manifest', ws.assets, ws.meta, VERSION])).toBe(0)
    expect(existsSync(join(ws.assets, 'latest.json'))).toBe(true)

    const complete = buildRelease()
    expect(main(['verify', complete.assets, VERSION])).toBe(0)
  })

  it('answers a usage error with exit code 1 and an empty exit code on success', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const argv of [[], ['collect'], ['manifest', 'a'], ['verify'], ['nope']]) {
      expect(main(argv)).toBe(1)
      expect(process.exitCode).toBe(1)
      process.exitCode = 0
    }
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^latest-json: usage: latest-json\.mjs/))
  })

  it('reads the process argv when none is injected', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // vitest's own command line is not one of the three subcommands.
    expect(main()).toBe(1)
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  it('turns a thrown validation error into exit code 1', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(main(['verify', '/definitely/not/here', VERSION])).toBe(1)
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^latest-json: asset directory .* does not exist/),
    )
  })
})

