import { describe, it, expect } from 'vitest'
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
})
