import { describe, it, expect } from 'vitest'
import {
  POLICY_OFF,
  POLICY_ASK,
  POLICY_ALLOWED,
  normalisePolicy,
  needsApproval,
  isAllowed,
  decideAction,
  actionOutcome,
} from '../src/lib/connector-policy.js'

describe('connector-policy', () => {
  it('normalises to the canonical three values', () => {
    expect(normalisePolicy('ALLOWED')).toBe(POLICY_ALLOWED)
    expect(normalisePolicy(' ask ')).toBe(POLICY_ASK)
    expect(normalisePolicy(null)).toBe(POLICY_OFF)
    expect(normalisePolicy('')).toBe(POLICY_OFF)
    expect(normalisePolicy('bogus')).toBe(POLICY_OFF)
  })

  it('needsApproval only for ask', () => {
    expect(needsApproval('ask')).toBe(true)
    expect(needsApproval('allowed')).toBe(false)
    expect(needsApproval('off')).toBe(false)
    expect(needsApproval('??')).toBe(false)
  })

  it('isAllowed for anything but off', () => {
    expect(isAllowed('off')).toBe(false)
    expect(isAllowed('ask')).toBe(true)
    expect(isAllowed('allowed')).toBe(true)
    expect(isAllowed('bogus')).toBe(false)
  })

  it('decideAction gates and parks correctly', () => {
    expect(decideAction('allowed', 'foo')).toEqual({ ok: true, park: false })
    expect(decideAction('ask', 'foo')).toEqual({ ok: true, park: true })
    expect(decideAction('off', 'foo')).toEqual({ ok: false, code: 'connector_policy_off' })
    expect(decideAction('allowed', '')).toEqual({ ok: false, code: 'bad_request' })
    expect(decideAction('allowed', '__proto__')).toEqual({ ok: false, code: 'connector_action_denied' })
    expect(decideAction('allowed', 'constructor')).toEqual({ ok: false, code: 'connector_action_denied' })
  })

  it('actionOutcome maps protocol states', () => {
    expect(actionOutcome('input-required')).toBe('parked')
    expect(actionOutcome('failed')).toBe('failed')
    expect(actionOutcome('completed')).toBe('done')
    expect(actionOutcome('canceled')).toBe('cancelled')
    expect(actionOutcome('working')).toBe('running')
    expect(actionOutcome('submitted')).toBe('running')
    expect(actionOutcome('nonsense')).toBe('unknown')
  })
})
