import { describe, it, expect, vi } from 'vitest'
import {
  DASH,
  formatBytes,
  formatDuration,
  formatTime,
  formatShortTime,
  formatRows,
  formatRatio,
} from '../src/lib/format.js'

describe('format', () => {
  it('formatBytes guards invalid input and renders units', () => {
    expect(formatBytes(-1)).toBe(DASH)
    expect(formatBytes('nope')).toBe(DASH)
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(150 * 1024 * 1024 * 1024)).toBe('150 GB')
  })

  it('formatDuration renders ms, s and m s', () => {
    expect(formatDuration(-1)).toBe(DASH)
    expect(formatDuration('x')).toBe(DASH)
    expect(formatDuration(500)).toBe('500 ms')
    expect(formatDuration(999)).toBe('999 ms')
    expect(formatDuration(1000)).toBe('1.0 s')
    expect(formatDuration(1500)).toBe('1.5 s')
    expect(formatDuration(60000)).toBe('1m 0s')
    expect(formatDuration(90000)).toBe('1m 30s')
  })

  it('formatTime and formatShortTime fall back to a dash', () => {
    expect(formatTime(null)).toBe(DASH)
    expect(formatTime('')).toBe(DASH)
    expect(formatTime('not-a-date')).toBe(DASH)
    expect(formatShortTime(null)).toBe(DASH)
    expect(formatShortTime('garbage')).toBe(DASH)
    // A valid stamp renders something other than the dash.
    expect(formatTime('2020-01-01T00:00:00Z')).not.toBe(DASH)
    expect(formatShortTime(new Date('2020-01-01T00:00:00Z'))).not.toBe(DASH)
  })

  it('formatRows only accepts non-negative integers', () => {
    expect(formatRows(-1)).toBe(DASH)
    expect(formatRows(1.5)).toBe(DASH)
    expect(formatRows('x')).toBe(DASH)
    expect(formatRows(0)).toBe('0')
    expect(formatRows(42)).toBe('42')
  })

  it('formatRatio needs a positive denominator', () => {
    expect(formatRatio(0, 0)).toBe(DASH)
    expect(formatRatio(1, 0)).toBe(DASH)
    expect(formatRatio(1, 4)).toBe('25%')
    expect(formatRatio(3, 4)).toBe('75%')
  })

  it('stops at GB even when the value is terabytes', () => {
    expect(formatBytes(1024 ** 4)).toBe('1024 GB')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe(DASH)
    expect(formatBytes(null)).toBe('0 B')
  })

  it('formatRatio rejects a value that is not a number', () => {
    expect(formatRatio('x', 10)).toBe(DASH)
    expect(formatRatio(1, 'x')).toBe(DASH)
    expect(formatRatio(-1, 4)).toBe('-25%')
  })

  it('renders a Date in the requested locale', () => {
    expect(formatTime(new Date('2020-01-01T00:00:00Z'), 'en')).not.toBe(DASH)
    expect(formatShortTime(new Date(), 'en')).not.toBe(DASH)
  })

  it('reports an unusable locale and falls back to a dash', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Intl rejects a tag with spaces, which is exactly the path a bad
    // `agentbuddy.lang` value takes in the wild.
    expect(formatTime('2020-01-01T00:00:00Z', 'not a language tag')).toBe(DASH)
    expect(formatShortTime('2020-01-01T00:00:00Z', 'not a language tag')).toBe(DASH)
    expect(consoleError).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('formatShortTime shows a clock for today and a date for older stamps', () => {
    const today = formatShortTime(new Date(), 'en')
    const older = formatShortTime(new Date('2020-01-01T00:00:00Z'), 'en')
    expect(today).not.toBe(older)
  })
})
