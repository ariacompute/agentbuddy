// Notification decisions, kept as a pure function.
//
// There is no DOM here and no timer: the monitor hands an event in and gets
// back "say nothing", "say this" or "say one summary". That is what lets the
// noisy parts (coalescing, quiet periods) be tested without a browser.
//
// The 1 hour idempotency window mirrors the server's push notifier, so a result
// that arrives over SSE and again over a push callback is still announced once.

export const IDEMPOTENT_WINDOW_MS = 60 * 60 * 1000
export const SAME_KEY_SILENCE_MS = 30 * 1000
export const DIGEST_WINDOW_MS = 60 * 1000
export const DEFAULT_MAX_PER_MINUTE = 8

/** Which task states are worth interrupting somebody for. */
const ANNOUNCED = {
  completed: 'result',
  'input-required': 'approval',
  failed: 'failure',
  canceled: 'result',
}

/** The identity of one announcement: the same result is never announced twice. */
export function eventKey(event) {
  const id = String(event?.taskId ?? '').trim()
  const state = String(event?.state ?? '').trim()
  return `${id}:${state}`
}

function recentWithin(recent, now, windowMs) {
  if (!Array.isArray(recent)) return []
  return recent.filter((at) => Number.isFinite(at) && now - at >= 0 && now - at < windowMs)
}

/**
 * Decides what, if anything, to surface for one task event.
 *
 * @param {object} input
 * @param {{taskId?: string, state?: string, threadId?: string, agentName?: string, summary?: string}} input.event
 * @param {Record<string, number>} input.seen  key -> timestamp in ms
 * @param {number} input.now
 * @param {{enabled?: boolean, quietUntil?: number, maxPerMinute?: number, recent?: number[]}} [input.settings]
 * @returns {null | {key: string, kind: string, title: string, body: string, link: string, system: boolean}}
 */
export function decide({ event, seen, now, settings = {} }) {
  if (!event || !Number.isFinite(now)) return null
  const state = String(event.state ?? '').trim()
  const kind = ANNOUNCED[state]
  if (!kind) return null
  const taskId = String(event.taskId ?? '').trim()
  if (!taskId) return null

  const key = eventKey(event)
  const last = seen && Object.prototype.hasOwnProperty.call(seen, key) ? seen[key] : null
  if (Number.isFinite(last)) {
    if (now - last < IDEMPOTENT_WINDOW_MS) return null
    if (now - last < SAME_KEY_SILENCE_MS) return null
  }

  const link = event.threadId ? `/threads/${event.threadId}` : `/tasks/${taskId}`
  const agent = String(event.agentName ?? '').trim()
  const summary = String(event.summary ?? '').trim()

  const max = Number.isFinite(settings.maxPerMinute) ? settings.maxPerMinute : DEFAULT_MAX_PER_MINUTE
  const burst = recentWithin(settings.recent, now, DIGEST_WINDOW_MS)
  if (burst.length >= max) {
    return {
      key,
      kind: 'digest',
      title: 'digestTitle',
      body: String(burst.length + 1),
      link: '/tasks',
      system: false,
    }
  }

  return {
    key,
    kind,
    title: `notify${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
    body: summary || agent || taskId,
    link,
    system: settings.enabled !== false && !(Number.isFinite(settings.quietUntil) && now < settings.quietUntil),
  }
}

/** Applies one decision to the seen map, returning a fresh object. */
export function markSeen(seen, key, now) {
  return { ...(seen || {}), [key]: now }
}

/** Drops idempotency entries that can no longer matter. */
export function pruneSeen(seen, now, windowMs = IDEMPOTENT_WINDOW_MS) {
  const out = {}
  for (const [key, at] of Object.entries(seen || {})) {
    if (Number.isFinite(at) && now - at < windowMs) out[key] = at
  }
  return out
}
