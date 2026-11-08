// @vitest-environment jsdom
// Upgrade wiring, end to end from the real api.js client through the settings
// card and the sidebar banner. `fetch` is stubbed rather than the api module,
// so these tests also pin the exact /__shell/upgrade routes and methods.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountWith } from './helpers/vue-utils.js'
import { setLang, useCopy } from '../src/lib/use-copy.js'
import {
  getUpgrade, checkUpgrade, installUpgrade, ApiError,
} from '../src/lib/api.js'
import SettingsView from '../src/views/SettingsView.vue'
import Sidebar from '../src/components/Sidebar.vue'

const IDLE = {
  status: 'up_to_date',
  currentVersion: '0.1.0',
  latestVersion: '0.1.0',
  notes: '',
  source: 'github',
  downloadUrl: '',
  checkedAt: 1_700_000_000,
  autoCheck: true,
  skippedVersion: null,
}

const AVAILABLE = {
  ...IDLE,
  status: 'available',
  latestVersion: '0.3.0',
  notes: 'Bug fixes and a faster startup.',
  source: 'gitee',
  downloadUrl: 'https://gitee.com/ariacompute/agentbuddy/releases/download/v0.3.0/a.msi.zip',
}

function jsonResponse(body, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body ?? {}),
    json: async () => body ?? {},
  }
}

/** Stubs the loopback proxy. `overrides.on` wins over the built-in routes. */
function installFetch(overrides = {}) {
  const state = overrides.upgrade || IDLE
  const calls = []
  const fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    calls.push({ url, method, body: options.body })
    if (overrides.failAll) return jsonResponse({ code: 'not_configured' }, false, 404)
    const exact = (overrides.on || {})[`${method} ${url}`]
    if (exact) {
      if (exact instanceof Error) throw exact
      return exact
    }
    if (url === '/__shell/upgrade' && method === 'GET') return jsonResponse(state)
    if (url === '/__shell/upgrade/check') return jsonResponse(overrides.checked || state)
    if (url === '/__shell/upgrade/install') return jsonResponse(overrides.installed || state)
    if (url === '/__shell/config' && method === 'GET') {
      return jsonResponse({ upgradeAutoCheck: true, upgradeSkippedVersion: '' })
    }
    if (url === '/__shell/config' && method === 'POST') return jsonResponse({ ok: true })
    if (url === '/healthz') return jsonResponse({ version: '0.1.0', build: 'abc' })
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch }
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((b) => b.text() === label)
}

async function mountSettings(overrides) {
  const calls = installFetch(overrides).calls
  const { wrapper } = mountWith(SettingsView)
  await flushPromises()
  await nextTick()
  return { wrapper, calls, card: wrapper.find('[data-testid="upgrade-card"]') }
}

beforeEach(() => {
  window.localStorage.clear()
  window.__AGENTBUDDY_VERSION__ = 'v0.1.0@abc123'
  // setLang() pushes the language to the shell; give it a harmless default
  // before any test installs its own route-aware stub.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))
  setLang('en')
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  setLang('en')
})

describe('upgrade api client', () => {
  it('reads the update state from GET /__shell/upgrade', async () => {
    const { calls } = installFetch({ upgrade: AVAILABLE })
    await expect(getUpgrade()).resolves.toMatchObject({ status: 'available', latestVersion: '0.3.0' })
    expect(calls).toContainEqual({ url: '/__shell/upgrade', method: 'GET', body: undefined })
  })

  it('posts a manual check and an install to their own routes', async () => {
    const { calls } = installFetch({ upgrade: AVAILABLE })
    await checkUpgrade()
    await installUpgrade()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /__shell/upgrade/check',
      'POST /__shell/upgrade/install',
    ])
  })

  it('surfaces a machine code when the shell refuses an install', async () => {
    installFetch({
      on: {
        'POST /__shell/upgrade/install': jsonResponse({ code: 'not_configured' }, false, 400),
      },
    })
    await expect(installUpgrade()).rejects.toBeInstanceOf(ApiError)
    await expect(installUpgrade()).rejects.toMatchObject({ code: 'not_configured' })
  })
})

describe('settings update card', () => {
  it('shows the current version, the mirror and an up-to-date status', async () => {
    const { card } = await mountSettings()
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('0.1.0')
    expect(card.text()).toContain('GitHub')
    expect(card.text()).toContain('You are up to date.')
    expect(card.attributes('aria-live')).toBeUndefined()
    expect(card.find('[role="status"]').attributes('aria-live')).toBe('polite')
  })

  it('offers upgrade, skip and a mirror-specific manual download for a new release', async () => {
    const { card } = await mountSettings({ upgrade: AVAILABLE })
    expect(card.text()).toContain('Version 0.3.0 is available.')
    expect(card.text()).toContain('Bug fixes and a faster startup.')
    expect(card.text()).toContain('Gitee')
    expect(button(card, 'Upgrade now').exists()).toBe(true)
    expect(button(card, 'Skip this version').exists()).toBe(true)
    const link = card.find('a.upgrade-link')
    expect(link.attributes('href')).toBe('https://gitee.com/ariacompute/agentbuddy/releases')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('does not offer an install when the manifest names a foreign host', async () => {
    const { card } = await mountSettings({
      upgrade: { ...AVAILABLE, downloadUrl: 'https://evil.test/a.zip' },
    })
    expect(button(card, 'Upgrade now')).toBeUndefined()
    // The manual link still comes from the fixed, trusted release-page table.
    expect(card.find('a.upgrade-link').attributes('href')).toContain('gitee.com')
  })

  it('runs a manual check and renders the returned state', async () => {
    const { wrapper, card, calls } = await mountSettings({ checked: AVAILABLE })
    await button(card, 'Check for updates').trigger('click')
    await flushPromises()
    expect(calls).toContainEqual({
      url: '/__shell/upgrade/check', method: 'POST', body: '{}',
    })
    expect(wrapper.find('[data-testid="upgrade-card"]').text()).toContain('Version 0.3.0')
  })

  it('installs after the user confirms and renders the installing state', async () => {
    const { card, calls } = await mountSettings({
      upgrade: AVAILABLE,
      on: {
        'POST /__shell/upgrade/install': jsonResponse({ ...AVAILABLE, status: 'installing' }),
      },
    })
    await button(card, 'Upgrade now').trigger('click')
    await flushPromises()
    expect(calls.map((c) => c.url)).toContain('/__shell/upgrade/install')
    expect(card.text()).toContain('Downloading and installing…')
  })

  it('shows the machine code when an install is refused', async () => {
    const { card } = await mountSettings({
      upgrade: AVAILABLE,
      on: {
        'POST /__shell/upgrade/install': jsonResponse({ code: 'not_configured' }, false, 400),
      },
    })
    await button(card, 'Upgrade now').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('not_configured')
    expect(card.text()).toContain('Could not check for updates')
  })

  it('skips a version through the existing config endpoint', async () => {
    const { card, calls } = await mountSettings({ upgrade: AVAILABLE })
    await button(card, 'Skip this version').trigger('click')
    await flushPromises()
    const post = calls.find((c) => c.url === '/__shell/config' && c.method === 'POST')
    expect(JSON.parse(post.body)).toMatchObject({ upgrade_skipped_version: '0.3.0' })
    expect(card.text()).toContain('You are up to date.')
  })

  it('persists the automatic-check switch', async () => {
    const { card, calls } = await mountSettings()
    const boxes = card.findAll('input[type="checkbox"]')
    await boxes[boxes.length - 1].setValue(false)
    await flushPromises()
    const post = calls.find((c) => c.url === '/__shell/config' && c.method === 'POST')
    expect(JSON.parse(post.body)).toMatchObject({ upgrade_auto_check: false })
  })

  it('shows the machine code when a manual check fails', async () => {
    const { card } = await mountSettings({
      on: {
        'POST /__shell/upgrade/check': jsonResponse({ code: 'network_failed' }, false, 502),
      },
    })
    await button(card, 'Check for updates').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('network_failed')
  })

  it('rejects an unparseable asset URL and an invalid check timestamp', async () => {
    const { card } = await mountSettings({
      upgrade: { ...AVAILABLE, downloadUrl: 'not a url', checkedAt: 'bogus' },
    })
    expect(button(card, 'Upgrade now')).toBeUndefined()
    expect(card.text()).toContain('Last checked')
    expect(card.text()).toContain('—')
  })

  it('stays quiet outside the desktop shell instead of throwing', async () => {
    const { card } = await mountSettings({ failAll: true })
    expect(card.text()).toContain('Automatic updates are not configured for this build.')
  })

  it('maps every machine code to a localised sentence', async () => {
    const codes = [
      'idle', 'checking', 'up_to_date', 'available', 'unsupported_platform',
      'downloading', 'installing', 'not_configured', 'network_failed',
      'manifest_invalid', 'signature_failed', 'busy', 'unavailable',
    ]
    for (const status of codes) {
      const { card } = await mountSettings({ upgrade: { ...AVAILABLE, status } })
      if (status !== 'idle') {
        expect(card.find('[role="status"]').text().trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('sidebar update banner', () => {
  it('appears only for an available release and links to settings', async () => {
    installFetch({ upgrade: AVAILABLE })
    const { wrapper } = mountWith(Sidebar)
    await flushPromises()
    await nextTick()
    const banner = wrapper.find('[data-testid="upgrade-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Update available')
    expect(banner.attributes('href')).toBe('/settings')
  })

  it('is absent when the shell reports no update', async () => {
    installFetch()
    const { wrapper } = mountWith(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="upgrade-banner"]').exists()).toBe(false)
  })

  it('is absent when the update state cannot be read', async () => {
    installFetch({ failAll: true })
    const { wrapper } = mountWith(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="upgrade-banner"]').exists()).toBe(false)
  })
})

describe('update copy is folded into the settings namespace', () => {
  it('resolves every upgrade key through useCopy(settings) in all 13 languages', () => {
    const { t } = useCopy('settings')
    const keys = [
      'upgradeTitle', 'upgradeCurrent', 'upgradeLatest', 'upgradeSource',
      'upgradeChecked', 'upgradeCheck', 'upgradeUpgrade', 'upgradeSkip',
      'upgradeDownload', 'upgradeAuto', 'upgradeChecking', 'upgradeUpToDate',
      'upgradeAvailable', 'upgradeUnsupported', 'upgradeBusy', 'upgradeFailed',
      'upgradeBanner', 'upgradeNotConfigured',
    ]
    setLang('en')
    const english = Object.fromEntries(keys.map((key) => [key, t(key)]))
    for (const key of keys) expect(english[key]).toBeTruthy()
    for (const lang of ['zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'pt', 'ar', 'hi']) {
      setLang(lang)
      for (const key of keys) {
        expect(t(key), `${lang}.${key}`).toBeTruthy()
        expect(t(key), `${lang}.${key}`).not.toBe(english[key])
      }
    }
  })
})

// The fallbacks below protect against a shell that answers with nothing, a
// status code the client does not know yet, or a config write that is refused.
// None of them is reachable from a healthy UI, but each is a real line the
// desktop client has to survive, so each gets a case here.
describe('upgrade defensive arms', () => {
  const emptyBody = { ok: true, status: 200, text: async () => '', json: async () => null }

  it('rejects an empty download URL before trying to parse it', async () => {
    const { wrapper } = await mountSettings()
    expect(wrapper.vm.assetHostAllowed('')).toBe(false)
    expect(wrapper.vm.assetHostAllowed(null)).toBe(false)
  })

  it('renders an unknown status and a release without a version number', async () => {
    const { card } = await mountSettings({
      upgrade: { ...AVAILABLE, status: 'brand_new_status', latestVersion: '' },
    })
    expect(card.find('[role="status"]').text()).toContain('Could not check for updates')
  })

  it('drops a second check or install while one is in flight', async () => {
    const { wrapper, calls } = await mountSettings()
    wrapper.vm.upgradeBusy = true
    await wrapper.vm.runCheck()
    await wrapper.vm.runInstall()
    expect(calls.filter((c) => c.url.startsWith('/__shell/upgrade/'))).toHaveLength(0)
  })

  it('treats an empty check response as unavailable', async () => {
    const { card } = await mountSettings({ on: { 'POST /__shell/upgrade/check': emptyBody } })
    await button(card, 'Check for updates').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('Automatic updates are not configured')
  })

  it('keeps the last good state when an install response is empty', async () => {
    const { card } = await mountSettings({
      upgrade: AVAILABLE,
      on: { 'POST /__shell/upgrade/install': emptyBody },
    })
    await button(card, 'Upgrade now').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('Version 0.3.0 is available.')
  })

  it('falls back to a generic code when a check error carries none', async () => {
    const { card } = await mountSettings({
      on: { 'POST /__shell/upgrade/check': new Error('socket gone') },
    })
    await button(card, 'Check for updates').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('unavailable')
  })

  it('falls back to not_configured when an install error carries none', async () => {
    const { card } = await mountSettings({
      upgrade: AVAILABLE,
      on: { 'POST /__shell/upgrade/install': new Error('socket gone') },
    })
    await button(card, 'Upgrade now').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('not_configured')
  })

  it('skipping a release without a version does not write config', async () => {
    const { card, calls } = await mountSettings({ upgrade: { ...AVAILABLE, latestVersion: '' } })
    await button(card, 'Skip this version').trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c.url === '/__shell/config' && c.method === 'POST')).toHaveLength(0)
  })

  it('keeps the state when the shell refuses to persist the skipped version', async () => {
    const { card } = await mountSettings({
      upgrade: AVAILABLE,
      on: { 'POST /__shell/config': jsonResponse({ code: 'forbidden' }, false, 403) },
    })
    await button(card, 'Skip this version').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('Version 0.3.0 is available.')
  })
})
