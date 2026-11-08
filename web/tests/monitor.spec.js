import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computePollInterval, ActivityMonitor } from '../src/lib/monitor.js'

describe('monitor computePollInterval', () => {
  it('uses the visible cadence when the window is shown', () => {
    expect(computePollInterval({ visible: true })).toBe(5000)
    expect(computePollInterval({ visible: false })).toBe(20000)
  })

  it('backs off exponentially while failing, floored and ceilinged', () => {
    expect(computePollInterval({ failing: true, failureCount: 0 })).toBe(5000)
    expect(computePollInterval({ failing: true, failureCount: 1 })).toBe(10000)
    expect(computePollInterval({ failing: true, failureCount: 2 })).toBe(20000)
    expect(computePollInterval({ failing: true, failureCount: 100 })).toBe(30000)
  })

  it('prefers backoff over visibility when failing', () => {
    expect(computePollInterval({ visible: true, failing: true, failureCount: 1 })).toBe(10000)
  })
})

vi.mock('../src/lib/api.js', () => ({
  getWorkspace: vi.fn(),
  listTasks: vi.fn(),
  subscribeTaskEvents: vi.fn(),
  isAuthError: vi.fn(),
}))

import { getWorkspace, listTasks, subscribeTaskEvents, isAuthError } from '../src/lib/api.js'

function makeStore() {
  return { agents: [], tasks: [], offline: true, authExpired: false, seen: {}, ingestTask() {} }
}

function flush() {
  return new Promise((r) => setTimeout(r, 10))
}

describe('ActivityMonitor', () => {
  beforeEach(() => {
    getWorkspace.mockReset()
    listTasks.mockReset()
    subscribeTaskEvents.mockReset()
  })

  it('polls workspace + tasks and clears the offline flag on success', async () => {
    getWorkspace.mockResolvedValue({ agents: [{ id: 'a1' }] })
    listTasks.mockResolvedValue({ tasks: [{ id: 't1', status: { state: 'completed' } }] })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(getWorkspace).toHaveBeenCalled()
    expect(listTasks).toHaveBeenCalled()
    expect(store.agents).toEqual([{ id: 'a1' }])
    expect(store.offline).toBe(false)
    expect(m.failing).toBe(false)
    expect(m.failureCount).toBe(0)
    m.stop()
  })

  it('flips offline + failing when the poll throws a connectivity error', async () => {
    getWorkspace.mockRejectedValue(new Error('boom'))
    isAuthError.mockReturnValue(false)
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(store.offline).toBe(true)
    expect(store.authExpired).toBe(false)
    expect(m.failing).toBe(true)
    expect(m.failureCount).toBe(1)
    m.stop()
  })

  it('flags authExpired (not offline) when the poll fails with an auth error', async () => {
    const authErr = { code: 'unauthenticated', status: 401 }
    getWorkspace.mockRejectedValue(authErr)
    isAuthError.mockReturnValue(true)
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(store.authExpired).toBe(true)
    expect(store.offline).toBe(false)
    // An expired session is not a connectivity failure, so no backoff.
    expect(m.failing).toBe(false)
    expect(m.failureCount).toBe(0)
    m.stop()
  })

  it('treats auth and connectivity errors differently on successive polls', async () => {
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.running = true // bypass the scheduler; drive _poll directly

    isAuthError.mockReturnValue(true)
    getWorkspace.mockRejectedValue({ code: 'unauthenticated', status: 401 })
    await m._poll()
    expect(store.authExpired).toBe(true)
    expect(store.offline).toBe(false)
    expect(m.failing).toBe(false)
    expect(m.failureCount).toBe(0)

    // A genuine connectivity failure afterwards: offline wins, authExpired cleared.
    isAuthError.mockReturnValue(false)
    getWorkspace.mockRejectedValue(new Error('boom'))
    await m._poll()
    expect(store.offline).toBe(true)
    expect(store.authExpired).toBe(false)
    expect(m.failing).toBe(true)
    expect(m.failureCount).toBe(1)
  })

  it('subscribes in-flight tasks and caps concurrent streams at 6 (LRU evict)', async () => {
    const inflight = []
    for (let i = 1; i <= 8; i++) inflight.push({ id: 't' + i, status: { state: 'working' } })
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: inflight })
    subscribeTaskEvents.mockReturnValue({ close: vi.fn() })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(m.subscriptions.size).toBe(6)
    expect(m.subscriptions.has('t1')).toBe(false) // oldest evicted
    expect(m.subscriptions.has('t2')).toBe(false)
    expect(m.subscriptions.has('t7')).toBe(true) // newest retained
    expect(m.subscriptions.has('t8')).toBe(true)
    m.stop()
  })
})

describe('ActivityMonitor subscription upkeep', () => {
  beforeEach(() => {
    getWorkspace.mockReset()
    listTasks.mockReset()
    subscribeTaskEvents.mockReset()
    subscribeTaskEvents.mockReturnValue({ close: vi.fn() })
  })

  it('only opens streams for in-flight tasks', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({
      tasks: [
        { id: 'working', status: { state: 'working' } },
        { id: 'parked', status: { state: 'input-required' } },
        { id: 'done', status: { state: 'completed' } },
      ],
    })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(m.subscriptions.has('working')).toBe(true)
    expect(m.subscriptions.has('parked')).toBe(true)
    expect(m.subscriptions.has('done')).toBe(false)
    m.stop()
  })

  it('closes the stream of a task that left the in-flight states', async () => {
    const close = vi.fn()
    subscribeTaskEvents.mockReturnValue({ close })
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [{ id: 't1', status: { state: 'working' } }] })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(m.subscriptions.has('t1')).toBe(true)

    // The task finished between polls: its stream is spent and must be released,
    // otherwise a long-lived window accumulates one socket per finished task.
    store.tasks = [{ id: 't1', status: { state: 'completed' } }]
    m._syncSubscriptions()
    expect(close).toHaveBeenCalled()
    expect(m.subscriptions.has('t1')).toBe(false)
    m.stop()
  })

  it('forgets per-task bookkeeping older than an hour', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [] })
    const store = makeStore()
    const old = Date.now() - 2 * 60 * 60 * 1000
    store.seen = { stale: old, fresh: Date.now() }
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(store.seen.stale).toBeUndefined()
    expect(store.seen.fresh).toBeDefined()
    m.stop()
  })

  it('opens nothing when there are no in-flight tasks', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [{ id: 'done', status: { state: 'failed' } }] })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(m.subscriptions.size).toBe(0)
    m.stop()
  })

  it('_onStatus merges the update and closes the stream on a terminal state', () => {
    const store = makeStore()
    store.tasks = [{ id: 't1', status: { state: 'working' } }]
    const close = vi.fn()
    const m = new ActivityMonitor(store)
    m.subscriptions.set('t1', { close, lastSeen: Date.now() })
    m._onStatus('t1', { id: 't1', status: { state: 'completed' }, foo: 'bar' })
    expect(store.tasks[0].foo).toBe('bar')
    expect(store.tasks[0].status).toEqual({ state: 'completed' })
    expect(close).toHaveBeenCalled()
    expect(m.subscriptions.has('t1')).toBe(false)
  })

  it('_onStatus keeps the stream for a non-terminal state', () => {
    const store = makeStore()
    store.tasks = [{ id: 't1', status: { state: 'working' } }]
    const close = vi.fn()
    const m = new ActivityMonitor(store)
    m.subscriptions.set('t1', { close, lastSeen: Date.now() })
    m._onStatus('t1', { id: 't1', status: { state: 'working' } })
    expect(close).not.toHaveBeenCalled()
    expect(m.subscriptions.has('t1')).toBe(true)
  })

  it('_touch refreshes the lastSeen timestamp', () => {
    const m = new ActivityMonitor(makeStore())
    const close = vi.fn()
    m.subscriptions.set('t1', { close, lastSeen: 1000 })
    m._touch('t1')
    expect(m.subscriptions.get('t1').lastSeen).toBeGreaterThan(1000)
  })

  it('uses the default visibility probe and forwards the stream handlers', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [{ id: 't1', status: { state: 'working' }, lastSeq: 4 }] })
    const opened = []
    subscribeTaskEvents.mockImplementation((id, seq, handlers) => {
      opened.push({ id, seq, handlers })
      return { close: vi.fn() }
    })

    const store = makeStore()
    // No options: the monitor falls back to "the window is visible" and keeps the
    // 5s cadence, which is the path the app itself takes.
    const m = new ActivityMonitor(store)
    m.start()
    await flush()

    expect(opened).toHaveLength(1)
    // A resumed stream must replay from where the task left off, not from zero.
    expect(opened[0].seq).toBe(4)

    opened[0].handlers.status({ status: { state: 'working' }, note: 'updated' })
    expect(store.tasks[0].note).toBe('updated')

    // Artifact and error frames are only liveness signals: they refresh the
    // bookkeeping so the LRU does not evict a stream that is still talking.
    const before = m.subscriptions.get('t1').lastSeen
    opened[0].handlers.artifact()
    expect(m.subscriptions.get('t1').lastSeen).toBeGreaterThanOrEqual(before)
    opened[0].handlers.error()

    m.stop()
  })
})

describe('ActivityMonitor lifecycle guards', () => {
  beforeEach(() => {
    getWorkspace.mockReset()
    listTasks.mockReset()
    subscribeTaskEvents.mockReset()
    subscribeTaskEvents.mockReturnValue({ close: vi.fn() })
  })

  it('start() twice polls once, so a remount cannot double the request rate', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [] })
    const m = new ActivityMonitor(makeStore(), { visible: () => true })
    m.start()
    m.start()
    await flush()
    expect(getWorkspace).toHaveBeenCalledTimes(1)
    m.stop()
  })

  it('stop() before the timer fires leaves no pending tick behind', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [] })
    const m = new ActivityMonitor(makeStore(), { visible: () => true })
    m.start()
    await flush()
    m.stop()

    // A stopped monitor must not resurrect itself by rescheduling.
    m._schedule()
    expect(m.timer).toBeNull()
  })

  it('a poll that resolves after stop() is a no-op', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [] })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.stop()
    await m._poll()
    expect(getWorkspace).not.toHaveBeenCalled()
    expect(store.offline).toBe(true) // untouched: nothing was applied
  })

  it('tolerates short payloads from an older server', async () => {
    // Neither endpoint returned its list key. The monitor publishes empty arrays
    // rather than undefined, so the views never have to guard for it.
    getWorkspace.mockResolvedValue({})
    listTasks.mockResolvedValue({})
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(store.agents).toEqual([])
    expect(store.tasks).toEqual([])
    expect(store.offline).toBe(false)
    m.stop()
  })

  it('re-syncing keeps one stream per task instead of stacking connections', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [{ id: 't1', status: { state: 'working' } }] })
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    m._syncSubscriptions()
    m._syncSubscriptions()
    expect(subscribeTaskEvents).toHaveBeenCalledTimes(1)
    expect(m.subscriptions.size).toBe(1)
    m.stop()
  })

  it('ignores a status frame for a task that is no longer in the list', () => {
    // A late frame can arrive after the task was pruned from the store; it must
    // not be re-created by an out-of-order event.
    const store = makeStore()
    const m = new ActivityMonitor(store)
    expect(() => m._onStatus('gone', { status: { state: 'completed' } })).not.toThrow()
    expect(store.tasks).toEqual([])
  })

  it('rebuilds the seen map when the store never had one', async () => {
    getWorkspace.mockResolvedValue({ agents: [] })
    listTasks.mockResolvedValue({ tasks: [] })
    const store = makeStore()
    delete store.seen
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(store.seen).toEqual({})
    m.stop()
  })
})
