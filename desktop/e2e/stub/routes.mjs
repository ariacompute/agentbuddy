// The stub's routing table: one entry per endpoint the workbench can call.
// Handlers return a small descriptor; server.mjs owns the socket so that a
// `drop` scenario can really cut the connection and an SSE handler can keep it.
import { EMPTY_SHAPES, ISO, LATER } from './fixtures.mjs'
import { nextId, recordRequest, resetState } from './state.mjs'
import { pushEvent } from './sse.mjs'
import { resolveScenario, setScenario } from './scenarios.mjs'

const routes = []
const add = (method, pattern, handler) => routes.push({ method, pattern, handler })

const json = (body, status = 200, headers = {}) => ({ status, json: body, headers })
const empty = () => ({ status: 204, body: '' })
const code = (value, status = 400) => json({ code: value }, status)

export function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

/** Minimal multipart reader: we only need field names, filenames and byte sizes. */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '')
  const boundary = match?.[1] || match?.[2]
  const fields = {}
  const files = []
  if (!boundary) return { fields, files }
  const delimiter = Buffer.from(`--${boundary}`)
  let start = buffer.indexOf(delimiter)
  while (start !== -1) {
    const after = start + delimiter.length
    if (buffer.subarray(after, after + 2).toString() === '--') break
    const cursor = after + 2
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd === -1) break
    const headers = buffer.subarray(cursor, headerEnd).toString('utf8')
    const next = buffer.indexOf(delimiter, headerEnd + 4)
    if (next === -1) break
    const data = buffer.subarray(headerEnd + 4, Math.max(headerEnd + 4, next - 2))
    const name = /name="([^"]+)"/i.exec(headers)?.[1] || ''
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1]
    if (filename !== undefined) files.push({ field: name, name: filename, size: data.length, data })
    else fields[name] = data.toString('utf8')
    start = next
  }
  return { fields, files }
}

function jsonBody(ctx) {
  try { return JSON.parse(ctx.body.toString('utf8') || '{}') } catch { return {} }
}

function find(list, id) {
  return list.find((item) => item.id === id || item.ID === id)
}

function remove(list, id) {
  // Approval rows are keyed by taskId (the URL carries the task id), while the
  // other fixtures use id / ID. Without taskId an approve answered 200 but the
  // row stayed in the queue forever.
  const at = list.findIndex((item) => item.id === id || item.ID === id || item.taskId === id)
  if (at >= 0) return list.splice(at, 1)[0]
  return null
}

const SESSION_COOKIE = 'ab_session=e2e-session; Path=/; HttpOnly; SameSite=Lax'
const CLEAR_COOKIE = 'ab_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

// ---- Health / discovery / A2A --------------------------------------------

add('GET', /^\/healthz$/, (s) => json(s.fixtures.healthz))
add('GET', /^\/\.well-known\//, () => json({ name: 'e2e-agent', protocolVersion: '0.3.0', skills: [] }))
add('POST', /^\/a2a(?:\/|$)/, () => json({ jsonrpc: '2.0', id: 1, result: { id: 'task-1', status: { state: 'completed' } } }))

// ---- Auth ----------------------------------------------------------------

add('GET', /^\/api\/auth\/config$/, (s) => json(s.fixtures.authConfig))
add('GET', /^\/api\/auth\/me$/, (s, ctx) => json(ctx.signedIn ? s.fixtures.user : null))
add('POST', /^\/api\/auth\/register$/, (s, ctx) => {
  const { email, password, name } = jsonBody(ctx)
  if (!email || !String(password || '').length) return code('weak_password', 400)
  if (s.fixtures.registeredEmails?.has(email)) return code('email_taken', 409)
  if (!s.fixtures.registeredEmails) s.fixtures.registeredEmails = new Set()
  s.fixtures.registeredEmails.add(email)
  s.fixtures.user = { ...s.fixtures.user, name: name || s.fixtures.user.name }
  return json({ ok: true })
})
add('POST', /^\/api\/auth\/login$/, (s, ctx) => {
  const { email, password } = jsonBody(ctx)
  if (email !== 'e2e@example.test' || password !== 'agentbuddy-e2e') {
    return code('invalid_credentials', 401)
  }
  s.sessions.add('e2e-session')
  return json({ ok: true }, 200, { 'Set-Cookie': SESSION_COOKIE })
})
add('POST', /^\/api\/auth\/logout$/, (s) => {
  s.sessions.clear()
  return json({ ok: true }, 200, { 'Set-Cookie': CLEAR_COOKIE })
})

// ---- Workspace -----------------------------------------------------------

add('GET', /^\/api\/workspace$/, (s) => json({ agents: s.fixtures.agents, activity: s.fixtures.activity }))

// ---- Threads -------------------------------------------------------------

add('GET', /^\/api\/threads$/, (s) => json({ threads: s.fixtures.threads }))
add('POST', /^\/api\/threads$/, (s, ctx) => {
  const { title } = jsonBody(ctx)
  const row = { ID: nextId(s, 'thread'), Title: title || 'Untitled', Channel: 'desktop', Status: 'open', Participants: [] }
  s.fixtures.threads.unshift(row)
  s.fixtures.messages[row.ID] = []
  return json(row)
})
add('GET', /^\/api\/threads\/([^/]+)\/events$/, (s, ctx, m) => ({
  sse: { channel: `thread:${m[1]}`, since: Number(ctx.query.get('since') || 0), defaultEvent: 'message' },
}))
add('POST', /^\/api\/threads\/([^/]+)\/audio$/, (s, ctx, m) => {
  const { files } = parseMultipart(ctx.body, ctx.headers['content-type'])
  const audio = files.find((f) => f.field === 'audio')
  if (!audio) return code('audio_unsupported', 400)
  if (audio.size > 16 * 1024 * 1024) return code('audio_too_large', 413)
  const row = {
    ID: nextId(s, 'm'), AuthorType: 'user', AuthorID: 'user-e2e', AuthorName: 'E2E Operator',
    ResourceID: 'agent-1', Body: '[voice transcript]', CreatedAt: LATER, TaskID: '', Origin: 'voice', Failed: false,
  }
  ;(s.fixtures.messages[m[1]] ||= []).push(row)
  pushEvent(s, `thread:${m[1]}`, 'message', row)
  return json({ ok: true, message: row })
})
add('DELETE', /^\/api\/threads\/([^/]+)\/messages$/, (s, ctx, m) => {
  s.fixtures.messages[m[1]] = []
  return empty()
})
add('POST', /^\/api\/threads\/([^/]+)\/messages$/, (s, ctx, m) => {
  const { body, mentions = [] } = jsonBody(ctx)
  const row = {
    ID: nextId(s, 'm'), AuthorType: 'user', AuthorID: 'user-e2e', AuthorName: 'E2E Operator',
    ResourceID: '', Body: body || '', CreatedAt: LATER, TaskID: '', Origin: '', Failed: false,
  }
  ;(s.fixtures.messages[m[1]] ||= []).push(row)
  const delegated = mentions.length ? [nextId(s, 'task')] : []
  if (mentions.length) {
    const reply = { ...row, ID: nextId(s, 'm'), AuthorType: 'agent', AuthorName: 'Scout', Origin: 'agent' }
    pushEvent(s, `thread:${m[1]}`, 'message', reply)
  }
  return json({ message: row, delegated, routed: mentions.length > 0 })
})
add('GET', /^\/api\/threads\/([^/]+)$/, (s, ctx, m) => {
  const thread = find(s.fixtures.threads, m[1])
  if (!thread) return code('thread_not_found', 404)
  return json({ thread, messages: s.fixtures.messages[m[1]] || [] })
})
add('DELETE', /^\/api\/threads\/([^/]+)$/, (s, ctx, m) => {
  const gone = remove(s.fixtures.threads, m[1])
  if (!gone) return code('thread_not_found', 404)
  delete s.fixtures.messages[m[1]]
  return empty()
})

// ---- Tasks ---------------------------------------------------------------

add('GET', /^\/api\/tasks$/, (s) => json({ tasks: s.fixtures.tasks }))
add('DELETE', /^\/api\/tasks$/, (s) => {
  const finished = s.fixtures.tasks.filter((t) => ['completed', 'failed', 'canceled'].includes(t.status.state))
  const kept = s.fixtures.tasks.length - finished.length
  s.fixtures.tasks = s.fixtures.tasks.filter((t) => !finished.includes(t))
  return json({ deleted: finished.length, kept })
})
add('GET', /^\/api\/tasks\/([^/]+)\/events$/, (s, ctx, m) => ({
  sse: { channel: `task:${m[1]}`, since: Number(ctx.query.get('since') || 0), defaultEvent: 'task_status_update' },
}))
add('POST', /^\/api\/tasks\/([^/]+)\/cancel$/, (s, ctx, m) => {
  const row = find(s.fixtures.tasks, m[1])
  if (!row) return code('task_not_found', 404)
  row.status.state = 'canceled'
  pushEvent(s, `task:${m[1]}`, 'task_status_update', { status: { state: 'canceled' } })
  return json({ ok: true })
})
add('POST', /^\/api\/tasks\/([^/]+)\/resume$/, (s, ctx, m) => {
  const row = find(s.fixtures.tasks, m[1])
  if (!row) return code('task_not_found', 404)
  row.status.state = 'working'
  pushEvent(s, `task:${m[1]}`, 'task_status_update', { status: { state: 'working' } })
  return json({ ok: true })
})
add('GET', /^\/api\/tasks\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.tasks, m[1])
  return row ? json(row) : code('task_not_found', 404)
})

// ---- Computers -----------------------------------------------------------

add('GET', /^\/api\/computers$/, (s) => json({ computers: s.fixtures.computers }))
add('POST', /^\/api\/computers$/, (s, ctx) => {
  const { kind, agentId } = jsonBody(ctx)
  const row = { id: nextId(s, 'computer'), kind: kind || 'shell', status: 'idle', agentId: agentId || '', lastAction: 'attached' }
  s.fixtures.computers.push(row)
  return json({ id: row.id })
})
add('GET', /^\/api\/computers\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.computers, m[1])
  return row ? json(row) : code('computer_not_found', 404)
})
add('DELETE', /^\/api\/computers\/([^/]+)$/, (s, ctx, m) => {
  remove(s.fixtures.computers, m[1])
  return json({ ok: true })
})

// ---- Sandboxes -----------------------------------------------------------

add('GET', /^\/api\/sandboxes\/stats$/, (s) => json(s.fixtures.sandboxStats))
add('GET', /^\/api\/sandboxes\/events$/, (s, ctx) => ({
  sse: { channel: 'sandbox', since: Number(ctx.query.get('since') || 0), defaultEvent: 'sandbox_event' },
}))
add('GET', /^\/api\/sandboxes$/, (s) => json(s.fixtures.sandboxes))
add('GET', /^\/api\/sandboxes\/([^/]+)$/, (s, ctx, m) => {
  const lease = find(s.fixtures.sandboxes.leases, m[1])
  return lease ? json({ lease, execs: s.fixtures.sandboxExecs[m[1]] || [] }) : code('sandbox_lease_lost', 404)
})
add('POST', /^\/api\/sandboxes\/([^/]+)\/exec$/, (s, ctx, m) => {
  if (!find(s.fixtures.sandboxes.leases, m[1])) return code('sandbox_lease_lost', 404)
  const { command = 'git', args = [] } = jsonBody(ctx)
  ;(s.fixtures.sandboxExecs[m[1]] ||= []).push({ id: nextId(s, 'exec'), command, exitCode: 0, durationMs: 5, at: LATER, dryRun: false })
  return json({ exitCode: 0, stdout: `${command} ${args.join(' ')}\n`, stderr: '', durationMs: 5, truncated: false })
})
add('POST', /^\/api\/sandboxes\/([^/]+)\/renew$/, (s, ctx, m) => {
  const lease = find(s.fixtures.sandboxes.leases, m[1])
  if (lease) lease.expiresAt = LATER
  return json({ ok: true })
})
add('DELETE', /^\/api\/sandboxes\/([^/]+)$/, (s, ctx, m) => {
  remove(s.fixtures.sandboxes.leases, m[1])
  return empty()
})
add('GET', /^\/api\/sandbox-providers$/, (s) => json(s.fixtures.sandboxProviders))
add('POST', /^\/api\/sandbox-providers\/refresh$/, (s) => json(s.fixtures.sandboxProviders))
add('GET', /^\/api\/sandbox-nodes$/, (s) => json(s.fixtures.sandboxNodes))

// ---- Schedules -----------------------------------------------------------

add('GET', /^\/api\/schedules$/, (s) => json({ schedules: s.fixtures.schedules }))
add('POST', /^\/api\/schedules$/, (s, ctx) => {
  const { goal, cronExpr = '0 * * * *', enabled = true } = jsonBody(ctx)
  const row = { id: nextId(s, 'schedule'), goal, trigger: 'cron', cronExpr, enabled, nextRun: LATER, lastStatus: '' }
  s.fixtures.schedules.push(row)
  return json({ id: row.id })
})
add('PUT', /^\/api\/schedules\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.schedules, m[1])
  if (row) Object.assign(row, jsonBody(ctx))
  return json(row || {})
})
add('DELETE', /^\/api\/schedules\/([^/]+)$/, (s, ctx, m) => {
  remove(s.fixtures.schedules, m[1])
  return empty()
})
add('POST', /^\/api\/schedules\/([^/]+)\/run$/, (s, ctx, m) => {
  const row = find(s.fixtures.schedules, m[1])
  if (row) row.lastStatus = 'running'
  pushEvent(s, 'router', 'router_event', { seq: s.sse.seq + 1, kind: 'trigger', id: m[1] })
  return json({ kicked: true })
})

// ---- Router / scheduler --------------------------------------------------

add('GET', /^\/api\/router\/stats$/, (s) => json(s.fixtures.router.stats))
add('GET', /^\/api\/router\/events$/, (s, ctx) => ({
  sse: { channel: 'router', since: Number(ctx.query.get('since') || 0), defaultEvent: 'router_event' },
}))
add('GET', /^\/api\/router\/triggers$/, (s) => json({ triggers: s.fixtures.router.triggers }))
add('GET', /^\/api\/router\/triggers\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.router.triggers, m[1])
  return row ? json({ ...row, at: ISO }) : code('router_trigger_not_found', 404)
})
add('GET', /^\/api\/router\/tickets$/, (s) => json({ tickets: s.fixtures.router.tickets }))
add('GET', /^\/api\/router\/tickets\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.router.tickets, m[1])
  return row ? json(row) : code('router_ticket_not_found', 404)
})
add('POST', /^\/api\/router\/tickets\/([^/]+)\/cancel$/, (s, ctx, m) => {
  const row = find(s.fixtures.router.tickets, m[1])
  if (row) row.state = 'canceled'
  return json({ ok: true })
})
add('POST', /^\/api\/router\/tickets\/([^/]+)\/handback$/, (s, ctx, m) => {
  const row = find(s.fixtures.router.tickets, m[1])
  if (row) row.state = 'waiting'
  return json({ ok: true })
})
add('DELETE', /^\/api\/router\/threads\/([^/]+)\/subscription$/, () => json({ ok: true }))
add('GET', /^\/api\/router\/policies$/, (s) => json({ policies: s.fixtures.router.policies }))
add('PUT', /^\/api\/router\/policies\/([^/]+)$/, (s, ctx, m) => {
  const row = s.fixtures.router.policies.find((p) => p.source === m[1])
  if (row) Object.assign(row, jsonBody(ctx))
  return json(row || {})
})
add('POST', /^\/api\/router\/passes$/, (s) => {
  s.fixtures.router.stats.passes += 1
  return json({ kicked: true })
})

// ---- Knowledge / resources ----------------------------------------------

add('GET', /^\/api\/knowledge$/, (s, ctx) => {
  const agentId = ctx.query.get('agentId')
  return json(agentId ? s.fixtures.knowledge.filter((k) => k.agentId === agentId) : s.fixtures.knowledge)
})
add('GET', /^\/api\/resources$/, (s, ctx) => {
  const kind = ctx.query.get('kind')
  return json({ resources: kind ? s.fixtures.resources.filter((r) => r.kind === kind) : s.fixtures.resources })
})
add('POST', /^\/api\/resources$/, (s, ctx) => {
  const body = jsonBody(ctx)
  const row = { id: nextId(s, 'resource'), name: body.name || 'unnamed', kind: body.kind || 'custom', display_name: body.display_name || body.name || '', health: 'healthy', capabilities: [], persona: {} }
  s.fixtures.resources.push(row)
  return json({ id: row.id })
})
add('PUT', /^\/api\/resources\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.resources, m[1])
  if (row) Object.assign(row, jsonBody(ctx))
  return json(row || {})
})

// ---- Channels ------------------------------------------------------------

add('GET', /^\/api\/channels$/, (s) => json({ channels: s.fixtures.channels, deliveries: s.fixtures.deliveries }))
add('POST', /^\/api\/channels$/, (s, ctx) => {
  const body = jsonBody(ctx)
  const row = {
    id: nextId(s, 'channel'), name: body.name || 'Channel', kind: body.kind || 'slack', enabled: body.enabled !== false,
    threadId: body.threadId || '', signingKeyEnv: body.signingKeyEnv || '', destination: body.destination || '',
    participants: body.participants || [],
  }
  s.fixtures.channels.push(row)
  s.fixtures.deliveries[row.id] = []
  return json({ id: row.id })
})
add('PUT', /^\/api\/channels\/([^/]+)$/, (s, ctx, m) => {
  const row = find(s.fixtures.channels, m[1])
  if (row) Object.assign(row, jsonBody(ctx))
  return json(row || {})
})
add('DELETE', /^\/api\/channels\/([^/]+)$/, (s, ctx, m) => {
  remove(s.fixtures.channels, m[1])
  delete s.fixtures.deliveries[m[1]]
  return json({ ok: true })
})
add('GET', /^\/api\/channels\/([^/]+)\/deliveries$/, (s, ctx, m) => json({ deliveries: s.fixtures.deliveries[m[1]] || [] }))
add('POST', /^\/api\/channels\/([^/]+)\/deliveries\/([^/]+)\/retry$/, (s, ctx, m) => {
  const row = find(s.fixtures.deliveries[m[1]] || [], m[2])
  if (!row) return code('delivery_not_found', 404)
  if (row.direction !== 'outbound' || row.status !== 'failed' || !row.body) return code('delivery_not_retryable', 409)
  row.status = 'delivered'
  row.errorCode = ''
  return json({ ok: true, id: row.id })
})
add('POST', /^\/api\/channels\/([^/]+)\/webhook$/, () => json({ ok: true, deduplicated: false }))

// ---- Connectors ----------------------------------------------------------

add('GET', /^\/api\/connectors$/, (s) => json({ connectors: s.fixtures.connectors }))
add('GET', /^\/api\/connectors\/approvals$/, (s) => json(s.fixtures.approvals))
add('POST', /^\/api\/connectors\/approvals\/([^/]+)\/approve$/, (s, ctx, m) => {
  const row = remove(s.fixtures.approvals, m[1])
  return row ? json({ id: m[1] }) : code('connector_approval_closed', 409)
})
add('POST', /^\/api\/connectors\/approvals\/([^/]+)\/reject$/, (s, ctx, m) => {
  const row = remove(s.fixtures.approvals, m[1])
  return row ? json({ id: m[1] }) : code('connector_approval_closed', 409)
})
add('GET', /^\/api\/connectors\/([^/]+)\/actions$/, (s, ctx, m) => {
  const row = s.fixtures.connectorActions[m[1]]
  return row ? json(row) : code('connector_not_found', 404)
})
add('POST', /^\/api\/connectors\/([^/]+)\/actions$/, (s, ctx, m) => {
  const connector = find(s.fixtures.connectors, m[1])
  if (!connector) return code('connector_not_found', 404)
  if (connector.policy === 'off') return code('connector_policy_off', 403)
  return json({ parked: connector.policy === 'ask' })
})
add('PUT', /^\/api\/connectors\/([^/]+)\/policy$/, (s, ctx, m) => {
  const connector = find(s.fixtures.connectors, m[1])
  const { policy } = jsonBody(ctx)
  if (connector) connector.policy = policy
  if (s.fixtures.connectorActions[m[1]]) s.fixtures.connectorActions[m[1]].policy = policy
  return json({ ok: true })
})

// ---- Shared files --------------------------------------------------------

add('GET', /^\/api\/files$/, (s) => json({ files: s.fixtures.files, ...s.fixtures.filesMeta }))
add('POST', /^\/api\/files$/, (s, ctx) => {
  const { files } = parseMultipart(ctx.body, ctx.headers['content-type'])
  const upload = files.find((f) => f.field === 'file')
  if (!upload) return code('file_unsupported', 400)
  if (upload.size > s.fixtures.filesMeta.maxBytes) return code('file_too_large', 413)
  const row = {
    id: nextId(s, 'file'), name: upload.name || 'upload.bin', mime: 'application/octet-stream',
    size: upload.size, sha256: 'b'.repeat(64), backend: 'local', createdAt: LATER,
  }
  s.fixtures.files.unshift(row)
  s.fixtures.fileBytes[row.id] = upload.data
  return json(row)
})
add('GET', /^\/api\/files\/([^/]+)\/content$/, (s, ctx, m) => {
  const row = find(s.fixtures.files, m[1])
  if (!row) return code('file_not_found', 404)
  const data = s.fixtures.fileBytes[m[1]] || Buffer.alloc(0)
  return { status: 200, raw: data, headers: { 'Content-Type': row.mime, 'Content-Disposition': `attachment; filename="${row.name}"`, 'Content-Length': String(data.length) } }
})
add('DELETE', /^\/api\/files\/([^/]+)$/, (s, ctx, m) => {
  remove(s.fixtures.files, m[1])
  delete s.fixtures.fileBytes[m[1]]
  return empty()
})

/** Test control plane. Only bound on the stub, never routed through the proxy. */
export function control(state, ctx) {
  const path = ctx.path
  const body = jsonBody(ctx)
  if (path === '/__e2e/reset' && ctx.method === 'POST') {
    // Keep the desktop WebView signed in: resetting fixtures between journeys
    // must not invalidate the session cookie the app is still carrying.
    const sessions = new Set(state.sessions)
    resetState(state)
    state.sessions = sessions
    return json({ ok: true })
  }
  if (path === '/__e2e/scenario' && ctx.method === 'POST') {
    setScenario(state, body.routeKey || body.path, body.mode, body.options || {})
    return json({ ok: true })
  }
  if (path === '/__e2e/requests' && ctx.method === 'GET') {
    return json({ requests: state.requests.slice() })
  }
  if (path === '/__e2e/sse' && ctx.method === 'POST') {
    const item = pushEvent(state, body.channel, body.event || undefined, body.data ?? {})
    return json({ ok: true, seq: item.seq })
  }
  if (path === '/__e2e/session' && ctx.method === 'POST') {
    if (body.clear) state.sessions.clear()
    else state.sessions.add('e2e-session')
    return json({ ok: true, signedIn: state.sessions.size > 0 })
  }
  if (path === '/__e2e/state' && ctx.method === 'GET') {
    const f = state.fixtures
    return json({
      threads: f.threads.length, tasks: f.tasks.length, channels: f.channels.length,
      connectors: f.connectors.length, approvals: f.approvals.length, files: f.files.length,
      schedules: f.schedules.length, knowledge: f.knowledge.length, resources: f.resources.length,
      requests: state.requests.length, signedIn: state.sessions.size > 0,
    })
  }
  if (path === '/__e2e/upgrade' && ctx.method === 'POST') {
    Object.assign(state.upgrade, body)
    return json({ ok: true, upgrade: state.upgrade })
  }
  return code('not_found', 404)
}

/** Resolves one normal request, applying fault injection before the handler. */
export function route(state, ctx) {
  const override = resolveScenario(state, ctx.path, ctx.method)
  if (override) {
    if (override.kind === 'fail') return json({ code: override.code || 'internal_error' }, override.status || 500)
    if (override.kind === 'empty') return json(EMPTY_SHAPES[ctx.path] || {})
    if (override.kind === 'drop') return { drop: true }
    if (override.kind === 'delay') return { delay: override.delayMs || 5000 }
  }
  for (const entry of routes) {
    if (entry.method !== ctx.method) continue
    const match = entry.pattern.exec(ctx.path)
    if (!match) continue
    return entry.handler(state, ctx, match)
  }
  return code('not_found', 404)
}

/** Names every endpoint the stub answers, for the contract spec. */
export function routeKeys() {
  return routes.map(({ method, pattern }) => `${method} ${pattern.source}`)
}
