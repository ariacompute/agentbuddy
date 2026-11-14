// @vitest-environment jsdom
// The arms the view suites never took: payload shapes the screens tolerate but
// were never handed, confirmations that were never cancelled, guards that only
// fire on a second click or on a goal the router already ran past.
//
// These are not new features — every case here is a branch that already existed
// and that a happy-path suite cannot reach. They are grouped per screen so the
// next gap in the same screen lands beside its neighbours.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountWith } from './helpers/vue-utils.js'
import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import { setLang } from '../src/lib/use-copy.js'

vi.mock('../src/lib/api.js')

import {
  listKnowledge, listConnectors, getConnectorActions, listResources, createResource,
  listComputers, getComputer, deleteComputer, createComputer,
  listSchedules, createSchedule, updateSchedule, deleteSchedule, listTasks,
  routerStats, listRouterTriggers, listRouterTickets, listRouterPolicies, saveRouterPolicy,
  getRouterTrigger, getRouterTicket, subscribeRouterEvents,
  sandboxStats, listSandboxes, listSandboxProviders, refreshSandboxProviders, listSandboxNodes,
  getSandbox, execSandbox, renewSandbox, terminateSandbox, listThreads,
  getThread, postThreadMessage, subscribeThreadEvents, dropRouterSubscription,
  checkHealth, request, getWorkspace,
} from '../src/lib/api.js'
import KnowledgeView from '../src/views/KnowledgeView.vue'
import ConnectorsView from '../src/views/ConnectorsView.vue'
import OrgView from '../src/views/OrgView.vue'
import ThreadView from '../src/views/ThreadView.vue'
import SchedulesView from '../src/views/SchedulesView.vue'
import ComputersView from '../src/views/ComputersView.vue'
import SettingsView from '../src/views/SettingsView.vue'
import ThreadListView from '../src/views/ThreadListView.vue'
import LoginView from '../src/views/LoginView.vue'
import PersonaEditor from '../src/views/PersonaEditor.vue'
import NotificationCenter from '../src/components/NotificationCenter.vue'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  window.localStorage.clear()

  getWorkspace.mockResolvedValue({ agents: [] })
  listKnowledge.mockResolvedValue([])
  listConnectors.mockResolvedValue([])
  listResources.mockResolvedValue({ resources: [] })
  listTasks.mockResolvedValue({ tasks: [] })
  listComputers.mockResolvedValue([])
  listSchedules.mockResolvedValue({ schedules: [] })
  routerStats.mockResolvedValue({})
  listRouterTriggers.mockResolvedValue({ triggers: [] })
  listRouterTickets.mockResolvedValue({ tickets: [] })
  listRouterPolicies.mockResolvedValue({ policies: [] })
  saveRouterPolicy.mockResolvedValue({})
  subscribeRouterEvents.mockReturnValue({ close: vi.fn() })
  subscribeThreadEvents.mockReturnValue({ close: vi.fn() })

  sandboxStats.mockResolvedValue({ activeLeases: 0 })
  listSandboxes.mockResolvedValue({ leases: [], default: {} })
  listSandboxProviders.mockResolvedValue({ groups: [], default: 'docker' })
  listSandboxNodes.mockResolvedValue({ nodes: [] })

  getThread.mockResolvedValue({ thread: { ID: '1', Title: 't' }, messages: [] })
  request.mockResolvedValue({})
  checkHealth.mockResolvedValue({ version: '1.0.0', commit: 'abc' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ''
  setLang('en')
})

describe('KnowledgeView payload shapes', () => {
  it('unwraps chunks that arrive under a key, and a chunk without metadata', async () => {
    // The endpoint answers a bare array today; the wrapper is the shape a
    // paginated version would use, and the screen already accepts both.
    listKnowledge.mockResolvedValue({ chunks: [{ id: 'k1', chunkText: 'the refund window is 30 days' }] })
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()

    const cards = wrapper.findAll('article')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('the refund window is 30 days')
    // No agentId and no createdAt: the header row still has to render.
    expect(cards[0].findAll('span')).toHaveLength(0)
  })
})

describe('ConnectorsView expansion bookkeeping', () => {
  it('reads the action list once, however often the row is expanded', async () => {
    listConnectors.mockResolvedValue([{ id: 'mcp-1' }])
    // No id and no actions in the answer: the row falls back to its own id and
    // says what the list would contain rather than rendering an empty <ul>.
    getConnectorActions.mockResolvedValue({ actions: [] })
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    const button = wrapper.findAll('button').find((b) => b.text() === 'Declared actions')
    await button.trigger('click')
    await flushPromises()
    expect(getConnectorActions).toHaveBeenCalledWith('mcp-1')
    // A connector with no name is addressed by id.
    expect(wrapper.text()).toContain('mcp-1')
    expect(wrapper.find('ul.trigger-list').exists()).toBe(false)

    // Collapse and expand again: the second visit reuses the cached list.
    await button.trigger('click')
    await button.trigger('click')
    await flushPromises()
    expect(getConnectorActions).toHaveBeenCalledTimes(1)
  })
})

describe('OrgView form edges', () => {
  it('submits every field and falls back to the typed name when no id comes back', async () => {
    createResource.mockResolvedValue({})
    listResources.mockResolvedValue({})
    const { wrapper } = mountWith(OrgView)
    await flushPromises()

    await wrapper.find('select').setValue('mcp')
    await wrapper.find('input[placeholder="my-agent"]').setValue('my-mcp')
    await wrapper.find('input[placeholder="1.0.0"]').setValue('2.0.0')
    await wrapper.find('input[placeholder="https://"]').setValue('https://example.test/sse')
    await wrapper.findAll('button').find((b) => b.text() === 'Create').trigger('click')
    await flushPromises()

    expect(createResource).toHaveBeenCalledWith({
      kind: 'mcp',
      name: 'my-mcp',
      display_name: 'my-mcp',
      version: '2.0.0',
      endpoint: 'https://example.test/sse',
    })
    // The confirmation names the resource: with no id, the name is the identity.
    expect(wrapper.text()).toContain('my-mcp')
    // …and the re-read answered with no collection at all, so the chart is empty
    // rather than broken.
    expect(wrapper.text()).toContain('Nothing is registered yet.')
  })

  it('ignores a resource whose kind the chart does not know', async () => {
    listResources.mockResolvedValue({ resources: [{ id: 'r1', kind: 'widget', name: 'strange' }] })
    const { wrapper } = mountWith(OrgView)
    await flushPromises()

    // The row lands in its own bucket; the six known columns stay empty and the
    // skills column does not inherit it.
    expect(wrapper.text()).not.toContain('strange')
    expect(wrapper.find('.org-grid').exists()).toBe(true)
  })

  it('says nothing to create without a name and posts nothing', async () => {
    // Whitespace is not a name: the guard trims before it decides, so a form of
    // spaces cannot register a resource called " ".
    const { wrapper } = mountWith(OrgView)
    await flushPromises()
    await wrapper.find('input[placeholder="my-agent"]').setValue('   ')
    await wrapper.findAll('button').find((b) => b.text() === 'Create').trigger('click')
    await flushPromises()

    expect(createResource).not.toHaveBeenCalled()
    expect(wrapper.find('.banner-error').exists()).toBe(false)
  })
})

describe('ThreadView message and subscription edges', () => {
  const thread = (messages) => getThread.mockResolvedValue({ thread: { ID: '1', Title: 't' }, messages })

  it('offers a catalogue entry by id when it has no display name', async () => {
    thread([{ ID: 'm1', AuthorID: 'agent-raw', AuthorName: '', AuthorType: 'agent', Body: 'hi' }])
    // An id-only registry row must still be pickable: an empty label would make
    // a perfectly addressable agent invisible in the picker.
    const agents = [{ id: 'agent-raw' }]
    getWorkspace.mockResolvedValue({ agents })
    const { wrapper, pinia } = mountWith(ThreadView, { props: { id: '1' } })
    useWorkbenchStore(pinia).agents = agents
    await flushPromises()

    await wrapper.find('textarea').setValue('@')
    await flushPromises()
    // The row carries an avatar (its initials) beside the handle.
    expect(wrapper.findAll('.mention-item').map((b) => b.text()).join(' ')).toContain('agent-raw')
  })

  it('refreshes the task list when the server says it delegated the turn', async () => {
    thread([])
    postThreadMessage.mockResolvedValue({ delegated: ['t1'] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()
    // Counted from here: the mount already refreshes once on its own.
    listTasks.mockClear()

    await wrapper.find('textarea').setValue('please handle this')
    await wrapper.findAll('button').find((b) => b.text().includes('Send')).trigger('click')
    await flushPromises()

    expect(listTasks).toHaveBeenCalledTimes(1)
    // The draft is consumed the instant the message is echoed into the stream.
    expect(wrapper.find('textarea').element.value).toBe('')
  })

  it('shows the message the POST returns without leaving the thread', async () => {
    thread([])
    const sent = { ID: 'm-new', AuthorType: 'user', AuthorName: 'me', Body: 'sent right now' }
    postThreadMessage.mockResolvedValueOnce({ message: sent, delegated: [] })
    const firstClose = vi.fn()
    let handlers = null
    subscribeThreadEvents
      .mockReturnValueOnce({ close: firstClose })
      .mockImplementationOnce((id, hs) => {
        handlers = hs
        return { close: vi.fn() }
      })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await wrapper.find('textarea').setValue('sent right now')
    await wrapper.findAll('button').find((b) => b.text().includes('Send')).trigger('click')
    await flushPromises()

    expect(postThreadMessage).toHaveBeenCalledWith('1', 'sent right now', [])
    expect(wrapper.findAll('.msg')).toHaveLength(1)
    expect(wrapper.find('.msg').text()).toContain('sent right now')
    expect(wrapper.find('.msg').classes()).toContain('from-user')
    expect(wrapper.find('textarea').element.value).toBe('')
    // The old stream is closed and a fresh one follows the task this send started.
    expect(firstClose).toHaveBeenCalledTimes(1)
    expect(subscribeThreadEvents).toHaveBeenCalledTimes(2)

    // That fresh stream replays the whole history: the same row must not double up.
    handlers.message(sent)
    await nextTick()
    expect(wrapper.findAll('.msg')).toHaveLength(1)
  })

  it('tolerates a POST answer that carries no body', async () => {
    thread([])
    postThreadMessage.mockResolvedValueOnce(null)
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await wrapper.find('textarea').setValue('no echo')
    await wrapper.findAll('button').find((b) => b.text().includes('Send')).trigger('click')
    await flushPromises()

    // Without a persisted row the echo is the only thing on screen — and the
    // message did go out, so it stays.
    expect(wrapper.findAll('.msg')).toHaveLength(1)
    expect(wrapper.find('.msg').text()).toContain('no echo')
    expect(wrapper.find('textarea').element.value).toBe('')
    expect(subscribeThreadEvents).toHaveBeenCalledTimes(2)
  })

  it('keeps refused sends on screen and explains each failure', async () => {
    thread([])
    postThreadMessage
      .mockRejectedValueOnce(new Error('server refused'))
      .mockRejectedValueOnce({})
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    const sendButton = () => wrapper.findAll('button').find((b) => b.text().includes('Send'))
    await wrapper.find('textarea').setValue('try again')
    await sendButton().trigger('click')
    await flushPromises()

    // The row stays, flagged; the draft was consumed on send, not restored.
    expect(wrapper.findAll('.msg')).toHaveLength(1)
    expect(wrapper.find('.msg').text()).toContain('try again')
    expect(wrapper.text()).toContain('Message not sent')
    expect(wrapper.text()).toContain('server refused')
    expect(wrapper.find('textarea').element.value).toBe('')
    // The failure ends the send: the status line explains it instead of spinning.
    expect(wrapper.find('.messages-status').text()).not.toContain('Sending')

    // A rejection without a message still reaches the screen as text.
    await wrapper.find('textarea').setValue('again')
    await sendButton().trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('[object Object]')
    expect(wrapper.findAll('.msg')).toHaveLength(2)
    expect(wrapper.findAll('.messages-status')).toHaveLength(2)
  })

  it('shows a failure that is neither "gone" nor "switched off"', async () => {
    thread([])
    dropRouterSubscription.mockRejectedValue(new Error('router refused'))
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Stop delegating').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('router refused')
    // The button stays: the thread is still subscribed.
    expect(wrapper.text()).toContain('Stop delegating')
  })

  it('closes the mention picker as soon as the token is no longer being typed', async () => {
    // The picker follows the caret, not a mode: an ordinary sentence must not
    // leave an empty listbox floating over the composer.
    thread([{ ID: 'm1', AuthorID: 'ada', AuthorName: 'ada', AuthorType: 'agent', Body: 'hi' }])
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    const composer = wrapper.find('textarea')
    await composer.setValue('@')
    await flushPromises()
    expect(wrapper.find('.mention-pop').exists()).toBe(true)

    await composer.setValue('@ada hello')
    await flushPromises()
    expect(wrapper.find('.mention-pop').exists()).toBe(false)
  })
})

describe('SchedulesView policy and detail edges', () => {
  it('defaults a policy with no mode to off and saves the mode on change', async () => {
    listRouterPolicies.mockResolvedValue({ policies: [{ source: 'slack' }] })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    const select = wrapper.find('select')
    // No mode on the row: the control shows what the server will do with an
    // unconfigured source, which is to ignore it.
    expect(select.element.value).toBe('off')

    await select.setValue('request_only')
    await flushPromises()

    expect(saveRouterPolicy).toHaveBeenCalledWith('slack', {
      mode: 'request_only',
      allow: [],
      keywords: [],
      resource: '',
    })
  })

  it('renders a goal that has no cron, no last status and is switched off', async () => {
    // A goal created without a schedule, and one the router already ran past:
    // the row must still say something instead of three blanks.
    listSchedules.mockResolvedValue({
      schedules: [{ id: 's1', goal: 'nightly tidy', enabled: false, nextRun: new Date(Date.now() - 60000).toISOString() }],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    const row = wrapper.find('.schedule-row')
    expect(row.text()).toContain('nightly tidy')
    expect(row.text()).toContain('—')
    // Switched off is stated in words, not by a colour.
    expect(row.text()).toContain('Idle')
    // A next run in the past reads as "due now", not a negative countdown.
    expect(row.text()).toContain('Run now')
  })

  it('toggles a goal without a trigger and deletes the selected one', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'g1', enabled: false }] })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').trigger('click')
    expect(wrapper.find('.schedule-row').classes()).toContain('selected')

    await wrapper.findAll('button').find((b) => b.text() === 'Enabled').trigger('click')
    await flushPromises()
    // A goal stored without a trigger is a cron goal: the update says so.
    expect(updateSchedule).toHaveBeenCalledWith('s1', {
      goal: 'g1',
      trigger: 'cron',
      cronExpr: '',
      enabled: true,
    })

    listSchedules.mockResolvedValue({ schedules: [] })
    await wrapper.find('.schedule-row').findAll('button').at(-1).trigger('click')
    await flushPromises()
    expect(deleteSchedule).toHaveBeenCalledWith('s1')
    // Deleting the selected goal closes its run history rather than leaving a
    // panel pointing at something that no longer exists.
    expect(wrapper.text()).not.toContain('Run history')
  })

  it('deselects a goal on a second click and says its history is empty', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'g1' }] })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').trigger('click')
    expect(wrapper.text()).toContain('Run history')
    expect(wrapper.text()).toContain('This goal has not run yet.')

    await wrapper.find('.schedule-row').trigger('click')
    expect(wrapper.text()).not.toContain('Run history')
  })

  it('opens a trigger with no body, a verdict that is not "routed", and closes it', async () => {
    listRouterTriggers.mockResolvedValue({
      triggers: [{ id: 't1', source: 'slack', disposition: 'dropped', at: '2026-05-05T10:00:00Z' }],
    })
    getRouterTrigger.mockResolvedValue({
      id: 't1', source: 'slack', disposition: 'dropped', ticketId: 'tk-1', at: '2026-05-05T10:00:00Z',
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.trigger-row-click').trigger('click')
    await flushPromises()

    expect(getRouterTrigger).toHaveBeenCalledWith('t1')
    // The ticket id is shown so the row can be traced even without a body.
    expect(wrapper.findAll('code').some((c) => c.text() === 'tk-1')).toBe(true)
    // A dropped trigger states the verdict without claiming it was routed.
    expect(wrapper.find('.chip-on').exists()).toBe(false)

    await wrapper.findAll('button').find((b) => b.text() === '×').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('tk-1')
  })

  it('leaves the panel closed when the detail endpoint answers with nothing', async () => {
    listRouterTriggers.mockResolvedValue({ triggers: [{ id: 't1', source: 'slack' }] })
    getRouterTrigger.mockResolvedValue(null)
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.trigger-row-click').trigger('click')
    await flushPromises()

    expect(getRouterTrigger).toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Body')
  })

  it('opens a ticket with attempts and a last error from the run history', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'g1' }] })
    listRouterTriggers.mockResolvedValue({ triggers: [{ id: 't1', sourceId: 's1' }] })
    listRouterTickets.mockResolvedValue({
      tickets: [
        { id: 'tk-1', originTriggerId: 't1', state: 'failed', attempts: 3, lastError: 'model timed out', taskId: 'task-9' },
      ],
    })
    getRouterTicket.mockResolvedValue({
      id: 'tk-1', state: 'failed', attempts: 3, lastError: 'model timed out', taskId: 'task-9',
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()
    await wrapper.find('.timeline-node').trigger('click')
    await flushPromises()

    expect(getRouterTicket).toHaveBeenCalledWith('tk-1')
    expect(wrapper.text()).toContain('model timed out')
    // Attempts are shown as a count, so a retried ticket is recognisable.
    expect(wrapper.text()).toContain('×3')
  })

  it('creates a goal that is switched off from the start', async () => {
    createSchedule.mockResolvedValue({ id: 's9' })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    // The form defaults to disabled. Flip it on and back off so the v-model
    // handler really runs; a bare setValue(false) would be a no-op here.
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('input[type="checkbox"]').setValue(false)
    await wrapper.find('input[placeholder="Goal"]').setValue('weekly tidy')
    await wrapper.findAll('button').find((b) => b.text() === 'New goal').trigger('click')
    await flushPromises()

    expect(createSchedule).toHaveBeenCalledWith('weekly tidy', '', false)
  })

  it('shows a ticket state it does not know verbatim', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'g1' }] })
    listRouterTickets.mockResolvedValue({
      tickets: [{ id: 'tk-1', originTriggerId: 't1', state: 'parked_somewhere', attempts: 0 }],
    })
    listRouterTriggers.mockResolvedValue({ triggers: [{ id: 't1', sourceId: 's1' }] })
    getRouterTicket.mockResolvedValue({ id: 'tk-1', state: 'parked_somewhere' })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()
    await wrapper.find('.timeline-node').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('parked_somewhere')
  })

  it('cancels a pending live refresh when the screen closes', async () => {
    // jsdom has no EventSource; the screen only subscribes when one exists, so
    // the test provides the constructor it is looking for.
    vi.stubGlobal('EventSource', class {})
    let onEvent
    subscribeRouterEvents.mockImplementation((since, handlers) => {
      onEvent = handlers.event
      return { close: vi.fn() }
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    expect(subscribeRouterEvents).toHaveBeenCalled()

    // One beat emits several frames; the first schedules a reload 800ms out.
    onEvent()
    onEvent()
    wrapper.unmount()
    await new Promise((resolve) => setTimeout(resolve, 900))

    // Nothing blew up after unmount, and the reload was dropped with the timer.
    expect(listRouterTriggers).toHaveBeenCalledTimes(1)
  })

  it('treats a stats answer with no body as an empty water level', async () => {
    routerStats.mockResolvedValue(null)
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    const values = wrapper.findAll('.stat-value').map((v) => v.text())
    expect(values.every((v) => v === '0' || v === '')).toBe(true)
  })
})

describe('ComputersView card and dialog edges', () => {
  const stubs = {
    BaseDialog: {
      name: 'BaseDialog',
      props: ['modelValue', 'title'],
      emits: ['update:modelValue'],
      template: '<div v-if="modelValue" class="dialog-stub"><slot /><slot name="footer" /></div>',
    },
  }

  it('labels every card status in words', async () => {
    listComputers.mockResolvedValue([
      { id: 'c1', kind: 'shell', status: 'active' },
      { id: 'c2', kind: 'browser', status: 'disabled' },
      { id: 'c3', kind: 'screen', status: 'paused' },
    ])
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Active')
    expect(text).toContain('Disabled')
    // Anything else is "idle": the vocabulary has three values, not four.
    expect(text).toContain('Idle')
  })

  it('cancels a delete confirmation without calling the endpoint', async () => {
    listComputers.mockResolvedValue([{ id: 'c1', kind: 'shell', status: 'active' }])
    getComputer.mockResolvedValue({ id: 'c1', kind: 'shell', status: 'active' })
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Delete computer').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Delete this computer?')

    await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    await flushPromises()

    expect(deleteComputer).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Delete this computer?')
  })

  it('closes the create dialog from the dialog itself', async () => {
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'New execution environment').trigger('click')
    expect(wrapper.find('.dialog-stub').exists()).toBe(true)

    // Escape and the backdrop both arrive as this event; the screen must not
    // keep a dialog it was told to close.
    wrapper.findComponent({ name: 'BaseDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
  })

  it('counts a node that polled recently as online and one that never did as never', async () => {
    listSandboxNodes.mockResolvedValue({
      nodes: [{ id: 'n1', name: 'laptop', status: 'offline', lastSeenAt: new Date().toISOString() }],
    })
    const first = mountWith(ComputersView, { stubs })
    await flushPromises()
    expect(first.wrapper.text()).toContain('Online')

    listSandboxNodes.mockResolvedValue({ nodes: [{ id: 'n2', name: 'laptop', status: 'offline', lastSeenAt: 'never' }] })
    const second = mountWith(ComputersView, { stubs })
    await flushPromises()
    // A heartbeat that cannot be parsed is "never", and an offline node is not
    // dressed up as online because the timestamp is unreadable.
    expect(second.wrapper.text()).toContain('Never')
    expect(second.wrapper.text()).toContain('Offline')
  })

  it('leases a new environment once, even when the button is pressed twice', async () => {
    let release
    createComputer.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'c9' }) }))
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'New execution environment').trigger('click')
    await wrapper.find('input.mono').setValue('agent-1')
    const leaseButton = wrapper.findAll('button').find((b) => b.text() === 'Lease it')
    await leaseButton.trigger('click')
    await leaseButton.trigger('click')

    expect(createComputer).toHaveBeenCalledTimes(1)
    release()
    await flushPromises()
  })
})

describe('SettingsView shell-absent edges', () => {
  const settingsOf = (wrapper) => wrapper.findAll('input[type="checkbox"]')

  it('falls back to the local mirror when the shell config cannot be read', async () => {
    window.localStorage.setItem(
      'agentbuddy.settings',
      JSON.stringify({ background: false, notify: false, quiet: 15 }),
    )
    request.mockImplementation((path) => {
      if (path === '/__shell/config') return Promise.reject(new Error('no shell'))
      return Promise.resolve({})
    })
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    const [background, notify] = settingsOf(wrapper)
    expect(background.element.checked).toBe(false)
    expect(notify.element.checked).toBe(false)
    expect(wrapper.find('input[type="number"]').element.value).toBe('15')
  })

  it('ignores a local mirror that is not JSON', async () => {
    window.localStorage.setItem('agentbuddy.settings', 'not json at all')
    request.mockImplementation(() => Promise.reject(new Error('no shell')))
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    const [background] = settingsOf(wrapper)
    expect(background.element.checked).toBe(true)
  })

  it('says Unknown when health answers without a version', async () => {
    checkHealth.mockResolvedValue({})
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    expect(wrapper.text().match(/Unknown/g).length).toBeGreaterThanOrEqual(2)
  })

  it('translates a refusal reason and shows an unknown one verbatim', async () => {
    request.mockImplementation((path) => {
      if (path === '/__shell/executor') return Promise.resolve({ status: { lastError: 'unreachable: dial tcp' } })
      return Promise.resolve({})
    })
    const first = mountWith(SettingsView)
    await flushPromises()
    expect(first.wrapper.text()).toContain('The server cannot be reached.')

    request.mockImplementation((path) => {
      if (path === '/__shell/executor') return Promise.resolve({ status: { lastError: 'brand_new_reason' } })
      return Promise.resolve({})
    })
    const second = mountWith(SettingsView)
    await flushPromises()
    expect(second.wrapper.text()).toContain('brand_new_reason')
  })

  it('saves the node with a sane concurrency when the field is cleared', async () => {
    request.mockImplementation((path, options) => {
      if (path === '/__shell/executor' && !options) return Promise.resolve({ status: null })
      if (path === '/__shell/executor') return Promise.resolve({})
      return Promise.resolve({})
    })
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    await wrapper.find('input[type="number"][max="8"]').setValue(0)
    await wrapper.findAll('button').find((b) => b.text() === 'Save').trigger('click')
    await flushPromises()

    const post = request.mock.calls.find(([path, options]) => path === '/__shell/executor' && options)
    expect(post[1].body).toContain('"max_concurrency":1')
    // No status in the answer: the block still confirms the write.
    expect(wrapper.text()).toContain('Saved')
  })

  it('falls back to "choose a server first" when the save fails without a code', async () => {
    request.mockImplementation((path, options) => {
      if (path === '/__shell/executor' && options) return Promise.reject(new Error('no shell'))
      return Promise.resolve({})
    })
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Save').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Choose a server first.')
  })

  it('keeps the local preferences when the shell refuses the write', async () => {
    request.mockImplementation((path, options) => {
      if (path === '/__shell/config' && options) return Promise.reject(new Error('no shell'))
      return Promise.resolve({})
    })
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    const [background] = settingsOf(wrapper)
    await background.setValue(false)
    await flushPromises()

    expect(JSON.parse(window.localStorage.getItem('agentbuddy.settings')).background).toBe(false)
  })
})

describe('ComputersView failures it must report', () => {
  const stubs = {
    BaseDialog: {
      name: 'BaseDialog',
      props: ['modelValue', 'title'],
      emits: ['update:modelValue'],
      template: '<div v-if="modelValue" class="dialog-stub"><slot /><slot name="footer" /></div>',
    },
  }
  const lease = { id: 'sbx-1', provider: 'docker', scope: 'shell', state: 'ready', expiresAt: new Date(Date.now() + 600000).toISOString() }

  // A failure with no machine code carries only prose; the banner shows that
  // prose rather than an empty strip.
  it('shows an unlabelled failure verbatim', async () => {
    listSandboxes.mockRejectedValue(new Error('the store is on fire'))
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    expect(wrapper.text()).toContain('the store is on fire')
  })

  it('reports a failed refresh without emptying the lease list', async () => {
    listSandboxes.mockResolvedValue({ leases: [lease] })
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    // The probe works on mount and fails on the next refresh, which is the only
    // way to tell a refresh failure from an empty screen.
    listSandboxProviders.mockRejectedValue(new Error('provider probe failed'))
    await wrapper.findAll('button').find((b) => b.text() === 'Refresh').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('provider probe failed')
    expect(wrapper.find('.lease-card').exists()).toBe(true)
  })

  it('reads a bare array of computers and falls back to the card when the re-read is empty', async () => {
    listComputers.mockResolvedValue([{ id: 'c1', kind: 'shell', status: 'active' }])
    getComputer.mockResolvedValue(null)
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    expect(wrapper.text()).toContain('c1')
    await wrapper.findAll('button').find((b) => b.text() === 'Delete computer').trigger('click')
    await flushPromises()

    // The stale list copy still describes what will be deleted.
    expect(wrapper.text()).toContain('Delete this computer?')
    expect(wrapper.text()).toContain('c1')
  })

  it('opens an audit whose detail is missing, and one with an untimed record', async () => {
    listSandboxes.mockResolvedValue({ leases: [lease] })
    getSandbox.mockResolvedValue(null)
    const first = mountWith(ComputersView, { stubs })
    await flushPromises()
    await first.wrapper.find('.lease-card').trigger('click')
    await flushPromises()
    expect(first.wrapper.text()).toContain('Execution audit')

    getSandbox.mockResolvedValue({ execs: [{ id: 'e1', command: 'git', args: [], exitCode: 0 }] })
    const second = mountWith(ComputersView, { stubs })
    await flushPromises()
    await second.wrapper.find('.lease-card').trigger('click')
    await flushPromises()
    // A receipt without a timestamp renders an empty cell, not "Invalid Date".
    expect(second.wrapper.text()).toContain('git')
    expect(second.wrapper.text()).not.toContain('Invalid Date')
  })

  it('reports a failed trial, renew and terminate separately', async () => {
    listSandboxes.mockResolvedValue({ leases: [lease] })
    execSandbox.mockRejectedValue(new Error('command refused'))
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Try a command').trigger('click')
    await flushPromises()
    await wrapper.find('input[placeholder="git"]').setValue('git')
    await wrapper.findAll('button').find((b) => b.text() === 'Run').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('command refused')

    renewSandbox.mockRejectedValue(new Error('lease expired'))
    await wrapper.findAll('button').find((b) => b.text() === 'Renew').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('lease expired')

    terminateSandbox.mockRejectedValue(new Error('node went away'))
    await wrapper.findAll('button').find((b) => b.text() === 'Terminate').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').filter((b) => b.text() === 'Terminate').at(-1).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('node went away')
  })

  it('dashes an owner and a backend the lease does not name', async () => {
    listSandboxes.mockResolvedValue({ leases: [{ id: 'sbx-2', provider: 'docker', scope: 'shell', state: 'ready' }] })
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    const card = wrapper.find('.lease-card')
    expect(card.text()).toContain('sbx-2')
    // Two of the three metadata rows have nothing to show, and say so.
    expect(card.text().match(/—/g).length).toBeGreaterThanOrEqual(2)
  })

  it('shows a node that never reported a heartbeat as never', async () => {
    listSandboxNodes.mockResolvedValue({ nodes: [{ id: 'n1', name: 'laptop', status: 'offline' }] })
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    expect(wrapper.text()).toContain('Never')
    expect(wrapper.text()).toContain('Offline')
  })
})

describe('KnowledgeView chunks and OrgView double submit', () => {
  it('accepts a bare array of chunks and a chunk that carries a timestamp', async () => {
    listKnowledge.mockResolvedValue([
      { id: 'k1', chunkText: 'a bare array works too', createdAt: '2026-05-01T10:00:00Z', agentId: 'agent-1' },
    ])
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()

    const card = wrapper.find('article')
    expect(card.text()).toContain('a bare array works too')
    expect(card.text()).toContain('agent-1')
    // The timestamp is rendered as a clock, so a dated chunk is dated.
    expect(card.findAll('span').length).toBeGreaterThan(0)
  })

  it('does not register the same resource twice on a double click', async () => {
    let release
    createResource.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'r1' }) }))
    const { wrapper } = mountWith(OrgView)
    await flushPromises()

    await wrapper.find('input[placeholder="my-agent"]').setValue('twice')
    const create = wrapper.findAll('button').find((b) => b.text() === 'Create')
    await create.trigger('click')
    await create.trigger('click')

    expect(createResource).toHaveBeenCalledTimes(1)
    release()
    await flushPromises()
  })
})

describe('KnowledgeView payloads without a wrapper key', () => {
  it('treats an answer with no chunks key as empty', async () => {
    listKnowledge.mockResolvedValue({})
    const { wrapper } = mountWith(KnowledgeView)
    await flushPromises()

    expect(wrapper.text()).not.toContain('undefined')
    expect(wrapper.findAll('article')).toHaveLength(0)
  })
})

describe('LoginView mode toggle', () => {
  it('goes both ways between sign in and sign up', async () => {
    const { wrapper } = mountWith(LoginView)
    await flushPromises()

    // The toggle names the other form, not the current one.
    const toggle = (label) => wrapper.findAll('button').find((b) => b.text() === label)
    await toggle('No account yet? Create one').trigger('click')
    await flushPromises()
    // Only the sign-up form asks for a name and a confirmation.
    expect(wrapper.findAll('input[type="password"]')).toHaveLength(2)

    await toggle('Already have an account? Sign in').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('input[type="password"]')).toHaveLength(1)
  })
})

describe('PersonaEditor with no agents', () => {
  it('says the catalogue is empty instead of rendering a form bound to nothing', async () => {
    listResources.mockResolvedValue({ resources: [] })
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()

    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
  })
})

describe('ComputersView answers with nothing in them', () => {
  const stubs = {
    BaseDialog: {
      name: 'BaseDialog',
      props: ['modelValue', 'title'],
      emits: ['update:modelValue'],
      template: '<div v-if="modelValue" class="dialog-stub"><slot /><slot name="footer" /></div>',
    },
  }

  it('treats a computers answer with no key as an empty list', async () => {
    listComputers.mockResolvedValue({})
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    expect(wrapper.text()).toContain('No computers yet.')
  })

  it('reports a lease list that fails on refresh, keeping the last good one', async () => {
    const lease = { id: 'sbx-1', provider: 'docker', scope: 'shell', state: 'ready' }
    listSandboxes.mockResolvedValue({ leases: [lease] })
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()
    expect(wrapper.find('.lease-card').exists()).toBe(true)

    listSandboxes.mockRejectedValue(new Error('lease store went away'))
    await wrapper.findAll('button').find((b) => b.text() === 'Refresh').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('lease store went away')
    expect(wrapper.find('.lease-card').exists()).toBe(true)
  })

  it('reports an audit detail that cannot be read', async () => {
    listSandboxes.mockResolvedValue({ leases: [{ id: 'sbx-1', provider: 'docker', scope: 'shell', state: 'ready' }] })
    getSandbox.mockRejectedValue(new Error('audit log unavailable'))
    const { wrapper } = mountWith(ComputersView, { stubs })
    await flushPromises()

    await wrapper.find('.lease-card').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('audit log unavailable')
    // The drawer stays open so the operator can see which lease it is about.
    expect(wrapper.text()).toContain('Execution audit')
  })
})

describe('ThreadView failure without a message', () => {
  it('stringifies a rejection that is not an Error', async () => {
    dropRouterSubscription.mockRejectedValue({})
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Stop delegating').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('[object Object]')
  })
})

describe('ThreadListView dialog', () => {
  it('closes the new-thread dialog from the dialog and from Cancel', async () => {
    listThreads.mockResolvedValue({ threads: [] })
    // The real dialog teleports to <body>; the stub keeps the slot inside the
    // wrapper so the form can be found, and still emits the close event.
    const stubs = {
      BaseDialog: {
        name: 'BaseDialog',
        props: ['modelValue', 'title', 'closeLabel'],
        emits: ['update:modelValue'],
        template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
      },
    }
    const { wrapper } = mountWith(ThreadListView, { stubs })
    await flushPromises()

    const open = wrapper.findAll('button').find((b) => b.text().includes('New'))
    await open.trigger('click')
    await flushPromises()
    expect(wrapper.find('#new-thread-title').exists()).toBe(true)

    wrapper.findComponent({ name: 'BaseDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.find('#new-thread-title').exists()).toBe(false)

    await open.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(wrapper.find('#new-thread-title').exists()).toBe(false)
  })
})

describe('NotificationCenter panel', () => {
  it('closes the panel from its own close button', async () => {
    const { wrapper, pinia } = mountWith(NotificationCenter)
    await flushPromises()
    const wb = useWorkbenchStore(pinia)
    wb.notifications = []

    await wrapper.find('button.btn-icon').trigger('click')
    expect(wrapper.find('.notif-center').exists()).toBe(true)

    const close = wrapper.find('button[aria-label="close"]')
    await close.trigger('click')
    expect(wrapper.find('.notif-center').exists()).toBe(false)
  })
})

// ---- Guards a disabled control cannot reach -------------------------------
// The UI disables its button in exactly the state that would take these
// branches, so trigger('click') never reaches the handler. Calling the handler
// directly proves the guard is a real line of defence rather than dead text.
describe('guards behind disabled controls', () => {
  const dialogStub = {
    BaseDialog: {
      name: 'BaseDialog',
      props: ['modelValue', 'title'],
      emits: ['update:modelValue'],
      template: '<div v-if="modelValue" class="dialog-stub"><slot /><slot name="footer" /></div>',
    },
  }

  it('ComputersView: every early return leaves the endpoint untouched', async () => {
    const { wrapper } = mountWith(ComputersView, { stubs: dialogStub })
    await flushPromises()
    deleteComputer.mockClear()
    getSandbox.mockClear()
    execSandbox.mockClear()
    terminateSandbox.mockClear()

    await wrapper.vm.confirmDeleteCard()   // nothing pending
    await wrapper.vm.refreshAudit()        // no selected lease
    await wrapper.vm.runTrial()            // no lease and no command
    await wrapper.vm.confirmTerminate()    // nothing pending

    expect(deleteComputer).not.toHaveBeenCalled()
    expect(getSandbox).not.toHaveBeenCalled()
    expect(execSandbox).not.toHaveBeenCalled()
    expect(terminateSandbox).not.toHaveBeenCalled()
  })

  it('ComputersView: a second lease request is dropped while one is in flight', async () => {
    let release
    createComputer.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'c9' }) }))
    const { wrapper } = mountWith(ComputersView, { stubs: dialogStub })
    await flushPromises()
    createComputer.mockClear()

    const first = wrapper.vm.create()
    await wrapper.vm.create()
    expect(createComputer).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('ComputersView: a refresh failure without a machine code keeps its message', async () => {
    refreshSandboxProviders.mockRejectedValueOnce(new Error('provider probe failed'))
    const { wrapper } = mountWith(ComputersView, { stubs: dialogStub })
    await flushPromises()
    await wrapper.vm.refresh()
    expect(wrapper.text()).toContain('provider probe failed')
  })

  it('OrgView: an empty name is a no-op even when the form is submitted directly', async () => {
    const { wrapper } = mountWith(OrgView)
    await flushPromises()
    createResource.mockClear()
    await wrapper.vm.submit()
    expect(createResource).not.toHaveBeenCalled()
  })

  it('PersonaEditor: an unknown selection has no form and an empty id cannot save', async () => {
    listResources.mockResolvedValue({ resources: [{ id: 'a1', persona: {} }] })
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()

    wrapper.vm.selectedId = 'ghost'
    await nextTick()
    expect(wrapper.vm.selected).toBeNull()

    // The read-out still offers Edit; the toolbar only exists once inside it.
    await wrapper.findAll('button').find((b) => /^edit/i.test(b.text())).trigger('click')
    // A click that cannot do anything is disabled rather than silently dropped.
    expect(wrapper.findAll('button').find((b) => /save/i.test(b.text())).attributes('disabled')).toBeDefined()

    // Cancelling with nothing selected has no record to reload, and must not throw.
    wrapper.vm.cancelEdit()
    await nextTick()
    expect(wrapper.vm.editing).toBe(false)

    wrapper.vm.selectedId = ''
    await wrapper.vm.save()
    expect(wrapper.vm.saving).toBe(false)
  })

  it('SchedulesView: empty goal, unselected history and a blank ticket state', async () => {
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    createSchedule.mockClear()

    await wrapper.vm.add()
    expect(createSchedule).not.toHaveBeenCalled()
    expect(wrapper.vm.history).toEqual([])
    expect(wrapper.vm.stateLabel('')).toBe('—')
  })

  it('SchedulesView: the enabled checkbox writes back through v-model', async () => {
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    // `enabled` starts false, so setValue(false) alone is a no-op: the cached
    // v-model handler only runs when the checkbox actually changes.
    for (const box of wrapper.findAll('input[type="checkbox"]')) await box.setValue(true)
    expect(wrapper.vm.enabled).toBe(true)
    for (const box of wrapper.findAll('input[type="checkbox"]')) await box.setValue(false)
    expect(wrapper.vm.enabled).toBe(false)
  })

  it('ThreadView: no @ token means no matches and a resubscribe closes the old stream', async () => {
    getThread.mockResolvedValue({ thread: { ID: '1', Title: 't' }, messages: [] })
    const close = vi.fn()
    subscribeThreadEvents.mockReturnValue({ close })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    expect(wrapper.vm.mentionMatches).toEqual([])
    wrapper.vm.subscribe()
    expect(close).toHaveBeenCalledTimes(1)
  })
})


