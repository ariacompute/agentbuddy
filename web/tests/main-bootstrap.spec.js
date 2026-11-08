// @vitest-environment jsdom
//
// The entry point, exercised for real: importing `src/main.js` resolves the
// language, proves pinia is installed before the router guard needs it, and
// mounts the app onto #app. Every request is answered locally, so the spec
// covers the wiring rather than the server.
//
// `vi.resetModules()` between cases is deliberate: main.js mounts the moment it
// is evaluated, so each case needs its own module graph.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SHELL_CONFIG = '/__shell/config'
const WHOAMI = '/api/auth/me'

/** A fetch stand-in that records calls and answers the three bootstrap paths. */
function installFetch() {
  const calls = []
  const fetchStub = vi.fn((url, options = {}) => {
    const target = String(url)
    calls.push({ url: target, method: (options.method || 'GET').toUpperCase(), body: options.body })
    if (target.endsWith(SHELL_CONFIG)) return Promise.resolve(new Response(null, { status: 204 }))
    if (target.endsWith(WHOAMI)) {
      // Anonymous: the guard redirects to /login, which is the first-run path.
      return Promise.resolve(new Response(JSON.stringify({ code: 'unauthenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
    }
    return Promise.resolve(new Response(JSON.stringify({ methods: ['password'], oauth: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  })
  globalThis.fetch = fetchStub
  return calls
}

async function boot() {
  const call = installFetch()
  await import('../src/main.js')
  const app = document.getElementById('app')
  // The router's first navigation is asynchronous, so wait for the screen the
  // anonymous guard lands on rather than for "some HTML" (the first paint is an
  // empty <router-view> placeholder, which would satisfy that).
  await vi.waitFor(() => expect(app.querySelector('form')).not.toBeNull())
  return { call, app }
}

describe('bootstrap (src/main.js)', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.body.innerHTML = '<div id="app"></div>'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('takes the language from the query, mirrors it on <html> and mounts', async () => {
    window.history.replaceState(null, '', '/?lang=ar')
    const { call, app } = await boot()

    // Query beats storage, and Arabic turns the document around.
    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(window.localStorage.getItem('agentbuddy.lang')).toBe('ar')

    // setLang pushes the language to the shell so the tray follows the app.
    const pushed = call.find((c) => c.url.endsWith(SHELL_CONFIG))
    expect(pushed.method).toBe('POST')
    expect(JSON.parse(pushed.body)).toEqual({ lang: 'ar' })

    // The app really mounted, and the guard sent an anonymous visitor to /login.
    expect(app.querySelector('form')).not.toBeNull()
    expect(window.location.hash).toContain('/login')
  })

  it('uses the stored language when the query has none, falling back to the browser', async () => {
    window.localStorage.setItem('agentbuddy.lang', 'ja')
    window.history.replaceState(null, '', '/')
    let { app } = await boot()
    expect(document.documentElement.lang).toBe('ja')
    expect(document.documentElement.dir).toBe('ltr')
    expect(app).not.toBeNull()

    // No query and nothing stored: `navigator.language` decides (jsdom says en-US).
    vi.resetModules()
    window.localStorage.clear()
    document.body.innerHTML = '<div id="app"></div>'
    window.history.replaceState(null, '', '/')
    ;({ app } = await boot())
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('agentbuddy.lang')).toBe('en')
  })

  it('ignores a language the copy tables do not carry', async () => {
    window.history.replaceState(null, '', '/?lang=xx')
    await boot()
    // detectLang drops the unknown code and falls through to the browser, so the
    // workbench never boots half-localised.
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('agentbuddy.lang')).toBe('en')
  })
})
