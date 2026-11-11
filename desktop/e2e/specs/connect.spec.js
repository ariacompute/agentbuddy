// F1 — the connection page. This is the first screen a real user sees on a
// fresh install, so it is driven through the form, not by pre-writing config.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LANGUAGES } from '../harness/config.mjs'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, pageFetch, rootState, step, waitForElement, waitFor, tryFind,
} from '../driver/helpers.mjs'

const { info, wd, proxy, reset } = e2eContext()
const connectUrl = () => `${info.proxyOrigin}/__shell/connect`

async function goToConnectPage() {
  await wd.navigate(connectUrl())
  await waitForElement(wd, CSS, '#server', info.timeoutMs)
  return wd.execute('return window.__SHELL__')
}

describe.skipIf(info.skipped)('F1 · connection page and server probe', () => {
  beforeEach(async () => { await reset() })
  afterEach(async () => {
    await proxy.saveConfig({ background: true, notify_enabled: true, notify_quiet_minutes: 0 }).catch(() => {})
    await wd.execute(`
      window.localStorage.setItem('agentbuddy.lang', 'en');
      window.localStorage.setItem('agentbuddy.theme', 'light');
    `)
    await wd.navigate(`${info.proxyOrigin}/#/`)
    await waitForElement(wd, CSS, '.shell', info.timeoutMs)
  })

  it('shows the server field, a 13-language table and RTL metadata', async () => {
    await step(wd, 'connect-page-renders', async () => {
      const boot = await goToConnectPage()
      expect(boot.page).toBe('connect')
      expect(LANGUAGES.every((lang) => boot.tables[lang])).toBe(true)
      expect(Object.keys(boot.tables)).toHaveLength(13)
      expect(boot.dirs.ar).toBe('rtl')
      expect(boot.dirs.en).toBe('ltr')
      expect(boot.defaultServerUrl).toMatch(/^https?:\/\//)
      const value = await wd.property(await waitForElement(wd, CSS, '#server'), 'value')
      expect(value).toMatch(/^https?:\/\//)
      const state = await rootState(wd)
      expect(['ltr', 'rtl']).toContain(state.dir)
    })
  })

  it('mirrors the chosen language onto <html lang|dir> and translates the form', async () => {
    await step(wd, 'connect-page-language', async () => {
      await wd.execute(`window.localStorage.setItem('agentbuddy.lang', 'ar'); location.reload()`)
      const boot = await goToConnectPage()
      const state = await rootState(wd)
      expect(state.lang).toBe('ar')
      expect(state.dir).toBe('rtl')
      const label = await wd.text(await waitForElement(wd, CSS, '#label-server'))
      expect(label).toBe(boot.tables.ar.fieldServer)
    })
  })

  it('refuses an empty and a malformed address with localised in-page status', async () => {
    await step(wd, 'connect-page-invalid-address', async () => {
      const boot = await goToConnectPage()
      const server = await waitForElement(wd, CSS, '#server')
      await wd.clear(server)
      await click(wd, CSS, '#connect')
      await waitFor(async () => (await wd.attribute(await waitForElement(wd, CSS, '#status'), 'data-tone')) === 'bad', 'empty-address status')
      expect(await wd.text(await waitForElement(wd, CSS, '#status'))).toBe(boot.tables.en.errEmpty)

      await wd.clear(server)
      await wd.type(server, 'not a url')
      await click(wd, CSS, '#connect')
      const status = await waitForElement(wd, CSS, '#status')
      expect(await wd.text(status)).toBe(boot.tables.en.errInvalid)
    })
  })

  it('reports an unreachable server without leaving the connect page', async () => {
    await step(wd, 'connect-page-unreachable', async () => {
      const boot = await goToConnectPage()
      const server = await waitForElement(wd, CSS, '#server')
      await wd.clear(server)
      await wd.type(server, 'http://127.0.0.1:1')
      await click(wd, CSS, '#connect')
      await waitFor(async () => (await wd.text(await waitForElement(wd, CSS, '#status'))).length > 0, 'probe result')
      const message = await wd.text(await waitForElement(wd, CSS, '#status'))
      expect([boot.tables.en.errUnreachable, boot.tables.en.errUnexpected]).toContain(message)
      expect(await tryFind(wd, CSS, '#form-card')).toBeTruthy()
    })
  })

  it('probes a healthy server and persists the address plus the certificate switch', async () => {
    await step(wd, 'connect-page-save', async () => {
      const boot = await goToConnectPage()
      const server = await waitForElement(wd, CSS, '#server')
      await wd.clear(server)
      await wd.type(server, info.serverUrl)
      await click(wd, CSS, '#insecure')
      await click(wd, CSS, '#connect')
      await waitFor(async () => (await tryFind(wd, CSS, '#app')) !== null, 'the workbench after saving')
      const config = await pageFetch(wd, '/__shell/config')
      expect(config.status).toBe(200)
      expect(config.body.serverUrl).toBe(info.serverUrl)
      expect(config.body.acceptInvalidCerts).toBe(true)
      expect(boot.tables.en.statusConnected).toBeTruthy()
    })
  })

  it('persists background / notification / quiet preferences on change, without reconnecting', async () => {
    await step(wd, 'connect-page-prefs', async () => {
      await goToConnectPage()
      await click(wd, CSS, '#notify')
      const before = await pageFetch(wd, '/__shell/config')
      expect(before.body.notifyEnabled).toBe(false)
      const quiet = await waitForElement(wd, CSS, '#quiet')
      await wd.clear(quiet)
      await wd.type(quiet, '15')
      await wd.execute(`document.getElementById('quiet').dispatchEvent(new Event('change', { bubbles: true }))`)
      await waitFor(async () => (await pageFetch(wd, '/__shell/config')).body.notifyQuietMinutes === 15, 'quiet minutes to persist')
      const config = await pageFetch(wd, '/__shell/config')
      expect(config.body.serverUrl).toBe(info.serverUrl)
      expect(config.body.notifyEnabled).toBe(false)
      expect(config.body.notifyQuietMinutes).toBe(15)
    })
  })

  it('answers the probe endpoint with each failure reason the UI maps', async () => {
    await step(wd, 'probe-codes', async () => {
      const empty = await proxy.testConnection({ server_url: '', accept_invalid_certs: false })
      expect(empty.status).toBe(400)
      expect(empty.body.reason).toBe('empty')
      const invalid = await proxy.testConnection({ server_url: 'ftp://nope', accept_invalid_certs: false })
      expect(invalid.body.reason).toBe('invalid')
      const unreachable = await proxy.testConnection({ server_url: 'http://127.0.0.1:1', accept_invalid_certs: false })
      expect(['unreachable', 'timeout', 'unexpected']).toContain(unreachable.body.reason)
      const healthy = await proxy.testConnection({ server_url: info.serverUrl, accept_invalid_certs: false })
      expect(healthy.body.ok).toBe(true)
    })
  })
})
