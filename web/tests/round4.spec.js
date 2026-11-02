// @vitest-environment jsdom
// The six surfaces the round-4 review found unwired, one describe each.
//
// api.js is mocked wholesale, so these cases are about the wiring itself: does
// the screen ask for the endpoint, does it render what came back, and does it
// say something useful when the answer is an error. Each case has both paths,
// because "renders the happy answer" alone is what let the orphans hide.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountWith } from './helpers/vue-utils.js'
import { setLang } from '../src/lib/use-copy.js'

vi.mock('../src/lib/api.js')

import {
  listKnowledge, createResource, listResources, getConnectorActions, listConnectors,
  listTasks, listComputers, getComputer, deleteComputer, saveRouterPolicy, listRouterPolicies,
  routerStats, listRouterTriggers, listRouterTickets, listSchedules,
  getRouterTrigger, getRouterTicket, dropRouterSubscription, getThread, subscribeThreadEvents,
  subscribeRouterEvents,
} from '../src/lib/api.js'
import KnowledgeView from '../src/views/KnowledgeView.vue'
import OrgView from '../src/views/OrgView.vue'
import ConnectorsView from '../src/views/ConnectorsView.vue'
import ComputersView from '../src/views/ComputersView.vue'
import SchedulesView from '../src/views/SchedulesView.vue'
import ThreadView from '../src/views/ThreadView.vue'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  window.localStorage.clear()
  listKnowledge.mockResolvedValue([])
  listResources.mockResolvedValue({ resources: [] })
  listConnectors.mockResolvedValue([])
  listTasks.mockResolvedValue({ tasks: [] })
  listComputers.mockResolvedValue([])
  listSchedules.mockResolvedValue({ schedules: [] })
  routerStats.mockResolvedValue({})
  listRouterTriggers.mockResolvedValue({ triggers: [] })
  listRouterTickets.mockResolvedValue({ tickets: [] })
  listRouterPolicies.mockResolvedValue({ policies: [] })
  getThread.mockResolvedValue({ thread: { ID: '1', Title: 't' }, messages: [] })
  subscribeThreadEvents.mockReturnValue({ close: vi.fn() })
  subscribeRouterEvents.mockReturnValue({ close: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ''
  setLang('en')
})

describe('KnowledgeView', () => {
  it('renders the chunks the agent can quote', async () => {
    listKnowledge.mockResolvedValue([
      { id: 'k1', agentId: 'agent-1', chunkText: 'the refund window is 30 days', sourceRef: 'policy.md' },
    ])
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()

    expect(listKnowledge).toHaveBeenCalled()
    expect(wrapper.text()).toContain('the refund window is 30 days')
    expect(wrapper.text()).toContain('policy.md')
  })

  it('passes the agent filter through on reload', async () => {
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()
    await wrapper.find('input[type="text"]').setValue('agent-9')
    await wrapper.findAll('button').find((b) => b.text() === 'Refresh').trigger('click')
    await flushPromises()
    expect(listKnowledge).toHaveBeenLastCalledWith('agent-9')
  })

  it('says the feature is off instead of showing an empty list', async () => {
    listKnowledge.mockRejectedValue(Object.assign(new Error('off'), { code: 'feature_unavailable' }))
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()
    expect(wrapper.text()).toContain('switched off')
  })

  it('shows the failure for any other error', async () => {
    listKnowledge.mockRejectedValue(new Error('boom'))
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()
    expect(wrapper.text()).toContain('boom')
  })
})

describe('OrgView resource form', () => {
  it('registers a resource and reloads the chart', async () => {
    createResource.mockResolvedValue({ id: 'res-new' })
    const { wrapper } = mountWith(OrgView)
    await flushPromises()

    // Text inputs are name / version / endpoint, in that order.
    const name = wrapper.findAll('input[type="text"]').at(0)
    await name.setValue('my-agent')
    await wrapper.findAll('button').find((b) => b.text() === 'Create').trigger('click')
    await flushPromises()

    expect(createResource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent', name: 'my-agent' }),
    )
    expect(wrapper.text()).toContain('res-new')
    // The chart is re-read after a create, so the new card appears without a reload.
    expect(listResources).toHaveBeenCalledTimes(2)
  })

  it('keeps the form open and prints why the registration failed', async () => {
    createResource.mockRejectedValue(new Error('name taken'))
    const { wrapper } = mountWith(OrgView)
    await flushPromises()

    await wrapper.findAll('input[type="text"]').at(0).setValue('dup')
    await wrapper.findAll('button').find((b) => b.text() === 'Create').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('name taken')
    expect(wrapper.find('input[type="text"]').element.value).toBe('dup')
  })
})

describe('ConnectorsView actions', () => {
  // Seeded through the store's own refresh (listConnectors) rather than by
  // poking state, so the case also proves the screen reads what the store holds.
  function mountWithConnector() {
    listConnectors.mockResolvedValue([{ id: 'mcp-1', name: 'files', policy: 'ask' }])
    return mountWith(ConnectorsView)
  }

  it('lists the declared actions of one connector on demand', async () => {
    getConnectorActions.mockResolvedValue({
      id: 'mcp-1', policy: 'ask', actions: [{ name: 'invoke', description: 'Invoke the connector' }],
    })
    const { wrapper } = mountWithConnector()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Declared actions').trigger('click')
    await flushPromises()

    expect(getConnectorActions).toHaveBeenCalledWith('mcp-1')
    expect(wrapper.text()).toContain('invoke')
    expect(wrapper.text()).toContain('Invoke the connector')
  })

  it('prints the error rather than an empty capability list', async () => {
    getConnectorActions.mockRejectedValue(new Error('connector gone'))
    const { wrapper } = mountWithConnector()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Declared actions').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('connector gone')
  })

  it('collapses on a second click without refetching', async () => {
    getConnectorActions.mockResolvedValue({ id: 'mcp-1', actions: [{ name: 'invoke' }] })
    const { wrapper } = mountWithConnector()
    await flushPromises()

    const button = wrapper.findAll('button').find((b) => b.text() === 'Declared actions')
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.find('.trigger-row').exists()).toBe(true)

    await button.trigger('click')
    await flushPromises()
    // The list is static until the resource is re-registered, so collapsing must
    // not spend another request.
    expect(getConnectorActions).toHaveBeenCalledTimes(1)
  })
})

describe('ComputersView cards', () => {
  it('lists agent computers and deletes one after re-reading it', async () => {
    listComputers.mockResolvedValue([
      { id: 'comp-1', kind: 'shell', status: 'idle', agentId: 'agent-1', lastAction: 'attached' },
    ])
    getComputer.mockResolvedValue({ id: 'comp-1', kind: 'shell', status: 'idle', agentId: 'agent-1' })
    deleteComputer.mockResolvedValue({})
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()

    expect(wrapper.text()).toContain('agent-1')

    await wrapper.findAll('button').find((b) => b.text() === 'Delete computer').trigger('click')
    await flushPromises()
    expect(getComputer).toHaveBeenCalledWith('comp-1')

    // The confirm button and the card button share a label; the dialog's is last.
    const confirm = wrapper.findAll('button').filter((b) => b.text() === 'Delete computer').at(-1)
    await confirm.trigger('click')
    await flushPromises()

    expect(deleteComputer).toHaveBeenCalledWith('comp-1')
    // Deleting reloads the list, so the card disappears without a refresh.
    expect(listComputers).toHaveBeenCalledTimes(2)
  })

  it('keeps the card and reports a refused delete', async () => {
    listComputers.mockResolvedValue([{ id: 'comp-2', kind: 'shell', status: 'idle', agentId: 'a2' }])
    getComputer.mockResolvedValue({ id: 'comp-2', kind: 'shell', status: 'idle', agentId: 'a2' })
    deleteComputer.mockRejectedValue(new Error('lease stuck'))
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Delete computer').trigger('click')
    await flushPromises()
    const confirm = wrapper.findAll('button').filter((b) => b.text() === 'Delete computer').at(-1)
    await confirm.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('lease stuck')
  })

  it('says the card list is switched off rather than empty', async () => {
    listComputers.mockRejectedValue(Object.assign(new Error('off'), { code: 'feature_unavailable' }))
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()
    expect(wrapper.text()).toContain('switched off')
  })

  it('reports a card list failure', async () => {
    listComputers.mockRejectedValue(new Error('cards unavailable'))
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()
    expect(wrapper.text()).toContain('cards unavailable')
  })

  it('refuses to open the confirm when the card cannot be re-read', async () => {
    listComputers.mockResolvedValue([{ id: 'comp-3', kind: 'shell', status: 'idle' }])
    getComputer.mockRejectedValue(new Error('card gone'))
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Delete computer').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('card gone')
    expect(deleteComputer).not.toHaveBeenCalled()
  })
})

describe('SchedulesView intake policies', () => {
  it('saves a policy through the source-named endpoint', async () => {
    listRouterPolicies.mockResolvedValue({
      policies: [{ source: 'slack', mode: 'off', allow: ['@ops'], keywords: ['refund'], resource: 'agent-1' }],
    })
    saveRouterPolicy.mockResolvedValue({})
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    expect(wrapper.text()).toContain('slack')
    expect(wrapper.text()).toContain('@ops')

    await wrapper.find('select').setValue('candidate')
    await flushPromises()

    // The source travels in the path; the body carries only the editable half.
    expect(saveRouterPolicy).toHaveBeenCalledWith('slack', expect.objectContaining({ mode: 'candidate' }))
  })

  it('expands a trigger into its body and verdict', async () => {
    listRouterTriggers.mockResolvedValue({
      triggers: [{ id: 'trg-1', source: 'slack', disposition: 'routed', at: '2026-11-01T10:00:00Z' }],
    })
    getRouterTrigger.mockResolvedValue({ id: 'trg-1', body: 'please refund order 42', source: 'slack', disposition: 'routed' })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.trigger-row-click').trigger('click')
    await flushPromises()

    expect(getRouterTrigger).toHaveBeenCalledWith('trg-1')
    expect(wrapper.text()).toContain('please refund order 42')

    // Clicking the same row again folds it away instead of fetching it twice.
    await wrapper.find('.trigger-row-click').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('please refund order 42')
    expect(getRouterTrigger).toHaveBeenCalledTimes(1)
  })

  it('reports a refused policy save', async () => {
    listRouterPolicies.mockResolvedValue({ policies: [{ source: 'slack', mode: 'off' }] })
    saveRouterPolicy.mockRejectedValue(new Error('policy rejected'))
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('select').setValue('candidate')
    await flushPromises()

    expect(wrapper.text()).toContain('policy rejected')
  })

  it('reports a trigger whose detail cannot be read', async () => {
    listRouterTriggers.mockResolvedValue({ triggers: [{ id: 'trg-2', source: 'slack' }] })
    getRouterTrigger.mockRejectedValue(new Error('trigger evicted'))
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.trigger-row-click').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('trigger evicted')
  })

  // A goal's run history needs the whole chain: the goal, the trigger it produced
  // and the ticket that trigger opened.
  function seedGoal() {
    listSchedules.mockResolvedValue({
      schedules: [{ id: 's1', goal: 'refund triage', cronExpr: '0 * * * *', enabled: true }],
    })
    listRouterTriggers.mockResolvedValue({ triggers: [{ id: 'trg-1', source: 'cron', sourceId: 's1' }] })
    listRouterTickets.mockResolvedValue({ tickets: [{ id: 'tk-1', originTriggerId: 'trg-1', state: 'completed' }] })
  }

  it('opens a ticket from the run history and collapses it again', async () => {
    seedGoal()
    getRouterTicket.mockResolvedValue({ id: 'tk-1', state: 'completed' })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()
    await wrapper.find('.timeline-node').trigger('click')
    await flushPromises()
    expect(getRouterTicket).toHaveBeenCalledWith('tk-1')
    expect(wrapper.text()).toContain('tk-1')

    await wrapper.find('.timeline-node').trigger('click')
    await flushPromises()
    // Collapsing is local: the detail is dropped, not re-fetched.
    expect(getRouterTicket).toHaveBeenCalledTimes(1)
  })

  it('reports a ticket whose detail cannot be read', async () => {
    seedGoal()
    getRouterTicket.mockRejectedValue(new Error('ticket evicted'))
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()
    await wrapper.find('.timeline-node').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('ticket evicted')
  })

  it('reloads on a live frame instead of waiting for the next poll', async () => {
    let handler = null
    subscribeRouterEvents.mockImplementation((since, h) => {
      handler = h
      return { close: vi.fn() }
    })
    // jsdom has no EventSource; the screen only opens the stream when the browser
    // can actually carry one, so the case has to provide the constructor.
    vi.stubGlobal('EventSource', function EventSource() {})

    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    expect(handler).not.toBeNull()

    const before = listRouterTriggers.mock.calls.length
    handler.event()
    handler.event() // one beat emits several frames; they must collapse into one reload
    await new Promise((resolve) => setTimeout(resolve, 900))
    await flushPromises()

    expect(listRouterTriggers.mock.calls.length).toBe(before + 1)
    wrapper.unmount()
  })
})

describe('ThreadView mention picker and unsubscribe', () => {
  function mountWithThread() {
    getThread.mockResolvedValue({
      thread: { ID: '1', Title: 't' },
      messages: [
        { ID: 'm1', AuthorType: 'agent', AuthorName: 'scout', Body: 'on it' },
        { ID: 'm2', AuthorType: 'agent', AuthorName: 'scribe', Body: 'noted' },
        { ID: 'm3', AuthorType: 'user', AuthorName: 'me', Body: 'hi' },
      ],
    })
    return mountWith(ThreadView, { props: { id: '1' } })
  }

  it('offers the names that have spoken in this thread', async () => {
    const { wrapper } = mountWithThread()
    await flushPromises()

    // "sco" rather than "sc": both scout and scribe spoke here, and the picker
    // matches on substring, so a shorter prefix would legitimately show two.
    await wrapper.find('textarea').setValue('ask @sco')
    await nextTick()

    const items = wrapper.findAll('.mention-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('scout')
  })

  it('completes the handle instead of leaving a half token', async () => {
    const { wrapper } = mountWithThread()
    await flushPromises()

    await wrapper.find('textarea').setValue('ask @sco')
    await nextTick()
    await wrapper.find('.mention-item').trigger('click')
    await nextTick()

    expect(wrapper.find('textarea').element.value).toBe('ask @scout ')
  })

  it('says so when the thread has nobody to mention', async () => {
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await wrapper.find('textarea').setValue('hey @')
    await nextTick()

    expect(wrapper.find('.mention-pop').text()).toContain('Nobody in this thread yet')
  })

  it('unsubscribes the thread from the router', async () => {
    dropRouterSubscription.mockResolvedValue({})
    const { wrapper } = mountWithThread()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Stop delegating').trigger('click')
    await flushPromises()

    expect(dropRouterSubscription).toHaveBeenCalledWith('1')
    // The button goes away once the thread is unsubscribed.
    expect(wrapper.findAll('button').find((b) => b.text() === 'Stop delegating')).toBeUndefined()
  })

  it('treats "no subscription" as done rather than as an error', async () => {
    dropRouterSubscription.mockRejectedValue(Object.assign(new Error('none'), { code: 'not_found' }))
    const { wrapper } = mountWithThread()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Stop delegating').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('none')
  })

  it('prints a real unsubscribe failure instead of pretending it worked', async () => {
    dropRouterSubscription.mockRejectedValue(new Error('router down'))
    const { wrapper } = mountWithThread()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Stop delegating').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('router down')
  })
})
