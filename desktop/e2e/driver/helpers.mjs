// User-visible actions only: find something on screen, click it, type into it,
// read what it says. Nothing here reaches into Vue internals or a Pinia store.
import { waitFor } from '../harness/lifecycle.mjs'
import { appendEvent, saveFailureScreenshot } from '../harness/report.mjs'
import { containsTextXPath, t, textXPath } from './selectors.mjs'

// Specs import every helper from this one module. Re-export the poll loop so a
// journey never has to know which layer owns it (a missing export silently
// resolves to undefined under Vite's SSR transform, so guard it statically).
export { waitFor }

export const CSS = 'css selector'
export const XPATH = 'xpath'

const RETRYABLE = new Set(['no such element', 'stale element reference', 'element not interactable', 'element click intercepted'])

/** A missing element is a normal "not yet", not a test failure. */
export async function tryFind(wd, using, value) {
  try {
    return await wd.find(using, value)
  } catch (error) {
    if (RETRYABLE.has(error.code)) return null
    throw error
  }
}

export async function waitForElement(wd, using, value, timeoutMs = 10_000) {
  return waitFor(() => tryFind(wd, using, value), `element ${value}`, timeoutMs)
}

export async function waitForGone(wd, using, value, timeoutMs = 10_000) {
  return waitFor(async () => (await tryFind(wd, using, value)) === null, `element ${value} to disappear`, timeoutMs)
}

export async function click(wd, using, value, timeoutMs = 10_000) {
  return waitFor(async () => {
    const id = await tryFind(wd, using, value)
    if (!id) return null
    try {
      await wd.click(id)
      return true
    } catch (error) {
      if (RETRYABLE.has(error.code)) return null
      throw error
    }
  }, `click ${value}`, timeoutMs)
}

export async function type(wd, using, value, text, { clear = true, timeoutMs = 10_000 } = {}) {
  const id = await waitForElement(wd, using, value, timeoutMs)
  if (clear) await wd.clear(id).catch(() => {})
  await wd.type(id, String(text))
  return id
}

export async function clickText(wd, text, { tag = '*', timeoutMs = 10_000 } = {}) {
  return click(wd, XPATH, textXPath(text, tag), timeoutMs)
}

export async function clickContaining(wd, text, { tag = '*', timeoutMs = 10_000 } = {}) {
  return click(wd, XPATH, containsTextXPath(text, tag), timeoutMs)
}

/** Clicks a button whose label comes from a copy key, in the current language. */
/**
 * Clicks something that opens a native window.confirm. W3C WebDriver reports
 * an "unexpected alert open" for the click itself on some platforms, so both
 * outcomes are accepted before the dialog is explicitly handled.
 */
export async function clickWithAlert(wd, using, value, { accept = true, timeoutMs = 10_000 } = {}) {
  const id = await waitForElement(wd, using, value, timeoutMs)
  try {
    await wd.click(id)
  } catch (error) {
    const text = `${error.code || ''} ${error.message}`
    if (!/alert|dialog/i.test(text)) throw error
  }
  try {
    if (accept) await wd.acceptAlert()
    else await wd.dismissAlert()
  } catch { /* some drivers auto-dismiss */ }
}

/** BaseDialog's footer is the only place these two buttons live, so scoping
 * avoids accidentally clicking a same-labelled button behind the backdrop. */
export async function confirmDialog(wd, { danger = true, timeoutMs = 10_000 } = {}) {
  const selector = danger ? '.dialog-foot .btn.btn-danger' : '.dialog-foot .btn.btn-primary'
  return click(wd, CSS, selector, timeoutMs)
}

export async function cancelDialog(wd, timeoutMs = 10_000) {
  return click(wd, CSS, '.dialog-foot .btn.btn-ghost', timeoutMs)
}

export async function clickCopy(wd, namespace, key, lang = 'en', options = {}) {
  const label = t(namespace, key, lang)
  if (!label) throw new Error(`missing copy key ${namespace}.${key}`)
  return clickContaining(wd, label, { tag: options.tag || 'button', timeoutMs: options.timeoutMs })
}

export async function pageText(wd) {
  return (await wd.execute('return document.body ? document.body.innerText : ""')) || ''
}

export async function waitForText(wd, text, timeoutMs = 10_000) {
  return waitFor(async () => (await pageText(wd)).includes(text), `visible text "${text}"`, timeoutMs)
}

export async function waitForNoText(wd, text, timeoutMs = 10_000) {
  return waitFor(async () => !(await pageText(wd)).includes(text), `text "${text}" to disappear`, timeoutMs)
}

export async function waitForSelectorText(wd, using, value, expected, timeoutMs = 10_000) {
  return waitFor(async () => {
    const id = await tryFind(wd, using, value)
    if (!id) return null
    const text = (await wd.text(id).catch(() => '')) || ''
    return text.includes(expected) ? text : null
  }, `${value} to say "${expected}"`, timeoutMs)
}

export async function rootState(wd) {
  return wd.execute(`return {
    theme: document.documentElement.dataset.theme || '',
    lang: document.documentElement.lang || '',
    dir: document.documentElement.dir || '',
    hash: window.location.hash || '',
    href: window.location.href || '',
    title: document.title || '',
    langStored: window.localStorage.getItem('agentbuddy.lang') || '',
    themeStored: window.localStorage.getItem('agentbuddy.theme') || ''
  }`)
}

export async function hash(wd) {
  return (await wd.execute('return window.location.hash')) || ''
}

/** Sets the hash without assuming it will stick. A route guard is allowed to
 * redirect immediately (e.g. an anonymous deep link -> /login?next=), so those
 * journeys must use setHash() and wait for the redirect instead. */
export async function setHash(wd, path) {
  const target = path.startsWith('#') ? path : `#${path}`
  await wd.execute(`window.location.hash = ${JSON.stringify(target)}; return true`)
  return target
}

/** Hash-router navigation; at least one journey uses a real menu click instead. */
export async function navigateHash(wd, path, timeoutMs = 10_000) {
  const target = await setHash(wd, path)
  await waitFor(async () => (await hash(wd)) === target, `route ${target}`, timeoutMs)
  return target
}

/** Leaves a route and comes back so its component really remounts and re-fetches.
 * Fault injection only changes what the *next* request returns; setting the same
 * hash twice fires no hashchange and would leave the old view on screen. */
export async function remount(wd, path, timeoutMs = 10_000) {
  await navigateHash(wd, '/', timeoutMs)
  return navigateHash(wd, path, timeoutMs)
}

export async function clickNav(wd, label, expectedPath, lang = 'en') {
  await clickContaining(wd, label, { tag: 'a' })
  await waitFor(async () => (await hash(wd)).startsWith(`#${expectedPath}`), `menu route ${expectedPath}`)
}

/** Changes the language through the real select, then waits for <html lang|dir>. */
export async function selectLanguage(wd, lang, timeoutMs = 10_000) {
  const changed = await wd.execute(`
    const select = document.querySelector('select.lang-select');
    if (!select) return false;
    select.value = arguments[0];
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `, [lang])
  if (!changed) throw new Error('language selector not found')
  await waitFor(async () => (await rootState(wd)).lang === lang, `<html lang="${lang}">`, timeoutMs)
  return rootState(wd)
}

export async function toggleTheme(wd, timeoutMs = 10_000) {
  const before = (await rootState(wd)).theme
  await click(wd, CSS, 'button.btn-icon[aria-label="Theme"]')
  await waitFor(async () => (await rootState(wd)).theme !== before, 'theme to change', timeoutMs)
  return rootState(wd)
}

/**
 * Runs a fetch *inside the WebView* so the request carries the proxy cookie and
 * a same-origin Origin. That is the only way to assert on /__shell/* and on the
 * four forwarded prefixes without inventing a new IPC surface.
 */
export async function pageFetch(wd, path, options = {}, timeoutMs = 15_000) {
  const args = [path, options.method || 'GET', options.body === undefined ? null : JSON.stringify(options.body), options.headers || {}]
  await wd.execute(`
    window.__E2E_FETCH_DONE = false;
    window.__E2E_FETCH_RESULT = null;
    const [p, method, body, extra] = arguments[0];
    const init = { method, headers: Object.assign({}, extra), credentials: 'same-origin' };
    if (body !== null) {
      init.body = body;
      if (!init.headers['content-type'] && !init.headers['Content-Type']) init.headers['content-type'] = 'application/json';
    }
    fetch(p, init).then(async (res) => {
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      window.__E2E_FETCH_RESULT = {
        status: res.status, ok: res.ok, body: parsed,
        headers: {
          contentType: res.headers.get('content-type'),
          cacheControl: res.headers.get('cache-control'),
          xContentTypeOptions: res.headers.get('x-content-type-options'),
          contentSecurityPolicy: res.headers.get('content-security-policy'),
        },
      };
    }).catch((error) => {
      window.__E2E_FETCH_RESULT = { status: 0, ok: false, error: String(error) };
    }).finally(() => { window.__E2E_FETCH_DONE = true; });
    return true;
  `, [args])
  await waitFor(() => wd.execute('return window.__E2E_FETCH_DONE === true'), `page fetch ${path}`, timeoutMs)
  return wd.execute('return window.__E2E_FETCH_RESULT')
}

/** Wraps one user step; a failure leaves a screenshot and an audit event. */
export async function step(wd, name, fn) {
  try {
    const value = await fn()
    appendEvent({ event: 'step', name, ok: true })
    return value
  } catch (error) {
    appendEvent({ event: 'step', name, ok: false, error: error.message })
    try {
      const png = await wd?.screenshot()
      if (png) saveFailureScreenshot(png, name)
    } catch { /* a dead session cannot be screenshotted */ }
    throw error
  }
}
