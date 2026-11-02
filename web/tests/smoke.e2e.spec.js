// @vitest-environment node
/**
 * Cross-process smoke test: the workbench's real HTTP client against a real
 * socket.
 *
 * Every other web test mocks `api.js`, so it can prove what the store does with
 * an answer but never that a request leaves the process, carries the right
 * method and body, or that a failure is classified the way the UI assumes. That
 * gap is exactly where "wired up but unreachable" bugs live.
 *
 * So this file starts a real `node:http` server on 127.0.0.1, points the client
 * at it through the documented `globalThis.__AGENTBUDDY_BASE__` seam (production
 * never sets it, keeping URLs same-origin) and drives the Pinia store for real:
 *
 *   store.refreshAll() ──HTTP──► stub  ◄──HTTP── POST /__shell/notify
 *
 * No mocks, no network beyond loopback, every wait bounded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createPinia, setActivePinia } from 'pinia'

import { isAuthError } from '../src/lib/api.js'
import { useWorkbenchStore } from '../src/lib/workbench-store.js'

const COMPLETED_TASK = {
  id: 'task-smoke-1',
  contextId: 'thread-smoke-1',
  resourceId: 'agent-smoke-1',
  status: { state: 'completed', message: { parts: [{ text: 'all green' }] } },
}

let server = null
let base = ''
let requests = []

/** Starts the stub on an ephemeral loopback port and returns its base URL. */
function startStub(handler) {
  return new Promise((resolve, reject) => {
    server = http.createServer(handler)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`
      globalThis.__AGENTBUDDY_BASE__ = base
      resolve(base)
    })
  })
}

function stopStub() {
  return new Promise((resolve) => {
    if (!server) return resolve()
    server.close(() => {
      server = null
      resolve()
    })
  })
}

function send(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

/** Records every request, then answers from `routes` (path → [status, body]). */
function recordingStub(routes) {
  return (req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body })
      const route = routes[req.url] || [404, { code: 'not_found' }]
      send(res, route[0], route[1])
    })
  }
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('workbench smoke test over a real socket', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requests = []
    // Failures are the point of two of these tests; keep the expected stack
    // traces out of the report without hiding them from a real run.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    delete globalThis.__AGENTBUDDY_BASE__
    await stopStub()
    vi.restoreAllMocks()
  })

  it('refreshes through real HTTP and posts the OS toast to the shell', async () => {
    await startStub(
      recordingStub({
        '/api/workspace': [200, { agents: [{ id: 'agent-smoke-1', name: 'Planner' }] }],
        '/api/threads': [200, { threads: [] }],
        '/api/tasks': [200, { tasks: [COMPLETED_TASK] }],
        '/api/channels': [200, []],
        '/api/connectors': [200, []],
        '/__shell/notify': [200, { ok: true }],
      }),
    )

    const store = useWorkbenchStore()
    await store.refreshAll()

    // The response really crossed a socket and landed in the store.
    expect(store.agents).toHaveLength(1)
    expect(store.tasks).toHaveLength(1)
    expect(store.offline).toBe(false)
    expect(store.authExpired).toBe(false)
    expect(requests.map((r) => r.url)).toEqual(
      expect.arrayContaining(['/api/workspace', '/api/threads', '/api/tasks', '/api/channels', '/api/connectors']),
    )

    // `announce` is fire-and-forget, so wait for the POST rather than assuming
    // it landed before refreshAll returned.
    await waitFor(() => requests.some((r) => r.url === '/__shell/notify'), 'the shell notification')
    const notify = requests.find((r) => r.url === '/__shell/notify')
    const payload = JSON.parse(notify.body)
    expect(notify.method).toBe('POST')
    // Localised at send time, not a copy key, and pointing at the thread.
    expect(payload.title).toBe('Task finished')
    expect(payload.body).toBe('all green')
    expect(payload.link).toBe('/threads/thread-smoke-1')
  })

  it('carries a rejected session through as an auth error, not as "offline"', async () => {
    await startStub(recordingStub({
      '/api/workspace': [401, { code: 'unauthenticated' }],
      '/api/threads': [401, { code: 'unauthenticated' }],
      '/api/tasks': [401, { code: 'unauthenticated' }],
      '/api/channels': [401, { code: 'unauthenticated' }],
      '/api/connectors': [401, { code: 'unauthenticated' }],
    }))

    const store = useWorkbenchStore()
    await store.refreshAll()

    expect(store.authExpired).toBe(true)
    expect(store.offline).toBe(false)
    expect(store.errorCode).toBe('unauthenticated')
  })

  it('treats a dead socket as a connectivity problem, never as an expired session', async () => {
    await startStub(recordingStub({}))
    const dead = base
    // Closing the listener frees the port, so the next connect is refused
    // instead of hanging — which is also what a stopped agenthub looks like.
    await stopStub()
    globalThis.__AGENTBUDDY_BASE__ = dead

    const store = useWorkbenchStore()
    await store.refreshAll()

    expect(store.offline).toBe(true)
    expect(store.authExpired).toBe(false)
    // A transport failure carries no machine code, so nothing may be mistaken
    // for a 401 on the way to the UI.
    expect(isAuthError({ code: store.errorCode, status: undefined })).toBe(false)
  })
})
