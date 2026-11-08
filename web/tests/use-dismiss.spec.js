import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDismiss } from '../src/lib/use-dismiss.js'

describe('useDismiss', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts at the initial value and shows new content', () => {
    const { value, show } = useDismiss('first')
    expect(value.value).toBe('first')
    show('second')
    expect(value.value).toBe('second')
  })

  it('auto-dismisses after the ttl', () => {
    const { value, show } = useDismiss(null, 1000)
    show('hello')
    expect(value.value).toBe('hello')
    vi.advanceTimersByTime(1000)
    expect(value.value).toBeNull()
  })

  it('never auto-dismisses when ttl is 0', () => {
    const { value, show } = useDismiss(null, 0)
    show('sticky')
    vi.advanceTimersByTime(10000)
    expect(value.value).toBe('sticky')
  })

  it('dismiss cancels a pending timer and clears the value', () => {
    const { value, show, dismiss } = useDismiss(null, 1000)
    show('hello')
    dismiss()
    expect(value.value).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(value.value).toBeNull()
  })

  it('show resets the timer so stale dismissals do not fire', () => {
    const { value, show } = useDismiss(null, 1000)
    show('a')
    vi.advanceTimersByTime(500)
    show('b')
    vi.advanceTimersByTime(500)
    // a's timer would have fired here, but b restarted it.
    expect(value.value).toBe('b')
    vi.advanceTimersByTime(500)
    expect(value.value).toBeNull()
  })
})
