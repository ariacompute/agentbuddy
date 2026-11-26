// The cross-repo half of the contract: the same refusals are asserted against
// the deterministic stub and a real agenthub. A stub is only useful if it
// answers like the server it stands in for, and this file is the executable
// version of that sentence.
//
// It deliberately needs no WebView, no tauri-driver and no built desktop binary:
// `E2E_CONTRACT_ONLY=1` leaves `info.skipped` true, but `info.serverUrl` and the
// credentials are still published, so CI can run this group against a server it
// started in the same job.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import { readE2eConfig } from '../harness/config.mjs'
import { ERROR_CONTRACT } from '../contract/error-contract.mjs'

const { info } = e2eContext()
const cfg = readE2eConfig()
const base = info.serverUrl.replace(/\/$/, '')

let cookie = ''
let skillId = ''

async function call(path, { method = 'GET', body } = {}) {
  const headers = cookie ? { Cookie: cookie } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed, setCookie: res.headers.get('set-cookie') }
}

const distribution = (method, id) => call(`/api/resources/${id}/distribution`, {
  method,
  body: method === 'POST' ? {} : undefined,
})

describe.skipIf(!base)('agenthub error contract (stub and live)', () => {
  beforeAll(async () => {
    expect(base, 'a server URL is required: E2E_SERVER_URL (live) or the stub URL').toBeTruthy()
    expect(cfg.credentials.email, 'live runs need E2E_LIVE_EMAIL').toBeTruthy()
    expect(cfg.credentials.password, 'live runs need E2E_LIVE_PASSWORD').toBeTruthy()

    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { email: cfg.credentials.email, password: cfg.credentials.password },
    })
    expect(login.status, `sign in as ${cfg.credentials.email}`).toBe(200)
    expect(login.setCookie, 'a successful login must set a session cookie').toBeTruthy()
    cookie = login.setCookie.split(';')[0]

    // A unique id makes a re-run against the same database harmless; the row is
    // deleted in afterAll (stub mode resets its fixtures instead).
    const id = `e2e-contract-skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const created = await call('/api/resources', {
      method: 'POST',
      body: {
        id,
        kind: 'skill',
        name: id,
        version: '1.0.0',
        health: 'healthy',
        status: 'approved',
        visibility: 'public',
        namespace: 'default',
      },
    })
    expect([200, 201], `create the temporary skill: ${JSON.stringify(created.body)}`).toContain(created.status)
    skillId = created.body?.id || id
    expect(skillId, 'the created skill must carry an id').toBeTruthy()
  })

  afterAll(async () => {
    // A test must not leave global state behind (M28/M48). Stub fixtures are
    // reset, a real database row is deleted; a failure here must not mask the
    // assertions above, so both paths are best-effort.
    if (info.backend === 'stub') {
      await fetch(`${base}/__e2e/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {})
      return
    }
    if (skillId) await call(`/api/resources/${skillId}`, { method: 'DELETE' }).catch(() => {})
  })

  it('refuses a non-agent target as invalid_kind on GET and POST', async () => {
    for (const method of ['GET', 'POST']) {
      const answer = await distribution(method, skillId)
      expect(answer.status, `${method} /distribution on a skill`).toBe(ERROR_CONTRACT.invalidKind.status)
      expect(answer.body?.code, `${method} /distribution code`).toBe(ERROR_CONTRACT.invalidKind.code)
    }
  })

  it('reports an unknown target as not_found, not invalid_kind', async () => {
    for (const method of ['GET', 'POST']) {
      const answer = await distribution(method, 'e2e-contract-does-not-exist')
      expect(answer.status, `${method} /distribution on an unknown id`).toBe(ERROR_CONTRACT.notFound.status)
      expect(answer.body?.code, `${method} /distribution code`).toBe(ERROR_CONTRACT.notFound.code)
    }
  })
})
