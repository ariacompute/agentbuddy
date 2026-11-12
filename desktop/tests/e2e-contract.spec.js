// The desktop E2E suite can only run in full on Linux with a built Tauri binary,
// but its most expensive failure was a plain wiring mistake: specs imported a
// helper that the driver never exported (Vite's SSR transform silently yields
// `undefined` instead of a link error) and called helpers without the `wd`
// session. Pin both contracts statically so they are caught on any machine.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const E2E_ROOT = fileURLToPath(new URL('../e2e/', import.meta.url))
const helpers = readFileSync(join(E2E_ROOT, 'driver', 'helpers.mjs'), 'utf8')
const specDir = join(E2E_ROOT, 'specs')
const specs = readdirSync(specDir)
  .filter((name) => name.endsWith('.spec.js'))
  .map((name) => ({ name, src: readFileSync(join(specDir, name), 'utf8') }))

function exportedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1])
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) names.add(name)
    }
  }
  return names
}

function importedFromHelpers(src) {
  const names = []
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (!m[2].endsWith('driver/helpers.mjs')) continue
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name) names.push(name)
    }
  }
  return names
}

/** Helpers whose declared first parameter is the WebDriver session. */
function wdFirstNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(\s*wd\b/g)) {
    names.add(m[1])
  }
  return names
}

describe('desktop E2E driver contract', () => {
  it('exports every helper the journeys import', () => {
    const exported = exportedNames(helpers)
    const missing = []
    for (const spec of specs) {
      for (const name of importedFromHelpers(spec.src)) {
        if (!exported.has(name)) missing.push(`${spec.name}: ${name}`)
      }
    }
    expect(missing, `missing helpers exports: ${missing.join(', ')}`).toEqual([])
  })

  it('passes the WebDriver session first to every wd-owning helper', () => {
    const bad = []
    for (const spec of specs) {
      for (const name of wdFirstNames(helpers)) {
        // Skip method calls (`wd.click(id)`) and CSS pseudo-classes
        // (`nth-of-type(1)`); only bare helper calls count.
        const calls = new RegExp(`(?<![\\w.\\-])${name}\\s*\\(\\s*([^,)\\n]*)`, 'g')
        for (const m of spec.src.matchAll(calls)) {
          if (m[1].trim() !== 'wd') bad.push(`${spec.name}: ${name}(${m[1].trim()}…)`)
        }
      }
    }
    expect(bad, `helpers called without wd: ${bad.join(', ')}`).toEqual([])
  })

  it('keeps the fault-injection vocabulary in sync with the stub', () => {
    const scenarios = readFileSync(join(E2E_ROOT, 'stub', 'scenarios.mjs'), 'utf8')
    const contract = readFileSync(join(specDir, 'stub-contract.spec.js'), 'utf8')
    for (const mode of ['unauthenticated', 'forbidden', 'unavailable', 'feature_off', 'server_error']) {
      expect(scenarios).toContain(`${mode}:`)
      expect(contract).toContain(`'${mode}'`)
    }
  })
})
