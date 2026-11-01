// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import { mountWith } from './helpers/vue-utils.js'

// The monitor owns timers; the app only decides whether to start one, so the
// spec records the decision instead of letting an interval run in the test.
const monitors = vi.hoisted(() => ({ instances: [] }))

vi.mock('../src/lib/monitor.js', () => ({
  ActivityMonitor: class {
    constructor(store, options) {
      this.store = store
      this.options = options
      this.started = false
      monitors.instances.push(this)
    }

    start() {
      this.started = true
    }

    stop() {
      this.started = false
    }
  },
}))

vi.mock('../src/lib/api.js')

import { getWorkspace, listThreads, listTasks, listChannels, listConnectors, getDeliveries, whoami, logout } from '../src/lib/api.js'
import { useAuthStore } from '../src/lib/auth-store.js'
import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import App from '../src/App.vue'

beforeEach(() => {
  vi.clearAllMocks()
  monitors.instances.length = 0
  window.localStorage.clear()
  getWorkspace.mockResolvedValue({ agents: [] })
  listThreads.mockResolvedValue({ threads: [] })
  listTasks.mockResolvedValue({ tasks: [] })
  listChannels.mockResolvedValue({ channels: [], deliveries: {} })
  listConnectors.mockResolvedValue({ connectors: [] })
  getDeliveries.mockResolvedValue({ deliveries: [] })
  logout.mockResolvedValue({})
})

describe('App shell', () => {
  it('shows the bare router view and no poller while signed out', async () => {
    whoami.mockResolvedValue(null)
    const { wrapper } = mountWith(App)
    await flushPromises()

    expect(wrapper.find('.shell').exists()).toBe(false)
    expect(monitors.instances).toHaveLength(0)
  })

  it('renders the shell and starts the poller once a principal is known', async () => {
    whoami.mockResolvedValue({ id: 'u1', name: 'Me', permissions: [] })
    const { wrapper } = mountWith(App)
    await flushPromises()

    expect(wrapper.find('.shell').exists()).toBe(true)
    expect(monitors.instances).toHaveLength(1)
    const monitor = monitors.instances[0]
    expect(monitor.started).toBe(true)
    // The poller stands down while the window is hidden; jsdom reports visible.
    expect(monitor.options.visible()).toBe(true)
  })

  it('re-checks the principal when a poll reports an expired session', async () => {
    whoami.mockResolvedValue({ id: 'u1', name: 'Me', permissions: [] })
    const { pinia } = mountWith(App)
    await flushPromises()
    const workbench = useWorkbenchStore(pinia)

    // The session survived the failed poll: nothing to do but clear the flag.
    workbench.authExpired = true
    await flushPromises()
    expect(logout).not.toHaveBeenCalled()
    expect(workbench.authExpired).toBe(false)
  })

  it('drops to the login surface when the session really is gone', async () => {
    whoami.mockResolvedValue({ id: 'u1', name: 'Me', permissions: [] })
    const { wrapper, pinia } = mountWith(App)
    await flushPromises()
    expect(wrapper.find('.shell').exists()).toBe(true)

    // The next poll fails with an auth error and the re-check finds no user.
    whoami.mockResolvedValue(null)
    const auth = useAuthStore(pinia)
    useWorkbenchStore(pinia).authExpired = true
    await flushPromises()

    expect(logout).toHaveBeenCalledTimes(1)
    expect(auth.signedIn).toBe(false)
    expect(auth.loggedOut).toBe(true)
    expect(wrapper.find('.shell').exists()).toBe(false)
  })

  it('treats an auth error on an already-anonymous app as a no-op', async () => {
    whoami.mockResolvedValue(null)
    const { pinia } = mountWith(App)
    await flushPromises()
    const workbench = useWorkbenchStore(pinia)

    workbench.authExpired = true
    await flushPromises()

    expect(logout).not.toHaveBeenCalled()
    expect(workbench.authExpired).toBe(false)
  })
})
