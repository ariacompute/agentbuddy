// ActivityMonitor: the client-side aggregation layer. agenthub has no cross-task
// SSE, so we derive "anything changed" two ways:
//   1. A coarse poll of /api/workspace + /api/tasks (O(1) requests per tick).
//   2. A fine, bounded set of per-task event streams for tasks still in flight,
//      capped at 6 concurrent connections (LRU drops the oldest).
//
// Polling cadence adapts: 5s while the window is visible, 20s while hidden
// (minimised to tray), and exponential backoff from 5s to 30s when the server
// looks offline, which also flips the offline chip.
import { getWorkspace, listTasks, subscribeTaskEvents } from './api.js'

const POLL_VISIBLE_MS = 5000
const POLL_HIDDEN_MS = 20000
const BACKOFF_FLOOR_MS = 5000
const BACKOFF_CEIL_MS = 30000
const MAX_SUBSCRIPTIONS = 6

export function computePollInterval({ visible = true, failing = false, failureCount = 0 } = {}) {
  if (failing) {
    const step = Math.min(BACKOFF_FLOOR_MS * 2 ** failureCount, BACKOFF_CEIL_MS)
    return Math.max(step, BACKOFF_FLOOR_MS)
  }
  return visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS
}

export class ActivityMonitor {
  constructor(store, { visible = () => true } = {}) {
    this.store = store
    this.isVisible = visible
    this.timer = null
    this.failing = false
    this.failureCount = 0
    this.subscriptions = new Map() // taskId -> { close, lastSeen }
    this.running = false
  }

  start() {
    if (this.running) return
    this.running = true
    this._poll()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const sub of this.subscriptions.values()) sub.close()
    this.subscriptions.clear()
  }

  _schedule() {
    if (!this.running) return
    const delay = computePollInterval({
      visible: this.isVisible(),
      failing: this.failing,
      failureCount: this.failureCount,
    })
    this.timer = setTimeout(() => this._poll(), delay)
  }

  async _poll() {
    if (!this.running) return
    try {
      const [ws, tasks] = await Promise.all([getWorkspace(), listTasks()])
      this.store.agents = ws.agents || []
      this.store.tasks = tasks.tasks || []
      this.store.offline = false
      this.failing = false
      this.failureCount = 0
      const now = Date.now()
      for (const task of this.store.tasks) this.store.ingestTask(task, now)
      this.store.seen = pruneSafe(this.store)
      this._syncSubscriptions()
    } catch (error) {
      console.error('agentbuddy: monitor poll failed', error)
      this.store.offline = true
      this.failing = true
      this.failureCount += 1
    } finally {
      this._schedule()
    }
  }

  _syncSubscriptions() {
    const active = this.store.tasks.filter((t) => {
      const s = t?.status?.state
      return s === 'submitted' || s === 'working' || s === 'input-required'
    })
    const wanted = new Set(active.map((t) => t.id))

    for (const [id, sub] of this.subscriptions) {
      if (!wanted.has(id)) {
        sub.close()
        this.subscriptions.delete(id)
      }
    }

    // Open new ones, oldest-first eviction when over the cap.
    for (const task of active) {
      if (this.subscriptions.has(task.id)) continue
      if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) {
        const oldestId = this.subscriptions.keys().next().value
        this.subscriptions.get(oldestId).close()
        this.subscriptions.delete(oldestId)
      }
      const handle = subscribeTaskEvents(task.id, task.lastSeq, {
        status: (data) => this._onStatus(task.id, data),
        artifact: () => this._touch(task.id),
        error: () => this._touch(task.id),
      })
      this.subscriptions.set(task.id, { close: handle.close, lastSeen: Date.now() })
    }
  }

  _onStatus(taskId, data) {
    const idx = this.store.tasks.findIndex((t) => t.id === taskId)
    if (idx === -1) return
    const state = data?.status?.state
    this.store.tasks[idx] = { ...this.store.tasks[idx], ...data, status: data.status }
    this.store.ingestTask(this.store.tasks[idx])
    if (state === 'completed' || state === 'failed' || state === 'canceled') {
      const sub = this.subscriptions.get(taskId)
      if (sub) { sub.close(); this.subscriptions.delete(taskId) }
    }
  }

  _touch(taskId) {
    const sub = this.subscriptions.get(taskId)
    if (sub) sub.lastSeen = Date.now()
  }
}

function pruneSafe(store) {
  const now = Date.now()
  const next = {}
  for (const [key, at] of Object.entries(store.seen || {})) {
    if (now - at < 60 * 60 * 1000) next[key] = at
  }
  return next
}
