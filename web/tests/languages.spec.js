import { describe, it, expect } from 'vitest'
import {
  LANGUAGES, LANG_CODES, isRTL, isValidLang, matchLang, hreflangFor, ogLocaleFor,
} from '../src/lib/languages.js'

describe('languages', () => {
  it('exactly 13 languages', () => {
    expect(LANGUAGES.length).toBe(13)
    expect(LANG_CODES).toEqual([
      'en', 'zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'pt', 'ar', 'hi',
    ])
  })

  it('only arabic is RTL', () => {
    expect(isRTL('ar')).toBe(true)
    for (const code of LANG_CODES.filter((c) => c !== 'ar')) {
      expect(isRTL(code)).toBe(false)
    }
  })

  it('validates codes', () => {
    expect(isValidLang('en')).toBe(true)
    expect(isValidLang('xx')).toBe(false)
  })

  it('matches browser locales', () => {
    expect(matchLang('en-US')).toBe('en')
    expect(matchLang('zh-Hant-HK')).toBe('zh-TW')
    expect(matchLang('fr')).toBe('fr')
    expect(matchLang('xx')).toBe('en')
    expect(matchLang('')).toBe('en')
  })

  it('maps codes onto hreflang and Open Graph locales', () => {
    expect(hreflangFor('zh')).toBe('zh-Hans')
    expect(hreflangFor('zh-TW')).toBe('zh-Hant')
    expect(hreflangFor('ar')).toBe('ar')
    expect(ogLocaleFor('zh')).toBe('zh_CN')
    expect(ogLocaleFor('pt')).toBe('pt_BR')
    // An unmapped code is passed through rather than crashing a page that
    // somehow got a language the catalogue never shipped.
    expect(hreflangFor('xx')).toBe('xx')
    expect(ogLocaleFor('xx')).toBe('en_US')
  })

  it('names every language in its own script', () => {
    for (const [code, name] of LANGUAGES) {
      expect(name.trim()).not.toBe('')
      expect(name).not.toBe(code)
    }
  })
})
