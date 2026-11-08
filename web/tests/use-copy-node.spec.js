// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
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

  it('also probes a browser-shaped global when one is present', async () => {
    // The bootstrap ternary has two arms. This file covers the window-less one
    // at import time; re-evaluating the module here with a stand-in window
    // reaches `? window.location.search` and `? window.localStorage` too.
    vi.stubGlobal('window', {
      location: { search: '?lang=fr' },
      localStorage: { getItem: () => null, setItem: () => {} },
    })
    vi.resetModules()
    try {
      const fresh = await import('../src/lib/use-copy.js')
      expect(fresh.useLang().value).toBe('fr')
      expect(fresh.detectLang('', { getItem: () => 'ja' })).toBe('ja')
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
