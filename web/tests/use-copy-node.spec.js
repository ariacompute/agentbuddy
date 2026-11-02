// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { useLang, setLang, useCopy } from '../src/lib/use-copy.js'

// The same module has to load where there is no `window` at all: a prerender
// host, a node script that imports the copy tables, a future SSR build. The
// initial language probe guards for it, and this file is the only place where
// that guard is genuinely exercised — in jsdom `window` always exists.
describe('use-copy without a browser', () => {
  it('starts from English when there is no window to read', () => {
    expect(typeof globalThis.window).toBe('undefined')
    expect(useLang().value).toBe('en')
  })

  it('still resolves copy and can switch language', () => {
    const { t } = useCopy('shell')
    expect(t('navWorkspace')).toBeTruthy()
    setLang('zh')
    expect(useLang().value).toBe('zh')
    // No document to mirror onto: setLang must not throw on the way through.
  })
})
