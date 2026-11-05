#!/usr/bin/env node
// Release-time helper for the auto-updater, with two subcommands:
//
//   node latest-json.mjs collect <platform-key> <out-dir>
//     Run once per build matrix leg. Tauri's `createUpdaterArtifacts` produces
//     a signed archive plus a sibling `.sig` somewhere under target/release/
//     bundle. Keep the archive's original filename: tauri-plugin-updater
//     infers the bundle type (msi.zip / app.tar.gz / AppImage.tar.gz) from it.
//     Writes updater-<platform-key>.json describing the leg into <out-dir>.
//
//   node latest-json.mjs manifest <assets-dir> <version>
//     Run once in the release job, after all legs' artifacts have been merged.
//     Emits latest.json (GitHub asset URLs) and latest-gitee.json (Gitee asset
//     URLs). Each manifest points only at its own mirror: the same signed
//     bytes, the same public key, never "query GitHub, download from Gitee".
//
// No signatures are generated here. `tauri build` signs with
// TAURI_SIGNING_PRIVATE_KEY; this script only carries the result across.

import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'ariacompute'
const REPO = 'agentbuddy'
const PLATFORMS = new Set([
  'windows-x86_64',
  'windows-aarch64',
  'windows-i686',
  'darwin-x86_64',
  'darwin-aarch64',
  'linux-x86_64',
  'linux-aarch64',
  'linux-i686',
  'linux-armv7',
])

function fail(message) {
  console.error(`latest-json: ${message}`)
  process.exitCode = 1
}

function collectSignatures(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSignatures(full, found)
    else if (full.endsWith('.sig')) found.push(full)
  }
}

function collect(platformKey, outDir) {
  if (!PLATFORMS.has(platformKey)) {
    fail(`unknown platform key: ${platformKey}`)
    return
  }
  const bundleRoot = path.resolve('desktop/src-tauri/target/release/bundle')
  if (!fs.existsSync(bundleRoot)) {
    console.log('latest-json: no bundle directory; skipping updater artifacts')
    return
  }
  const signatures = []
  collectSignatures(bundleRoot, signatures)
  if (signatures.length === 0) {
    // Signing is optional (the private key is a repository secret). Without
    // it we still publish the ordinary installers; clients treat the missing
    // platform key as "no installer for this system" and offer a manual link.
    console.log('latest-json: no updater signature was produced; skipping')
    return
  }
  const signaturePath = signatures[0]
  const assetPath = signaturePath.slice(0, -'.sig'.length)
  if (!fs.existsSync(assetPath)) {
    fail(`signature ${signaturePath} has no matching archive`)
    return
  }
  const asset = path.basename(assetPath)
  const signature = fs.readFileSync(signaturePath, 'utf8').trim()
  if (!signature) {
    fail(`signature ${signaturePath} is empty`)
    return
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.copyFileSync(assetPath, path.join(outDir, asset))
  fs.copyFileSync(signaturePath, path.join(outDir, `${asset}.sig`))
  fs.writeFileSync(
    path.join(outDir, `updater-${platformKey}.json`),
    `${JSON.stringify({ platform: platformKey, asset, signature }, null, 2)}\n`,
  )
  console.log(`latest-json: collected ${platformKey} -> ${asset}`)
}

function manifest(assetsDir, rawVersion) {
  const version = String(rawVersion || '').replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`not a semver release tag: ${rawVersion}`)
    return
  }
  const tag = `v${version}`
  const platforms = Object.create(null)
  for (const file of fs.readdirSync(assetsDir)) {
    if (!/^updater-[a-z0-9_-]+\.json$/.test(file)) continue
    const meta = JSON.parse(fs.readFileSync(path.join(assetsDir, file), 'utf8'))
    if (!PLATFORMS.has(meta.platform)) {
      fail(`${file}: unknown platform ${meta.platform}`)
      return
    }
    if (platforms[meta.platform]) {
      fail(`${file}: duplicate platform ${meta.platform}`)
      return
    }
    if (!meta.asset || !meta.signature || !fs.existsSync(path.join(assetsDir, meta.asset))) {
      fail(`${file}: missing asset or signature`)
      return
    }
    // A leaked build directory or a path traversal in a name must never become
    // a URL segment.
    if (path.basename(meta.asset) !== meta.asset || /[\\/]/.test(meta.asset)) {
      fail(`${file}: unsafe asset name ${meta.asset}`)
      return
    }
    platforms[meta.platform] = meta
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
    }
    for (const [key, meta] of Object.entries(platforms)) {
      body.platforms[key] = {
        url: `${base}/${encodeURIComponent(meta.asset)}`,
        signature: meta.signature,
      }
    }
    fs.writeFileSync(path.join(assetsDir, file), `${JSON.stringify(body, null, 2)}\n`)
    console.log(`latest-json: wrote ${file} with ${Object.keys(platforms).length} platform(s)`)
  }
  if (Object.keys(platforms).length === 0) {
    console.log('latest-json: no signed platform; clients will offer manual download')
  }
}

const [command, first, second] = process.argv.slice(2)
if (command === 'collect' && first && second) collect(first, second)
else if (command === 'manifest' && first && second) manifest(first, second)
else fail('usage: latest-json.mjs collect <platform-key> <out-dir> | manifest <assets-dir> <version>')
