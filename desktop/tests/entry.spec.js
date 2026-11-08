// `scripts/lib/entry.mjs` is the only place that decides "am I the process entry
// point?". It exists so the decision is an ordinary function a spec can call,
// rather than three lines at the bottom of every script that only a spawned
// process could ever reach — the coverage gate must not need an ignore comment.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { isMain, runAsEntry } from '../scripts/lib/entry.mjs'

const roots = []

function tempScript(name = 'script.mjs') {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-entry-'))
  roots.push(root)
  const file = join(root, name)
  writeFileSync(file, '// fixture\n')
  return file
}

const original = process.argv[1]

afterEach(() => {
  process.argv[1] = original
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('isMain', () => {
  it('compares the resolved argv[1] with the module URL', () => {
    const file = tempScript()
    expect(isMain(pathToFileURL(file), file)).toBe(true)
    // A relative path (how a shell may pass it) resolves to the same file.
    expect(isMain(pathToFileURL(file), relative(process.cwd(), file))).toBe(true)
    expect(isMain(pathToFileURL(file), tempScript('other.mjs'))).toBe(false)
    expect(isMain(pathToFileURL(file), undefined)).toBe(false)
    expect(isMain(pathToFileURL(file), '')).toBe(false)
  })
})

describe('runAsEntry', () => {
  it('does nothing when the module was imported', () => {
    const main = vi.fn(() => 0)
    const exit = { exitCode: 0 }
    // vitest's own argv[1] is not this fixture, so this is the import case.
    expect(runAsEntry(pathToFileURL(tempScript()), main)).toBeUndefined()
    expect(main).not.toHaveBeenCalled()
    expect(exit.exitCode).toBe(0)
  })

  it('runs main and publishes its code when it is the entry point', () => {
    const file = tempScript()
    process.argv[1] = file
    const main = vi.fn(() => 7)
    const exit = { exitCode: 0 }
    expect(runAsEntry(pathToFileURL(file), main, { exit })).toBe(7)
    // `main` takes no arguments: it reads argv/env through its own defaults, so
    // this wrapper never needs a body that only a spawned process could reach.
    expect(main).toHaveBeenCalledWith()
    expect(exit.exitCode).toBe(7)
  })

  it('defaults to the real process when no exit code sink is injected', () => {
    const file = tempScript()
    process.argv[1] = file
    expect(runAsEntry(pathToFileURL(file), () => 3)).toBe(3)
    expect(process.exitCode).toBe(3)
  })
})
