import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The auth store talks to the server only through api.js; mock that module so we
// exercise the getters and action orchestration without a network.
vi.mock('../src/lib/api.js', () => ({
  authConfig: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  whoami: vi.fn(),
}))

import { useAuthStore, PERMISSIONS } from '../src/lib/auth-store.js'
import { authConfig, login, register, logout, whoami } from '../src/lib/api.js'

describe('auth-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('exposes the full permission vocabulary', () => {
    expect(PERMISSIONS).toContain('resources:read')
    expect(PERMISSIONS).toContain('tasks:write')
    expect(PERMISSIONS).toContain('backups:manage')
    expect(PERMISSIONS.length).toBeGreaterThan(10)
  })

  describe('getters', () => {
    it('is anonymous until a user is present', () => {
      const s = useAuthStore()
      expect(s.signedIn).toBe(false)
      expect(s.isOwner).toBe(false)
      expect(s.permissions).toEqual([])
      expect(s.can('tasks:read')).toBe(false)
      expect(s.oauthProviders).toEqual([])
    })

    it('an owner can do anything regardless of the permission list', () => {
      const s = useAuthStore()
      s.user = { isOwner: true, permissions: [] }
      expect(s.isOwner).toBe(true)
      expect(s.can('resources:write')).toBe(true)
    })

    it('a non-owner is gated by the permission set', () => {
      const s = useAuthStore()
      s.user = { isOwner: false, permissions: ['tasks:read'] }
      expect(s.can('tasks:read')).toBe(true)
      expect(s.can('tasks:write')).toBe(false)
    })

    it('oauth providers come from the loaded config', () => {
      const s = useAuthStore()
      s.config = { oauth: [{ name: 'github' }] }
      expect(s.oauthProviders).toEqual([{ name: 'github' }])
    })
  })

  describe('loadConfig', () => {
    it('stores the config on success', async () => {
      authConfig.mockResolvedValue({ oauth: [] })
      const s = useAuthStore()
      await s.loadConfig()
      expect(s.config).toEqual({ oauth: [] })
      expect(s.refreshError).toBeNull()
    })

    it('records only the machine code on failure', async () => {
      authConfig.mockRejectedValue({ code: 'service_unavailable' })
      const s = useAuthStore()
      await s.loadConfig()
      expect(s.refreshError).toBe('service_unavailable')
    })
  })

  describe('refresh', () => {
    it('normalises name into displayName', async () => {
      whoami.mockResolvedValue({ name: 'Ada', isOwner: false, permissions: [] })
      const s = useAuthStore()
      await s.refresh()
      expect(s.user).toEqual({ name: 'Ada', displayName: 'Ada', isOwner: false, permissions: [] })
    })

    it('treats a missing user as anonymous', async () => {
      whoami.mockResolvedValue(null)
      const s = useAuthStore()
      await s.refresh()
      expect(s.user).toBeNull()
    })

    it('keeps the error only for non-auth failures', async () => {
      whoami.mockRejectedValue({ code: 'unauthenticated' })
      const s = useAuthStore()
      await s.refresh()
      expect(s.user).toBeNull()
      expect(s.refreshError).toBeNull()

      whoami.mockRejectedValue({ code: 'service_unavailable' })
      await s.refresh()
      expect(s.refreshError).toBe('service_unavailable')
    })
  })

  describe('login', () => {
    it('refreshes and reports success', async () => {
      login.mockResolvedValue(undefined)
      whoami.mockResolvedValue({ name: 'Ada' })
      const s = useAuthStore()
      const res = await s.login('a@b.c', 'pw')
      expect(res.ok).toBe(true)
      expect(s.busy).toBe(false)
      expect(s.errorCode).toBeNull()
    })

    it('captures the machine code on failure', async () => {
      login.mockRejectedValue({ code: 'invalid_credentials' })
      const s = useAuthStore()
      const res = await s.login('a@b.c', 'bad')
      expect(res.ok).toBe(false)
      expect(res.code).toBe('invalid_credentials')
      expect(s.errorCode).toBe('invalid_credentials')
      expect(s.busy).toBe(false)
    })
  })

  describe('register', () => {
    it('logs in and refreshes on success', async () => {
      register.mockResolvedValue(undefined)
      login.mockResolvedValue(undefined)
      whoami.mockResolvedValue({ name: 'New' })
      const s = useAuthStore()
      const res = await s.register('a@b.c', 'pw', 'New')
      expect(res.ok).toBe(true)
      expect(s.user.displayName).toBe('New')
    })

    it('reports the machine code on failure', async () => {
      register.mockRejectedValue({ code: 'email_taken' })
      const s = useAuthStore()
      const res = await s.register('a@b.c', 'pw', 'New')
      expect(res.ok).toBe(false)
      expect(res.code).toBe('email_taken')
    })
  })

  describe('logout', () => {
    it('clears the user even if the server call fails', async () => {
      const s = useAuthStore()
      s.user = { name: 'Ada' }
      logout.mockRejectedValue({ code: 'service_unavailable' })
      await s.logout()
      expect(s.user).toBeNull()
    })
  })
})
