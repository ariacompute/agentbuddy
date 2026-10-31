import { describe, it, expect, vi } from 'vitest'
import {
  resolve,
  detectLang,
  STORAGE_KEY,
  setLang,
  useLang,
  useCopy,
  enumLabel,
  taskStateLabel,
  kindLabel,
  healthLabel,
} from '../src/lib/use-copy.js'

describe('use-copy', () => {
  it('resolve shallow-merges English under a locale', () => {
    const table = { en: { a: 'A', b: 'B' }, fr: { b: 'Bfr' } }
    const merged = resolve(table, 'fr')
    expect(merged.a).toBe('A')
    expect(merged.b).toBe('Bfr')
  })

  it('detectLang prefers query, then storage, then en', () => {
    expect(detectLang('?lang=zh', null)).toBe('zh')
    expect(detectLang('?lang=zz', null)).toBe('en')
    const storage = { getItem: (k) => (k === STORAGE_KEY ? 'ja' : null) }
    expect(detectLang('', storage)).toBe('ja')
    expect(detectLang('', { getItem: () => 'zz' })).toBe('en')
  })

  it('enumLabel returns the localised label or the raw value', () => {
    expect(taskStateLabel('working')).toBeTruthy()
    expect(enumLabel('taskState', 'missing')).toBe('missing')
    expect(kindLabel('zzz-unknown')).toBe('zzz-unknown')
    expect(healthLabel('healthy')).toBeTruthy()
  })

  it('setLang updates the shared language ref', () => {
    const before = useLang().value
    expect(setLang('fr')).toBe('fr')
    expect(useLang().value).toBe('fr')
    setLang(before)
  })

  it('useCopy binds a namespace and exposes t/te', () => {
    const copy = useCopy('shell')
    expect(copy.lang).toBe(useLang())
    expect(typeof copy.t('langLabel')).toBe('string')
    expect(copy.t('langLabel').length).toBeGreaterThan(0)
    expect(copy.te('langLabel')).toBe(true)
    expect(copy.te('noSuchKey')).toBe(false)
  })

  it('useLang returns the shared language ref', () => {
    expect(useLang().value).toBe('en')
  })

  it('label helpers localise known enums and pass unknown values through', () => {
    expect(taskStateLabel('working')).toBeTruthy()
    expect(kindLabel('mcp')).toBeTruthy()
    expect(healthLabel('healthy')).toBeTruthy()
    expect(kindLabel('zzz-unknown')).toBe('zzz-unknown')
    expect(healthLabel('')).toBe('')
  })

  it('setLang mirrors the language onto <html> and pushes to the shell', async () => {
    const setItem = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const docEl = {}
    vi.stubGlobal('window', { localStorage: { getItem: vi.fn(), setItem } })
    vi.stubGlobal('document', { documentElement: docEl })
    vi.stubGlobal('fetch', fetchMock)
    const before = useLang().value
    try {
      setLang('ar')
      expect(docEl.lang).toBe('ar')
      expect(docEl.dir).toBe('rtl')
      expect(setItem).toHaveBeenCalledWith('agentbuddy.lang', 'ar')
      expect(fetchMock).toHaveBeenCalledWith('/__shell/config', expect.objectContaining({ method: 'POST' }))
    } finally {
      setLang(before)
      vi.unstubAllGlobals()
    }
  })

  it('setLang falls back to en for an unknown code', () => {
    const before = useLang().value
    expect(setLang('xx')).toBe('en')
    expect(useLang().value).toBe('en')
    setLang(before)
  })
})
