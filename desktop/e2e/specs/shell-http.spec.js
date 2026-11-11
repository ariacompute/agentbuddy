// Desktop shell HTTP contract. The WebView has a bootstrap cookie; a bare Node
// fetch has none, which is exactly how the refusal paths are exercised.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import { CSS, navigateHash, pageFetch, step, waitForElement } from '../driver/helpers.mjs'

const { info, wd, proxy, reset } = e2eContext()

async function restoreShell() {
  await proxy.saveConfig({
    lang: 'en', theme: 'light', background: true,
    notify_enabled: true, notify_quiet_minutes: 0,
  }).catch(() => {})
  await proxy.badge(0).catch(() => {})
}

describe.skipIf(info.skipped)('desktop shell · loopback proxy', () => {
  beforeEach(async () => { await reset() })
  afterEach(async () => { await restoreShell() })

  it('refuses a request with no proxy token, before touching the upstream', async () => {
    await step(wd, 'proxy-401', async () => {
      const denied = await proxy.direct('/api/workspace')
      expect(denied.status).toBe(401)
      expect(denied.body.code).toBe('proxy_unauthorized')
    })
  })

  it('refuses a foreign Origin even with a valid-looking cookie', async () => {
    await step(wd, 'proxy-403', async () => {
      const denied = await proxy.direct('/api/workspace', {
        headers: { Origin: 'https://evil.example', cookie: 'ab_session=anything' },
      })
      expect(denied.status).toBe(403)
      expect(denied.body.code).toBe('proxy_origin_refused')
    })
  })

  it('admits the WebView and forwards all four upstream prefixes', async () => {
    await step(wd, 'proxy-prefixes', async () => {
      const health = await proxy.forward('/healthz')
      expect(health.status).toBe(200)
      expect(health.body.status || health.body.ok).toBeTruthy()
      const card = await proxy.forward('/.well-known/agent.json')
      expect(card.status).toBe(200)
      const workspace = await proxy.forward('/api/workspace')
      expect(workspace.status).toBe(200)
      const a2a = await proxy.forward('/a2a', { method: 'POST', body: { jsonrpc: '2.0' } })
      expect(a2a.status).toBe(200)
    })
  })

  it('falls back to the SPA for an unknown client-side route', async () => {
    await step(wd, 'proxy-spa-fallback', async () => {
      const page = await proxy.spaFallback('/a/route/that/does/not/exist')
      expect(page.status).toBe(200)
      expect(String(page.body)).toContain('id="app"')
      expect(page.headers.contentType).toContain('text/html')
      expect(String(page.headers.contentSecurityPolicy || '')).toContain('nonce-')
    })
  })

  it('serves shell answers with no-store and no-sniff headers', async () => {
    await step(wd, 'proxy-secure-headers', async () => {
      const config = await proxy.config()
      expect(config.status).toBe(200)
      expect(String(config.headers.cacheControl || '')).toContain('no-store')
      expect(String(config.headers.xContentTypeOptions || '')).toBe('nosniff')
    })
  })

  it('reads and writes config with the documented camelCase/snake_case contract', async () => {
    await step(wd, 'proxy-config-roundtrip', async () => {
      const saved = await proxy.saveConfig({ lang: 'de', theme: 'dark' })
      expect(saved.status).toBe(200)
      const read = await proxy.config()
      expect(read.body.serverUrl).toBe(info.serverUrl)
      expect(read.body.lang).toBe('de')
      expect(read.body.theme).toBe('dark')
      expect(typeof read.body.sessionBackend).toBe('string')
      expect(read.body).toHaveProperty('upgradeAutoCheck')
    })
  })

  it('clamps the tray badge to 999 and clears it at zero', async () => {
    await step(wd, 'proxy-badge', async () => {
      const huge = await proxy.badge(999_999)
      expect(huge.status).toBe(200)
      expect(huge.body).toMatchObject({ ok: true, count: 999 })
      const small = await proxy.badge(7)
      expect(small.body.count).toBe(7)
      const cleared = await proxy.badge(0)
      expect(cleared.body.count).toBe(0)
      const missing = await pageFetch(wd, '/__shell/badge', { method: 'POST', body: {} }, info.timeoutMs)
      expect(missing.status).toBe(400)
      expect(missing.body.code).toBe('invalid_count')
    })
  })

  it('keeps the badge across a tray language change', async () => {
    await step(wd, 'proxy-badge-language', async () => {
      await proxy.badge(12)
      await proxy.saveConfig({ lang: 'ja' })
      const read = await proxy.config()
      expect(read.body.lang).toBe('ja')
      // The count lives in the proxy process, not in the rebuilt tray menu;
      // re-applying it must not be refused or reset to zero.
      const again = await proxy.badge(12)
      expect(again.body.count).toBe(12)
    })
  })

  it('validates notification payloads and honours the master switch', async () => {
    await step(wd, 'proxy-notify', async () => {
      const missing = await proxy.notify({ title: '', body: '' })
      expect(missing.body).toMatchObject({ ok: false, reason: 'missing_fields' })
      const malformed = await pageFetch(wd, '/__shell/notify', { method: 'POST', body: 'not-an-object' }, info.timeoutMs)
      expect(malformed.status).toBe(400)
      expect(malformed.body.reason).toBe('invalid_json')
      await proxy.saveConfig({ notify_enabled: false })
      const disabled = await proxy.notify({ title: 'E2E', body: 'quiet' })
      expect(disabled.body).toMatchObject({ ok: false, reason: 'disabled' })
      await proxy.saveConfig({ notify_enabled: true })
      const shown = await proxy.notify({ title: 'E2E', body: 'hello', link: '/threads/thread-1' })
      // OS permission can legitimately be denied in CI; either way the shell
      // answers with a reason instead of hanging or crashing.
      expect([true, false]).toContain(shown.body.ok)
      if (!shown.body.ok) expect(['denied', 'no_app']).toContain(shown.body.reason)
    })
  })

  it('exposes the executor and upgrade state through their own endpoints', async () => {
    await step(wd, 'proxy-executor-upgrade', async () => {
      const executor = await proxy.executor()
      expect(executor.status).toBe(200)
      expect(executor.body).toHaveProperty('status')
      expect(executor.body.limits).toHaveProperty('maxOutputBytes')
      const upgrade = await proxy.upgrade()
      expect([200, 404, 405, 503]).toContain(upgrade.status)
      if (upgrade.status === 200) expect(upgrade.body).toHaveProperty('status')
    })
  })

  it('the connect and about pages are served even once configured', async () => {
    await step(wd, 'proxy-shell-pages', async () => {
      const connect = await proxy.connectPage()
      expect(connect.status).toBe(200)
      expect(String(connect.body)).toContain('id="server"')
      const about = await proxy.aboutPage()
      expect(about.status).toBe(200)
      expect(String(about.body).length).toBeGreaterThan(100)
    })
  })

  it('a workbench reload keeps the bootstrap cookie so /api/* is still admitted', async () => {
    await step(wd, 'proxy-bootstrap-persists', async () => {
      await navigateHash(wd, '/', info.timeoutMs)
      await wd.execute('window.location.reload()')
      await waitForElement(wd, CSS, '.shell', info.timeoutMs)
      const workspace = await proxy.forward('/api/workspace')
      expect(workspace.status).toBe(200)
      const denied = await proxy.direct('/api/workspace')
      expect(denied.status).toBe(401)
    })
  })
})
