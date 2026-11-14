// Screenshot generator: drives the single already-authenticated desktop session
// through every screen, in English and Chinese (light theme), and writes one PNG
// per screen to agentbuddy/screenshots/<lang>/<feature>.png. It does NOT assert
// on app behaviour — a failed shot is logged (events.jsonl + failure screenshot)
// and skipped so the remaining 29 still land.
import { beforeAll, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, navigateHash, pageFetch, scrollToTop, selectLanguage, step, waitForElement,
} from '../driver/helpers.mjs'
import { signIn, signOut } from '../driver/session.mjs'
import { saveScreenshot } from '../harness/report.mjs'

const { info, cfg, wd } = e2eContext()

const LANGS = ['en', 'zh']
const ROUTES = [
  '/login', '/', '/threads', '/threads/:id', '/tasks', '/tasks/:id',
  '/org', '/channels', '/connectors', '/settings', '/computers',
  '/schedules', '/persona', '/knowledge', '/files',
]
// File names use the feature's own language, matching the sidebar navXxx copy.
const ROUTE_NAMES = {
  '/login': { en: 'Login', zh: '登录' },
  '/': { en: 'Workbench', zh: '工作台' },
  '/threads': { en: 'Threads', zh: '会话' },
  '/threads/:id': { en: 'Thread', zh: '会话详情' },
  '/tasks': { en: 'Tasks', zh: '任务' },
  '/tasks/:id': { en: 'Task', zh: '任务详情' },
  '/org': { en: 'Organisation', zh: '组织' },
  '/channels': { en: 'Channels', zh: '通道' },
  '/connectors': { en: 'Connectors', zh: '连接器' },
  '/settings': { en: 'Settings', zh: '设置' },
  '/computers': { en: 'Computers', zh: '计算机' },
  '/schedules': { en: 'Schedules', zh: '目标调度' },
  '/persona': { en: 'Persona', zh: '人格' },
  '/knowledge': { en: 'Knowledge', zh: '知识库' },
  '/files': { en: 'Files', zh: '文件' },
}

function pickId(item) {
  return item?.ID ?? item?.id ?? item?.threadId ?? item?.taskId ?? undefined
}

/** Resolves the first id from a list endpoint, tolerant of wrapper shapes. */
function firstId(res, pluralKey) {
  const body = res?.body
  if (!body) return null
  const arr = Array.isArray(body) ? body : (body[pluralKey] || body.items || body.data || body.rows)
  if (!Array.isArray(arr) || arr.length === 0) return null
  return pickId(arr[0])
}

/** Live servers have no fixed fixtures; pull a real id so detail screens render. */
async function resolveRoute(wd, route) {
  if (route === '/threads/:id') {
    const res = await pageFetch(wd, '/api/threads').catch(() => null)
    const id = firstId(res, 'threads') || 'thread-1'
    return `/threads/${id}`
  }
  if (route === '/tasks/:id') {
    const res = await pageFetch(wd, '/api/tasks').catch(() => null)
    const id = firstId(res, 'tasks') || 'task-2'
    return `/tasks/${id}`
  }
  return route
}

async function waitForScreen(wd, route) {
  if (route === '/login') {
    await waitForElement(wd, CSS, 'input[type="email"]', info.timeoutMs)
  } else {
    await waitForElement(wd, CSS, '.shell', info.timeoutMs)
  }
  // Let lists, avatars and charts paint before the shutter falls.
  await wd.execute('return new Promise((r) => setTimeout(r, 600))').catch(() => {})
}

describe.skipIf(info.skipped)('agentbuddy screenshots (en / zh)', () => {
  beforeAll(async () => {
    // globalSetup signs in and lands on the workbench; make that explicit.
    await navigateHash(wd, '/')
    await waitForElement(wd, CSS, '.shell', info.timeoutMs)
  })

  it('captures all 15 screens in English and Chinese', async () => {
    // Walk en then zh. The login screen needs an anonymous session, so each
    // language's login shot signs out, captures, then signs back in.
    const order = []
    for (const lang of LANGS) {
      for (const route of ROUTES) order.push({ lang, route, name: ROUTE_NAMES[route][lang] })
    }

    let signedIn = true
    let currentLang = null
    let failures = 0

    for (const { lang, route, name } of order) {
      try {
        if (lang !== currentLang) {
          await step(wd, `lang-${lang}`, async () => { await selectLanguage(wd, lang) })
          currentLang = lang
        }

        if (route === '/login') {
          if (signedIn) {
            await step(wd, 'signout', async () => { await signOut(wd, info.timeoutMs) })
            signedIn = false
            await selectLanguage(wd, lang).catch(() => {}) // re-assert on the login page
          }
          await step(wd, `shot-${lang}-login`, async () => {
            await waitForScreen(wd, '/login')
            await scrollToTop(wd)
            const png = await wd.screenshot()
            saveScreenshot(png, `${lang}/${name}`)
          })
          await step(wd, 'signin', async () => { await signIn(wd, cfg.credentials, { timeoutMs: info.timeoutMs }) })
          signedIn = true
          await waitForElement(wd, CSS, '.shell', info.timeoutMs)
        } else {
          if (!signedIn) {
            await step(wd, 'signin', async () => { await signIn(wd, cfg.credentials, { timeoutMs: info.timeoutMs }) })
            signedIn = true
            await waitForElement(wd, CSS, '.shell', info.timeoutMs)
            await selectLanguage(wd, lang).catch(() => {})
          }
          await step(wd, `shot-${lang}-${route}`, async () => {
            const path = await resolveRoute(wd, route)
            await navigateHash(wd, path)
            await waitForScreen(wd, route)
            const png = await wd.screenshot()
            saveScreenshot(png, `${lang}/${name}`)
          })
        }
      } catch {
        // step() already recorded the failure and saved a failure screenshot.
        failures += 1
      }
    }

    expect(failures).toBe(0)
  })
})
