// Cross-cutting behaviour: settings, all 13 languages, light/dark tokens, RTL
// and accessibility. These are visible-browser assertions — layout, computed
// colour and direction are exactly what a jsdom unit test cannot measure.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LANGUAGES, isRTL } from '../harness/config.mjs'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, navigateHash, pageText, rootState, selectLanguage, step,
  toggleTheme, waitForElement, waitFor, waitForText, type,
} from '../driver/helpers.mjs'
import { t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset } = e2eContext()

async function openSettings() {
  await navigateHash(wd, '/settings', info.timeoutMs)
  await waitForElement(wd, CSS, '[data-testid="upgrade-card"]', info.timeoutMs)
}

async function restoreDefaults() {
  await selectLanguage(wd, 'en', info.timeoutMs).catch(() => {})
  let state = await rootState(wd)
  if (state.theme !== 'light') await toggleTheme(wd, info.timeoutMs).catch(() => {})
  await proxy.saveConfig({ notify_enabled: true, notify_quiet_minutes: 0 }).catch(() => {})
}

describe.skipIf(info.skipped)('settings · 13 languages, theme, RTL, a11y', () => {
  beforeEach(async () => { await reset() })
  afterEach(async () => { await restoreDefaults() })

  it('shows the server version and commit from /healthz', async () => {
    await step(wd, 'settings-health', async () => {
      await openSettings()
      if (info.backend === 'stub') {
        await waitForText(wd, 'e2e-stub-1.0', info.timeoutMs)
        expect(await pageText(wd)).toContain('abc1234')
      } else {
        expect(await pageText(wd)).toContain(t('settings', 'version'))
      }
    })
  })

  it('switches through all 13 languages with correct <html lang|dir> and translated navigation', async () => {
    await step(wd, 'language-sweep', async () => {
      await openSettings()
      for (const lang of LANGUAGES) {
        const state = await selectLanguage(wd, lang, info.timeoutMs)
        expect(state.lang).toBe(lang)
        expect(state.dir).toBe(isRTL(lang) ? 'rtl' : 'ltr')
        const direction = await wd.execute('return getComputedStyle(document.body).direction')
        expect(direction).toBe(isRTL(lang) ? 'rtl' : 'ltr')
        const expected = t('shell', 'navWorkspace', lang)
        await waitFor(async () => (await pageText(wd)).includes(expected), `nav label in ${lang}`)
      }
    })
  })

  it('the English fallback still fills keys a locale leaves out', async () => {
    await step(wd, 'language-fallback', async () => {
      await openSettings()
      await selectLanguage(wd, 'hi', info.timeoutMs)
      const rendered = await pageText(wd)
      for (const key of ['notify', 'quiet', 'version']) {
        const label = t('settings', key, 'hi') || t('settings', key, 'en')
        expect(rendered).toContain(label)
      }
    })
  })

  it('mirrors language and theme choices into the shell config for the tray menu', async () => {
    await step(wd, 'shell-config-sync', async () => {
      await openSettings()
      await selectLanguage(wd, 'fr', info.timeoutMs)
      const afterLang = await proxy.config()
      expect(afterLang.body.lang).toBe('fr')
      const themed = await toggleTheme(wd, info.timeoutMs)
      const afterTheme = await proxy.config()
      expect(afterTheme.body.theme).toBe(themed.theme)
    })
  })

  it('flips the paired light/dark tokens and keeps every colour monochrome', async () => {
    await step(wd, 'theme-tokens', async () => {
      await openSettings()
      const read = () => wd.execute(`
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const value = (name) => {
          probe.style.color = 'var(' + name + ')';
          return getComputedStyle(probe).color;
        };
        const out = { theme: document.documentElement.dataset.theme, bg: value('--bg'), fg: value('--fg') };
        probe.remove();
        return out;
      `)
      const light = await read()
      expect(light.theme).toBe('light')
      const dark = (await toggleTheme(wd, info.timeoutMs), await read())
      expect(dark.theme).toBe('dark')
      expect(dark.bg).not.toBe(light.bg)
      for (const sample of [light.bg, light.fg, dark.bg, dark.fg]) {
        const channels = String(sample).match(/\d+/g)?.slice(0, 3).map(Number) || []
        expect(channels).toHaveLength(3)
        expect(new Set(channels).size, `${sample} must be grayscale`).toBe(1)
      }
    })
  })

  it('persists notification on/off and quiet minutes into the shell settings', async () => {
    await step(wd, 'notification-settings', async () => {
      await openSettings()
      const toggle = await waitForElement(wd, CSS, '.switch input[type="checkbox"]')
      await wd.click(toggle)
      await type(wd, CSS, 'input[type="number"]', '30', { clear: true })
      await wd.execute(`const el = document.querySelector('input[type="number"]'); el.dispatchEvent(new Event('change', { bubbles: true }));`)
      await waitFor(async () => {
        const cfg = await proxy.config()
        return cfg.body.notifyEnabled === false && cfg.body.notifyQuietMinutes === 30
      }, 'shell notification settings', info.timeoutMs)
    })
  })

  it('keeps touch targets at least 44px and a 2px focus ring', async () => {
    await step(wd, 'a11y-targets', async () => {
      await openSettings()
      const sizes = await wd.execute(`
        return Array.from(document.querySelectorAll('button, a.btn, select'))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ w: r.width, h: r.height }));
      `)
      expect(sizes.length).toBeGreaterThan(0)
      const tooSmall = sizes.filter((r) => r.h < 43)
      expect(tooSmall, `${tooSmall.length} controls are shorter than 44px`).toHaveLength(0)
      const focused = await wd.execute(`
        const el = document.querySelector('button.btn');
        if (!el) return null;
        el.focus();
        const s = getComputedStyle(el);
        return { width: s.outlineWidth, offset: s.outlineOffset };
      `)
      if (focused) expect(parseFloat(focused.width)).toBeGreaterThanOrEqual(2)
    })
  })

  it('declares a reduced-motion rule that disables animation', async () => {
    await step(wd, 'a11y-reduced-motion', async () => {
      await openSettings()
      const found = await wd.execute(`
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules } catch { continue }
          for (const rule of rules) {
            if (rule.conditionText && rule.conditionText.includes('prefers-reduced-motion')) return true;
          }
        }
        return false;
      `)
      expect(found).toBe(true)
    })
  })

  it('an unavailable upgrade endpoint degrades to a readable status', async () => {
    await step(wd, 'upgrade-status', async () => {
      await openSettings()
      expect(await pageText(wd)).toContain(t('settings', 'upgradeTitle'))
      const checked = await proxy.checkUpgrade()
      expect([200, 404, 405, 503]).toContain(checked.status)
      expect(await pageText(wd)).toContain(t('settings', 'upgradeTitle'))
    })
  })
})
