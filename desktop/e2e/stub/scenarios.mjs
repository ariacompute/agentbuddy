// Fault injection for the stub, driven by the /__e2e/* control endpoints.
// A scenario is keyed by an exact path, by "METHOD path", or by a trailing `*`
// prefix; the first match wins.
import { pushEvent } from './sse.mjs'

export const FAILURE_MODES = {
  ok: null,
  unauthenticated: { kind: 'fail', status: 401, code: 'unauthenticated' },
  forbidden: { kind: 'fail', status: 403, code: 'forbidden' },
  unavailable: { kind: 'fail', status: 405, code: 'method_not_allowed' },
  // The workbench renders its "switched off" panels only for this machine code,
  // not for a generic 405 (which means "route missing on an old server").
  feature_off: { kind: 'fail', status: 503, code: 'feature_unavailable' },
  server_error: { kind: 'fail', status: 500, code: 'internal_error' },
  payload_too_large: { kind: 'fail', status: 413, code: 'payload_too_large' },
  empty: { kind: 'empty' },
  timeout: { kind: 'delay', delayMs: 5000 },
  drop: { kind: 'drop' },
  slow_sse: { kind: 'delay', delayMs: 3000 },
}

export function setScenario(state, routeKey, mode, options = {}) {
  if (mode === 'ok') {
    state.scenarios.delete(routeKey)
    return
  }
  if (!(mode in FAILURE_MODES)) throw new Error(`unknown scenario mode: ${mode}`)
  const preset = { ...FAILURE_MODES[mode] }
  // Only override when the caller actually supplied a value: spreading an
  // undefined `status`/`code` here would silently turn a 405 into a 500.
  if (options.delayMs !== undefined) preset.delayMs = options.delayMs
  if (options.status !== undefined) preset.status = options.status
  if (options.code !== undefined) preset.code = options.code
  state.scenarios.set(routeKey, preset)
}

export function resetScenarios(state) {
  state.scenarios.clear()
}

/** Returns the active override for one request, or null. */
export function resolveScenario(state, path, method = 'GET') {
  for (const [key, value] of state.scenarios) {
    const exact = key === `${method} ${path}` || key === path
    const prefix = key.endsWith('*') && path.startsWith(key.slice(0, -1))
    if (exact || prefix) return value
  }
  return null
}

export function recordedRequests(state) {
  return state.requests.slice()
}

export function pushSseEvent(state, channel, payload = {}) {
  return pushEvent(state, channel, payload.event || undefined, payload.data ?? payload)
}
