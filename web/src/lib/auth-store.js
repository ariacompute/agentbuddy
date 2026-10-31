// Auth store (Pinia). Holds the signed-in principal and its permission set. As
// with agenthub, every failed call stores only a machine `code` — the message
// comes from errors.js. The permission vocabulary is copied from agenthub so the
// same `can(...)` checks work against either server.
import { defineStore } from 'pinia'
import {
  authConfig, login as apiLogin, register as apiRegister, logout as apiLogout, whoami,
} from './api.js'

// Copied from agenthub's permission words; reused verbatim so checks match.
export const PERMISSIONS = [
  'resources:read', 'resources:write',
  'tasks:read', 'tasks:write',
  'users:manage', 'roles:manage', 'grants:manage', 'sessions:manage',
  'backups:manage', 'registries:manage', 'registry:curate',
  'sources:manage', 'apikeys:manage',
]

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    config: null,
    refreshError: null,
    errorCode: null,
    busy: false,
  }),

  getters: {
    signedIn: (s) => !!s.user,
    isOwner: (s) => !!s.user && s.user.isOwner === true,
    permissions: (s) => (s.user && Array.isArray(s.user.permissions) ? s.user.permissions : []),
    can: (s) => (perm) => {
      if (!s.user) return false
      if (s.user.isOwner) return true
      const set = Array.isArray(s.user.permissions) ? s.user.permissions : []
      return set.includes(perm)
    },
    oauthProviders: (s) => (s.config && Array.isArray(s.config.oauth) ? s.config.oauth : []),
  },

  actions: {
    async loadConfig() {
      try {
        this.config = await authConfig()
      } catch (error) {
        console.error('agentbuddy: cannot load auth config', error)
        this.refreshError = error.code
      }
    },

    async refresh() {
      this.refreshError = null
      try {
        const u = await whoami()
        // agenthub renders the user's name as `name`; the UI elsewhere reads
        // `displayName`, so normalise it here once.
        this.user = u ? { ...u, displayName: u.displayName || u.name } : null
      } catch (error) {
        // Not signed in, or server unreachable: treat as anonymous.
        this.user = null
        if (error.code && error.code !== 'unauthenticated') this.refreshError = error.code
      }
    },

    async login(email, password) {
      this.busy = true
      this.errorCode = null
      try {
        await apiLogin(email, password)
        await this.refresh()
        return { ok: true }
      } catch (error) {
        this.errorCode = error.code
        return { ok: false, code: error.code }
      } finally {
        this.busy = false
      }
    },

    async register(email, password, displayName) {
      this.busy = true
      this.errorCode = null
      try {
        await apiRegister(email, password, displayName)
        await apiLogin(email, password)
        await this.refresh()
        return { ok: true }
      } catch (error) {
        this.errorCode = error.code
        return { ok: false, code: error.code }
      } finally {
        this.busy = false
      }
    },

    async logout() {
      this.errorCode = null
      try {
        await apiLogout()
      } catch (error) {
        console.error('agentbuddy: logout failed', error)
      }
      this.user = null
    },
  },
})
