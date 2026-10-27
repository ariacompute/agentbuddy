// Workbench store (Pinia). The single source of truth the views read from. It
// pulls from the API and, when a task changes, runs it through the pure
// notification decision so the in-app centre and (via the shell) the OS toast
// stay in sync — without ever holding a timer or DOM reference itself.
import { defineStore } from 'pinia'
import {
  getWorkspace, listThreads, listTasks, listChannels, listConnectors, getDeliveries,
  resumeTask, cancelTask,
} from './api.js'
import { decide, markSeen, pruneSeen } from './notifications.js'

const ACTIVE_STATES = ['submitted', 'working', 'input-required']

function isActive(task) {
  return ACTIVE_STATES.includes(task?.status?.state)
}

export const useWorkbenchStore = defineStore('workbench', {
  state: () => ({
    agents: [],
    threads: [],
    tasks: [],
    channels: [],
    connectors: [],
    deliveries: {}, // channelId -> []
    notifications: [],
    seen: {},
    offline: false,
    errorCode: null,
    loading: false,
  }),

  getters: {
    activeTasks: (s) => s.tasks.filter(isActive),
    approvals: (s) => s.tasks.filter((t) => t?.status?.state === 'input-required'),
    unreadCount: (s) => s.notifications.length,
    channelById: (s) => (id) => s.channels.find((c) => c.id === id),
    connectorById: (s) => (id) => s.connectors.find((c) => c.id === id),
  },

  actions: {
    async refreshWorkspace() {
      try {
        const data = await getWorkspace()
        this.agents = data.agents || []
        this.offline = false
      } catch (error) {
        console.error('agentbuddy: workspace refresh failed', error)
        this.offline = true
        this.errorCode = error.code
      }
    },

    async refreshThreads() {
      try {
        const data = await listThreads()
        this.threads = data.threads || []
      } catch (error) {
        console.error('agentbuddy: threads refresh failed', error)
        this.errorCode = error.code
      }
    },

    async refreshTasks() {
      try {
        const data = await listTasks()
        this.tasks = data.tasks || []
        const now = Date.now()
        for (const task of this.tasks) this.ingestTask(task, now)
        this.seen = pruneSeen(this.seen, now)
      } catch (error) {
        console.error('agentbuddy: tasks refresh failed', error)
        this.errorCode = error.code
      }
    },

    async refreshChannels() {
      try {
        const data = await listChannels()
        this.channels = data.channels || []
        for (const c of this.channels) {
          try {
            const d = await getDeliveries(c.id)
            this.deliveries[c.id] = d.deliveries || []
          } catch (error) {
            console.error('agentbuddy: deliveries failed', error)
          }
        }
      } catch (error) {
        console.error('agentbuddy: channels refresh failed', error)
        this.errorCode = error.code
      }
    },

    async refreshConnectors() {
      try {
        const data = await listConnectors()
        this.connectors = data.connectors || []
      } catch (error) {
        console.error('agentbuddy: connectors refresh failed', error)
        this.errorCode = error.code
      }
    },

    async refreshAll() {
      this.loading = true
      this.errorCode = null
      await Promise.all([
        this.refreshWorkspace(),
        this.refreshThreads(),
        this.refreshTasks(),
        this.refreshChannels(),
        this.refreshConnectors(),
      ])
      this.loading = false
    },

    /** Runs one task through the notification decision and queues it if needed. */
    ingestTask(task, now = Date.now()) {
      const event = {
        taskId: task.id,
        state: task?.status?.state,
        threadId: task.contextId,
        agentName: task.resourceId,
        summary: task.status?.message?.parts?.map((p) => p.text).join(' ') || '',
      }
      const decision = decide({
        event,
        seen: this.seen,
        now,
        settings: { enabled: true },
      })
      if (!decision) return null
      const note = {
        key: decision.key,
        kind: decision.kind,
        titleKey: decision.title,
        body: decision.body,
        link: decision.link,
        system: decision.system,
        at: now,
      }
      this.notifications.unshift(note)
      if (this.notifications.length > 50) this.notifications.length = 50
      this.seen = markSeen(this.seen, decision.key, now)
      return note
    },

    markAllRead() {
      this.notifications = []
    },

    clearNotifications() {
      this.notifications = []
      this.seen = {}
    },

    /** Approves an input-required task by resuming it with an empty answer. */
    async approve(taskId) {
      await resumeTask(taskId, '')
      await this.refreshTasks()
    },

    /** Rejects an input-required task by cancelling it. */
    async reject(taskId) {
      await cancelTask(taskId)
      await this.refreshTasks()
    },
  },
})
