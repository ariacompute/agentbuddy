// Desktop session lifecycle: the connection page is the first thing a real user
// sees on a fresh install, so the harness goes through it too rather than
// pre-writing config.json. That also proves the health probe and the save path.
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../harness/lifecycle.mjs'
import { newDesktopSession, attachSession } from './webdriver.mjs'
import { CSS, XPATH, click, pageFetch, rootState, tryFind, waitForElement } from './helpers.mjs'
import { byLabel, t, textXPath } from './selectors.mjs'

/** Re-attaches the worker to the one session globalSetup created. */
export function attachFromSessionInfo(info) {
  return attachSession(info.driverUrl, info.sessionId, { timeoutMs: info.timeoutMs })
}

export function proxyOriginFrom(url) {
  try { return new URL(url).origin } catch { return '' }
}

/** Fills the shell's connect form and waits for the workbench to load. */
export async function connectServer(wd, serverUrl, { timeoutMs = 30_000 } = {}) {
  const boot = await wd.execute('return window.__SHELL__ ? window.__SHELL__.page : null')
  if (boot !== 'connect') {
    // Already configured (e.g. an operator reused a config dir): skip the form.
    return { connected: true, reused: true, boot }
  }
  const server = await waitForElement(wd, CSS, '#server', timeoutMs)
  await wd.clear(server)
  await wd.type(server, serverUrl)
  await click(wd, CSS, '#connect', timeoutMs)

  // `/__shell/config` is saved before the page redirects to `/`, so the
  // workbench bundle appearing is the user-visible proof the connection stuck.
  await waitFor(async () => {
    const app = await tryFind(wd, CSS, '#app')
    const connectPage = await tryFind(wd, CSS, '#connect')
    return app && !connectPage ? true : null
  }, 'the workbench to replace the connection page', timeoutMs)

  // Verify the shell actually persisted the address, not just navigated.
  const config = await pageFetch(wd, '/__shell/config')
  return { connected: !!config?.body?.serverUrl, reused: false, config: config?.body }
}

/** The UI language currently applied to <html>, falling back to English. */
function labelLang(state) {
  return state.lang || 'en'
}

/** Signs in through the login form. Anonymous /api/auth/me leads here by design. */
export async function signIn(wd, credentials, { timeoutMs = 30_000 } = {}) {
  const state = await rootState(wd)
  if (!state.hash.startsWith('#/login')) return { signedIn: true, reused: true }
  // A journey that failed while the form was in sign-up mode must not poison
  // every later sign-in: the toggle says "Sign in" exactly in that mode. Its
  // text is translated, so resolve it in the UI's current language.
  const toggle = t('shell', 'loginToggleSignIn', labelLang(state))
  const backToSignIn = await tryFind(wd, XPATH, textXPath(toggle, 'button')).catch(() => null)
  if (backToSignIn) await wd.click(backToSignIn)
  const email = await waitForElement(wd, CSS, 'input[type="email"]', timeoutMs)
  await wd.clear(email)
  await wd.type(email, credentials.email)
  const password = await waitForElement(wd, CSS, 'input[type="password"][autocomplete="current-password"]', timeoutMs)
  await wd.clear(password)
  await wd.type(password, credentials.password)
  await click(wd, CSS, 'button.btn.btn-primary[type="submit"]', timeoutMs)
  await waitFor(async () => {
    const root = await rootState(wd)
    return root.hash.startsWith('#/login') ? null : true
  }, 'login to leave the sign-in page', timeoutMs)
  return { signedIn: true, reused: false }
}

/** Signs out through the topbar, for the re-login / guard journeys. */
export async function signOut(wd, timeoutMs = 15_000) {
  // The topbar's aria-label is translated (e.g. 退出登录 for zh), so resolve it
  // in the UI's current language — a hardcoded English label hangs for the full
  // timeout on every non-English run.
  const lang = labelLang(await rootState(wd))
  const signOutButton = await waitForElement(wd, CSS, `.topbar ${byLabel('shell', 'accountSignOut', lang)}`, timeoutMs)
  await wd.click(signOutButton)
  await waitFor(async () => (await rootState(wd)).hash.startsWith('#/login'), 'sign-out redirect', timeoutMs)
}

/** One call for globalSetup: create the session, connect, sign in, report origin. */
export async function openDesktopSession(cfg, serverUrl) {
  const wd = await newDesktopSession(cfg.driverUrl, cfg.appBinary, { timeoutMs: cfg.startupMs })

  // The app only writes its single-instance record once it is really running.
  // Seeing it in *our* directory proves the binary was built with the
  // e2e-isolation feature; otherwise the run would be touching the user's real
  // config, so stop before the connect form can save anything.
  if (cfg.configDir) {
    await waitFor(
      () => fs.existsSync(path.join(cfg.configDir, 'instance.json')),
      'the isolated config dir (build with --features e2e-isolation)',
      20_000,
    )
  }

  await waitFor(async () => {
    const url = await wd.url().catch(() => '')
    return proxyOriginFrom(url) ? true : null
  }, 'the loopback proxy URL', cfg.startupMs)
  const origin = proxyOriginFrom(await wd.url())
  const connection = await connectServer(wd, serverUrl, { timeoutMs: cfg.startupMs })
  await signIn(wd, cfg.credentials, { timeoutMs: cfg.startupMs })
  await waitForElement(wd, CSS, '.shell, .login-card, #app', cfg.startupMs)
  return { wd, proxyOrigin: origin, connection }
}
