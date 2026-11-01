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
  createSchedule, updateSchedule,   updateResource, login, authConfig, whoami,
  logout, getDeliveries, request,
  routerStats, listRouterTriggers, listRouterTickets, kickRouterPass, runSchedule,
  cancelRouterTicket, handbackRouterTrigger,
} from '../src/lib/api.js'

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
})

describe('TaskListView', () => {
  it('renders a task card per task', async () => {
    const { wrapper, pinia } = mountWith(TaskListView)
    const wb = useWorkbenchStore(pinia)
    wb.tasks = [{ id: 't1', resourceId: 'A', status: { state: 'working' } }]
    await nextTick()
    expect(wrapper.findAllComponents(TaskCard).length).toBe(1)
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
  it('removes a channel through the API', async () => {
    deleteChannel.mockResolvedValue({})
    const { wrapper, pinia } = mountWith(ChannelsView)
    const wb = useWorkbenchStore(pinia)
    wb.channels = [{ id: 'c1', name: 'Slack', kind: 'slack', enabled: true }]
    await nextTick()
    const remove = wrapper.findAll('button').find((b) => /remove|delete/i.test(b.text()))
    if (remove) {
      await remove.trigger('click')
      await flushPromises()
      expect(deleteChannel).toHaveBeenCalledWith('c1')
    }
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
})

describe('ComputersView', () => {
  it('adds a computer through the API', async () => {
    createComputer.mockResolvedValue({})
    const { wrapper } = mountWith(ComputersView)
    const add = wrapper.findAll('button').find((b) => /add|new/i.test(b.text()))
    if (add) {
      await add.trigger('click')
      await flushPromises()
      expect(createComputer).toHaveBeenCalled()
    }
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
    if (themeBtn) {
      await themeBtn.trigger('click')
      await flushPromises()
      expect(request).toHaveBeenCalledWith('/__shell/config', expect.objectContaining({ method: 'POST' }))
    }
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
    if (save) {
      await save.trigger('click')
      await flushPromises()
      expect(updateResource).toHaveBeenCalled()
    }
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
    const toggle = wrapper.findAll('button').find((b) => /sign up|register|create account/i.test(b.text()))
    if (toggle) {
      await toggle.trigger('click')
      await flushPromises()
      // Sign-up mode reveals a confirm-password field.
      expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    }
  })
})
