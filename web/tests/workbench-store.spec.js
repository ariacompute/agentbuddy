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
}))

import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import {
  getWorkspace, listThreads, listTasks, listChannels, listConnectors, getDeliveries,
  resumeTask, cancelTask,
} from '../src/lib/api.js'

describe('workbench-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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

    it('refreshChannels also loads deliveries per channel', async () => {
      listChannels.mockResolvedValue({ channels: [{ id: 'c1' }] })
      getDeliveries.mockResolvedValue({ deliveries: [{ id: 'd1' }] })
      const s = useWorkbenchStore()
      await s.refreshChannels()
      expect(s.channels).toHaveLength(1)
      expect(s.deliveries['c1']).toEqual([{ id: 'd1' }])
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
})
