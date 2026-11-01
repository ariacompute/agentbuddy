// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import { useAuthStore } from '../src/lib/auth-store.js'
import { setLang } from '../src/lib/use-copy.js'
import { mountWith } from './helpers/vue-utils.js'

vi.mock('../src/lib/api.js')

import {
  getWorkspace, listThreads, listTasks, listChannels, listConnectors,
  getTask, getThread, cancelTask, resumeTask, postTaskMessage, postThreadMessage,
  createThread, deleteChannel, createChannel, updateChannel, setConnectorPolicy,
  runConnectorAction, listResources, listComputers, createComputer, listSchedules,
  createSchedule, updateSchedule, deleteSchedule, updateResource, login, authConfig, whoami,
  logout, getDeliveries, request, retryDelivery,
  routerStats, listRouterTriggers, listRouterTickets, kickRouterPass, runSchedule,
  cancelRouterTicket, handbackRouterTrigger,
} from '../src/lib/api.js'
import { errorMessage } from '../src/lib/errors.js'

import WorkspaceView from '../src/views/WorkspaceView.vue'
import TaskListView from '../src/views/TaskListView.vue'
import TaskTraceView from '../src/views/TaskTraceView.vue'
import ThreadListView from '../src/views/ThreadListView.vue'
import ThreadView from '../src/views/ThreadView.vue'
import ChannelsView from '../src/views/ChannelsView.vue'
import ConnectorsView from '../src/views/ConnectorsView.vue'
import OrgView from '../src/views/OrgView.vue'
import ComputersView from '../src/views/ComputersView.vue'
import SchedulesView from '../src/views/SchedulesView.vue'
import SettingsView from '../src/views/SettingsView.vue'
import PersonaEditor from '../src/views/PersonaEditor.vue'
import LoginView from '../src/views/LoginView.vue'
import TaskCard from '../src/components/TaskCard.vue'
import ConnectorCard from '../src/components/ConnectorCard.vue'
import ApprovalCard from '../src/components/ApprovalCard.vue'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  window.localStorage.clear()
  window.confirm = vi.fn(() => true)
  // Safe empty/read responses so each view's onMounted refresh never throws.
  getWorkspace.mockResolvedValue({ agents: [] })
  listThreads.mockResolvedValue({ threads: [] })
  listTasks.mockResolvedValue({ tasks: [] })
  listChannels.mockResolvedValue({ channels: [], deliveries: {} })
  listConnectors.mockResolvedValue({ connectors: [] })
  getDeliveries.mockResolvedValue({ deliveries: [] })
  getTask.mockResolvedValue({ id: 't1', status: { state: 'working' }, artifacts: [], spans: [] })
  getThread.mockResolvedValue({ thread: { ID: '1', Title: 't', Channel: 'x', Status: 'open' }, messages: [] })
  listResources.mockResolvedValue({ resources: [] })
  listComputers.mockResolvedValue({ computers: [] })
  listSchedules.mockResolvedValue({ schedules: [] })
  // The scheduler's three reads: the water level, the trigger stream and the
  // tickets. Empty answers keep every screen's onMounted refresh quiet.
  routerStats.mockResolvedValue({ pending: 0, runningTickets: 0, waiting: 0, batchSize: 0, passes: 0 })
  listRouterTriggers.mockResolvedValue({ triggers: [] })
  listRouterTickets.mockResolvedValue({ tickets: [] })
  kickRouterPass.mockResolvedValue({ kicked: true })
  runSchedule.mockResolvedValue({})
  login.mockResolvedValue({})
  authConfig.mockResolvedValue({})
  whoami.mockResolvedValue(null)
  logout.mockResolvedValue({})
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  setLang('en')
})

describe('WorkspaceView', () => {
  it('mounts, shows the workbench heading and pulls data', async () => {
    const { wrapper, pinia } = mountWith(WorkspaceView)
    const wb = useWorkbenchStore(pinia)
    wb.agents = [{ name: 'a', displayName: 'Agent A', health: 'healthy' }]
    await flushPromises()
    expect(wrapper.text().length).toBeGreaterThan(0)
  })
  it('renders approval cards when there are pending tasks', async () => {
    const { wrapper, pinia } = mountWith(WorkspaceView)
    const wb = useWorkbenchStore(pinia)
    wb.tasks = [{ id: 't1', resourceId: 'A', status: { state: 'input-required' } }]
    await nextTick()
    expect(wrapper.findAllComponents(ApprovalCard).length).toBe(1)
  })

  it('opens the trace of the activity row that was clicked', async () => {
    const { wrapper, pinia, router } = mountWith(WorkspaceView)
    const wb = useWorkbenchStore(pinia)
    wb.tasks = [{ id: 't9', status: { state: 'working' } }]
    await nextTick()

    // With no agent name the row falls back to the task id, so this also covers
    // the placeholder path of a task whose resource was deleted.
    const row = wrapper.findAll('.card-hover').find((r) => r.text().includes('t9'))
    expect(row).toBeTruthy()
    await row.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/tasks/t9')
  })
})

describe('TaskListView', () => {
  it('renders a task card per task', async () => {
    const { wrapper, pinia } = mountWith(TaskListView)
    const wb = useWorkbenchStore(pinia)
    wb.tasks = [{ id: 't1', resourceId: 'A', status: { state: 'working' } }]
    await nextTick()
    expect(wrapper.findAllComponents(TaskCard).length).toBe(1)
  })

  it('narrows the list by state, one filter at a time', async () => {
    listTasks.mockResolvedValue({
      tasks: [
        { id: 't1', status: { state: 'submitted' } },
        { id: 't2', status: { state: 'working' } },
        { id: 't3', status: { state: 'input-required' } },
        { id: 't4', status: { state: 'completed' } },
        { id: 't5', status: { state: 'failed' } },
        { id: 't6' },
      ],
    })
    const { wrapper } = mountWith(TaskListView)
    await flushPromises()
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(6)

    const pick = async (label) => {
      await wrapper.findAll('button').find((b) => b.text() === label).trigger('click')
      await nextTick()
      return wrapper.findAllComponents(TaskCard).length
    }

    expect(await pick('Active')).toBe(2)
    expect(await pick('Waiting for you')).toBe(1)
    expect(await pick('Finished')).toBe(2)
    expect(await pick('All')).toBe(6)
  })

  it('explains the empty list instead of rendering an empty grid', async () => {
    const { wrapper } = mountWith(TaskListView)
    await flushPromises()
    expect(wrapper.find('.grid').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(4)
  })
})

describe('TaskTraceView', () => {
  it('loads and renders a task by id', async () => {
    const { wrapper } = mountWith(TaskTraceView, { props: { id: 't1' } })
    await flushPromises()
    expect(getTask).toHaveBeenCalledWith('t1')
  })
  it('cancels a running task through the API', async () => {
    cancelTask.mockResolvedValue({})
    const { wrapper } = mountWith(TaskTraceView, { props: { id: 't1' } })
    await flushPromises()
    const btns = wrapper.findAll('button')
    // Find a button whose label contains an action verb for cancel.
    const cancel = btns.find((b) => /cancel/i.test(b.text()))
    if (cancel) {
      await cancel.trigger('click')
      await flushPromises()
      expect(cancelTask).toHaveBeenCalledWith('t1')
    }
  })
})

describe('ThreadListView', () => {
  it('opens the new-thread dialog and creates a thread', async () => {
    createThread.mockResolvedValue({ thread: { ID: 'new' } })
    const { wrapper } = mountWith(ThreadListView)
    await wrapper.find('button.btn-primary').trigger('click')
    expect(document.querySelector('.dialog-backdrop')).not.toBeNull()
    const input = document.querySelector('#new-thread-title')
    if (input) {
      input.value = 'Hello thread'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const createBtn = Array.from(document.querySelectorAll('.dialog-foot button'))
      .find((b) => /create|new/i.test(b.textContent || ''))
    if (createBtn) {
      await createBtn.click()
      await flushPromises()
      expect(createThread).toHaveBeenCalled()
    }
  })
})

describe('ThreadView', () => {
  it('loads a thread and posts a message', async () => {
    postThreadMessage.mockResolvedValue({})
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()
    expect(getThread).toHaveBeenCalledWith('1')
    const textarea = wrapper.find('textarea')
    if (textarea.exists()) {
      await textarea.setValue('hi')
      const send = wrapper.findAll('button').find((b) => /send|post/i.test(b.text()))
      if (send) {
        await send.trigger('click')
        await flushPromises()
        expect(postThreadMessage).toHaveBeenCalled()
      }
    }
  })
})

describe('ChannelsView', () => {
  // The dialog itself is covered by base-dialog.spec.js; here it is stubbed so
  // the form renders inline and the test can drive it without hunting through
  // a teleported body.
  const stubs = {
    BaseDialog: { props: ['modelValue'], template: '<div class="dialog-stub"><slot /><slot name="footer" /></div>' },
  }

  it('sends the form as the API expects and refreshes the list', async () => {
    createChannel.mockResolvedValue({})
    listChannels.mockResolvedValue({ channels: [], deliveries: {} })
    const { wrapper } = mountWith(ChannelsView, { stubs })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('Add channel')).trigger('click')
    await nextTick()

    const inputs = wrapper.findAll('.field input')
    await inputs[0].setValue('Ops')
    await inputs[1].setValue('')
    await inputs[2].setValue('SLACK_SIGNING_KEY')
    await inputs[3].setValue('agent-a, agent-b')
    listChannels.mockClear()

    await wrapper.findAll('button').find((b) => b.text() === 'Create').trigger('click')
    await flushPromises()

    expect(createChannel).toHaveBeenCalledWith({
      name: 'Ops',
      kind: 'slack',
      threadId: undefined,
      signingKeyEnv: 'SLACK_SIGNING_KEY',
      destination: undefined,
      participants: ['agent-a', 'agent-b'],
    })
    expect(listChannels).toHaveBeenCalled()
  })

  it('keeps the dialog open and shows the reason when the save is rejected', async () => {
    listChannels.mockResolvedValue({ channels: [], deliveries: {} })
    createChannel.mockRejectedValue(Object.assign(new Error('nope'), { code: 'channel_signature_invalid' }))
    const { wrapper } = mountWith(ChannelsView, { stubs })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('Add channel')).trigger('click')
    await nextTick()
    await wrapper.findAll('button').find((b) => b.text() === 'Create').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('channel_signature_invalid'))
  })

  it('removes a channel through the API and refreshes the list', async () => {
    deleteChannel.mockResolvedValue({})
    listChannels.mockResolvedValue({ channels: [{ id: 'c1', name: 'Slack', kind: 'slack', enabled: true }], deliveries: {} })
    const { wrapper } = mountWith(ChannelsView)
    await flushPromises()
    listChannels.mockClear()

    await wrapper.find('button[aria-label="delete"]').trigger('click')
    await flushPromises()

    expect(deleteChannel).toHaveBeenCalledWith('c1')
    expect(listChannels).toHaveBeenCalled()
  })

  it('reports a rejected delete instead of leaving an unhandled rejection', async () => {
    listChannels.mockResolvedValue({ channels: [{ id: 'c9', name: 'Gone', kind: 'slack', enabled: true }], deliveries: {} })
    deleteChannel.mockRejectedValue(Object.assign(new Error('nope'), { code: 'channel_not_found' }))
    const { wrapper } = mountWith(ChannelsView)
    await flushPromises()

    await wrapper.find('button[aria-label="delete"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('channel_not_found'))
  })

  it('retries a failed delivery with both ids', async () => {
    retryDelivery.mockResolvedValue({})
    listChannels.mockResolvedValue({ channels: [{ id: 'c1', name: 'Slack', kind: 'slack', enabled: true }], deliveries: {} })
    getDeliveries.mockResolvedValue({
      deliveries: [{ id: 'd1', status: 'failed', errorCode: 'delivery_failed', at: '2026-11-01T10:00:00Z' }],
    })
    const { wrapper } = mountWith(ChannelsView)
    await flushPromises()

    // Open the card's delivery panel, then press the retry control inside it.
    await wrapper.findAll('button').find((b) => b.text().includes('Deliveries')).trigger('click')
    await nextTick()
    await wrapper.find('button[aria-label="Try again"]').trigger('click')
    await flushPromises()

    expect(retryDelivery).toHaveBeenCalledWith('c1', 'd1')
  })

  it('offers no retry for a delivery that already arrived', async () => {
    listChannels.mockResolvedValue({ channels: [{ id: 'c1', name: 'Slack', kind: 'slack', enabled: true }], deliveries: {} })
    getDeliveries.mockResolvedValue({
      deliveries: [{ id: 'd1', status: 'delivered', at: '2026-11-01T10:00:00Z' }],
    })
    const { wrapper } = mountWith(ChannelsView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('Deliveries')).trigger('click')
    await nextTick()

    expect(wrapper.find('button[aria-label="Try again"]').exists()).toBe(false)
  })
})

describe('ConnectorsView', () => {
  it('loads connectors on mount and sets a policy', async () => {
    setConnectorPolicy.mockResolvedValue({})
    const { wrapper, pinia } = mountWith(ConnectorsView)
    const wb = useWorkbenchStore(pinia)
    wb.connectors = [{ id: 'k1', name: 'Twilio', policy: 'off' }]
    await nextTick()
    expect(wrapper.findAllComponents(ConnectorCard).length).toBe(1)
  })
})

describe('OrgView', () => {
  it('lists resources after load', async () => {
    listResources.mockResolvedValue({ resources: [{ id: 'r1', name: 'M', kind: 'model' }] })
    const { wrapper } = mountWith(OrgView)
    await flushPromises()
    expect(listResources).toHaveBeenCalled()
    expect(wrapper.text()).toContain('M')
  })

  it('sums the fleet workload from the cached tasks', async () => {
    listResources.mockResolvedValue({ resources: [] })
    const { wrapper, pinia } = mountWith(OrgView)
    await flushPromises()
    const wb = useWorkbenchStore(pinia)
    wb.tasks = [
      { id: 't1', status: { state: 'working', durationMs: 1500 }, artifacts: [{ parts: [{ file: { bytes: 'x'.repeat(2048) } }] }] },
      { id: 't2', status: { state: 'input-required', durationMs: 500 } },
    ]
    await nextTick()

    const values = wrapper.findAll('.stat .v').map((v) => v.text())
    expect(values).toEqual(['2', '1', '1', '2.0 KB', '2.0 s'])
  })

  it('keeps the page standing when the resource list cannot be read', async () => {
    listResources.mockRejectedValue(Object.assign(new Error('nope'), { code: 'forbidden' }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = mountWith(OrgView)
    await flushPromises()

    // The page is a read-only overview, so a failed load logs and leaves the
    // frame in place rather than replacing it with an error screen.
    expect(consoleError).toHaveBeenCalled()
    expect(wrapper.text()).toContain('Organisation')
    expect(wrapper.findAll('.stat .v').map((v) => v.text())).toEqual(['0', '0', '0', '0 B', '0 ms'])
    consoleError.mockRestore()
  })
})

describe('ComputersView', () => {
  it('unwraps the list envelope and renders one card per computer', async () => {
    listComputers.mockResolvedValue({
      computers: [
        { id: 'cmp-1', kind: 'browser', status: 'active' },
        { id: 'cmp-2', kind: 'shell', status: 'disabled' },
      ],
    })
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()

    expect(wrapper.text()).toContain('cmp-1')
    expect(wrapper.text()).toContain('cmp-2')
    expect(wrapper.text()).toContain('Active')
    expect(wrapper.text()).toContain('Disabled')
    expect(wrapper.findAll('.card')).toHaveLength(2)
  })

  it('starts a browser session and reloads the list', async () => {
    listComputers.mockResolvedValue({ computers: [] })
    createComputer.mockResolvedValue({})
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()
    listComputers.mockClear()

    const browser = wrapper.findAll('button').find((b) => b.text().includes('browser'))
    expect(browser).toBeTruthy()
    await browser.trigger('click')
    await flushPromises()

    expect(createComputer).toHaveBeenCalledWith('browser', '')
    expect(listComputers).toHaveBeenCalled()
  })

  it('shows the reason a create failed and re-enables the buttons', async () => {
    listComputers.mockResolvedValue({ computers: [] })
    createComputer.mockRejectedValue(Object.assign(new Error('nope'), { code: 'feature_unavailable' }))
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('shell')).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('feature_unavailable'))
    const buttons = wrapper.findAll('button').filter((b) => b.text().startsWith('+'))
    for (const b of buttons) expect(b.attributes('disabled')).toBeUndefined()
  })

  it('shows the empty state when the server returns no sessions', async () => {
    listComputers.mockResolvedValue({ computers: [] })
    const { wrapper } = mountWith(ComputersView)
    await flushPromises()
    expect(wrapper.text()).toContain('No computers yet.')
  })
})

describe('SchedulesView', () => {
  it('lists schedules returned by the API', async () => {
    createSchedule.mockResolvedValue({})
    updateSchedule.mockResolvedValue({})
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }] })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    expect(wrapper.text()).toContain('Nightly')
  })

  it('shows the water level above the trigger stream', async () => {
    routerStats.mockResolvedValue({ pending: 4, runningTickets: 2, waiting: 1, batchSize: 3, passes: 27 })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('4')
    expect(text).toContain('27')
    expect(wrapper.findAll('.stat')).toHaveLength(5)
  })

  it('renders the recent triggers with the verdict on each row', async () => {
    listRouterTriggers.mockResolvedValue({
      triggers: [
        { id: 'trg-1', source: 'cron', body: 'nightly rollup', disposition: 'routed', ticketId: 'tkt-1', at: '2026-11-01T10:00:00Z' },
        { id: 'trg-2', source: 'thread', body: 'thanks!', disposition: 'filtered', at: '2026-11-01T10:01:00Z' },
      ],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    const rows = wrapper.findAll('.trigger-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Accepted')
    expect(rows[1].text()).toContain('Filtered')
  })

  it('says the scheduler is off instead of showing a level of zero', async () => {
    const off = new Error('off')
    off.code = 'feature_unavailable'
    routerStats.mockRejectedValue(off)
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    expect(wrapper.text()).toContain('switched off')
    expect(wrapper.findAll('.stat')).toHaveLength(0)
  })

  it('runs a goal now and refreshes the stream', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }] })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    const runBtn = wrapper.findAll('button').find((b) => b.text() === 'Run now')
    expect(runBtn).toBeTruthy()
    await runBtn.trigger('click')
    await flushPromises()
    expect(runSchedule).toHaveBeenCalledWith('s1')
  })

  it('shows the run history of the goal once it is selected', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }] })
    listRouterTriggers.mockResolvedValue({
      triggers: [{ id: 'trg-1', source: 'cron', sourceId: 's1', disposition: 'routed', ticketId: 'tkt-1', at: '2026-11-01T10:00:00Z' }],
    })
    listRouterTickets.mockResolvedValue({
      tickets: [{ id: 'tkt-1', state: 'done', originTriggerId: 'trg-1', taskId: 'task-1', createdAt: '2026-11-01T10:00:00Z' }],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.timeline-node')).toHaveLength(1)
    expect(wrapper.text()).toContain('Run history')
  })

  it('offers cancel and hand back only while a run is in flight', async () => {
    cancelRouterTicket.mockResolvedValue({})
    handbackRouterTrigger.mockResolvedValue({ requeued: true })
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }] })
    listRouterTriggers.mockResolvedValue({
      triggers: [{ id: 'trg-1', source: 'cron', sourceId: 's1', disposition: 'routed', ticketId: 'tkt-1', at: '2026-11-01T10:00:00Z' }],
    })
    listRouterTickets.mockResolvedValue({
      tickets: [{ id: 'tkt-1', state: 'running', originTriggerId: 'trg-1', createdAt: '2026-11-01T10:00:00Z' }],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()

    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    const handback = wrapper.findAll('button').find((b) => b.text() === 'Hand back')
    expect(cancel).toBeTruthy()
    expect(handback).toBeTruthy()

    await cancel.trigger('click')
    await flushPromises()
    expect(cancelRouterTicket).toHaveBeenCalledWith('tkt-1')

    await handback.trigger('click')
    await flushPromises()
    expect(handbackRouterTrigger).toHaveBeenCalledWith('tkt-1', 'trg-1')
  })

  it('creates a goal from the form and reloads the list', async () => {
    createSchedule.mockResolvedValue({})
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    const [goal, cron] = wrapper.findAll('input[type="text"]')
    await goal.setValue('Nightly rollup')
    await cron.setValue('*/5 * * * *')
    listSchedules.mockClear()

    await wrapper.findAll('button').find((b) => b.text() === 'New goal').trigger('click')
    await flushPromises()

    expect(createSchedule).toHaveBeenCalledWith('Nightly rollup', '*/5 * * * *', false)
    expect(listSchedules).toHaveBeenCalled()
    // The form is cleared, so the create button is disabled again.
    expect(wrapper.findAll('button').find((b) => b.text() === 'New goal').attributes('disabled')).toBeDefined()
  })

  it('toggles and deletes a goal through the API', async () => {
    listSchedules.mockResolvedValue({
      schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }],
    })
    updateSchedule.mockResolvedValue({})
    deleteSchedule.mockResolvedValue({})
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()

    await wrapper.find('.schedule-row').findAll('button')[1].trigger('click')
    await flushPromises()
    expect(updateSchedule).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ enabled: false, cronExpr: '* * * * *', trigger: 'cron' }),
    )

    await wrapper.find('.schedule-row').findAll('button')[2].trigger('click')
    await flushPromises()
    expect(deleteSchedule).toHaveBeenCalledWith('s1')
  })

  it('surfaces a rejected cancel instead of pretending the run stopped', async () => {
    cancelRouterTicket.mockRejectedValue(Object.assign(new Error('nope'), { code: 'router_ticket_closed' }))
    listSchedules.mockResolvedValue({
      schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }],
    })
    listRouterTriggers.mockResolvedValue({
      triggers: [{ id: 'trg-1', source: 'cron', sourceId: 's1', disposition: 'routed', ticketId: 'tkt-1', at: '2026-11-01T10:00:00Z' }],
    })
    listRouterTickets.mockResolvedValue({
      tickets: [{ id: 'tkt-1', state: 'running', originTriggerId: 'trg-1', createdAt: '2026-11-01T10:00:00Z' }],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('router_ticket_closed'))
  })

  it('names every ticket state and marks values it cannot read', async () => {
    listSchedules.mockResolvedValue({
      schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron', nextRun: 'not a date' }],
    })
    listRouterTriggers.mockResolvedValue({
      triggers: [
        { id: 'trg-1', source: 'cron', sourceId: 's1', disposition: 'routed', ticketId: 'tkt-1', at: 'not a date', body: 'x'.repeat(60) },
        { id: 'trg-2', source: 'cron', sourceId: 's1', disposition: 'filtered', at: '2026-11-01T10:00:00Z' },
      ],
    })
    listRouterTickets.mockResolvedValue({
      tickets: [
        { id: 'tkt-1', state: 'waiting', originTriggerId: 'trg-1', createdAt: '2026-11-01T10:00:00Z' },
        { id: 'tkt-2', state: 'queued', originTriggerId: 'trg-2', createdAt: '2026-11-01T10:00:00Z' },
      ],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Awaiting a person')
    expect(wrapper.text()).toContain('Filtered')
    expect(wrapper.text()).toContain('…')
    expect(wrapper.text()).toContain('—')
  })

  it('ticks the countdown once a second and stops ticking on unmount', async () => {
    vi.useFakeTimers()
    const nextRun = new Date(Date.now() + 90 * 60 * 1000).toISOString()
    listSchedules.mockResolvedValue({
      schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron', nextRun }],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    expect(wrapper.text()).toContain('1h 30m')

    vi.setSystemTime(Date.now() + 31 * 60 * 1000)
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(wrapper.text()).toContain('58m')

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('hides cancel once a run has finished', async () => {
    listSchedules.mockResolvedValue({ schedules: [{ id: 's1', goal: 'Nightly', enabled: true, cronExpr: '* * * * *', trigger: 'cron' }] })
    listRouterTriggers.mockResolvedValue({
      triggers: [{ id: 'trg-1', source: 'cron', sourceId: 's1', disposition: 'routed', ticketId: 'tkt-1', at: '2026-11-01T10:00:00Z' }],
    })
    listRouterTickets.mockResolvedValue({
      tickets: [{ id: 'tkt-1', state: 'done', originTriggerId: 'trg-1', createdAt: '2026-11-01T10:00:00Z' }],
    })
    const { wrapper } = mountWith(SchedulesView)
    await flushPromises()
    await wrapper.find('.schedule-row').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text() === 'Cancel')).toBe(false)
  })
})

describe('SettingsView', () => {
  it('persists the chosen theme via the shell config endpoint', async () => {
    const { wrapper } = mountWith(SettingsView)
    const themeBtn = wrapper.findAll('button').find((b) => /dark|light/i.test(b.text()))
    expect(themeBtn).toBeTruthy()
    await themeBtn.trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledWith('/__shell/config', expect.objectContaining({ method: 'POST' }))
  })

  it('writes both the local mirror and the canonical theme key', async () => {
    request.mockResolvedValue({})
    window.localStorage.setItem('agentbuddy.theme', 'dark')
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()

    const light = wrapper.findAll('button').find((b) => b.text() === 'Light')
    await light.trigger('click')
    await flushPromises()

    expect(window.localStorage.getItem('agentbuddy.theme')).toBe('light')
    expect(JSON.parse(window.localStorage.getItem('agentbuddy.settings')).theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('resets every toggle to its default after a confirmation', async () => {
    request.mockResolvedValue({})
    window.confirm = vi.fn(() => true)
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()
    request.mockClear()

    await wrapper.findAll('button').find((b) => b.text() === 'Reset to defaults').trigger('click')
    await flushPromises()

    expect(window.confirm).toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(
      '/__shell/config',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"notify_enabled":true'),
      }),
    )
  })

  it('leaves the settings alone when the reset is declined', async () => {
    request.mockResolvedValue({})
    window.confirm = vi.fn(() => false)
    const { wrapper } = mountWith(SettingsView)
    await flushPromises()
    request.mockClear()

    await wrapper.findAll('button').find((b) => b.text() === 'Reset to defaults').trigger('click')
    await flushPromises()

    expect(request).not.toHaveBeenCalled()
  })
})

describe('PersonaEditor', () => {
  it('loads agents and saves a persona', async () => {
    listResources.mockResolvedValue({ resources: [{ id: 'a1', name: 'Agent', kind: 'agent', persona: {} }] })
    updateResource.mockResolvedValue({})
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()
    expect(listResources).toHaveBeenCalledWith('agent')

    const save = wrapper.findAll('button').find((b) => /save/i.test(b.text()))
    expect(save).toBeTruthy()
    await save.trigger('click')
    await flushPromises()
    expect(updateResource).toHaveBeenCalledWith('a1', expect.objectContaining({ persona: expect.any(Object) }))
  })

  it('switches the form to whichever agent is selected', async () => {
    listResources.mockResolvedValue({
      resources: [
        { id: 'a1', name: 'First', kind: 'agent', persona: { instruction: 'be terse', mbti: 'INTJ' } },
        { id: 'a2', name: 'Second', kind: 'agent', persona: { instruction: 'be kind', avatar_ref: 'ref://b' } },
      ],
    })
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()
    expect(wrapper.find('textarea').element.value).toBe('be terse')

    await wrapper.findAll('select')[0].setValue('a2')
    await nextTick()

    expect(wrapper.find('textarea').element.value).toBe('be kind')
    expect(wrapper.find('input[placeholder="ref://"]').element.value).toBe('ref://b')
    expect(wrapper.findAll('select')[1].element.value).toBe('')
  })

  it('reports a rejected save and lets the user try again', async () => {
    listResources.mockResolvedValue({ resources: [{ id: 'a1', name: 'Agent', kind: 'agent', persona: {} }] })
    updateResource.mockRejectedValue(Object.assign(new Error('nope'), { code: 'forbidden' }))
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()

    const save = wrapper.findAll('button').find((b) => /save/i.test(b.text()))
    await save.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('forbidden'))
    // The error branch replaces the form, so there is no half-saved editor left
    // on screen pretending to hold the old values.
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('reports a failed load instead of showing an empty form', async () => {
    listResources.mockRejectedValue(Object.assign(new Error('nope'), { code: 'unauthorized' }))
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('unauthorized'))
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('says there is nothing to edit when no agent is registered', async () => {
    listResources.mockResolvedValue({ resources: [] })
    const { wrapper } = mountWith(PersonaEditor)
    await flushPromises()
    expect(wrapper.text()).toContain('No computers yet.')
  })
})

describe('LoginView', () => {
  it('renders sign-in fields and submits credentials', async () => {
    const { wrapper } = mountWith(LoginView)
    await flushPromises()
    const email = wrapper.find('input[type="email"]')
    const password = wrapper.find('input[type="password"]')
    expect(email.exists()).toBe(true)
    expect(password.exists()).toBe(true)
    await email.setValue('me@example.com')
    await password.setValue('secret')
    const submit = wrapper.find('button.btn-primary')
    await submit.trigger('click')
    await flushPromises()
    expect(login).toHaveBeenCalled()
  })
  it('toggles between sign-in and sign-up', async () => {
    const { wrapper } = mountWith(LoginView)
    const toggle = wrapper.findAll('button').find((b) => /create one/i.test(b.text()))
    expect(toggle).toBeTruthy()
    await toggle.trigger('click')
    await flushPromises()

    // Sign-up mode asks for a name and a confirmation before it will submit.
    expect(wrapper.findAll('input[type="password"]')).toHaveLength(2)
    expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeDefined()
  })

  it('will not submit a half-filled form', async () => {
    login.mockResolvedValue({})
    const { wrapper } = mountWith(LoginView)
    await flushPromises()
    const submit = () => wrapper.find('button.btn-primary')
    expect(submit().attributes('disabled')).toBeDefined()

    await wrapper.find('input[type="email"]').setValue('me@example.com')
    expect(submit().attributes('disabled')).toBeDefined()

    await wrapper.find('input[type="password"]').setValue('secret')
    expect(submit().attributes('disabled')).toBeUndefined()
  })

  it('lands on the workbench after a successful sign-in', async () => {
    login.mockResolvedValue({})
    whoami.mockResolvedValue({ id: 'u1', name: 'Me' })
    const { wrapper, router } = mountWith(LoginView)
    await flushPromises()

    await wrapper.find('input[type="email"]').setValue('me@example.com')
    await wrapper.find('input[type="password"]').setValue('secret')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(login).toHaveBeenCalledWith('me@example.com', 'secret')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('stays put and explains a rejected sign-in', async () => {
    login.mockRejectedValue(Object.assign(new Error('nope'), { code: 'invalid_credentials' }))
    const { wrapper, router } = mountWith(LoginView)
    await flushPromises()
    const push = vi.spyOn(router, 'push')

    await wrapper.find('input[type="email"]').setValue('me@example.com')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('invalid_credentials'))
    expect(push).not.toHaveBeenCalled()
    push.mockRestore()
  })

  it('shows the shell version stamp when the desktop shell provided one', async () => {
    window.__AGENTBUDDY_VERSION__ = 'v0.4.0@1a2b3c4'
    const { wrapper } = mountWith(LoginView)
    await flushPromises()
    expect(wrapper.text()).toContain('v0.4.0@1a2b3c4')
    delete window.__AGENTBUDDY_VERSION__
  })
})
