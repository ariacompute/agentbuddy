import { describe, it, expect } from 'vitest'
import {
  IDEMPOTENT_WINDOW_MS,
  eventKey,
  decide,
  markSeen,
  pruneSeen,
} from '../src/lib/notifications.js'

describe('notifications eventKey', () => {
  it('joins taskId and state', () => {
    expect(eventKey({ taskId: 't1', state: 'completed' })).toBe('t1:completed')
    expect(eventKey({})).toBe(':')
  })
})

describe('notifications decide', () => {
  const now = 1_000_000

  it('returns null when there is no event or no clock to weigh it against', () => {
    // The poll loop hands this whatever the last refresh produced; a frame that
    // arrived without a body, or a clock that is not a number, must not throw.
    expect(decide({ event: null, seen: {}, now })).toBeNull()
    expect(decide({ event: { taskId: 't1', state: 'completed' }, seen: {}, now: Number.NaN })).toBeNull()
  })

  it('returns null for non-announced states', () => {
    expect(decide({ event: { taskId: 't1', state: 'submitted' }, seen: {}, now })).toBeNull()
  })

  it('returns null without a taskId', () => {
    expect(decide({ event: { state: 'completed' }, seen: {}, now })).toBeNull()
  })

  it('announces a first result for a completed task', () => {
    const d = decide({
      event: { taskId: 't1', state: 'completed', agentName: 'Bob', summary: 'done' },
      seen: {},
      now,
    })
    expect(d).not.toBeNull()
    expect(d.kind).toBe('result')
    expect(d.title).toBe('notifyResult')
    expect(d.body).toBe('done')
    expect(d.link).toBe('/tasks/t1')
  })

  it('links an input-required event to the thread', () => {
    const d = decide({
      event: { taskId: 't1', threadId: 'th1', state: 'input-required' },
      seen: {},
      now,
    })
    expect(d.kind).toBe('approval')
    expect(d.link).toBe('/threads/th1')
  })

  it('suppresses a repeat within the idempotency window', () => {
    const seen = { 't1:completed': now - 1000 }
    expect(decide({ event: { taskId: 't1', state: 'completed' }, seen, now })).toBeNull()
  })

  it('announces the same key again once the window has passed', () => {
    // The window is the only rule: a stale entry must not silence a real retry.
    const seen = { 't1:completed': now - IDEMPOTENT_WINDOW_MS - 1 }
    const d = decide({ event: { taskId: 't1', state: 'completed' }, seen, now })
    expect(d).not.toBeNull()
    expect(d.title).toBe('notifyResult')
  })

  it('announces the same task again when it reaches a different state', () => {
    // The key carries the state, so "completed" never mutes "failed".
    const seen = { 't1:completed': now - 1000 }
    const d = decide({ event: { taskId: 't1', state: 'failed' }, seen, now })
    expect(d).not.toBeNull()
    expect(d.kind).toBe('failure')
  })

  it('marks system:false when notifications are disabled', () => {
    const d = decide({
      event: { taskId: 't1', state: 'completed' },
      seen: {},
      now,
      settings: { enabled: false },
    })
    expect(d.system).toBe(false)
  })

  it('marks system:false during a quiet period', () => {
    const d = decide({
      event: { taskId: 't1', state: 'completed' },
      seen: {},
      now,
      settings: { quietUntil: now + 5000 },
    })
    expect(d.system).toBe(false)
  })

  it('falls back to a digest when the per-minute cap is hit', () => {
    const settings = { maxPerMinute: 2, recent: [now - 1000, now - 2000] }
    const d = decide({ event: { taskId: 't1', state: 'completed' }, seen: {}, now, settings })
    expect(d.kind).toBe('digest')
    expect(d.title).toBe('digestTitle')
  })
})

describe('notifications seen bookkeeping', () => {
  const now = 2_000_000

  it('markSeen returns a fresh object with the key stamped', () => {
    const seen = markSeen({ a: 1 }, 'k', now)
    expect(seen).toEqual({ a: 1, k: now })
  })

  it('pruneSeen drops entries older than the window', () => {
    const seen = { fresh: now - 100, stale: now - IDEMPOTENT_WINDOW_MS - 1 }
    expect(pruneSeen(seen, now)).toEqual({ fresh: now - 100 })
  })

  it('treats a missing map as empty rather than throwing', () => {
    // `seen` starts as {} but a store restored from an older build, or one that
    // never ingested anything, can hand these functions nothing at all.
    expect(markSeen(undefined, 'k', now)).toEqual({ k: now })
    expect(pruneSeen(undefined, now)).toEqual({})
  })
})
