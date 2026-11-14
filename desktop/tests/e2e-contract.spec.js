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
  .map((name) => {
    const src = readFileSync(join(specDir, name), 'utf8')
    return { name, src, calls: stripComments(src) }
  })

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

/**
 * Blanks out line and block comments without touching string literals: URLs and
 * XPath selectors are full of `//`, and a note like `// pageText() is the whole
 * body` is prose, not a call. Characters are replaced one-for-one (newlines
 * kept) so the remaining call sites stay where the regex expects them.
 */
function stripComments(src) {
  let out = ''
  let quote = ''
  let comment = ''
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    const next = src[i + 1] || ''
    if (comment === 'line') {
      out += ch === '\n' ? '\n' : ' '
      if (ch === '\n') comment = ''
      continue
    }
    if (comment === 'block') {
      out += ch === '\n' ? '\n' : ' '
      if (ch === '*' && next === '/') {
        out += ' '
        i += 1
        comment = ''
      }
      continue
    }
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next
        i += 1
      } else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      comment = 'line'
      out += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      comment = 'block'
      out += ' '
      continue
    }
    out += ch
  }
  return out
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
        for (const m of spec.calls.matchAll(calls)) {
          if (m[1].trim() !== 'wd') bad.push(`${spec.name}: ${name}(${m[1].trim()}…)`)
        }
      }
    }
    expect(bad, `helpers called without wd: ${bad.join(', ')}`).toEqual([])
  })

  it('ignores comments but still sees real calls and string literals', () => {
    const src = [
      '// pageText() is prose, not a call',
      '/* click() is prose too */',
      "const url = 'http://127.0.0.1:1';",
      'const xpath = `(//section)[1]`;',
      'await waitForText(wd, label);',
      'await pageText(proxy);',
    ].join('\n')
    const code = stripComments(src)
    expect(code).not.toContain('pageText()')
    expect(code).not.toContain('click()')
    expect(code).toContain("'http://127.0.0.1:1'")
    expect(code).toContain('`(//section)[1]`')
    expect(code).toContain('waitForText(wd, label)')
    expect(code).toContain('pageText(proxy)')
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
