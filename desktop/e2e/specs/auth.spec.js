// F1 — identity. Signing out through the topbar is a real user action, so this
// file deliberately leaves the shared session signed back in at the end.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickText, navigateHash, pageText, rootState, setHash, step,
  waitForElement, waitForText, waitFor, type, tryFind,
} from '../driver/helpers.mjs'
import { errorMessage, t } from '../driver/selectors.mjs'
import { signIn, signOut } from '../driver/session.mjs'

const { info, cfg, wd, proxy, reset, requests } = e2eContext()

async function ensureSignedIn() {
  const state = await rootState(wd)
  if (!state.hash.startsWith('#/login')) return
  await signIn(wd, cfg.credentials, { timeoutMs: info.timeoutMs })
}

describe.skipIf(info.skipped)('F1 · login, registration and route guard', () => {
  beforeAll(async () => {
    await navigateHash(wd, '/')
    await waitForElement(wd, CSS, '.topbar', info.timeoutMs)
    await signOut(wd, info.timeoutMs)
  })
  afterAll(async () => { await ensureSignedIn() })
  beforeEach(async () => { await reset() })

  it('keeps the sign-in page reachable and renders the OAuth providers from /api/auth/config', async () => {
    await step(wd, 'login-page', async () => {
      expect((await rootState(wd)).hash).toContain('#/login')
      await waitForElement(wd, CSS, 'input[type="email"]')
      expect(await pageText(wd)).toContain(t('shell', 'loginSignIn'))
      if (info.backend === 'stub') {
        await waitForText(wd, 'GitHub')
        expect((await wd.findAll(CSS, '.oauth-row button.btn')).length).toBeGreaterThan(0)
      } else {
        // A live server with no credentials configured must not render any provider.
        const providers = await proxy.forward('/api/auth/config')
        const expected = providers.body?.oauth?.length || 0
        expect((await wd.findAll(CSS, '.oauth-row button.btn')).length).toBe(expected)
      }
    })
  })

  it('an unauthenticated deep link is redirected to /login with next=', async () => {
    await step(wd, 'guard-next', async () => {
      // The guard rewrites the hash immediately: waiting for '#/files' to stick
      // can never succeed, so set it and wait for the redirect instead.
      await setHash(wd, '/files')
      await waitFor(async () => (await rootState(wd)).hash.startsWith('#/login'), 'guard redirect')
      const state = await rootState(wd)
      expect(state.hash).toContain('next=')
      expect(state.hash).toContain('files')
    })
  })

  it('a wrong password shows a localised error and leaves the form usable', async () => {
    await step(wd, 'bad-credentials', async () => {
      const email = await waitForElement(wd, CSS, 'input[type="email"]')
      await wd.clear(email)
      await wd.type(email, cfg.credentials.email || 'someone@example.test')
      const password = await waitForElement(wd, CSS, 'input[type="password"][autocomplete="current-password"]')
      await wd.clear(password)
      await wd.type(password, 'definitely-wrong')
      await click(wd, CSS, 'button.btn.btn-primary[type="submit"]')
      await waitFor(async () => (await pageText(wd)).length > 0, 'error banner')
      const text = await pageText(wd)
      expect(text).toContain(errorMessage('invalid_credentials'))
      expect((await rootState(wd)).hash).toContain('#/login')
      expect(await tryFind(wd, CSS, 'input[type="email"]')).toBeTruthy()
    })
  })

  it('sign-up mode reveals the name and confirmation fields', async () => {
    await step(wd, 'signup-mode', async () => {
      await clickText(wd, t('shell', 'loginToggleSignUp'), { tag: 'button' })
      await waitForElement(wd, CSS, 'input[autocomplete="name"]')
      await waitForElement(wd, CSS, 'input[autocomplete="new-password"]')
      expect(await pageText(wd)).toContain(t('shell', 'loginSignUp'))
      await clickText(wd, t('shell', 'loginToggleSignIn'), { tag: 'button' })
      await waitFor(async () => (await tryFind(wd, CSS, 'input[autocomplete="name"]')) === null, 'sign-up fields to close')
    })
  })

  it('a duplicate registration is reported as a machine code, not a crash', async () => {
    await step(wd, 'registration-error', async () => {
      if (!proxy.isStub) return
      try {
        await proxy.scenario('/api/auth/register', 'server_error', { status: 409, code: 'email_taken' })
        await clickText(wd, t('shell', 'loginToggleSignUp'), { tag: 'button' })
        await type(wd, CSS, 'input[autocomplete="name"]', 'E2E Operator')
        await type(wd, CSS, 'input[type="email"]', 'e2e@example.test')
        // Sign-up only enables Submit when password === confirmation, so both
        // fields must be filled; leaving the main password at the previous
        // journey's value keeps the button disabled and no request is sent.
        await type(wd, CSS, 'input[type="password"][autocomplete="current-password"]', 'agentbuddy-e2e')
        await type(wd, CSS, 'input[autocomplete="new-password"]', 'agentbuddy-e2e')
        await click(wd, CSS, 'button.btn.btn-primary[type="submit"]')
        await waitFor(async () => (await pageText(wd)).includes(errorMessage('email_taken')), 'duplicate-email banner')
      } finally {
        // A failure must not leave the shared login form in sign-up mode: the
        // next journey signs in with only email + password.
        await proxy.scenario('/api/auth/register', 'ok').catch(() => {})
        await clickText(wd, t('shell', 'loginToggleSignIn'), { tag: 'button' }).catch(() => {})
      }
    })
  })

  it('valid credentials land on the workbench and honour the next= deep link', async () => {
    await step(wd, 'sign-in', async () => {
      await navigateHash(wd, '/login?next=%2Ffiles')
      await waitForElement(wd, CSS, 'input[type="email"]')
      await signIn(wd, cfg.credentials, { timeoutMs: info.timeoutMs })
      const state = await rootState(wd)
      expect(state.hash.startsWith('#/login')).toBe(false)
      await waitForElement(wd, CSS, '.shell', info.timeoutMs)
      const me = await proxy.forward('/api/auth/me')
      expect(me.status).toBe(200)
      if (info.backend === 'stub') expect(me.body).toMatchObject({ id: 'user-e2e' })
    })
  })

  it('a 401 and a dead socket are two different connection states', async () => {
    await step(wd, 'auth-vs-offline', async () => {
      if (!proxy.isStub) return
      try {
        // A 401 is an auth failure. The app re-checks the principal (the stub
        // still answers /api/auth/me), so the session survives and the shell
        // must NOT claim the server is unreachable. The auth-expired banner is
        // deliberately transient in that case — App.vue clears it after a
        // successful re-check (pinned by web/tests/app.spec.js).
        await proxy.scenario('/api/workspace', 'unauthenticated')
        await wd.execute('window.location.reload()')
        await waitFor(async () => (await requests()).some((r) => r.path === '/api/workspace' && r.status === 401), '401 workspace poll', info.timeoutMs)
        await waitForElement(wd, CSS, '.shell', info.timeoutMs)
        expect(await pageText(wd)).not.toContain(t('workspace', 'connectionOffline'))

        // A dropped socket is the other state: the localised offline banner.
        await proxy.scenario('/api/workspace', 'drop')
        await wd.execute('window.location.reload()')
        await waitForText(wd, t('workspace', 'connectionOffline'), info.timeoutMs)
      } finally {
        // Scenarios live in the shared stub process: never leak a 401 or a drop
        // into the next spec (its /api/workspace probe would answer 401).
        await proxy.scenario('/api/workspace', 'ok').catch(() => {})
        await ensureSignedIn().catch(() => {})
      }
      await wd.execute('window.location.reload()')
      await waitForElement(wd, CSS, '.shell', info.timeoutMs)
    })
  })
})
