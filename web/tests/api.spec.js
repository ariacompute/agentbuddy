import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  request,
  ApiError,
  createChannel,
  listChannels,
  getDeliveries,
  listConnectors,
  setConnectorPolicy,
  runConnectorAction,
  authConfig,
  login,
  register,
  logout,
  whoami,
  checkHealth,
  getWorkspace,
  listThreads,
  createThread,
  getThread,
  postThreadMessage,
  listTasks,
  getTask,
  cancelTask,
  resumeTask,
  listResources,
  updateChannel,
  deleteChannel,
  retryDelivery,
  postThreadAudio,
  subscribeThreadEvents,
  subscribeTaskEvents,
} from '../src/lib/api.js'

let fetchMock

function jsonResponse(obj, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    json: async () => obj,
    text: async () => (obj === null ? '' : JSON.stringify(obj)),
  }
}

const lastCall = () => {
  const calls = fetchMock.mock.calls
  return calls[calls.length - 1]
}

describe('api client', () => {
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses a JSON 200 and sends credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ a: 1 }))
    const r = await request('/api/x')
    expect(r).toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }))
  })

  it('returns null on 204 and on empty body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' })
    expect(await request('/api/x', { method: 'DELETE' })).toBeNull()
    fetchMock.mockResolvedValue(jsonResponse(null))
    expect(await request('/api/x')).toBeNull()
  })

  it('throws ApiError carrying the server code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'not_found' }, { status: 404, ok: false }))
    await expect(request('/api/x')).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('falls back to the status string when the body is unreadable', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('bad') },
      text: async () => '',
    })
    await expect(request('/api/x')).rejects.toMatchObject({ code: '500' })
  })

  it('serialises a JSON body for post and omits it when undefined', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await createChannel({ name: 'x' })
    let opts = lastCall()[1]
    expect(lastCall()[0]).toBe('/api/channels')
    expect(opts.method).toBe('POST')
    expect(opts.body).toBe(JSON.stringify({ name: 'x' }))
    expect(opts.headers['Content-Type']).toBe('application/json')

    await createChannel()
    opts = lastCall()[1]
    expect(opts.body).toBeUndefined()
  })

  it('exposes typed helpers that build the right paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listChannels()
    expect(lastCall()[0]).toBe('/api/channels')
    await getDeliveries('c1')
    expect(lastCall()[0]).toBe('/api/channels/c1/deliveries')
    await listConnectors()
    expect(lastCall()[0]).toBe('/api/connectors')
    await setConnectorPolicy('c1', 'ask')
    expect(lastCall()[0]).toBe('/api/connectors/c1/policy')
    await runConnectorAction('c1', 'do', { a: 1 })
    expect(lastCall()[0]).toBe('/api/connectors/c1/actions')
    expect(lastCall()[1].method).toBe('POST')
  })
})

describe('ApiError', () => {
  it('carries code, status and a localised message', () => {
    const e = new ApiError('bad_request', 400)
    expect(e.code).toBe('bad_request')
    expect(e.status).toBe(400)
    expect(e.message).toBeTruthy()
  })
})

describe('api endpoint helpers', () => {
  class FakeEventSource {
    constructor(url) {
      this.url = url
      this._listeners = {}
      this.closed = false
      this.onmessage = null
      FakeEventSource.last = this
    }
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    }
    removeEventListener() {}
    close() {
      this.closed = true
    }
  }

  function emit(source, type, data) {
    const ev = { data: JSON.stringify(data) }
    if (type === 'message' && source.onmessage) source.onmessage(ev)
    for (const fn of source._listeners[type] || []) fn(ev)
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('auth helpers hit the right paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await authConfig()
    expect(lastCall()[0]).toBe('/api/auth/config')
    await login('a@b.c', 'pw')
    expect(lastCall()[0]).toBe('/api/auth/login')
    await register('a@b.c', 'pw', 'A')
    expect(lastCall()[0]).toBe('/api/auth/register')
    await logout()
    expect(lastCall()[0]).toBe('/api/auth/logout')
    await whoami()
    expect(lastCall()[0]).toBe('/api/auth/me')
  })

  it('health and workspace helpers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await checkHealth()
    expect(lastCall()[0]).toBe('/healthz')
    await getWorkspace()
    expect(lastCall()[0]).toBe('/api/workspace')
  })

  it('thread helpers build paths and bodies', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listThreads()
    expect(lastCall()[0]).toBe('/api/threads')
    await createThread('Title')
    expect(lastCall()[0]).toBe('/api/threads')
    expect(lastCall()[1].method).toBe('POST')
    await getThread('t1')
    expect(lastCall()[0]).toBe('/api/threads/t1')
    await postThreadMessage('t1', 'hi', ['a1'])
    expect(lastCall()[0]).toBe('/api/threads/t1/messages')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ body: 'hi', mentions: ['a1'] })
  })

  it('task helpers build paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listTasks()
    expect(lastCall()[0]).toBe('/api/tasks')
    await getTask('t1')
    expect(lastCall()[0]).toBe('/api/tasks/t1')
    await cancelTask('t1')
    expect(lastCall()[0]).toBe('/api/tasks/t1/cancel')
    await resumeTask('t1', 'answer')
    expect(lastCall()[0]).toBe('/api/tasks/t1/resume')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ answer: 'answer' })
  })

  it('listResources passes the kind as a query when given', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listResources('mcp')
    expect(lastCall()[0]).toBe('/api/resources?kind=mcp')
    await listResources()
    expect(lastCall()[0]).toBe('/api/resources')
  })

  it('channel mutation helpers and delivery retry', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await updateChannel('c1', { name: 'x' })
    expect(lastCall()[0]).toBe('/api/channels/c1')
    expect(lastCall()[1].method).toBe('PUT')
    await deleteChannel('c1')
    expect(lastCall()[0]).toBe('/api/channels/c1')
    expect(lastCall()[1].method).toBe('DELETE')
    await retryDelivery('c1', 'd1')
    expect(lastCall()[0]).toBe('/api/channels/c1/deliveries/d1/retry')
  })

  it('postThreadAudio sends a multipart form', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    const blob = new Blob(['data'], { type: 'audio/webm' })
    await postThreadAudio('t1', blob)
    const [url, opts] = lastCall()
    expect(url).toBe('/api/threads/t1/audio')
    expect(opts.method).toBe('POST')
    expect(opts.body).toBeInstanceOf(FormData)
  })

  it('subscribeThreadEvents wires listeners and closes', () => {
    const handlers = { message: vi.fn(), agent: vi.fn(), error: vi.fn() }
    const handle = subscribeThreadEvents('t1', handlers)
    const src = FakeEventSource.last
    expect(src.url).toBe('/api/threads/t1/events')
    emit(src, 'message', { a: 1 })
    expect(handlers.message).toHaveBeenCalledWith({ a: 1 })
    emit(src, 'thread.agent', { b: 2 })
    expect(handlers.agent).toHaveBeenCalledWith({ b: 2 })
    emit(src, 'thread.message', { c: 3 })
    expect(handlers.message).toHaveBeenCalledWith({ c: 3 })
    handle.close()
    expect(src.closed).toBe(true)
  })

  it('subscribeTaskEvents forwards the since param and task events', () => {
    const handlers = { status: vi.fn(), artifact: vi.fn(), span: vi.fn(), message: vi.fn() }
    const handle = subscribeTaskEvents('t1', 7, handlers)
    const src = FakeEventSource.last
    expect(src.url).toBe('/api/tasks/t1/events?since=7')
    emit(src, 'task_status_update', { s: 1 })
    expect(handlers.status).toHaveBeenCalledWith({ s: 1 })
    emit(src, 'task_artifact_update', { a: 1 })
    expect(handlers.artifact).toHaveBeenCalledWith({ a: 1 })
    emit(src, 'task_span_update', { sp: 1 })
    expect(handlers.span).toHaveBeenCalledWith({ sp: 1 })
    emit(src, 'message', { m: 1 })
    expect(handlers.message).toHaveBeenCalledWith({ m: 1 })
    handle.close()
    expect(src.closed).toBe(true)
  })
})
