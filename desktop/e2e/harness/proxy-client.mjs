// Two ways to observe the loopback proxy:
//   * pageFetch — a fetch inside the WebView, carrying the bootstrap cookie and
//     a same-origin Origin. This is what /__shell/* and forwarded /api/* need.
//   * direct    — a bare Node fetch with no credentials, for the refusal paths
//     (401 without token, 403 for a foreign Origin) and response headers.
// The stub's /__e2e/* control plane is reached directly, not through the proxy.
import { pageFetch } from '../driver/helpers.mjs'

async function readJson(res) {
  const text = await res.text()
  try { return text ? JSON.parse(text) : null } catch { return text }
}

export function createProxyClient({ wd, proxyOrigin, stubUrl, backend, timeoutMs = 15_000 }) {
  const isStub = backend === 'stub' && !!stubUrl

  const shell = (path, options = {}) => pageFetch(wd, path, options, timeoutMs)

  const direct = async (path, { method = 'GET', headers = {}, body = undefined } = {}) => {
    const res = await fetch(`${proxyOrigin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return {
      status: res.status,
      ok: res.ok,
      body: await readJson(res),
      headers: Object.fromEntries(res.headers.entries()),
    }
  }

  const control = async (name, payload) => {
    if (!isStub) throw new Error(`stub control /__e2e/${name} is unavailable in live mode`)
    const res = await fetch(`${stubUrl}/__e2e/${name}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return readJson(res)
  }

  return {
    isStub,
    proxyOrigin,
    shell,
    direct,

    config: () => shell('/__shell/config'),
    saveConfig: (patch) => shell('/__shell/config', { method: 'POST', body: patch }),
    executor: () => shell('/__shell/executor'),
    saveExecutor: (patch) => shell('/__shell/executor', { method: 'POST', body: patch }),
    hide: () => shell('/__shell/hide', { method: 'POST', body: {} }),
    notify: (payload) => shell('/__shell/notify', { method: 'POST', body: payload }),
    badge: (count) => shell('/__shell/badge', { method: 'POST', body: { count } }),
    upgrade: () => shell('/__shell/upgrade'),
    checkUpgrade: () => shell('/__shell/upgrade/check', { method: 'POST', body: {} }),
    installUpgrade: () => shell('/__shell/upgrade/install', { method: 'POST', body: {} }),
    testConnection: (payload) => shell('/__shell/test', { method: 'POST', body: payload }),
    connectPage: () => shell('/__shell/connect'),
    aboutPage: () => shell('/__shell/about'),

    forward: (path, options) => shell(path, options),
    spaFallback: (path = '/a-page-that-does-not-exist') => shell(path),

    reset: () => control('reset', {}),
    scenario: (routeKey, mode, options = {}) => control('scenario', { routeKey, mode, options }),
    requests: async () => (await control('requests'))?.requests || [],
    state: () => control('state'),
    pushSse: (channel, event, data) => control('sse', { channel, event, data }),
    setSession: (clear = false) => control('session', { clear }),
    setUpgradeState: (patch) => control('upgrade', patch),
  }
}
