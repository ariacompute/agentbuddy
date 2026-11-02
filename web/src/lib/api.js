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

// One seam, used only by the end-to-end smoke test: a real HTTP server can stand
// in for the loopback proxy by setting `globalThis.__AGENTBUDDY_BASE__` before
// the first request. Production never sets it, so BASE stays '' and every path
// remains same-origin (which is what makes the cookie flow work at all).
function baseUrl() {
  const override = typeof globalThis === 'undefined' ? '' : globalThis.__AGENTBUDDY_BASE__
  return typeof override === 'string' && override ? override : BASE
}

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

/**
 * True when an API error is an authentication / authorisation failure rather than a
 * connectivity problem. The workbench must tell these apart: a 401/403 means the
 * session expired (the server is reachable, just rejects us), whereas a network
 * error or a 502/503 from the loopback proxy means the server really is down.
 * Confusing the two makes the desktop app falsely report "cannot connect to server".
 */
export function isAuthError(err) {
  if (!err) return false
  const code = err.code
  return (
    code === 'unauthenticated' ||
    code === 'forbidden' ||
    code === 'session_expired' ||
    err.status === 401 ||
    err.status === 403
  )
}

export async function request(path, options = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
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
  post('/api/auth/register', { email, password, name: displayName })
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

// ---- Agent computers (F11) ----------------------------------------------

export const listComputers = () => get('/api/computers')
export const createComputer = (kind, agentId) =>
  post('/api/computers', { kind, agentId })
export const getComputer = (id) => get(`/api/computers/${id}`)
/** Terminates the lease behind a computer before dropping its card. */
export const deleteComputer = (id) => del(`/api/computers/${id}`)

// ---- Execution environments (sandboxes) -----------------------------------

/** The water level: leases, queued jobs, online nodes, recent runs, last sweep. */
export const sandboxStats = () => get('/api/sandboxes/stats')
export const listSandboxes = () => get('/api/sandboxes')
export const getSandbox = (id) => get(`/api/sandboxes/${id}`)
/** Runs one command in a lease. A manual probe, not a routed task. */
export const execSandbox = (id, body) => post(`/api/sandboxes/${id}/exec`, body)
export const renewSandbox = (id) => post(`/api/sandboxes/${id}/renew`)
export const terminateSandbox = (id) => del(`/api/sandboxes/${id}`)

/** The catalogue, grouped by isolation layer on the server. */
export const listSandboxProviders = () => get('/api/sandbox-providers')
/** Re-probes every backend; a POST because it spawns the runtime binaries. */
export const refreshSandboxProviders = () => post('/api/sandbox-providers/refresh')

export const listSandboxNodes = () => get('/api/sandbox-nodes')

/** Streams environment frames (replay from `since`, then live). */
export function subscribeSandboxEvents(since, handlers = {}) {
  const q = since ? `?since=${encodeURIComponent(since)}` : ''
  const source = new EventSource(`/api/sandboxes/events${q}`)
  source.addEventListener('sandbox_event', (ev) => {
    if (handlers.event) handlers.event(JSON.parse(ev.data))
  })
  source.onerror = (err) => {
    if (handlers.error) handlers.error(err)
  }
  return { close: () => source.close() }
}

// ---- Schedules (F13) ----------------------------------------------------

// `trigger` is 'cron' for periodic goals. The server derives next_run from the
// expression at save time; the router fires it when it comes due.
export const listSchedules = () => get('/api/schedules')
export const createSchedule = (goal, cronExpr, enabled) =>
  post('/api/schedules', { goal, trigger: 'cron', cronExpr, enabled })
export const updateSchedule = (id, patch) => put(`/api/schedules/${id}`, patch)
export const deleteSchedule = (id) => del(`/api/schedules/${id}`)

/** Fires a goal now, whatever its expression says. It enters the router as a trigger. */
export const runSchedule = (id) => post(`/api/schedules/${id}/run`)

// ---- Router / scheduler ---------------------------------------------------

const qs = (params) => {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (pairs.length === 0) return ''
  return `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
}

/** The water level: queue depth, tickets in hand and the last batch size. */
export const routerStats = () => get('/api/router/stats')
export const listRouterTriggers = (params = {}) =>
  get(`/api/router/triggers${qs(params)}`)
export const getRouterTrigger = (id) => get(`/api/router/triggers/${id}`)
export const listRouterTickets = (params = {}) => get(`/api/router/tickets${qs(params)}`)
export const getRouterTicket = (id) => get(`/api/router/tickets/${id}`)
export const cancelRouterTicket = (id) => post(`/api/router/tickets/${id}/cancel`)
export const handbackRouterTrigger = (ticketId, triggerId, reason) =>
  post(`/api/router/tickets/${ticketId}/handback`, { triggerId, reason })
export const dropRouterSubscription = (threadId) =>
  del(`/api/router/threads/${threadId}/subscription`)
export const listRouterPolicies = () => get('/api/router/policies')
export const saveRouterPolicy = (source, patch) =>
  put(`/api/router/policies/${source}`, patch)
/** Runs one scheduling beat now instead of waiting for the next tick. */
export const kickRouterPass = () => post('/api/router/passes')

/** Streams scheduler frames (replay from `since`, then live). */
export function subscribeRouterEvents(since, handlers = {}) {
  const q = since ? `?since=${encodeURIComponent(since)}` : ''
  const source = new EventSource(`/api/router/events${q}`)
  source.addEventListener('router_event', (ev) => {
    if (handlers.event) handlers.event(JSON.parse(ev.data))
  })
  source.onerror = (err) => {
    if (handlers.error) handlers.error(err)
  }
  return { close: () => source.close() }
}

// ---- Knowledge (F14, mock RAG) ------------------------------------------

export const listKnowledge = (agentId) =>
  get(`/api/knowledge${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`)

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
export const createResource = (body) => post('/api/resources', body)
export const updateResource = (id, patch) => put(`/api/resources/${id}`, patch)

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

// ---- Desktop shell -------------------------------------------------------
//
// `/__shell/*` is served by the loopback proxy, not by agenthub. In a plain web
// build the paths 404 and every caller treats that as "no shell" — which is why
// these are safe to call from shared code.

/** The shell's own config: language, close behaviour and the notify preferences. */
export const getShellConfig = () => get('/__shell/config')

/**
 * Asks the shell to raise an OS notification. The shell answers
 * `{ok:false, reason}` for a disabled or impossible notification; a refusal is a
 * normal answer, not a failure, so callers ignore the body.
 */
export const notifyShell = ({ title, body, link }) =>
  post('/__shell/notify', { title, body, link })

// ---- Speech --------------------------------------------------------------

/** Uploads a recorded audio blob to be transcribed, delegated and answered. */
export async function postThreadAudio(id, blob) {
  const form = new FormData()
  form.append('audio', blob, 'voice.webm')
  const res = await fetch(`${baseUrl()}/api/threads/${id}/audio`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) throw await parseError(res)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
