// A tiny W3C WebDriver client over global fetch. No selenium, no webdriverio,
// no npm dependency: tauri-driver speaks the standard protocol on :4444 and the
// handful of commands below are all a user-journey suite needs.
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'

export class WebDriverError extends Error {
  constructor(message, { code, status, path } = {}) {
    super(message)
    this.name = 'WebDriverError'
    this.code = code
    this.status = status
    this.path = path
  }
}

export function createWebDriver(driverUrl, { timeoutMs = 30_000 } = {}) {
  const base = driverUrl.replace(/\/+$/, '')

  async function call(method, path, body) {
    let res
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new WebDriverError(`cannot reach tauri-driver at ${base}${path}: ${error.message}`, { path })
    }
    const raw = await res.text().catch(() => '')
    let payload = {}
    try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { value: raw } }
    const value = payload?.value
    const code = value?.error || (!res.ok ? String(res.status) : null)
    if (code) {
      throw new WebDriverError(
        `WebDriver ${method} ${path} → ${code}: ${value?.message || raw.slice(0, 300)}`,
        { code, status: res.status, path },
      )
    }
    return value
  }

  return { call, base, timeoutMs }
}

const elementId = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  return value[ELEMENT_KEY] || Object.values(value)[0] || null
}
const toElements = (value) => (Array.isArray(value) ? value : []).map(elementId).filter(Boolean)

/** Attaches to a session the orchestrator already created (specs run in workers). */
export function attachSession(driverUrl, sessionId, options) {
  const client = createWebDriver(driverUrl, options)
  const root = `/session/${sessionId}`
  const enc = encodeURIComponent

  const api = {
    sessionId,
    client,
    raw: client.call,
    delete: () => client.call('DELETE', root),
    status: () => client.call('GET', '/status'),
    url: () => client.call('GET', `${root}/url`),
    title: () => client.call('GET', `${root}/title`),
    source: () => client.call('GET', `${root}/source`),
    navigate: (url) => client.call('POST', `${root}/url`, { url }),
    refresh: () => client.call('POST', `${root}/refresh`, {}),
    back: () => client.call('POST', `${root}/back`, {}),
    setTimeouts: (timeouts) => client.call('POST', `${root}/timeouts`, timeouts),
    execute: (script, args = []) => client.call('POST', `${root}/execute/sync`, { script, args }),
    executeAsync: (script, args = []) => client.call('POST', `${root}/execute/async`, { script, args }),
    screenshot: () => client.call('GET', `${root}/screenshot`),
    windowHandle: () => client.call('GET', `${root}/window`),
    windowHandles: () => client.call('GET', `${root}/window/handles`),
    switchToWindow: (handle) => client.call('POST', `${root}/window`, { handle }),
    setWindowRect: (rect) => client.call('POST', `${root}/window/rect`, rect),
    alertText: () => client.call('GET', `${root}/alert/text`),
    acceptAlert: () => client.call('POST', `${root}/alert/accept`, {}),
    dismissAlert: () => client.call('POST', `${root}/alert/dismiss`, {}),

    find: async (using, value) => elementId(await client.call('POST', `${root}/element`, { using, value })),
    findAll: async (using, value) => toElements(await client.call('POST', `${root}/elements`, { using, value })),
    click: (id) => client.call('POST', `${root}/element/${enc(id)}/click`, { value: undefined }),
    type: (id, text) => client.call('POST', `${root}/element/${enc(id)}/value`, { text }),
    clear: (id) => client.call('POST', `${root}/element/${enc(id)}/clear`, {}),
    text: (id) => client.call('GET', `${root}/element/${enc(id)}/text`),
    attribute: (id, name) => client.call('GET', `${root}/element/${enc(id)}/attribute/${enc(name)}`),
    property: (id, name) => client.call('GET', `${root}/element/${enc(id)}/property/${enc(name)}`),
    css: (id, name) => client.call('GET', `${root}/element/${enc(id)}/css/${enc(name)}`),
    displayed: (id) => client.call('GET', `${root}/element/${enc(id)}/displayed`),
    selected: (id) => client.call('GET', `${root}/element/${enc(id)}/selected`),
  }
  return api
}

/** Creates a real desktop session; tauri-driver spawns the app binary for us. */
export async function newDesktopSession(driverUrl, appBinary, { timeoutMs = 120_000 } = {}) {
  const client = createWebDriver(driverUrl, { timeoutMs })
  const value = await client.call('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'wry',
        'tauri:options': { application: appBinary },
      },
      firstMatch: [{}],
    },
  })
  const sessionId = value?.sessionId || value?.capabilities?.sessionId
  if (!sessionId) throw new WebDriverError('newSession did not return a sessionId')
  const session = attachSession(driverUrl, sessionId, { timeoutMs })
  await session.setTimeouts({ script: 20_000, pageLoad: 30_000, implicit: 0 }).catch(() => {})
  return session
}

export { elementId }
