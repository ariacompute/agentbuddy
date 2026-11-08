import { describe, it, expect } from 'vitest'
import { withCopy } from '../src/lib/copy/scheduler-copy.js'
import { shellCopy } from '../src/lib/copy/shell-copy.js'
import { workspaceCopy } from '../src/lib/copy/workspace-copy.js'
import { threadCopy } from '../src/lib/copy/thread-copy.js'
import { taskCopy } from '../src/lib/copy/task-copy.js'
import { orgCopy } from '../src/lib/copy/org-copy.js'
import { channelCopy } from '../src/lib/copy/channel-copy.js'
import { connectorCopy } from '../src/lib/copy/connector-copy.js'
import { settingsCopy } from '../src/lib/copy/settings-copy.js'
import { upgradeCopy } from '../src/lib/copy/upgrade-copy.js'
import { errorsCopy } from '../src/lib/copy/errors-copy.js'
import { hubCopy } from '../src/lib/copy/hub-copy.js'

// Mirrors agenthub: every language must translate every key, and none may equal
// the English text. This is what keeps the app from silently falling back to a
// language the user did not choose.
const NAMESPACES = {
  shell: shellCopy,
  workspace: workspaceCopy,
  thread: threadCopy,
  task: taskCopy,
  org: orgCopy,
  channel: channelCopy,
  connector: connectorCopy,
  settings: settingsCopy,
  // Folded into `settings` at runtime, but audited on its own so every new
  // update-card key has to be translated in all 13 languages.
  upgrade: upgradeCopy,
  errors: errorsCopy,
  hub: hubCopy,
}

const LANGS = ['zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'pt', 'ar', 'hi']

describe('copy fallback', () => {
  for (const [name, table] of Object.entries(NAMESPACES)) {
    describe(name, () => {
      const en = table.en
      const enKeys = Object.keys(en)

      it('has English as the fallback with every key', () => {
        expect(enKeys.length).toBeGreaterThan(0)
      })

      for (const lang of LANGS) {
        it(`${lang} translates every key and differs from English`, () => {
          const local = table[lang]
          expect(local).toBeTruthy()
          for (const key of enKeys) {
            expect(local[key], `${lang}.${key} missing`).toBeTruthy()
            expect(local[key], `${lang}.${key} equals English`).not.toBe(en[key])
          }
        })
      }
    })
  }
})

describe('withCopy', () => {
  it('folds the extra keys into the languages that have them', () => {
    const out = withCopy({ en: { a: 'A' }, zh: { a: '甲' } }, { en: { b: 'B' } })
    expect(out.en).toEqual({ a: 'A', b: 'B' })
    expect(out.zh).toEqual({ a: '甲' })
  })

  it('keeps a language the extra table does not cover', () => {
    // A namespace can grow a key before every locale has it; the language must
    // survive the merge so the English fallback in `resolve()` can still work.
    const out = withCopy({ en: { a: 'A' }, ar: { a: 'أ' } }, { en: { b: 'B' }, zh: { b: '乙' } })
    expect(out.ar).toEqual({ a: 'أ' })
    // The extra table cannot introduce a language of its own: the set of
    // languages is owned by the base table, which the copy-fallback suite audits.
    expect(Object.keys(out).sort()).toEqual(['ar', 'en'])
    expect(out.zh).toBeUndefined()
  })

  it('does not mutate the table it was given', () => {
    const table = { en: { a: 'A' } }
    withCopy(table, { en: { b: 'B' } })
    expect(table.en).toEqual({ a: 'A' })
  })
})
