// The connector action gateway, kept free of Vue and of the network so the
// whole decision can be tested on its own.
//
// Policies: 'allowed' runs, 'ask' parks the task for a human, 'off' refuses.
// The default is 'off' — nothing an application connector can do is permitted
// until somebody says so.

export const POLICIES = ['off', 'ask', 'allowed']

export const POLICY_OFF = 'off'
export const POLICY_ASK = 'ask'
export const POLICY_ALLOWED = 'allowed'

const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

/** Normalises whatever the server sent into one of the three policies. */
export function normalisePolicy(policy) {
  const value = String(policy ?? '').trim().toLowerCase()
  return POLICIES.includes(value) ? value : POLICY_OFF
}

/** Does this action need a human before it runs? */
export function needsApproval(policy) {
  return normalisePolicy(policy) === POLICY_ASK
}

/** Is this action permitted at all? */
export function isAllowed(policy) {
  return normalisePolicy(policy) !== POLICY_OFF
}

/**
 * Decides what to do with one action.
 * @returns {{ok: true, park: boolean} | {ok: false, code: string}}
 */
export function decideAction(policy, action) {
  const name = String(action ?? '').trim()
  if (!name) return { ok: false, code: 'bad_request' }
  if (RESERVED.has(name.toLowerCase())) return { ok: false, code: 'connector_action_denied' }
  const resolved = normalisePolicy(policy)
  if (resolved === POLICY_OFF) return { ok: false, code: 'connector_policy_off' }
  return { ok: true, park: resolved === POLICY_ASK }
}

/** The state the UI should show for a task produced by an action. */
export function actionOutcome(state) {
  if (state === 'input-required') return 'parked'
  if (state === 'failed') return 'failed'
  if (state === 'completed') return 'done'
  if (state === 'canceled') return 'cancelled'
  if (state === 'working' || state === 'submitted') return 'running'
  return 'unknown'
}
