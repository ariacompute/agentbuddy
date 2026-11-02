// Workbench store (Pinia). The single source of truth the views read from. It
// pulls from the API and, when a task changes, runs it through the pure
// notification decision so the in-app centre and (via the shell) the OS toast
// stay in sync — without ever holding a timer or DOM reference itself.
import { defineStore } from 'pinia'
import {
  getWorkspace, listThreads, listTasks, listChannels, listConnectors, getDeliveries,
  resumeTask, cancelTask, isAuthError, notifyShell,
} from './api.js'
import { decide, markSeen, pruneSeen } from './notifications.js'
import { loadShellNotifySettings } from './shell-settings.js'
import { useCopy } from './use-copy.js'

// The OS toast needs a sentence, not a copy key, so the store resolves the title
// through the workspace namespace at the moment it announces. Reading the table
// through useCopy keeps it reactive to a language switch.
const workspaceCopy = useCopy('workspace')

const ACTIVE_STATES = ['submitted', 'working', 'input-required']

function isActive(task) {
  return ACTIVE_STATES.includes(task?.status?.state)
}

// Some agenthub collections come back bare (channels, connectors, deliveries)
// and some wrapped in an object (agents, threads, tasks). Accept both: a shape
// change on one side must not silently empty a screen.
function asList(data, key) {
  if (Array.isArray(data)) return data
  return (data && data[key]) || []
}

// A receipt arrives with `createdAt` / `error`; every other row in the app is
// read as `at` / `errorCode`. Normalise once, here, so views stay uniform.
function normalizeDelivery(row) {
  return {
    ...row,
    at: row.at || row.createdAt,
    errorCode: row.errorCode || row.error,
  }
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
    // The shell's notify preferences. Defaults are permissive so the workbench
    // behaves the same when it is not running inside the desktop shell.
    notifySettings: { enabled: true, quietUntil: 0, quietMinutes: 0, inShell: false },
    offline: false,
    // Set when a poll/refresh fails with an auth error (401/403): the server is
    // reachable but the session expired. Drives a "re-login" prompt instead of the
    // misleading "cannot connect to server" offline banner.
    authExpired: false,
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
        this.authExpired = false
      } catch (error) {
        console.error('agentbuddy: workspace refresh failed', error)
        if (isAuthError(error)) {
          this.authExpired = true
          this.offline = false
        } else {
          this.offline = true
          this.authExpired = false
        }
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
        this.channels = asList(data, 'channels')
        for (const c of this.channels) {
          try {
            const d = await getDeliveries(c.id)
            this.deliveries[c.id] = asList(d, 'deliveries').map(normalizeDelivery)
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
        this.connectors = asList(data, 'connectors')
      } catch (error) {
        console.error('agentbuddy: connectors refresh failed', error)
        this.errorCode = error.code
      }
    },

    async refreshAll() {
      this.loading = true
      this.errorCode = null
      this.authExpired = false
      await Promise.all([
        this.refreshWorkspace(),
        this.refreshThreads(),
        this.refreshTasks(),
        this.refreshChannels(),
        this.refreshConnectors(),
      ])
      this.loading = false
    },

    /** Re-reads the shell's notify preferences (quiet period, master switch). */
    async refreshNotifySettings({ force = false } = {}) {
      this.notifySettings = await loadShellNotifySettings({ force })
      return this.notifySettings
    },

    /**
     * Hands one announcement to the desktop shell so it can raise an OS toast.
     * Fire-and-forget by design: the in-app centre already holds the note, a
     * plain web build has no `/__shell`, and the shell answers `{ok:false}` for
     * a perfectly normal "quiet" or "unsupported" case.
     */
    announce(note) {
      try {
        const title = workspaceCopy.t(note.titleKey) || note.titleKey
        // Promise.resolve keeps a shell that answers synchronously (or not at all)
        // from turning a notification into an exception inside the poll loop.
        Promise.resolve(notifyShell({ title, body: note.body, link: note.link })).catch(() => {})
      } catch (error) {
        console.error('agentbuddy: system notification failed', error)
      }
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
      const settings = this.notifySettings || {}
      const decision = decide({
        event,
        seen: this.seen,
        now,
        settings: {
          enabled: settings.enabled !== false,
          quietUntil: settings.quietUntil || 0,
        },
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
      if (note.system) this.announce(note)
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
