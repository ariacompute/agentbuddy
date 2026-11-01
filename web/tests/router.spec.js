// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../src/lib/api.js')

import { whoami } from '../src/lib/api.js'
import { useAuthStore } from '../src/lib/auth-store.js'
import router from '../src/router.js'

// The guard is the only thing standing between a signed-out visitor and the
// workbench, so these tests drive the real router rather than a reimplementation
// of its rules.
beforeEach(() => {
  setActivePinia(createPinia())
  whoami.mockReset()
})

describe('router guard', () => {
  it('sends an anonymous visitor to the login page and remembers the target', async () => {
    whoami.mockResolvedValue(null)
    await router.push('/threads')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/threads')
  })

  it('lets a signed-in visitor through to the requested screen', async () => {
    whoami.mockResolvedValue({ id: 'u1', name: 'Me', permissions: [] })
    await router.push('/schedules')
    expect(router.currentRoute.value.name).toBe('schedules')
  })

  it('bounces a signed-in visitor away from the login page', async () => {
    whoami.mockResolvedValue({ id: 'u1', name: 'Me', permissions: [] })
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('workbench')
  })

  it('answers an unknown path with the workbench', async () => {
    whoami.mockResolvedValue({ id: 'u1', name: 'Me', permissions: [] })
    await router.push('/no-such-screen')
    expect(router.currentRoute.value.name).toBe('workbench')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('does not re-check the session once the user has logged out', async () => {
    const auth = useAuthStore()
    auth.user = null
    auth.loggedOut = true
    whoami.mockClear()

    await router.push('/computers')
    expect(whoami).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/computers')
  })

  it('skips the session check when a principal is already in memory', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', name: 'Me' }
    whoami.mockClear()

    await router.push('/persona')
    expect(whoami).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('persona')
  })
})
