import { describe, it, expect } from 'vitest'
import { CODE_KEYS, errorMessage } from '../src/lib/errors.js'
import { errorsCopy } from '../src/lib/copy/errors-copy.js'

describe('errors', () => {
  it('localises a known code in English', () => {
    const msg = errorMessage('bad_request')
    expect(msg).toBeTruthy()
    // English fallback copy, never the raw machine code.
    expect(msg).not.toBe('bad_request')
  })

  it('falls back to the raw code for unknown/empty input', () => {
    expect(errorMessage('totally_unknown_code')).toBe('totally_unknown_code')
    expect(errorMessage('')).toBe('')
  })

  it('every registered code maps to an English copy key', () => {
    expect(errorsCopy.en).toBeTruthy()
    const enKeys = new Set(Object.keys(errorsCopy.en))
    for (const code of Object.keys(CODE_KEYS)) {
      const key = CODE_KEYS[code]
      expect(enKeys.has(key), `CODE_KEYS.${code} -> ${key} missing in errorsCopy.en`).toBe(true)
    }
  })

  it('every registered code has a non-empty English label', () => {
    for (const code of Object.keys(CODE_KEYS)) {
      const key = CODE_KEYS[code]
      expect(errorsCopy.en[key], `${code} (${key})`).toBeTruthy()
    }
  })

  it('maps the F10-F16 machine codes to non-empty localised copy', () => {
    const codes = [
      'computer_not_found',
      'schedule_not_found',
      'schedule_invalid',
      'skill_distill_disabled',
      'feature_unavailable',
    ]
    for (const code of codes) {
      expect(CODE_KEYS[code], `${code} should be registered`).toBeTruthy()
      const msg = errorMessage(code)
      expect(msg, `${code} should localise`).toBeTruthy()
      expect(msg).not.toBe(code) // never the raw machine code
      expect(errorsCopy.en[CODE_KEYS[code]], `${code} en label`).toBeTruthy()
    }
  })
})
