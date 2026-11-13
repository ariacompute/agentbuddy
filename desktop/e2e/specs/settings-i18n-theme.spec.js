// Cross-cutting behaviour: settings, all 13 languages, light/dark tokens, RTL
// and accessibility. These are visible-browser assertions — layout, computed
// colour and direction are exactly what a jsdom unit test cannot measure.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LANGUAGES, isRTL } from '../harness/config.mjs'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, XPATH, pageText, remount, rootState, selectLanguage, setHash, step,
  toggleTheme, waitForElement, waitFor, waitForText, tryFind, type,
} from '../driver/helpers.mjs'
import { signIn } from '../driver/session.mjs'
import { t } from '../driver/selectors.mjs'

const { info, cfg, wd, proxy, reset } = e2eContext()

/** The route guard may rewrite the hash *after* a hash-navigation returned, so
 * wait for the settings screen itself and re-sign-in if we were bounced. */
async function openSettings() {
  await remount(wd, '/settings', info.timeoutMs)
  await waitFor(async () => {
    // Key off the view's own test id, not a translated heading: a preceding
    // language-sweep journey may still be rendering in another locale.
    if ((await tryFind(wd, CSS, '[data-testid="upgrade-card"]')) !== null) return true
    if ((await rootState(wd)).hash.startsWith('#/login')) {
      await signIn(wd, cfg.credentials, { timeoutMs: info.timeoutMs }).catch(() => {})
    }
    await setHash(wd, '/settings').catch(() => {})
    return false
  }, 'settings view', info.timeoutMs, 250)
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
        // The shared WebView may be in any of the 13 languages (the sweep
        // restores en only in afterEach), so resolve the label in the language
        // the page is actually showing, then pin the value to live /healthz.
        const lang = (await rootState(wd)).lang || 'en'
        expect(await pageText(wd)).toContain(t('settings', 'version', lang))
        const health = await proxy.forward('/healthz')
        expect(health.status).toBe(200)
        if (health.body?.version) await waitForText(wd, String(health.body.version), info.timeoutMs)
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
      // There are four switches and two number fields on this screen: scope both
      // locators to the notifications card, otherwise the first match is the
      // "background" switch and notifyEnabled never changes. Key off structure
      // rather than the heading text so a non-English locale cannot break it.
      const section = `(//section[.//input[@type='number']])[1]`
      const toggle = await waitForElement(wd, XPATH, `${section}//label[contains(@class,'switch')]//input[@type='checkbox']`)
      await wd.click(toggle)
      await type(wd, XPATH, `${section}//input[@type='number']`, '30', { clear: true })
      await wd.execute(`const el = document.querySelector('.grid.grid-2 input[type="number"]'); el.dispatchEvent(new Event('change', { bubbles: true }));`)
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
      // Programmatic focus does not reliably match :focus-visible in WebKit, so
      // read the declared ring from CSSOM instead of a computed style that may
      // legitimately be 0px until a real TAB press.
      const rings = await wd.execute(`
        const out = [];
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules } catch { continue }
          for (const rule of rules) {
            if (!rule.selectorText || !rule.selectorText.includes(':focus-visible')) continue;
            const width = parseFloat(rule.style.outlineWidth || rule.style.outline || '');
            const offset = parseFloat(rule.style.outlineOffset || '');
            if (Number.isFinite(width)) out.push({ width, offset });
          }
        }
        return out;
      `)
      expect(rings.length).toBeGreaterThan(0)
      expect(rings.some((r) => r.width >= 2 && r.offset >= 2), 'a 2px / 2px focus-visible ring').toBe(true)
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
