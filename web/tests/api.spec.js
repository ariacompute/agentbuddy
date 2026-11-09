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
  deleteThread,
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
  subscribeRouterEvents,
  listComputers,
  createComputer,
  getComputer,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listKnowledge,
  createResource,
  updateResource,
  isAuthError,
  runSchedule,
  routerStats,
  listRouterTriggers,
  listRouterTickets,
  cancelRouterTicket,
  handbackRouterTrigger,
  dropRouterSubscription,
  saveRouterPolicy,
  kickRouterPass,
  getRouterTrigger,
  getRouterTicket,
  listRouterPolicies,
  getConnectorActions,
  deleteComputer,
  sandboxStats,
  listSandboxes,
  getSandbox,
  execSandbox,
  renewSandbox,
  terminateSandbox,
  listSandboxProviders,
  refreshSandboxProviders,
  listSandboxNodes,
  subscribeSandboxEvents,
  getShellConfig,
  notifyShell,
  setTrayBadge,
  listFiles,
  deleteFile,
  fileContentUrl,
  uploadFile,
  listConnectorApprovals,
  approveConnectorAction,
  rejectConnectorAction,
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

  it('builds an ApiError even when the server named no code', () => {
    // The message is the localised sentence for a code; with no code there is
    // nothing to translate, and the error must not read "undefined".
    const err = new ApiError(undefined, 500)
    expect(err.message).toBe('')
    expect(err.code).toBeUndefined()
    expect(err.status).toBe(500)
  })

  it('reads the shell config and asks it to notify', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ background: true, lang: 'zh' }))
    await expect(getShellConfig()).resolves.toEqual({ background: true, lang: 'zh' })
    expect(lastCall()[0]).toBe('/__shell/config')

    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await notifyShell({ title: 'Done', body: 'task t1', link: '/tasks/t1' })
    expect(lastCall()[0]).toBe('/__shell/notify')
    expect(lastCall()[1].body).toContain('"/tasks/t1"')
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

  it('returns null when a successful response is not JSON', async () => {
    // A proxy or a static-file fallback can answer 200 with HTML; treating that as
    // an object would push `undefined.x` errors into every caller.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>nope</html>' })
    expect(await request('/api/x')).toBeNull()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
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

  it('prints an unregistered code as itself instead of "undefined"', () => {
    // A server that ships a new code before the console knows it must still show
    // something an operator can paste into a bug report.
    const e = new ApiError('brand_new_code', 500)
    expect(e.message).toBe('brand_new_code')
  })
})

describe('isAuthError', () => {
  it('flags auth/permission failures but not connectivity or other errors', () => {
    expect(isAuthError(new ApiError('unauthenticated', 401))).toBe(true)
    expect(isAuthError(new ApiError('forbidden', 403))).toBe(true)
    expect(isAuthError(new ApiError('session_expired', 401))).toBe(true)
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(isAuthError({ status: 403 })).toBe(true)
    expect(isAuthError(new ApiError('service_unavailable', 503))).toBe(false)
    expect(isAuthError(new ApiError('not_found', 404))).toBe(false)
    expect(isAuthError(new TypeError('network failed'))).toBe(false)
    expect(isAuthError(null)).toBe(false)
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

  it('deletes a thread by id with a bodyless 204', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' })
    await deleteThread('t1')
    const [url, opts] = lastCall()
    expect(url).toBe('/api/threads/t1')
    expect(opts.method).toBe('DELETE')
  })

  it('surfaces a refused thread delete as a machine code', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: 'forbidden' }),
    })
    await expect(deleteThread('t2')).rejects.toMatchObject({ code: 'forbidden', status: 403 })
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

  it('postThreadAudio surfaces a refused upload as an ApiError', async () => {
    // The recorder uploads a blob before anything is transcribed, so a refusal
    // here (too large, wrong type, session expired) must reach the caller as a
    // machine code rather than a resolved promise with a null body.
    fetchMock.mockResolvedValue(jsonResponse({ code: 'audio_too_large' }, { status: 413, ok: false }))
    await expect(postThreadAudio('t1', new Blob(['x']))).rejects.toMatchObject({
      code: 'audio_too_large',
      status: 413,
    })
  })

  it('postThreadAudio reads an empty 200 as "nothing to say"', async () => {
    // A transcription that produced no text answers 200 with an empty body; the
    // caller treats null as "silent recording", not as a parse failure.
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    await expect(postThreadAudio('t1', new Blob(['x']))).resolves.toBeNull()
  })

  it('omits the argument map when a connector action takes none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await runConnectorAction('k1', 'sync')
    const [, opts] = lastCall()
    expect(JSON.parse(opts.body)).toEqual({ action: 'sync', args: {} })
  })

  it('builds no query string when every router filter is empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ triggers: [] }))
    await listRouterTriggers({ state: '', since: undefined, idle: null })
    expect(lastCall()[0]).toBe('/api/router/triggers')
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

  it('subscribeThreadEvents reports a stream error so the view can reconnect', () => {
    const handlers = { message: vi.fn(), error: vi.fn() }
    subscribeThreadEvents('t1', handlers)
    const src = FakeEventSource.last
    const err = new Error('stream dropped')
    src.onerror(err)
    expect(handlers.error).toHaveBeenCalledWith(err)
  })

  it('subscribeRouterEvents replays from a seq and names the router event', () => {
    const handlers = { event: vi.fn(), error: vi.fn() }
    const handle = subscribeRouterEvents(42, handlers)
    const src = FakeEventSource.last
    expect(src.url).toBe('/api/router/events?since=42')
    emit(src, 'router_event', { seq: 43, kind: 'ticket.opened' })
    expect(handlers.event).toHaveBeenCalledWith({ seq: 43, kind: 'ticket.opened' })
    const err = new Error('stream dropped')
    src.onerror(err)
    expect(handlers.error).toHaveBeenCalledWith(err)
    handle.close()
    expect(src.closed).toBe(true)
  })

  it('subscribeRouterEvents omits the query on a first connection', () => {
    subscribeRouterEvents(0)
    expect(FakeEventSource.last.url).toBe('/api/router/events')
  })

  it('subscribeSandboxEvents replays from a seq and names the sandbox event', () => {
    const handlers = { event: vi.fn(), error: vi.fn() }
    const handle = subscribeSandboxEvents(12, handlers)
    const src = FakeEventSource.last
    expect(src.url).toBe('/api/sandboxes/events?since=12')

    emit(src, 'sandbox_event', { seq: 13, kind: 'lease.created' })
    expect(handlers.event).toHaveBeenCalledWith({ seq: 13, kind: 'lease.created' })

    const err = new Error('stream dropped')
    src.onerror(err)
    expect(handlers.error).toHaveBeenCalledWith(err)

    handle.close()
    expect(src.closed).toBe(true)
  })

  it('subscribeSandboxEvents omits the query on a first connection', () => {
    subscribeSandboxEvents(0)
    expect(FakeEventSource.last.url).toBe('/api/sandboxes/events')
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

  it('subscribeTaskEvents reports a stream error so the trace can reconnect', () => {
    const handlers = { status: vi.fn(), error: vi.fn() }
    subscribeTaskEvents('t1', 0, handlers)
    const err = new Error('stream dropped')
    FakeEventSource.last.onerror(err)
    expect(handlers.error).toHaveBeenCalledWith(err)
  })

  it('subscribeTaskEvents keeps working when a handler is not supplied', () => {
    // Only status is watched: the other three listeners must simply not be wired,
    // rather than being registered as undefined and throwing on the first frame.
    const status = vi.fn()
    subscribeTaskEvents('t1', 0, { status })
    const src = FakeEventSource.last
    emit(src, 'task_status_update', { s: 2 })
    expect(status).toHaveBeenCalledWith({ s: 2 })
    expect(src._listeners.task_artifact_update).toBeUndefined()
    expect(src._listeners.message).toBeUndefined()
  })
})

describe('F10–F16 api helpers', () => {
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('computers helpers build paths and bodies', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listComputers()
    expect(lastCall()[0]).toBe('/api/computers')
    expect(lastCall()[1].method).toBe('GET')

    await createComputer('screen', 'a1')
    expect(lastCall()[0]).toBe('/api/computers')
    expect(lastCall()[1].method).toBe('POST')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ kind: 'screen', agentId: 'a1' })

    await getComputer('c1')
    expect(lastCall()[0]).toBe('/api/computers/c1')

    await deleteComputer('c1')
    expect(lastCall()[0]).toBe('/api/computers/c1')
    expect(lastCall()[1].method).toBe('DELETE')
  })

  it('router detail and policy helpers name their resource', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    await getRouterTrigger('trg-1')
    expect(lastCall()[0]).toBe('/api/router/triggers/trg-1')

    await getRouterTicket('tkt-1')
    expect(lastCall()[0]).toBe('/api/router/tickets/tkt-1')

    await listRouterPolicies()
    expect(lastCall()[0]).toBe('/api/router/policies')

    // A connector's action catalogue is a read; running one is a POST.
    await getConnectorActions('k1')
    expect(lastCall()[0]).toBe('/api/connectors/k1/actions')
    expect(lastCall()[1].method).toBe('GET')
  })

  it('sandbox helpers build the control-plane paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    await sandboxStats()
    expect(lastCall()[0]).toBe('/api/sandboxes/stats')
    await listSandboxes()
    expect(lastCall()[0]).toBe('/api/sandboxes')
    await getSandbox('sbx-1')
    expect(lastCall()[0]).toBe('/api/sandboxes/sbx-1')

    await execSandbox('sbx-1', { command: 'git', args: ['status'] })
    expect(lastCall()[0]).toBe('/api/sandboxes/sbx-1/exec')
    expect(lastCall()[1].method).toBe('POST')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ command: 'git', args: ['status'] })

    await renewSandbox('sbx-1')
    expect(lastCall()[0]).toBe('/api/sandboxes/sbx-1/renew')
    expect(lastCall()[1].method).toBe('POST')

    await terminateSandbox('sbx-1')
    expect(lastCall()[0]).toBe('/api/sandboxes/sbx-1')
    expect(lastCall()[1].method).toBe('DELETE')

    await listSandboxProviders()
    expect(lastCall()[0]).toBe('/api/sandbox-providers')
    // Re-probing spawns runtimes, so it is a POST rather than a cache read.
    await refreshSandboxProviders()
    expect(lastCall()[0]).toBe('/api/sandbox-providers/refresh')
    expect(lastCall()[1].method).toBe('POST')

    await listSandboxNodes()
    expect(lastCall()[0]).toBe('/api/sandbox-nodes')
  })


  it('schedules helpers build paths and bodies', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listSchedules()
    expect(lastCall()[0]).toBe('/api/schedules')

    await createSchedule('goal', '* * * * *', true)
    expect(lastCall()[0]).toBe('/api/schedules')
    expect(lastCall()[1].method).toBe('POST')
    expect(JSON.parse(lastCall()[1].body)).toEqual({
      goal: 'goal',
      trigger: 'cron',
      cronExpr: '* * * * *',
      enabled: true,
    })

    await updateSchedule('s1', { enabled: false })
    expect(lastCall()[0]).toBe('/api/schedules/s1')
    expect(lastCall()[1].method).toBe('PUT')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ enabled: false })

    await deleteSchedule('s1')
    expect(lastCall()[0]).toBe('/api/schedules/s1')
    expect(lastCall()[1].method).toBe('DELETE')
  })

  it('router helpers build the scheduler paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await runSchedule('s1')
    expect(lastCall()[0]).toBe('/api/schedules/s1/run')
    expect(lastCall()[1].method).toBe('POST')

    await routerStats()
    expect(lastCall()[0]).toBe('/api/router/stats')

    await listRouterTriggers({ source: 'cron', limit: 20 })
    expect(lastCall()[0]).toBe('/api/router/triggers?source=cron&limit=20')

    // Empty values are dropped rather than sent as `?disposition=`.
    await listRouterTickets({ state: '', open: 'true' })
    expect(lastCall()[0]).toBe('/api/router/tickets?open=true')

    await cancelRouterTicket('t1')
    expect(lastCall()[0]).toBe('/api/router/tickets/t1/cancel')
    expect(lastCall()[1].method).toBe('POST')

    await handbackRouterTrigger('t1', 'g1', 'not mine')
    expect(lastCall()[0]).toBe('/api/router/tickets/t1/handback')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ triggerId: 'g1', reason: 'not mine' })

    await dropRouterSubscription('th1')
    expect(lastCall()[0]).toBe('/api/router/threads/th1/subscription')
    expect(lastCall()[1].method).toBe('DELETE')

    await saveRouterPolicy('thread', { mode: 'off' })
    expect(lastCall()[0]).toBe('/api/router/policies/thread')
    expect(lastCall()[1].method).toBe('PUT')

    await kickRouterPass()
    expect(lastCall()[0]).toBe('/api/router/passes')
  })

  it('router helpers surface the machine code on refusal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'router_handback_exhausted' }, { status: 409, ok: false }))
    await expect(handbackRouterTrigger('t1', 'g1')).rejects.toMatchObject({
      code: 'router_handback_exhausted',
      status: 409,
    })
  })

  it('knowledge helper adds the agentId query only when present', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listKnowledge('a1')
    expect(lastCall()[0]).toBe('/api/knowledge?agentId=a1')
    await listKnowledge()
    expect(lastCall()[0]).toBe('/api/knowledge')
  })

  it('resource create/update wrap the body and path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await createResource({ kind: 'persona', name: 'p' })
    expect(lastCall()[0]).toBe('/api/resources')
    expect(lastCall()[1].method).toBe('POST')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ kind: 'persona', name: 'p' })

    await updateResource('r1', { name: 'x' })
    expect(lastCall()[0]).toBe('/api/resources/r1')
    expect(lastCall()[1].method).toBe('PUT')
    expect(JSON.parse(lastCall()[1].body)).toEqual({ name: 'x' })
  })
})

describe('api base seam', () => {
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.__AGENTBUDDY_BASE__
  })

  it('ignores an override that is not a non-empty string', async () => {
    // Only the smoke test sets this, and only to a string. Anything else must
    // leave the URLs same-origin rather than producing "42/api/x".
    fetchMock.mockResolvedValue(jsonResponse({}))
    globalThis.__AGENTBUDDY_BASE__ = 42
    try {
      await request('/api/x')
      expect(lastCall()[0]).toBe('/api/x')

      globalThis.__AGENTBUDDY_BASE__ = ''
      await request('/api/y')
      expect(lastCall()[0]).toBe('/api/y')
    } finally {
      delete globalThis.__AGENTBUDDY_BASE__
    }
  })

  it('prefixes the URL when a shell or test points it elsewhere', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    globalThis.__AGENTBUDDY_BASE__ = 'http://127.0.0.1:9'
    try {
      await request('/api/z')
      expect(lastCall()[0]).toBe('http://127.0.0.1:9/api/z')
    } finally {
      delete globalThis.__AGENTBUDDY_BASE__
    }
  })

  it('keeps the machine code as the message when no translation exists', () => {
    const err = new ApiError('brand_new_code', 500)
    expect(err.message).toBe('brand_new_code')
    expect(err.code).toBe('brand_new_code')
    expect(err.status).toBe(500)
  })
})

// The round-5 surfaces: shared files, the approval queue, and the tray badge.
describe('api client: round-5 endpoints', () => {
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists files with the cap and the backend the screen needs', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ files: [], maxBytes: 1024, backend: 'local' }))
    const data = await listFiles()
    expect(lastCall()[0]).toBe('/api/files')
    expect(data.maxBytes).toBe(1024)
  })

  it('deletes a file by id', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' })
    await deleteFile('file_1')
    const [url, opts] = lastCall()
    expect(url).toBe('/api/files/file_1')
    expect(opts.method).toBe('DELETE')
  })

  it('builds the download as a same-origin path, not a request', () => {
    // Nothing is fetched: the browser downloads the bytes itself.
    expect(fileContentUrl('file_1')).toBe('/api/files/file_1/content')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the approval queue', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listConnectorApprovals()
    expect(lastCall()[0]).toBe('/api/connectors/approvals')
  })

  it('approves and rejects by task id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'task-1' }))
    await approveConnectorAction('task-1')
    let [url, opts] = lastCall()
    expect(url).toBe('/api/connectors/approvals/task-1/approve')
    expect(opts.method).toBe('POST')

    await rejectConnectorAction('task-1')
    ;[url, opts] = lastCall()
    expect(url).toBe('/api/connectors/approvals/task-1/reject')
    expect(opts.method).toBe('POST')
  })

  it('names the path and the method of the tray badge', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, count: 3 }))
    await setTrayBadge(3)
    const [url, opts] = lastCall()
    expect(url).toBe('/__shell/badge')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ count: 3 })
  })
})

// uploadFile is the one wrapper that cannot use fetch: only XHR reports upload
// progress, so it is exercised against a stand-in with the same surface.
describe('api client: uploadFile', () => {
  class FakeXHR {
    constructor() {
      this.upload = {}
      this.status = 0
      this.responseText = ''
      FakeXHR.last = this
    }

    open(method, url) {
      this.method = method
      this.url = url
    }

    send(body) {
      this.body = body
    }
  }

  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts multipart form data and reports the percentage', async () => {
    const progress = vi.fn()
    const pending = uploadFile(new File(['hello'], 'a.txt'), progress)
    const xhr = FakeXHR.last
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/files')
    expect(xhr.body).toBeInstanceOf(FormData)

    xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 })
    // Not computable is not zero percent: the bar keeps its last value.
    xhr.upload.onprogress({ lengthComputable: false, loaded: 0, total: 0 })
    xhr.status = 201
    xhr.responseText = JSON.stringify({ id: 'file_1' })
    xhr.onload()

    await expect(pending).resolves.toEqual({ id: 'file_1' })
    expect(progress).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(50)
  })

  it('turns the server code into the rejection', async () => {
    const pending = uploadFile(new File(['x'], 'big.bin'))
    const xhr = FakeXHR.last
    xhr.status = 413
    xhr.responseText = JSON.stringify({ code: 'file_too_large' })
    xhr.onload()
    await expect(pending).rejects.toMatchObject({ code: 'file_too_large', status: 413 })
  })

  it('rejects a transport failure and a timeout', async () => {
    const first = uploadFile(new File(['x'], 'a.txt'))
    FakeXHR.last.onerror()
    await expect(first).rejects.toMatchObject({ code: 'network_error' })

    const second = uploadFile(new File(['x'], 'a.txt'))
    FakeXHR.last.ontimeout()
    await expect(second).rejects.toMatchObject({ code: 'timeout' })
  })

  it('resolves a success with no body as null', async () => {
    const pending = uploadFile(new File(['x'], 'a.txt'))
    const xhr = FakeXHR.last
    xhr.status = 200
    xhr.responseText = ''
    xhr.onload()
    await expect(pending).resolves.toBeNull()
  })

  it('resolves null rather than throwing on an unparsable body', async () => {
    const pending = uploadFile(new File(['x'], 'a.txt'))
    const xhr = FakeXHR.last
    xhr.status = 200
    xhr.responseText = '{ not json'
    xhr.onload()
    await expect(pending).resolves.toBeNull()
  })

  it('falls back to the status when the error body is unreadable', async () => {
    const pending = uploadFile(new File(['x'], 'a.txt'))
    const xhr = FakeXHR.last
    xhr.status = 500
    xhr.responseText = '{ not json'
    xhr.onload()
    await expect(pending).rejects.toMatchObject({ code: '500', status: 500 })
  })

  it('gives an unnamed file a name the server can store', async () => {
    // A dropped folder or a File built by a picker without metadata arrives with
    // an empty name. The multipart part still needs one.
    const pending = uploadFile(new File(['x'], ''))
    const xhr = FakeXHR.last
    const part = xhr.body.get('file')
    expect(part.name).toBe('upload.bin')
    xhr.status = 201
    xhr.responseText = JSON.stringify({ id: 'file_9' })
    xhr.onload()
    await expect(pending).resolves.toEqual({ id: 'file_9' })
  })

  it('reads the code out of an empty error body without throwing', async () => {
    // The `|| '{}'` arm: a 502 from a proxy may carry no body at all.
    const pending = uploadFile(new File(['x'], 'a.txt'))
    const xhr = FakeXHR.last
    xhr.status = 502
    xhr.responseText = ''
    xhr.onload()
    await expect(pending).rejects.toMatchObject({ code: '502', status: 502 })
  })
})
