import { describe, it, expect } from 'vitest'
import { enumsCopy } from '../src/lib/copy/enums-copy.js'

const LANGS = ['en', 'zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'pt', 'ar', 'hi']
const GROUPS = Object.keys(enumsCopy)

describe('enums copy', () => {
  it('covers every language for every group', () => {
    expect(GROUPS.length).toBeGreaterThan(0)
    for (const group of GROUPS) {
      const enKeys = Object.keys(enumsCopy[group].en)
      for (const lang of LANGS) {
        const local = enumsCopy[group][lang]
        expect(local, `${group}.${lang} missing`).toBeTruthy()
        for (const key of enKeys) {
          expect(local[key], `${group}.${lang}.${key} missing`).toBeTruthy()
        }
      }
    }
  })

  it('taskState has all protocol states', () => {
    for (const state of ['submitted', 'working', 'input-required', 'completed', 'failed', 'canceled', 'unknown']) {
      expect(enumsCopy.taskState.en[state]).toBeTruthy()
    }
  })
})
