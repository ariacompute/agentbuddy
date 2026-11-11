// In-memory state for the stub. Nothing here is persisted, so one run cannot
// leak fixtures into the next; `resetState` restores the whole world between
// user journeys.
import { makeFixtures } from './fixtures.mjs'

export function createState() {
  return {
    fixtures: makeFixtures(),
    requests: [],
    scenarios: new Map(),
    sessions: new Set(),
    counter: 100,
    sse: { seq: 0, events: new Map(), clients: new Set() },
    shellNotifications: [],
    shellBadges: [],
    shellConfigPatches: [],
    upgrade: {
      status: 'up_to_date',
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      notes: '',
      source: 'github',
      downloadUrl: '',
      checkedAt: 1_700_000_000,
      autoCheck: true,
      skippedVersion: null,
    },
  }
}

export function resetState(state) {
  const fresh = createState()
  for (const key of Object.keys(fresh)) state[key] = fresh[key]
  return state
}

export function nextId(state, prefix) {
  state.counter += 1
  return `${prefix}-${state.counter}`
}

/** Only method/path/status/time are kept: never bodies, cookies or credentials. */
export function recordRequest(state, req, status, extra = {}) {
  const url = new URL(req.url || '/', 'http://stub.local')
  const entry = {
    method: req.method || 'GET',
    path: url.pathname,
    query: url.search,
    status,
    at: new Date().toISOString(),
    ...extra,
  }
  if (state.requests.length >= 5000) state.requests.shift()
  state.requests.push(entry)
  return entry
}
