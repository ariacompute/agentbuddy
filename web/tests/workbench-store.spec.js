import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../src/lib/api.js', () => ({
  getWorkspace: vi.fn(),
  listThreads: vi.fn(),
  listTasks: vi.fn(),
  listChannels: vi.fn(),
  listConnectors: vi.fn(),
  getDeliveries: vi.fn(),
  resumeTask: vi.fn(),
  cancelTask: vi.fn(),
  isAuthError: vi.fn(),
  notifyShell: vi.fn(),
  setTrayBadge: vi.fn(),
  getShellConfig: vi.fn(),
}))

import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import {
  getWorkspace, listThreads, listTasks, listChannels, listConnectors, getDeliveries,
  resumeTask, cancelTask, isAuthError, notifyShell, setTrayBadge, getShellConfig,
} from '../src/lib/api.js'
import { resetShellNotifySettings } from '../src/lib/shell-settings.js'

describe('workbench-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    notifyShell.mockResolvedValue({ ok: true })
  })

  describe('getters', () => {
    it('activeTasks and approvals partition by state', () => {
      const s = useWorkbenchStore()
      s.tasks = [
        { id: 'a', status: { state: 'submitted' } },
        { id: 'b', status: { state: 'input-required' } },
        { id: 'c', status: { state: 'completed' } },
      ]
      expect(s.activeTasks.map((t) => t.id)).toEqual(['a', 'b'])
      expect(s.approvals.map((t) => t.id)).toEqual(['b'])
    })

    it('unreadCount tracks queued notifications', () => {
      const s = useWorkbenchStore()
      expect(s.unreadCount).toBe(0)
      s.notifications = [{ key: 'k' }]
      expect(s.unreadCount).toBe(1)
    })

    it('looks up channels and connectors by id', () => {
      const s = useWorkbenchStore()
      s.channels = [{ id: 'c1' }]
      s.connectors = [{ id: 'm1' }]
      expect(s.channelById('c1')).toEqual({ id: 'c1' })
      expect(s.channelById('nope')).toBeUndefined()
      expect(s.connectorById('m1')).toEqual({ id: 'm1' })
    })
  })

  describe('tray badge', () => {
    it('mirrors the unread count every time it changes', () => {
      const s = useWorkbenchStore()
      s.ingestTask({ id: 't1', status: { state: 'completed' }, resourceId: 'agent' }, 1_000_000)
      expect(setTrayBadge).toHaveBeenLastCalledWith(1)

      s.ingestTask({ id: 't2', status: { state: 'failed' }, resourceId: 'agent' }, 1_000_001)
      expect(setTrayBadge).toHaveBeenLastCalledWith(2)

      s.markAllRead()
      expect(s.notifications).toHaveLength(0)
      expect(setTrayBadge).toHaveBeenLastCalledWith(0)

      s.ingestTask({ id: 't3', status: { state: 'completed' }, resourceId: 'agent' }, 1_000_002)
      s.clearNotifications()
      expect(setTrayBadge).toHaveBeenLastCalledWith(0)
    })

    it('does not turn a shell refusal into an unhandled rejection', async () => {
      // A plain web build has no /__shell/badge; the push is fire-and-forget.
      setTrayBadge.mockRejectedValueOnce(new Error('no shell'))
      const s = useWorkbenchStore()
      s.markAllRead()
      await Promise.resolve()
      await Promise.resolve()
      expect(setTrayBadge).toHaveBeenCalledWith(0)
    })
  })

  describe('ingestTask', () => {
    it('queues a notification for an announced state and marks it seen', () => {
      const s = useWorkbenchStore()
      const now = 1_000_000
      const note = s.ingestTask({ id: 't1', status: { state: 'completed' }, resourceId: 'agent' }, now)
      expect(note).not.toBeNull()
      expect(note.kind).toBe('result')
      expect(note.body).toBe('agent')
      expect(s.notifications).toHaveLength(1)
      expect(s.seen['t1:completed']).toBe(now)
    })

    it('links an input-required task to its thread', () => {
      const s = useWorkbenchStore()
      const note = s.ingestTask({ id: 't1', contextId: 'th1', status: { state: 'input-required' } })
      expect(note.kind).toBe('approval')
      expect(note.link).toBe('/threads/th1')
    })

    it('builds the summary from message parts', () => {
      const s = useWorkbenchStore()
      const note = s.ingestTask({
        id: 't1',
        status: { state: 'completed', message: { parts: [{ text: 'all' }, { text: 'done' }] } },
      })
      expect(note.body).toBe('all done')
    })

    it('does not queue a non-announced state', () => {
      const s = useWorkbenchStore()
      expect(s.ingestTask({ id: 't1', status: { state: 'working' } })).toBeNull()
      expect(s.notifications).toHaveLength(0)
    })

    it('suppresses a repeat within the idempotency window', () => {
      const s = useWorkbenchStore()
      const now = 1_000_000
      expect(s.ingestTask({ id: 't1', status: { state: 'completed' } }, now)).not.toBeNull()
      expect(s.ingestTask({ id: 't1', status: { state: 'completed' } }, now + 1000)).toBeNull()
      expect(s.notifications).toHaveLength(1)
    })

    it('caps the notification list at 50', () => {
      const s = useWorkbenchStore()
      for (let i = 0; i < 60; i++) {
        s.ingestTask({ id: `t${i}`, status: { state: 'completed' }, resourceId: 'a' }, i)
      }
      expect(s.notifications).toHaveLength(50)
    })
  })

  describe('refresh actions', () => {
    it('refreshTasks stores tasks, ingests, and prunes seen', async () => {
      listTasks.mockResolvedValue({ tasks: [{ id: 't1', status: { state: 'completed' } }] })
      const s = useWorkbenchStore()
      s.seen = { 'old:key': 1 }
      await s.refreshTasks()
      expect(s.tasks).toHaveLength(1)
      expect(s.offline).toBe(false)
      expect(s.notifications).toHaveLength(1)
    })

    it('records the machine code when a refresh fails', async () => {
      listThreads.mockRejectedValue({ code: 'service_unavailable' })
      const s = useWorkbenchStore()
      await s.refreshThreads()
      expect(s.errorCode).toBe('service_unavailable')
    })

    it('records the code from a failed task, channel or connector refresh', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = useWorkbenchStore()

      listTasks.mockRejectedValue({ code: 'tasks_down' })
      await s.refreshTasks()
      expect(s.errorCode).toBe('tasks_down')

      listChannels.mockRejectedValue({ code: 'channels_down' })
      await s.refreshChannels()
      expect(s.errorCode).toBe('channels_down')

      listConnectors.mockRejectedValue({ code: 'connectors_down' })
      await s.refreshConnectors()
      expect(s.errorCode).toBe('connectors_down')

      consoleError.mockRestore()
    })

    it('keeps the channel list when only one delivery read fails', async () => {
      // One unreadable delivery history must not blank the whole screen: the
      // channel stays, its deliveries simply stay empty.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      listChannels.mockResolvedValue({ channels: [{ id: 'c1' }, { id: 'c2' }] })
      getDeliveries.mockImplementation(async (id) => {
        if (id === 'c1') throw { code: 'deliveries_down' }
        return { deliveries: [{ id: 'd1' }] }
      })
      const s = useWorkbenchStore()
      await s.refreshChannels()

      expect(s.channels).toHaveLength(2)
      expect(s.deliveries.c1).toBeUndefined()
      expect(s.deliveries.c2).toEqual([{ id: 'd1' }])
      expect(s.errorCode).toBeNull()
      consoleError.mockRestore()
    })

    it('marks authExpired on a 401 but offline on a connectivity failure', async () => {
      const s = useWorkbenchStore()
      isAuthError.mockReturnValue(true)
      getWorkspace.mockRejectedValue({ code: 'unauthenticated', status: 401 })
      await s.refreshWorkspace()
      expect(s.authExpired).toBe(true)
      expect(s.offline).toBe(false)

      isAuthError.mockReturnValue(false)
      getWorkspace.mockRejectedValue({ code: 'service_unavailable', status: 503 })
      await s.refreshWorkspace()
      expect(s.offline).toBe(true)
      expect(s.authExpired).toBe(false)
    })

    it('refreshChannels also loads deliveries per channel', async () => {
      listChannels.mockResolvedValue({ channels: [{ id: 'c1' }] })
      getDeliveries.mockResolvedValue({ deliveries: [{ id: 'd1' }] })
      const s = useWorkbenchStore()
      await s.refreshChannels()
      expect(s.channels).toHaveLength(1)
      expect(s.deliveries['c1']).toEqual([{ id: 'd1' }])
    })

    it('accepts a bare array where the list used to arrive wrapped', async () => {
      // channels, connectors and deliveries come back bare; agents/threads/tasks
      // stay wrapped. A shape change on either side must not blank a screen.
      listChannels.mockResolvedValue([{ id: 'c1' }])
      getDeliveries.mockResolvedValue([{ id: 'd1' }])
      listConnectors.mockResolvedValue([{ id: 'm1' }])
      const s = useWorkbenchStore()
      await s.refreshChannels()
      await s.refreshConnectors()
      expect(s.channels).toEqual([{ id: 'c1' }])
      expect(s.deliveries.c1).toEqual([{ id: 'd1' }])
      expect(s.connectors).toEqual([{ id: 'm1' }])
    })

    it('normalises a receipt to the row shape the rest of the app reads', async () => {
      listChannels.mockResolvedValue([{ id: 'c1' }])
      getDeliveries.mockResolvedValue([{ id: 'd1', createdAt: 42, error: 'invalid_signature' }])
      const s = useWorkbenchStore()
      await s.refreshChannels()
      expect(s.deliveries.c1[0]).toMatchObject({ id: 'd1', at: 42, errorCode: 'invalid_signature' })
    })

    it('prefers the canonical receipt field when both names are present', async () => {
      listChannels.mockResolvedValue([{ id: 'c1' }])
      getDeliveries.mockResolvedValue([
        { id: 'd1', at: 7, createdAt: 1, errorCode: 'kept', error: 'dropped' },
      ])
      const s = useWorkbenchStore()
      await s.refreshChannels()
      expect(s.deliveries.c1[0].at).toBe(7)
      expect(s.deliveries.c1[0].errorCode).toBe('kept')
    })

    it('treats an unusable payload as empty instead of throwing', async () => {
      listChannels.mockResolvedValue(null)
      listConnectors.mockResolvedValue({ items: [] })
      const s = useWorkbenchStore()
      await s.refreshChannels()
      await s.refreshConnectors()
      expect(s.channels).toEqual([])
      expect(s.connectors).toEqual([])
      expect(s.errorCode).toBeNull()
    })

    it('refreshAll fans out to every source', async () => {
      getWorkspace.mockResolvedValue({ agents: [] })
      listThreads.mockResolvedValue({ threads: [] })
      listTasks.mockResolvedValue({ tasks: [] })
      listChannels.mockResolvedValue({ channels: [] })
      listConnectors.mockResolvedValue({ connectors: [] })
      const s = useWorkbenchStore()
      await s.refreshAll()
      expect(s.loading).toBe(false)
      expect(getWorkspace).toHaveBeenCalled()
      expect(listConnectors).toHaveBeenCalled()
    })
  })

  describe('approval actions', () => {
    it('approve resumes with an empty answer', async () => {
      resumeTask.mockResolvedValue(undefined)
      listTasks.mockResolvedValue({ tasks: [] })
      const s = useWorkbenchStore()
      await s.approve('t1')
      expect(resumeTask).toHaveBeenCalledWith('t1', '')
    })

    it('reject cancels the task', async () => {
      cancelTask.mockResolvedValue(undefined)
      listTasks.mockResolvedValue({ tasks: [] })
      const s = useWorkbenchStore()
      await s.reject('t1')
      expect(cancelTask).toHaveBeenCalledWith('t1')
    })
  })

  describe('notification clearing', () => {
    it('markAllRead and clearNotifications both empty the queue', () => {
      const s = useWorkbenchStore()
      s.notifications = [{ key: 'a' }, { key: 'b' }]
      s.seen = { 'k': 1 }
      s.markAllRead()
      expect(s.notifications).toEqual([])
      s.notifications = [{ key: 'c' }]
      s.clearNotifications()
      expect(s.notifications).toEqual([])
      expect(s.seen).toEqual({})
    })
  })

  // The shell has had a working /__shell/notify since F5; nothing ever called
  // it, so "task finished" only ever appeared inside the window the user was
  // already looking at. These cases pin the wiring end (the shell's own branch is
  // covered by cargo tests).
  describe('system notifications', () => {
    beforeEach(() => {
      resetShellNotifySettings()
      notifyShell.mockResolvedValue({ ok: true })
      getShellConfig.mockRejectedValue(Object.assign(new Error('404'), { code: 'not_found' }))
    })

    it('asks the shell for an OS toast with a localised title', () => {
      const s = useWorkbenchStore()
      const now = 2_000_000
      const note = s.ingestTask({ id: 't9', status: { state: 'failed' }, resourceId: 'agent' }, now)

      expect(note.system).toBe(true)
      expect(notifyShell).toHaveBeenCalledTimes(1)
      const payload = notifyShell.mock.calls[0][0]
      expect(payload.link).toBe('/tasks/t9')
      expect(payload.body).toBe('agent')
      // A copy key is not prose: the shell renders whatever it is given.
      expect(payload.title).not.toBe(note.titleKey)
      expect(payload.title.length).toBeGreaterThan(0)
    })

    it('stays in the app during the quiet period', () => {
      const s = useWorkbenchStore()
      const now = 3_000_000
      s.notifySettings = { enabled: true, quietUntil: now + 60_000, quietMinutes: 5, inShell: true }

      const note = s.ingestTask({ id: 't10', status: { state: 'completed' } }, now)

      // Still queued in the centre: quiet means "do not pop up", not "drop it".
      expect(note).not.toBeNull()
      expect(note.system).toBe(false)
      expect(notifyShell).not.toHaveBeenCalled()
    })

    it('does not pop up when the master switch is off', () => {
      const s = useWorkbenchStore()
      s.notifySettings = { enabled: false, quietUntil: 0, quietMinutes: 0, inShell: true }

      s.ingestTask({ id: 't11', status: { state: 'completed' } }, 4_000_000)

      expect(notifyShell).not.toHaveBeenCalled()
    })

    it('survives a shell bridge that throws on the call itself', () => {
      // A preload bridge that is not a promise, or one that throws while
      // marshalling, must not take the poll loop down with it.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      notifyShell.mockImplementation(() => { throw new Error('bridge died') })
      const s = useWorkbenchStore()

      expect(() => s.ingestTask({ id: 't13', status: { state: 'completed' } }, 6_000_000)).not.toThrow()
      expect(s.notifications).toHaveLength(1)
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('survives a shell that refuses or is absent', async () => {
      notifyShell.mockRejectedValue(new Error('no shell'))
      const s = useWorkbenchStore()

      // Not awaited anywhere in the store: a rejection must not become an
      // unhandled rejection or break the ingest.
      expect(() => s.ingestTask({ id: 't12', status: { state: 'completed' } }, 5_000_000)).not.toThrow()
      await Promise.resolve()
      expect(s.notifications).toHaveLength(1)
    })

    it('reads the preferences from the shell and falls back to defaults', async () => {
      const s = useWorkbenchStore()
      await s.refreshNotifySettings()
      // No shell in a browser build: permissive defaults keep the centre alive.
      expect(s.notifySettings).toMatchObject({ enabled: true, quietUntil: 0, inShell: false })

      getShellConfig.mockResolvedValue({ notifyEnabled: false, notifyQuietMinutes: 0 })
      await s.refreshNotifySettings({ force: true })
      expect(s.notifySettings.enabled).toBe(false)
      expect(s.notifySettings.inShell).toBe(true)
    })

    it('turns the quiet minutes into a deadline', async () => {
      getShellConfig.mockResolvedValue({ notifyEnabled: true, notifyQuietMinutes: 10 })
      const s = useWorkbenchStore()
      await s.refreshNotifySettings()

      expect(s.notifySettings.quietMinutes).toBe(10)
      expect(s.notifySettings.quietUntil).toBeGreaterThan(Date.now() + 9 * 60 * 1000)
    })
  })

  // The three list refreshers read `data.<key> || []`. A server that answers 200
  // with no body, or with a shape this client does not recognise, must leave the
  // screen empty rather than setting a collection to undefined — a `v-for` over
  // undefined throws and takes the whole view with it.
  describe('payloads without the collection', () => {
    it('leaves every list empty when the answer carries no keys', async () => {
      getWorkspace.mockResolvedValue({})
      listThreads.mockResolvedValue({})
      listTasks.mockResolvedValue({})
      const s = useWorkbenchStore()

      await s.refreshWorkspace()
      await s.refreshThreads()
      await s.refreshTasks()

      expect(s.agents).toEqual([])
      expect(s.threads).toEqual([])
      expect(s.tasks).toEqual([])
      // An empty answer is still a successful one: no banner.
      expect(s.offline).toBe(false)
      expect(s.errorCode).toBeNull()
    })

    it('announces the raw key when the copy table has no sentence for it', async () => {
      const s = useWorkbenchStore()

      s.announce({ titleKey: 'notAKeyInAnyTable', body: 'body', link: '/threads/1' })
      await Promise.resolve()

      expect(notifyShell).toHaveBeenCalledWith({
        title: 'notAKeyInAnyTable',
        body: 'body',
        link: '/threads/1',
      })
    })

    it('still decides a task when the shell settings were never loaded', async () => {
      const s = useWorkbenchStore()
      // A plain web build never reaches /__shell, so the settings are absent.
      s.notifySettings = null

      const note = s.ingestTask({ id: 'task-null-settings', status: { state: 'failed' } })

      expect(note).toBeTruthy()
      expect(note.link).toBe('/tasks/task-null-settings')
      expect(note.system).toBe(true)
    })
  })
})
