// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useAuthStore } from '../src/lib/auth-store.js'
import { setLang } from '../src/lib/use-copy.js'
import { mountWith } from './helpers/vue-utils.js'

vi.mock('../src/lib/api.js')

import {
  getResource, getResourceDistribution, listResources, pushResourceDistribution, updateResource,
} from '../src/lib/api.js'
import { errorMessage } from '../src/lib/errors.js'
import AbilitiesView from '../src/views/AbilitiesView.vue'

const AGENT = {
  id: 'agent_1',
  kind: 'agent',
  name: 'planner',
  display_name: 'Planner',
  status: 'approved',
  visibility: 'public',
  persona: { instructions: 'be terse' },
  health: { status: 'healthy' },
  kind_config: { agent: { mcp: ['mcp_1'], skills: ['skill_1'] } },
}

const WRITER = { id: 'agent_2', kind: 'agent', name: 'writer', display_name: 'Writer', status: 'approved', kind_config: {} }

const PACKAGE = {
  agent_id: 'agent_1',
  mcp: [{ id: 'mcp_1', name: 'search', transport: 'http', url: 'https://mcp.example', env_keys: ['SEARCH_KEY'] }],
  skills: [{ id: 'skill_1', name: 'triage', triggers: ['help'], steps: ['ask', 'answer'], docs_truncated: true }],
  unresolved: ['skill_gone'],
  missing: ['mcp_hidden'],
}

beforeEach(() => {
  vi.clearAllMocks()
  setLang('en')
  listResources.mockImplementation((kind) => {
    if (kind === 'agent') return Promise.resolve({ resources: [AGENT, WRITER] })
    if (kind === 'mcp') return Promise.resolve({ resources: [{ id: 'mcp_1', kind: 'mcp', name: 'search', display_name: 'Search' }] })
    if (kind === 'skill') return Promise.resolve({ resources: [{ id: 'skill_1', kind: 'skill', name: 'triage', display_name: 'Triage' }] })
    return Promise.resolve({ resources: [] })
  })
  getResource.mockResolvedValue({ ...AGENT })
  getResourceDistribution.mockResolvedValue({ ...PACKAGE })
  updateResource.mockImplementation(async (id, body) => ({ ...body, id }))
  pushResourceDistribution.mockResolvedValue({ id: 'task_9' })
})

afterEach(() => {
  document.body.innerHTML = ''
  setLang('en')
})

async function mountView({ write = true } = {}) {
  const ctx = mountWith(AbilitiesView)
  const auth = useAuthStore(ctx.pinia)
  auth.user = { id: 'u1', name: 'Me', permissions: write ? ['resources:write'] : [] }
  await flushPromises()
  return ctx
}

async function selectFirst(wrapper) {
  await wrapper.findAll('.agent-item')[0].trigger('click')
  await flushPromises()
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text() === label)
}

describe('AbilitiesView catalogue', () => {
  it('asks for every agent, mcp server and skill without a page window', async () => {
    await mountView()
    // The management view of the catalogue, exactly like the org screen: no
    // discoverable filter, no paging.
    expect(listResources).toHaveBeenCalledWith('agent', { limit: 0 })
    expect(listResources).toHaveBeenCalledWith('mcp', { limit: 0 })
    expect(listResources).toHaveBeenCalledWith('skill', { limit: 0 })
  })

  it('lists agents with the number of abilities they carry', async () => {
    const { wrapper } = await mountView()
    const items = wrapper.findAll('.agent-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Planner')
    expect(items[0].find('.chip').text()).toBe('2')
    expect(items[1].find('.chip').text()).toBe('0')
  })

  it('filters the list locally instead of asking again', async () => {
    const { wrapper } = await mountView()
    const calls = listResources.mock.calls.length
    await wrapper.find('input[type="search"]').setValue('writ')
    expect(wrapper.findAll('.agent-item')).toHaveLength(1)
    expect(wrapper.find('.agent-item').text()).toContain('Writer')
    expect(listResources).toHaveBeenCalledTimes(calls)
  })

  it('reads the record and the package when an agent is picked', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    expect(getResource).toHaveBeenCalledWith('agent_1')
    expect(getResourceDistribution).toHaveBeenCalledWith('agent_1')
    const text = wrapper.text()
    expect(text).toContain('Search')
    expect(text).toContain('https://mcp.example')
    expect(text).toContain('ask → answer')
    expect(text).toContain('SEARCH_KEY')
    expect(text).toContain('Manual truncated')
    // Both hints are reported, never fatal.
    expect(text).toContain('skill_gone')
    expect(text).toContain('mcp_hidden')
  })

  it('shows the server reason when the record cannot be read', async () => {
    const { wrapper } = await mountView()
    getResource.mockRejectedValueOnce({ code: 'forbidden' })
    await selectFirst(wrapper)
    expect(wrapper.text()).toContain(errorMessage('forbidden'))
  })

  it('shows the server reason when the package cannot be resolved', async () => {
    const { wrapper } = await mountView()
    getResourceDistribution.mockRejectedValueOnce({ code: 'not_found' })
    await selectFirst(wrapper)
    expect(wrapper.text()).toContain(errorMessage('not_found'))
  })
})

describe('AbilitiesView bindings', () => {
  it('saves the whole record with only the two arrays changed', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)

    // Uncheck the MCP server; the skill stays bound.
    await wrapper.findAll('.ability-row input')[0].setValue(false)
    await flushPromises()
    await button(wrapper, 'Save bindings').trigger('click')
    await flushPromises()

    const [id, body] = updateResource.mock.calls[0]
    expect(id).toBe('agent_1')
    expect(body.status).toBe('approved')
    expect(body.persona).toEqual({ instructions: 'be terse' })
    expect(body.visibility).toBe('public')
    expect(body.kind_config.agent.skills).toEqual(['skill_1'])
    expect(body.kind_config.agent.mcp).toBeUndefined()
    expect(wrapper.text()).toContain('Bindings saved')
  })

  it('re-reads the package after a save, because it is derived from the bindings', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    await wrapper.findAll('.ability-row input')[0].setValue(false)
    await flushPromises()
    await button(wrapper, 'Save bindings').trigger('click')
    await flushPromises()
    expect(getResourceDistribution).toHaveBeenCalledTimes(2)
  })

  it('clears every binding', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    await button(wrapper, 'Clear all').trigger('click')
    await flushPromises()
    await button(wrapper, 'Save bindings').trigger('click')
    await flushPromises()
    const body = updateResource.mock.calls[0][1]
    expect('mcp' in body.kind_config.agent).toBe(false)
    expect('skills' in body.kind_config.agent).toBe(false)
  })

  it('offers clearing a record that was only just opened', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    // Nothing was edited yet, so the record is not dirty — but it does carry
    // bindings, and withdrawing all of them has to stay possible.
    expect(button(wrapper, 'Clear all').element.disabled).toBe(false)
  })

  it('does not offer clearing a record with nothing bound', async () => {
    const { wrapper } = await mountView()
    getResource.mockResolvedValueOnce({ ...WRITER })
    await wrapper.findAll('.agent-item')[1].trigger('click')
    await flushPromises()
    expect(button(wrapper, 'Clear all').element.disabled).toBe(true)
  })

  it('keeps an invisible binding visible and removable', async () => {
    const { wrapper } = await mountView()
    // mcp_gone is bound but absent from the candidates: a record the caller may
    // not see, or a binding that predates the picker.
    getResource.mockResolvedValueOnce({ ...AGENT, kind_config: { agent: { mcp: ['mcp_1', 'mcp_gone'], skills: [] } } })
    await selectFirst(wrapper)

    const chips = wrapper.findAll('.ability-chip.is-unresolved')
    expect(chips).toHaveLength(1)
    expect(chips[0].text()).toContain('mcp_gone')

    await chips[0].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.ability-chip.is-unresolved')).toHaveLength(0)
    await button(wrapper, 'Save bindings').trigger('click')
    await vi.waitFor(() => expect(updateResource).toHaveBeenCalledTimes(1))
    expect(updateResource.mock.calls[0][1].kind_config.agent.mcp).toEqual(['mcp_1'])
  })

  it('falls back to the error message when a save has no machine code', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    updateResource.mockRejectedValueOnce({ message: 'save exploded' })
    await wrapper.findAll('.ability-row input')[0].setValue(false)
    await flushPromises()
    await button(wrapper, 'Save bindings').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('save exploded')
  })

  it('shows the server reason when a save is refused', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    updateResource.mockRejectedValueOnce({ code: 'forbidden' })
    await wrapper.findAll('.ability-row input')[0].setValue(false)
    await flushPromises()
    await button(wrapper, 'Save bindings').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(errorMessage('forbidden'))
  })

  it('disables saving and delivering without the write permission', async () => {
    const { wrapper } = await mountView({ write: false })
    await selectFirst(wrapper)
    expect(wrapper.text()).toContain('resources:write')
    expect(button(wrapper, 'Save bindings').element.disabled).toBe(true)
    expect(button(wrapper, 'Deliver to agent').element.disabled).toBe(true)
    expect(wrapper.findAll('.ability-row input')[0].element.disabled).toBe(true)
  })
})

describe('AbilitiesView delivery', () => {
  it('delivers the package and links the task it produced', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    await button(wrapper, 'Deliver to agent').trigger('click')
    await flushPromises()

    expect(pushResourceDistribution).toHaveBeenCalledWith('agent_1')
    const text = wrapper.text()
    expect(text).toContain('Delivered')
    expect(text).toContain('task_9')
    const link = wrapper.findAll('a').find((anchor) => anchor.text() === 'Open task')
    expect(link.attributes('href')).toBe('/tasks/task_9')
  })

  it('shows the server reason when delivery is not wired', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    pushResourceDistribution.mockRejectedValueOnce({ code: 'feature_unavailable' })
    await button(wrapper, 'Deliver to agent').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(errorMessage('feature_unavailable'))
  })

  it('falls back to the error message when delivery has no machine code', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    pushResourceDistribution.mockRejectedValueOnce({ message: 'delivery exploded' })
    await button(wrapper, 'Deliver to agent').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('delivery exploded')
  })
})

describe('AbilitiesView empty and partial states', () => {
  it('reports a refused catalogue once, without the empty hint', async () => {
    listResources.mockImplementationOnce(() => Promise.reject({ code: 'forbidden' }))
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain(errorMessage('forbidden'))
    expect(wrapper.text()).not.toContain('Register an agent in the registry first')
  })

  it('shows the plain message when the catalogue fails without a code', async () => {
    listResources.mockImplementationOnce(() => Promise.reject({ message: 'catalogue down' }))
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('catalogue down')
  })

  it('tells an empty registry apart from an empty search', async () => {
    listResources.mockResolvedValue({ resources: [] })
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('No agents to manage')
    expect(wrapper.text()).toContain('Register an agent in the registry first')
    await wrapper.find('input[type="search"]').setValue('anything')
    expect(wrapper.text()).toContain('No agents to manage')
  })

  it('says nothing matches when the search rules every agent out', async () => {
    const { wrapper } = await mountView()
    await wrapper.find('input[type="search"]').setValue('zzz')
    const text = wrapper.text()
    expect(text).toContain('No agent matches this search')
    expect(text).not.toContain('Register an agent in the registry first')
  })

  it('drops rows of another kind and says there is nothing to bind', async () => {
    listResources.mockImplementation((kind) => {
      if (kind === 'agent') return Promise.resolve({ resources: [AGENT, { id: 'stray', kind: 'mcp' }] })
      if (kind === 'mcp') return Promise.resolve({ resources: [{ id: 'mcp_1', kind: 'skill' }] })
      if (kind === 'skill') return Promise.resolve({ resources: [{ id: 'skill_1', kind: 'agent' }] })
      return Promise.resolve({ resources: [] })
    })
    const { wrapper } = await mountView()
    expect(wrapper.findAll('.agent-item')).toHaveLength(1)
    getResource.mockResolvedValueOnce({ id: 'agent_1', kind: 'agent', name: 'planner', kind_config: {} })
    await selectFirst(wrapper)
    expect(wrapper.findAll('.ability-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('Nothing to bind yet')
  })

  it('falls back from display name to name to id', async () => {
    listResources.mockImplementation((kind) => {
      if (kind === 'agent') {
        return Promise.resolve({
          resources: [
            { id: 'agent_n', kind: 'agent', name: 'solo' },
            { id: 'agent_x', kind: 'agent', health: 'degraded' },
          ],
        })
      }
      return Promise.resolve({ resources: [] })
    })
    const { wrapper } = await mountView()
    await wrapper.find('input[type="search"]').setValue('agent')
    const items = wrapper.findAll('.agent-item')
    expect(items[0].text()).toContain('solo')
    expect(items[1].text()).toContain('agent_x')
    expect(items[1].find('.health-dot').attributes('data-health')).toBe('degraded')
  })

  it('falls back to the error message when reading the record has no code', async () => {
    const { wrapper } = await mountView()
    getResource.mockRejectedValueOnce({ message: 'entry exploded' })
    getResourceDistribution.mockRejectedValueOnce({ message: 'package exploded' })
    await selectFirst(wrapper)
    expect(wrapper.text()).toContain('entry exploded')
    expect(wrapper.text()).toContain('package exploded')
  })

  it('ignores a late answer for an agent that is no longer selected', async () => {
    const { wrapper } = await mountView()
    let resolveEntry
    let resolvePackage
    getResource.mockImplementationOnce(() => new Promise((resolve) => { resolveEntry = resolve }))
    getResource.mockResolvedValueOnce({ ...WRITER })
    getResourceDistribution.mockImplementationOnce(() => new Promise((resolve) => { resolvePackage = resolve }))
    getResourceDistribution.mockResolvedValueOnce({ agent_id: 'agent_2', mcp: [], skills: [] })

    await wrapper.findAll('.agent-item')[0].trigger('click')
    await wrapper.findAll('.agent-item')[1].trigger('click')
    await flushPromises()

    resolveEntry({ ...AGENT, display_name: 'Stale planner' })
    resolvePackage({ ...PACKAGE })
    await flushPromises()

    expect(wrapper.text()).not.toContain('https://mcp.example')
    expect(wrapper.text()).not.toContain('Manual truncated')
  })

  it('leaves the list alone when the server answers with another id', async () => {
    const { wrapper } = await mountView()
    getResource.mockResolvedValueOnce({ ...AGENT, id: 'agent_ghost', display_name: 'Ghost' })
    await selectFirst(wrapper)
    expect(wrapper.findAll('.agent-item')[0].text()).toContain('Planner')
    expect(wrapper.findAll('.agent-item')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Ghost')
  })

  it('reads a package that only carries skills', async () => {
    const { wrapper } = await mountView()
    getResourceDistribution.mockResolvedValueOnce({ agent_id: 'agent_1', skills: [{ id: 'skill_1', name: 'triage' }] })
    await selectFirst(wrapper)
    const text = wrapper.text()
    expect(text).not.toContain('This agent carries no abilities yet')
    expect(text).toContain('triage')
  })

  it('reads an mcp entry that declares nothing but an id', async () => {
    const { wrapper } = await mountView()
    getResourceDistribution.mockResolvedValueOnce({ agent_id: 'agent_1', mcp: [{ id: 'mcp_1' }] })
    await selectFirst(wrapper)
    const text = wrapper.text()
    expect(text).toContain('mcp_1')
    expect(text).toContain('—')
    expect(text).not.toContain('This agent carries no abilities yet')
  })

  it('shows the empty-package note', async () => {
    const { wrapper } = await mountView()
    getResourceDistribution.mockResolvedValueOnce({ agent_id: 'agent_1' })
    await selectFirst(wrapper)
    expect(wrapper.text()).toContain('This agent carries no abilities yet')
  })

  it('renders every declared field of a full package', async () => {
    const { wrapper } = await mountView()
    getResourceDistribution.mockResolvedValueOnce({
      agent_id: 'agent_1',
      mcp: [{
        id: 'mcp_1',
        name: 'search',
        transport: 'stdio',
        command: 'npx search-mcp',
        tool_allowlist: ['query', 'fetch'],
        env_keys: ['SEARCH_KEY'],
        auth_schemes: ['bearer'],
      }],
      skills: [{ id: 'skill_1', name: 'triage', tools: ['ticket.create'] }],
    })
    await selectFirst(wrapper)
    const text = wrapper.text()
    expect(text).toContain('npx search-mcp')
    expect(text).toContain('query, fetch')
    expect(text).toContain('bearer')
    expect(text).toContain('ticket.create')
  })

  it('treats a catalogue answer without lists as empty', async () => {
    listResources.mockResolvedValue({})
    const { wrapper } = await mountView()
    expect(wrapper.findAll('.agent-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('No agents to manage')
  })
})

describe('AbilitiesView guards', () => {
  it('does not save or deliver before an agent is picked', async () => {
    const { wrapper } = await mountView()
    await wrapper.vm.save()
    await wrapper.vm.deliver()
    expect(updateResource).not.toHaveBeenCalled()
    expect(pushResourceDistribution).not.toHaveBeenCalled()
  })

  it('refuses to write without the permission even when called directly', async () => {
    const { wrapper } = await mountView({ write: false })
    await selectFirst(wrapper)
    await wrapper.vm.save()
    await wrapper.vm.deliver()
    expect(updateResource).not.toHaveBeenCalled()
    expect(pushResourceDistribution).not.toHaveBeenCalled()
  })

  it('does not start a second save or delivery while one is running', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)

    let releaseSave
    updateResource.mockImplementationOnce(() => new Promise((resolve) => { releaseSave = resolve }))
    await wrapper.findAll('.ability-row input')[0].setValue(false)
    await flushPromises()
    const saving = button(wrapper, 'Save bindings').trigger('click')
    await wrapper.vm.save()
    expect(updateResource).toHaveBeenCalledTimes(1)
    releaseSave({ ...AGENT, kind_config: { agent: { skills: ['skill_1'] } } })
    await saving
    await flushPromises()

    let releaseDelivery
    pushResourceDistribution.mockImplementationOnce(() => new Promise((resolve) => { releaseDelivery = resolve }))
    const delivering = button(wrapper, 'Deliver to agent').trigger('click')
    await wrapper.vm.deliver()
    expect(pushResourceDistribution).toHaveBeenCalledTimes(1)
    releaseDelivery({ id: 'task_10' })
    await delivering
    await flushPromises()
    expect(wrapper.text()).toContain('task_10')
  })

  it('ignores a repeated click on the already selected agent and an empty id', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    await wrapper.vm.selectAgent('')
    await wrapper.findAll('.agent-item')[0].trigger('click')
    await flushPromises()
    expect(getResource).toHaveBeenCalledTimes(1)
    expect(getResourceDistribution).toHaveBeenCalledTimes(1)
  })

  it('unbinds a skill manual', async () => {
    const { wrapper } = await mountView()
    await selectFirst(wrapper)
    await wrapper.findAll('.ability-row input')[1].setValue(false)
    await flushPromises()
    await button(wrapper, 'Save bindings').trigger('click')
    await flushPromises()
    const body = updateResource.mock.calls.at(-1)[1]
    expect(body.kind_config.agent.mcp).toEqual(['mcp_1'])
    expect(body.kind_config.agent.skills).toBeUndefined()
  })
})
