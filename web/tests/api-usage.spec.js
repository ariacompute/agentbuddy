// Every wrapper in api.js has to be reachable from the product.
//
// The round-4 review found twelve exports that nothing called: the endpoints
// existed on the server, the client had a typed wrapper for each, and no screen
// ever asked for one. Unit tests did not notice, because they test the wrapper
// against a stub — they prove the call is well-formed, not that anybody makes it.
//
// This guard closes that gap by reading the source: an export of api.js that no
// other file under src/ mentions is a feature that shipped server-side only.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as api from '../src/lib/api.js'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '../src')
const apiFile = join(srcRoot, 'lib', 'api.js')

/**
 * Exports that are plumbing rather than endpoints. Each one has to be used inside
 * api.js itself (the assertion below checks that), so listing it here does not
 * hide an unwired feature.
 */
const PLUMBING = new Set(['BASE', 'ApiError', 'authConfig', 'isAuthError', 'request'])

function sourceFiles(dir = srcRoot) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (/\.(js|vue)$/.test(name)) out.push(full)
  }
  return out
}

const files = sourceFiles().map((path) => ({
  path,
  rel: relative(srcRoot, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}))

/** Does any file other than api.js reference `name` as an identifier? */
function usedOutsideApi(name) {
  const pattern = new RegExp(`\\b${name}\\b`)
  return files.some((f) => f.path !== apiFile && pattern.test(f.text))
}

const exported = Object.keys(api).filter((name) => !PLUMBING.has(name)).sort()

describe('api.js exports', () => {
  it('has a wrapper for every endpoint group it claims', () => {
    // A floor, not a target: it fails loudly if the module is refactored to
    // export nothing, which would make every assertion below vacuous.
    expect(exported.length).toBeGreaterThan(40)
  })

  it('is referenced by at least one screen or component', () => {
    const orphans = exported.filter((name) => !usedOutsideApi(name))
    expect(orphans, `these wrappers are never called by the app:\n  ${orphans.join('\n  ')}`).toEqual([])
  })

  it('keeps the plumbing exports internal to api.js', () => {
    // If a plumbing helper is imported elsewhere it is no longer plumbing, and
    // the allowlist above would be hiding a real use — or a real orphan.
    const apiText = readFileSync(apiFile, 'utf8')
    for (const name of PLUMBING) {
      expect(apiText, `${name} is not defined in api.js`).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })
})
