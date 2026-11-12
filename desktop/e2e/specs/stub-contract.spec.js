// Contract specs for the deterministic backend. These need no Rust toolchain,
// no tauri-driver and no WebView, so they are the part of the suite that runs
// on any developer machine (including the Windows limitation in AGENTS.md).
// They pin the response shapes, SSE replay and fault injection that every
// desktop journey relies on.
import { describe, expect, it, beforeEach } from 'vitest'
import { e2eContext } from '../harness/context.mjs'

const { info } = e2eContext()
const base = info.stubUrl

const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
})
const get = async (path, init = {}) => {
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, ok: res.ok, body, res }
}

async function readSseFrames(path, expectedFrames, timeoutMs = 4000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, { signal: controller.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body.getReader()
    let text = ''
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && (text.match(/^data: /gm) || []).length < expectedFrames) {
      const { value, done } = await reader.read()
      if (done) break
      text += Buffer.from(value).toString('utf8')
    }
    await reader.cancel().catch(() => {})
    return text
  } finally {
    clearTimeout(timer)
  }
}

describe.skipIf(info.backend !== 'stub' || !base)('deterministic backend contract', () => {
  beforeEach(async () => {
    await post('/__e2e/reset', {})
  })

  it('answers /healthz, /.well-known and /a2a with the shapes the shell consumes', async () => {
    const health = await get('/healthz')
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ status: 'ok', auth: 'session', version: expect.any(String) })
    const card = await get('/.well-known/agent.json')
    expect(card.status).toBe(200)
    expect(card.body).toHaveProperty('protocolVersion')
    const a2a = await get('/a2a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(a2a.status).toBe(200)
    expect(a2a.body).toHaveProperty('jsonrpc', '2.0')
  })

  it('covers every endpoint the 15 screens call on mount', async () => {
    const paths = [
      '/api/auth/config', '/api/auth/me', '/api/workspace', '/api/threads', '/api/tasks',
      '/api/channels', '/api/connectors', '/api/connectors/approvals', '/api/resources',
      '/api/computers', '/api/sandboxes/stats', '/api/sandboxes', '/api/sandbox-providers',
      '/api/sandbox-nodes', '/api/schedules', '/api/router/stats',
      '/api/router/triggers?limit=50', '/api/router/tickets?limit=50', '/api/router/policies',
      '/api/knowledge', '/api/files',
    ]
    for (const path of paths) {
      const answer = await get(path)
      expect(answer.status, `${path} should be answered`).toBe(200)
      // An anonymous session is a legitimate answer, not a missing body.
      if (path === '/api/auth/me') expect(answer.body).toBeNull()
      else expect(answer.body, `${path} should have a body`).not.toBeNull()
    }
  })

  it('signs in with a cookie and refuses bad credentials with a machine code', async () => {
    const anonymous = await get('/api/auth/me')
    expect(anonymous.body).toBeNull()
    const bad = await post('/api/auth/login', { email: 'e2e@example.test', password: 'wrong' })
    expect(bad.status).toBe(401)
    expect((await bad.json()).code).toBe('invalid_credentials')
    const good = await post('/api/auth/login', { email: 'e2e@example.test', password: 'agentbuddy-e2e' })
    expect(good.status).toBe(200)
    expect(good.headers.get('set-cookie')).toContain('ab_session=')
    const me = await get('/api/auth/me', { headers: { cookie: 'ab_session=e2e-session' } })
    expect(me.body).toMatchObject({ id: 'user-e2e', isOwner: true })
  })

  it('injects 401 / 403 / 405 / 503 / 500 / empty / drop faults and clears them again', async () => {
    const cases = [
      ['unauthenticated', 401, 'unauthenticated'],
      ['forbidden', 403, 'forbidden'],
      ['unavailable', 405, 'method_not_allowed'],
      ['feature_off', 503, 'feature_unavailable'],
      ['server_error', 500, 'internal_error'],
    ]
    for (const [mode, status, code] of cases) {
      await post('/__e2e/scenario', { routeKey: '/api/tasks', mode })
      const answer = await get('/api/tasks')
      expect(answer.status).toBe(status)
      expect(answer.body.code).toBe(code)
    }
    await post('/__e2e/scenario', { routeKey: '/api/tasks', mode: 'empty' })
    expect((await get('/api/tasks')).body).toEqual({ tasks: [] })
    await post('/__e2e/scenario', { routeKey: '/api/tasks', mode: 'ok' })
    expect((await get('/api/tasks')).body.tasks.length).toBeGreaterThan(0)

    await post('/__e2e/scenario', { routeKey: '/api/workspace', mode: 'drop' })
    await expect(fetch(`${base}/api/workspace`)).rejects.toThrow()
  })

  it('replays only the frames after `since`, then streams new ones', async () => {
    const first = await post('/__e2e/sse', { channel: 'router', event: 'router_event', data: { kind: 'one' } })
    const firstSeq = (await first.json()).seq
    await post('/__e2e/sse', { channel: 'router', event: 'router_event', data: { kind: 'two' } })

    const replay = await readSseFrames('/api/router/events?since=0', 2)
    expect(replay).toContain('event: router_event')
    expect(replay).toContain('"kind":"one"')
    expect(replay).toContain('"kind":"two"')

    const incremental = await readSseFrames(`/api/router/events?since=${firstSeq}`, 1)
    expect(incremental).toContain('"kind":"two"')
    expect(incremental).not.toContain('"kind":"one"')
  })

  it('accepts multipart `file` / `audio`, enforces the caps and rejects wrong fields', async () => {
    const form = new FormData()
    form.append('file', new Blob(['hello e2e']), 'brief.txt')
    const uploaded = await fetch(`${base}/api/files`, { method: 'POST', body: form })
    expect(uploaded.status).toBe(200)
    const row = await uploaded.json()
    expect(row.name).toBe('brief.txt')
    const content = await get(`/api/files/${row.id}/content`)
    expect(content.res.headers.get('content-disposition')).toContain('brief.txt')

    const wrongField = new FormData()
    wrongField.append('not-audio', new Blob(['x']), 'voice.webm')
    const audio = await fetch(`${base}/api/threads/thread-1/audio`, { method: 'POST', body: wrongField })
    expect(audio.status).toBe(400)
    expect((await audio.json()).code).toBe('audio_unsupported')
  })

  it('mutates the world through CRUD and resets it between journeys', async () => {
    const created = await post('/api/threads', { title: 'New journey' })
    expect((await created.json()).Title).toBe('New journey')
    expect((await get('/api/threads')).body.threads.length).toBe(3)

    const cleared = await get('/api/tasks', { method: 'DELETE' })
    expect(cleared.body).toMatchObject({ deleted: expect.any(Number), kept: expect.any(Number) })
    expect(cleared.body.deleted + cleared.body.kept).toBe(4)

    const retried = await post('/api/channels/channel-1/deliveries/delivery-1/retry', {})
    expect(retried.status).toBe(200)
    const notRetryable = await post('/api/channels/channel-1/deliveries/delivery-2/retry', {})
    expect(notRetryable.status).toBe(409)
    expect((await notRetryable.json()).code).toBe('delivery_not_retryable')

    await post('/__e2e/reset', {})
    expect((await get('/api/threads')).body.threads.length).toBe(2)
    expect((await get('/api/tasks')).body.tasks.length).toBe(4)
  })

  it('removes a decided approval keyed by taskId and refuses a second decision', async () => {
    expect((await get('/api/connectors/approvals')).body).toHaveLength(1)
    const approved = await post('/api/connectors/approvals/approval-1/approve', {})
    expect(approved.status).toBe(200)
    expect((await get('/api/connectors/approvals')).body).toHaveLength(0)
    const again = await post('/api/connectors/approvals/approval-1/approve', {})
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('connector_approval_closed')
  })

  it('logs only method / path / status / time, never bodies or credentials', async () => {
    await post('/api/auth/login', { email: 'e2e@example.test', password: 'agentbuddy-e2e' })
    const { body } = await get('/__e2e/requests')
    expect(body.requests.length).toBeGreaterThan(0)
    for (const entry of body.requests) {
      expect(Object.keys(entry).sort()).toEqual(['at', 'method', 'path', 'query', 'status'])
      expect(JSON.stringify(entry)).not.toContain('agentbuddy-e2e')
    }
  })
})
