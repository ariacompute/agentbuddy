// API client for agentbuddy. Talks to agenthub through the desktop loopback
// proxy, where every path is same-origin, so a bare '' base and
// credentials:'include' are enough (the HttpOnly session cookie is sent).
//
// Two rules, inherited from agenthub:
//   1. A failed request throws an Error carrying only a machine `code`.
//      The caller localises through errors.js — never store prose here.
//   2. SSE is read with the browser EventSource (GET + text/event-stream),
//      which is how agenthub streams thread and task events.
import { errorMessage } from './errors.js'

export const BASE = ''

export class ApiError extends Error {
  constructor(code, status) {
    super(errorMessage(code) || code)
    this.code = code
    this.status = status
  }
}

async function parseError(res) {
  let code = String(res.status)
  try {
    const data = await res.json()
    if (data && data.code) code = data.code
  } catch (error) {
    console.error('agentbuddy: cannot read error body', error)
  }
  return new ApiError(code, res.status)
}

export async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error('agentbuddy: cannot parse response', error)
    return null
  }
}

const get = (path) => request(path, { method: 'GET' })
const del = (path) => request(path, { method: 'DELETE' })
const post = (path, body) => request(path, {
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
})
const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) })

// ---- Auth ----------------------------------------------------------------

export const authConfig = () => get('/api/auth/config')
export const register = (email, password, displayName) =>
  post('/api/auth/register', { email, password, displayName })
export const login = (email, password) => post('/api/auth/login', { email, password })
export const logout = () => post('/api/auth/logout')
export const whoami = () => get('/api/auth/me')

// ---- Server health -------------------------------------------------------

export const checkHealth = () => get('/healthz')

// ---- Workspace -----------------------------------------------------------

export const getWorkspace = () => get('/api/workspace')

// ---- Threads -------------------------------------------------------------

export const listThreads = () => get('/api/threads')
export const createThread = (title) => post('/api/threads', { title })
export const getThread = (id) => get(`/api/threads/${id}`)
export const postThreadMessage = (id, body, mentions) =>
  post(`/api/threads/${id}/messages`, { body, mentions })

/** Streams thread events (replay then live). `handlers` gets {event, data}. */
export function subscribeThreadEvents(id, handlers = {}) {
  const source = new EventSource(`/api/threads/${id}/events`)
  source.onmessage = (ev) => {
    if (handlers.message) handlers.message(JSON.parse(ev.data))
  }
  source.addEventListener('thread.agent', (ev) => {
    if (handlers.agent) handlers.agent(JSON.parse(ev.data))
  })
  source.addEventListener('thread.message', (ev) => {
    if (handlers.message) handlers.message(JSON.parse(ev.data))
  })
  source.onerror = (err) => {
    if (handlers.error) handlers.error(err)
  }
  return {
    close: () => source.close(),
  }
}

// ---- Tasks ---------------------------------------------------------------

export const listTasks = () => get('/api/tasks')
export const getTask = (id) => get(`/api/tasks/${id}`)
export const cancelTask = (id) => post(`/api/tasks/${id}/cancel`)
export const resumeTask = (id, answer) => post(`/api/tasks/${id}/resume`, { answer })

/** Streams one task's events since a sequence number. `handlers` gets {event, data}. */
export function subscribeTaskEvents(id, since, handlers = {}) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  const source = new EventSource(`/api/tasks/${id}/events${qs}`)
  const handlersFor = {
    task_status_update: handlers.status,
    task_artifact_update: handlers.artifact,
    task_span_update: handlers.span,
    message: handlers.message,
  }
  source.onmessage = (ev) => {
    if (handlers.message) handlers.message(JSON.parse(ev.data))
  }
  for (const [kind, fn] of Object.entries(handlersFor)) {
    if (!fn) continue
    source.addEventListener(kind, (ev) => fn(JSON.parse(ev.data)))
  }
  source.onerror = (err) => { if (handlers.error) handlers.error(err) }
  return { close: () => source.close() }
}

// ---- Resources (org + connectors) ----------------------------------------

export const listResources = (kind) =>
  get(kind ? `/api/resources?kind=${encodeURIComponent(kind)}` : '/api/resources')

// ---- Channels ------------------------------------------------------------

export const listChannels = () => get('/api/channels')
export const createChannel = (body) => post('/api/channels', body)
export const updateChannel = (id, body) => put(`/api/channels/${id}`, body)
export const deleteChannel = (id) => del(`/api/channels/${id}`)
export const getDeliveries = (id) => get(`/api/channels/${id}/deliveries`)
export const retryDelivery = (id, deliveryId) => post(`/api/channels/${id}/deliveries/${deliveryId}/retry`)

// ---- Connectors ----------------------------------------------------------

export const listConnectors = () => get('/api/connectors')
export const setConnectorPolicy = (id, policy) => put(`/api/connectors/${id}/policy`, { policy })
export const getConnectorActions = (id) => get(`/api/connectors/${id}/actions`)
export const runConnectorAction = (id, name, args) =>
  post(`/api/connectors/${id}/actions`, { name, args: args || {} })

// ---- Speech --------------------------------------------------------------

/** Uploads a recorded audio blob to be transcribed, delegated and answered. */
export async function postThreadAudio(id, blob) {
  const form = new FormData()
  form.append('audio', blob, 'voice.webm')
  const res = await fetch(`${BASE}/api/threads/${id}/audio`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) throw await parseError(res)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
