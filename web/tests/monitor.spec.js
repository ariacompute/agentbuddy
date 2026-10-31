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
}))

import { getWorkspace, listTasks, subscribeTaskEvents } from '../src/lib/api.js'

function makeStore() {
  return { agents: [], tasks: [], offline: true, seen: {}, ingestTask() {} }
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

  it('flips offline + failing when the poll throws', async () => {
    getWorkspace.mockRejectedValue(new Error('boom'))
    const store = makeStore()
    const m = new ActivityMonitor(store, { visible: () => true })
    m.start()
    await flush()
    expect(store.offline).toBe(true)
    expect(m.failing).toBe(true)
    expect(m.failureCount).toBe(1)
    m.stop()
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
})
