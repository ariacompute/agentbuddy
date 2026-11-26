import { describe, it, expect } from 'vitest'
import {
  bindingsDiffer, bindingsOf, normalizeRefs, toggleRef, unresolvedRefs, withBindings,
} from '../src/lib/bindings.js'

const entry = () => ({
  id: 'agent_1',
  kind: 'agent',
  name: 'planner',
  display_name: 'Planner',
  status: 'approved',
  visibility: 'public',
  namespace: 'default',
  endpoint: 'https://agent.example',
  persona: { instructions: 'be terse', avatarUrl: 'https://a.example/p.png' },
  metadata: { team: 'ops' },
  health: 'healthy',
  kind_config: {
    agent: { mcp: ['mcp_1'], skills: ['skill_1'], card_url: 'https://agent.example/card', egress_allowlist: ['mcp.example'] },
    sandbox: { provider: 'local' },
  },
})

describe('normalizeRefs', () => {
  it('drops blanks and duplicates while keeping the order', () => {
    expect(normalizeRefs(['b', ' a ', 'b', '', '  ', null, 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('answers an empty list for anything that is not an array', () => {
    expect(normalizeRefs(undefined)).toEqual([])
    expect(normalizeRefs(null)).toEqual([])
    expect(normalizeRefs('mcp_1')).toEqual([])
  })
})

describe('toggleRef', () => {
  it('adds an id at the end and removes it where it was', () => {
    expect(toggleRef(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleRef(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('leaves the selection alone for an empty id', () => {
    expect(toggleRef(['a'], '')).toEqual(['a'])
  })
})

describe('unresolvedRefs', () => {
  it('keeps bound ids that the candidate list does not offer', () => {
    const options = [{ id: 'mcp_1' }, { id: 'mcp_2' }, null]
    expect(unresolvedRefs(['mcp_1', 'mcp_gone', 'mcp_2'], options)).toEqual(['mcp_gone'])
  })

  it('treats a missing candidate list as offering nothing', () => {
    expect(unresolvedRefs(['mcp_1'], undefined)).toEqual(['mcp_1'])
  })
})

describe('withBindings', () => {
  it('changes only the two binding arrays and carries every other field through', () => {
    const body = withBindings(entry(), { mcp: ['mcp_2'], skills: ['skill_1'] })
    expect(body.kind_config.agent.mcp).toEqual(['mcp_2'])
    expect(body.kind_config.agent.skills).toEqual(['skill_1'])
    // Fields the screen never edits must survive a whole-record PUT.
    expect(body.kind_config.agent.card_url).toBe('https://agent.example/card')
    expect(body.kind_config.agent.egress_allowlist).toEqual(['mcp.example'])
    expect(body.kind_config.sandbox).toEqual({ provider: 'local' })
    expect(body.persona).toEqual({ instructions: 'be terse', avatarUrl: 'https://a.example/p.png' })
    expect(body.metadata).toEqual({ team: 'ops' })
    expect(body.visibility).toBe('public')
    expect(body.endpoint).toBe('https://agent.example')
    expect(body.health).toBe('healthy')
  })

  it('states the status instead of letting the namespace default decide', () => {
    // An empty status resolves to "pending" in a reviewed namespace, which would
    // send an approved agent back to the queue on every binding save.
    expect(withBindings({ ...entry(), status: '' }, { mcp: [], skills: [] }).status).toBe('approved')
    expect(withBindings({ ...entry(), status: 'pending' }, { mcp: [], skills: [] }).status).toBe('pending')
  })

  it('removes the keys when a selection is cleared', () => {
    const body = withBindings(entry(), { mcp: [], skills: [] })
    expect(body.kind_config.agent).toEqual({ card_url: 'https://agent.example/card', egress_allowlist: ['mcp.example'] })
    expect('mcp' in body.kind_config.agent).toBe(false)
    expect('skills' in body.kind_config.agent).toBe(false)
  })

  it('builds the agent block when the record has none', () => {
    const bare = { id: 'agent_2', kind: 'agent', name: 'writer', status: 'approved' }
    const body = withBindings(bare, { mcp: ['mcp_1'], skills: ['skill_1'] })
    expect(body.kind_config).toEqual({ agent: { mcp: ['mcp_1'], skills: ['skill_1'] } })
  })

  it('normalizes the selection it is given', () => {
    const body = withBindings(entry(), { mcp: ['mcp_2', ' mcp_2 ', 'mcp_3'], skills: [] })
    expect(body.kind_config.agent.mcp).toEqual(['mcp_2', 'mcp_3'])
  })

  it('refuses to build a body without a record to start from', () => {
    // Saving a half record would replace fields this screen never read.
    expect(() => withBindings(null, { mcp: [], skills: [] })).toThrow()
    expect(() => withBindings({ name: 'no id' }, { mcp: [], skills: [] })).toThrow()
  })

  it('does not mutate the record it was handed', () => {
    const source = entry()
    withBindings(source, { mcp: [], skills: ['skill_2'] })
    expect(source.kind_config.agent.mcp).toEqual(['mcp_1'])
    expect(source.kind_config.agent.skills).toEqual(['skill_1'])
  })
})

describe('bindingsOf and bindingsDiffer', () => {
  it('reads the two arrays an entry carries', () => {
    expect(bindingsOf(entry())).toEqual({ mcp: ['mcp_1'], skills: ['skill_1'] })
    expect(bindingsOf({ id: 'x', kind_config: {} })).toEqual({ mcp: [], skills: [] })
    expect(bindingsOf(null)).toEqual({ mcp: [], skills: [] })
  })

  it('reports a change only when the selection really differs', () => {
    const current = entry()
    expect(bindingsDiffer(current, { mcp: ['mcp_1'], skills: ['skill_1'] })).toBe(false)
    expect(bindingsDiffer(current, { mcp: ['mcp_1', 'mcp_2'], skills: ['skill_1'] })).toBe(true)
    expect(bindingsDiffer(current, { mcp: ['mcp_1'], skills: [] })).toBe(true)
    // Order is part of the stored value, so a reordered list is a change.
    expect(bindingsDiffer(current, { mcp: ['mcp_1'], skills: ['skill_1', 'skill_2'] })).toBe(true)
  })
})
