#!/usr/bin/env node
// Release-time helper for the auto-updater, with three subcommands:
//
//   node latest-json.mjs collect <platform-key> <assets-dir> <meta-dir>
//     Run once per build matrix leg, AFTER `tauri signer sign` has written a
//     sibling `<asset>.sig` for each of that leg's two downloads. Normalises
//     each signature to base64(minisign signature box), picks the one asset the
//     updater plugin can install on this platform, writes an internal
//     `<meta-dir>/<platform-key>.json` and removes every temporary `.sig`.
//     Nothing here is publishable: the release job consumes the meta artifact.
//
//   node latest-json.mjs manifest <assets-dir> <meta-dir> <version>
//     Run once in the release job after all legs' artifacts have been merged.
//     Emits latest.json (GitHub asset URLs) and latest-gitee.json (Gitee asset
//     URLs) into <assets-dir>. `platforms` points at the three already published
//     downloads that tauri-plugin-updater can install; `signatures` carries the
//     signatures of all six downloads so no standalone `.sig` asset is needed.
//     Each manifest points only at its own mirror: never "query GitHub,
//     download from Gitee".
//
//   node latest-json.mjs verify <assets-dir> <version>
//     Fail the release unless <assets-dir> contains exactly the nine published
//     files, both manifests agree with each other and with SHA256SUMS, and no
//     updater archive / `.sig` / `updater-*.json` leaked into the upload set.
//
// No signatures are generated here. The release workflow signs with
// `bun run tauri signer sign` and TAURI_SIGNING_PRIVATE_KEY; this script only
// normalises and carries the result across. With no signing key there are no
// `.sig` files: collect writes empty meta and the clients keep their existing
// "manual download" fallback.

import fs from 'node:fs'
import path from 'node:path'
import { runAsEntry } from './lib/entry.mjs'

const OWNER = 'ariacompute'
const REPO = 'agentbuddy'
// The three keys the release matrix actually publishes. A manifest with zero
// platforms means "unsigned release"; anything else must be exactly this set.
const PUBLISHED_PLATFORMS = ['linux-x86_64', 'darwin-aarch64', 'windows-x86_64']

// Which published download tauri-plugin-updater can consume on each platform.
// Windows: a zip holding a bare .exe would be treated as an NSIS installer, so
// point at the .msi. Linux: a deb-installed app runs `dpkg -i` on the .deb.
// macOS: the plugin always unpacks a gz tar whose root entry is the .app.
const UPDATER_ASSET = {
  'windows-x86_64': /^AgentBuddy-x64-.+\.msi$/,
  'windows-aarch64': /^AgentBuddy-arm64-.+\.msi$/,
  'windows-i686': /^AgentBuddy-x86-.+\.msi$/,
  'darwin-x86_64': /^AgentBuddy-macos-x86_64-.+\.tar\.gz$/,
  'darwin-aarch64': /^AgentBuddy-macos-aarch64-.+\.tar\.gz$/,
  'linux-x86_64': /^AgentBuddy-amd64-.+\.deb$/,
  'linux-aarch64': /^AgentBuddy-arm64-.+\.deb$/,
  'linux-i686': /^AgentBuddy-i386-.+\.deb$/,
  'linux-armv7': /^AgentBuddy-armhf-.+\.deb$/,
}

/** Which platform keys this helper knows: exactly the keys of UPDATER_ASSET. */
const isPlatform = (key) => Object.prototype.hasOwnProperty.call(UPDATER_ASSET, key)

const DOWNLOAD = /^AgentBuddy-[0-9A-Za-z._-]+\.(?:deb|dmg|msi|zip|tar\.gz)$/
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const B64 = /^[A-Za-z0-9+/]+={0,2}$/
const SAFE_NAME = /^[0-9A-Za-z._-]+$/
const META_FILE = /^[a-z0-9_-]+\.json$/

function fail(message) {
  console.error(`latest-json: ${message}`)
  process.exitCode = 1
}

function versionOf(raw) {
  const version = String(raw || '').replace(/^v/i, '')
  if (!SEMVER.test(version)) throw new Error(`not a semver release tag: ${raw}`)
  return version
}

function expectedAssetNames(version) {
  return [
    `AgentBuddy-amd64-${version}.deb`,
    `AgentBuddy-linux-x86_64-${version}.tar.gz`,
    `AgentBuddy-aarch64-${version}.dmg`,
    `AgentBuddy-macos-aarch64-${version}.tar.gz`,
    `AgentBuddy-x64-${version}.msi`,
    `AgentBuddy-windows-x86_64-${version}.zip`,
  ]
}

function assertSafeName(name, label) {
  // SAFE_NAME already refuses `/`, `\\` and anything that is not a bare file
  // name, so it is the whole guard: a second basename() comparison could never
  // be the deciding operand.
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) {
    throw new Error(`${label}: unsafe asset name ${name}`)
  }
}

function assertSignatureBox(box, label) {
  if (!/^untrusted comment: signature/i.test(box) || !/^trusted comment:/im.test(box)) {
    throw new Error(`${label}: not a minisign signature box`)
  }
}

/**
 * `tauri-plugin-updater` base64-decodes the manifest's `signature` field into a
 * minisign signature box. Tauri versions have written `.sig` both as that
 * base64 string and as the plain four-line box; accept either and always emit
 * base64.
 */
function normalizeSignature(raw, label) {
  const text = String(raw || '').trim()
  if (!text) throw new Error(`${label}: empty signature`)
  if (B64.test(text) && text.length % 4 === 0) {
    assertSignatureBox(Buffer.from(text, 'base64').toString('utf8'), label)
    return text
  }
  assertSignatureBox(text, label)
  return Buffer.from(`${text}\n`, 'utf8').toString('base64')
}

function validateSignature(signature, label) {
  if (
    typeof signature !== 'string' ||
    !B64.test(signature) ||
    signature.length % 4 !== 0
  ) {
    throw new Error(`${label}: signature is not base64`)
  }
  assertSignatureBox(Buffer.from(signature, 'base64').toString('utf8'), label)
}

/** `tauri signer sign --app-version` binds the release in the trusted comment. */
function signedVersion(signature) {
  const box = Buffer.from(signature, 'base64').toString('utf8')
  const comment = box.split(/\r?\n/).find((line) => line.startsWith('trusted comment:')) || ''
  const field = comment.split('\t').find((part) => part.startsWith('version:'))
  return field ? field.slice('version:'.length).trim() : null
}

function collect(platformKey, assetsDir, metaDir) {
  if (!isPlatform(platformKey)) throw new Error(`unknown platform key: ${platformKey}`)
  const rule = UPDATER_ASSET[platformKey]
  if (!fs.existsSync(assetsDir)) throw new Error(`asset directory ${assetsDir} does not exist`)

  const files = fs.readdirSync(assetsDir)
  const downloads = files.filter((name) => DOWNLOAD.test(name))
  const sigFiles = files.filter((name) => name.endsWith('.sig'))
  const meta = {
    platform: platformKey,
    updaterAsset: null,
    signature: '',
    signatures: Object.create(null),
  }

  if (sigFiles.length > 0) {
    for (const sigFile of sigFiles) {
      const asset = sigFile.slice(0, -'.sig'.length)
      assertSafeName(asset, sigFile)
      if (!DOWNLOAD.test(asset) || !files.includes(asset)) {
        throw new Error(`${sigFile}: no matching download asset ${asset}`)
      }
      meta.signatures[asset] = normalizeSignature(
        fs.readFileSync(path.join(assetsDir, sigFile), 'utf8'),
        sigFile,
      )
    }
    const unsigned = downloads.filter((name) => !(name in meta.signatures))
    if (unsigned.length) throw new Error(`partially signed release: ${unsigned.join(', ')}`)
    const candidates = Object.keys(meta.signatures).filter((name) => rule.test(name))
    if (candidates.length !== 1) {
      throw new Error(`${platformKey}: expected exactly one installable asset, found ${candidates.length}`)
    }
    meta.updaterAsset = candidates[0]
    meta.signature = meta.signatures[meta.updaterAsset]
  }

  fs.mkdirSync(metaDir, { recursive: true })
  fs.writeFileSync(path.join(metaDir, `${platformKey}.json`), `${JSON.stringify(meta, null, 2)}\n`)
  for (const sigFile of sigFiles) fs.rmSync(path.join(assetsDir, sigFile))
  console.log(
    sigFiles.length === 0
      ? `latest-json: collected ${platformKey} without signatures (manual download)`
      : `latest-json: collected ${platformKey} -> ${meta.updaterAsset} (${sigFiles.length} signed assets)`,
  )
}

function validateMeta(meta, assetsDir, label) {
  const signatures = meta.signatures || Object.create(null)
  for (const [name, signature] of Object.entries(signatures)) {
    assertSafeName(name, label)
    if (!DOWNLOAD.test(name) || !fs.existsSync(path.join(assetsDir, name))) {
      throw new Error(`${label}: signed asset ${name} is not published`)
    }
    validateSignature(signature, `${label}:${name}`)
  }
  if (meta.updaterAsset === null || meta.updaterAsset === undefined) {
    if (Object.keys(signatures).length || meta.signature) {
      throw new Error(`${label}: signatures without an updater asset`)
    }
    return
  }
  assertSafeName(meta.updaterAsset, label)
  if (!fs.existsSync(path.join(assetsDir, meta.updaterAsset))) {
    throw new Error(`${label}: updater asset ${meta.updaterAsset} is not published`)
  }
  if (!signatures[meta.updaterAsset] || signatures[meta.updaterAsset] !== meta.signature) {
    throw new Error(`${label}: updater asset has no matching signature`)
  }
}

function manifest(assetsDir, metaDir, rawVersion) {
  const version = versionOf(rawVersion)
  const tag = `v${version}`
  const metas = []
  if (fs.existsSync(metaDir)) {
    for (const file of fs.readdirSync(metaDir).sort()) {
      if (!META_FILE.test(file)) continue
      const meta = JSON.parse(fs.readFileSync(path.join(metaDir, file), 'utf8'))
      if (!isPlatform(meta.platform)) throw new Error(`${file}: unknown platform ${meta.platform}`)
      if (metas.some((m) => m.platform === meta.platform)) {
        throw new Error(`${file}: duplicate platform ${meta.platform}`)
      }
      validateMeta(meta, assetsDir, file)
      metas.push(meta)
    }
  } else {
    console.log('latest-json: no meta directory; publishing unsigned installers')
  }

  const platforms = Object.create(null)
  const signatures = Object.create(null)
  for (const meta of metas) {
    for (const [name, signature] of Object.entries(meta.signatures || {})) {
      if (signatures[name]) throw new Error(`duplicate signature for ${name}`)
      const bound = signedVersion(signature)
      if (bound && bound.replace(/^v/i, '') !== version) {
        throw new Error(`${name}: signature binds version ${bound}, manifest announces ${version}`)
      }
      signatures[name] = signature
    }
    if (meta.updaterAsset) {
      platforms[meta.platform] = { asset: meta.updaterAsset, signature: meta.signature }
    }
  }

  const mirrors = [
    ['latest.json', `https://github.com/${OWNER}/${REPO}/releases/download/${tag}`],
    ['latest-gitee.json', `https://gitee.com/${OWNER}/${REPO}/releases/download/${tag}`],
  ]
  for (const [file, base] of mirrors) {
    const body = {
      version,
      notes: process.env.RELEASE_NOTES || '',
      pub_date: new Date().toISOString(),
      platforms: Object.create(null),
      signatures,
    }
    for (const [key, entry] of Object.entries(platforms)) {
      body.platforms[key] = {
        url: `${base}/${encodeURIComponent(entry.asset)}`,
        signature: entry.signature,
      }
    }
    fs.writeFileSync(path.join(assetsDir, file), `${JSON.stringify(body, null, 2)}\n`)
    console.log(`latest-json: wrote ${file} with ${Object.keys(platforms).length} platform(s)`)
  }
  if (Object.keys(platforms).length === 0) {
    console.log('latest-json: no signed platform; clients will offer manual download')
  }
}

function verifyManifest(body, name, version, host) {
  if (body.version !== version) throw new Error(`${name}: version ${body.version} != ${version}`)
  const downloads = expectedAssetNames(version)
  const base = `https://${host}/${OWNER}/${REPO}/releases/download/v${version}`
  const keys = Object.keys(body.platforms || {}).sort()
  const wanted = PUBLISHED_PLATFORMS.slice().sort()
  if (keys.length !== 0 && JSON.stringify(keys) !== JSON.stringify(wanted)) {
    throw new Error(`${name}: partial platform set ${keys.join(', ')}`)
  }
  const signatures = body.signatures || Object.create(null)
  const signedNames = Object.keys(signatures).sort()
  const allNames = downloads.slice().sort()
  if (keys.length === 0 && signedNames.length !== 0) {
    throw new Error(`${name}: signatures without any updater platform`)
  }
  if (keys.length !== 0 && JSON.stringify(signedNames) !== JSON.stringify(allNames)) {
    throw new Error(`${name}: expected signatures for all six downloads`)
  }
  for (const [key, entry] of Object.entries(body.platforms || {})) {
    if (!entry.url.startsWith(`${base}/`)) throw new Error(`${name}:${key}: cross-mirror or unsafe URL`)
    const asset = decodeURIComponent(entry.url.slice(base.length + 1))
    if (!downloads.includes(asset)) throw new Error(`${name}:${key}: unknown asset ${asset}`)
    if (!entry.signature || entry.signature !== signatures[asset]) {
      throw new Error(`${name}:${key}: signature does not match the signatures map`)
    }
    validateSignature(entry.signature, `${name}:${key}`)
  }
  // The set comparison above already proved these are exactly the six
  // downloads, so the loop only has to prove each box is a signature.
  for (const [asset, signature] of Object.entries(signatures)) {
    validateSignature(signature, `${name}:${asset}`)
  }
}

function verify(assetsDir, rawVersion) {
  const version = versionOf(rawVersion)
  const downloads = expectedAssetNames(version)
  const expected = [...downloads, 'latest.json', 'latest-gitee.json', 'SHA256SUMS'].sort()
  if (!fs.existsSync(assetsDir)) throw new Error(`asset directory ${assetsDir} does not exist`)
  const actual = fs.readdirSync(assetsDir).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`unexpected release assets: ${actual.join(', ')}`)
  }
  for (const [name, host] of [
    ['latest.json', 'github.com'],
    ['latest-gitee.json', 'gitee.com'],
  ]) {
    verifyManifest(
      JSON.parse(fs.readFileSync(path.join(assetsDir, name), 'utf8')),
      name,
      version,
      host,
    )
  }
  const sums = fs
    .readFileSync(path.join(assetsDir, 'SHA256SUMS'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
      if (!match) throw new Error(`malformed SHA256SUMS line: ${line}`)
      return match[2]
    })
    .sort()
  if (JSON.stringify(sums) !== JSON.stringify(downloads.slice().sort())) {
    throw new Error(`SHA256SUMS must cover exactly the six downloads, found: ${sums.join(', ')}`)
  }
  console.log('latest-json: verified exactly nine release assets')
}

function run(argv) {
  const [command, ...args] = argv
  if (command === 'collect' && args.length === 3) collect(...args)
  else if (command === 'manifest' && args.length === 3) manifest(...args)
  else if (command === 'verify' && args.length === 2) verify(...args)
  else {
    // A usage error is a failure like any other: throw so main() reports it with
    // exit code 1 instead of leaving the run "successful" with nothing done.
    throw new Error(
      'usage: latest-json.mjs collect <platform-key> <assets-dir> <meta-dir> | ' +
        'manifest <assets-dir> <meta-dir> <version> | verify <assets-dir> <version>',
    )
  }
}

/** CLI wrapper: turn a thrown validation error into a `::error::` + exit 1. */
function main(argv = process.argv.slice(2)) {
  try {
    run(argv)
    return 0
  } catch (error) {
    fail(error.message)
    return 1
  }
}

runAsEntry(import.meta.url, main)

export { normalizeSignature, expectedAssetNames, versionOf, collect, manifest, verify, run, main }
