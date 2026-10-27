import { describe, it, expect } from 'vitest'
import {
  resolve,
  detectLang,
  STORAGE_KEY,
  setLang,
  useLang,
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
})
