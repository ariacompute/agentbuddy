// F3 — collaboration threads: create, mention, live events, batch delete,
// clear messages, back links and the failure paths.
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickContaining, confirmDialog, cancelDialog, navigateHash,
  pageText, rootState, step, waitForElement, waitForText, waitFor, tryFind, type,
} from '../driver/helpers.mjs'
import { t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests, fixtures } = e2eContext()

async function openList() {
  await navigateHash(wd, '/threads', info.timeoutMs)
  await waitForElement(wd, CSS, '.thread-card, .empty', info.timeoutMs)
}
async function openDetail(id = 'thread-1') {
  await navigateHash(wd, `/threads/${id}`, info.timeoutMs)
  await waitForElement(wd, CSS, '.composer, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F3 · threads', () => {
  beforeEach(async () => {
    await reset()
    await openList()
  })

  it('lists threads and creates one through the dialog', async () => {
    await step(wd, 'create-thread', async () => {
      if (info.backend === 'stub') expect((await wd.findAll(CSS, '.thread-card')).length).toBe(2)
      await clickContaining(wd, t('thread', 'newThread'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await type(wd, CSS, '[role="dialog"] input', 'E2E journey')
      await confirmDialog(wd, { danger: false })
      await waitFor(async () => (await rootState(wd)).hash.startsWith('#/threads/'), 'new thread route')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'POST' && r.path === '/api/threads')).toBe(true)
      }
    })
  })

  it('cancelling the create dialog sends no request', async () => {
    await step(wd, 'cancel-create-thread', async () => {
      await clickContaining(wd, t('thread', 'newThread'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await cancelDialog(wd)
      await waitFor(async () => (await tryFind(wd, CSS, '[role="dialog"]')) === null, 'dialog to close')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'POST' && r.path === '/api/threads')).toBe(false)
      }
    })
  })

  it.skipIf(!fixtures)('shows messages with their origin and streams new ones over SSE', async () => {
    await step(wd, 'thread-sse', async () => {
      await openDetail()
      expect((await wd.findAll(CSS, '.msg')).length).toBeGreaterThan(0)
      if (info.backend === 'stub') {
        const before = (await wd.findAll(CSS, '.msg')).length
        await proxy.pushSse('thread:thread-1', 'message', {
          ID: 'm-live', AuthorType: 'agent', AuthorName: 'Scout', Body: 'live frame',
          CreatedAt: '2026-11-11T09:10:00Z', Origin: 'voice', Failed: false,
        })
        await waitFor(async () => (await wd.findAll(CSS, '.msg')).length > before, 'incremental SSE message')
        expect(await pageText(wd)).toContain('live frame')
      }
    })
  })

  it.skipIf(!fixtures)('@mention opens the agent candidates and delegates on send', async () => {
    await step(wd, 'thread-mention', async () => {
      await openDetail()
      const composer = await waitForElement(wd, CSS, '.composer textarea')
      await wd.type(composer, 'please @')
      await waitFor(async () => (await tryFind(wd, CSS, '#mention-listbox')) !== null, 'mention candidates')
      const candidates = await wd.findAll(CSS, '.mention-item')
      expect(candidates.length).toBeGreaterThan(0)
      await wd.click(candidates[0])
      await clickContaining(wd, t('thread', 'send'), { tag: 'button' })
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path === '/api/threads/thread-1/messages'), 'delegated message')
      }
    })
  })

  it.skipIf(!fixtures)('clears all messages after a confirmation, keeping the thread', async () => {
    await step(wd, 'clear-messages', async () => {
      await openDetail()
      await clickContaining(wd, t('thread', 'clearMessages'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await confirmDialog(wd)
      await waitFor(async () => (await wd.findAll(CSS, '.msg')).length === 0, 'messages to clear')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'DELETE' && r.path === '/api/threads/thread-1/messages')).toBe(true)
      }
      expect(await pageText(wd)).toContain(t('thread', 'messagesEmpty'))
    })
  })

  it.skipIf(!fixtures)('cancelling clear-messages does not send the delete', async () => {
    await step(wd, 'cancel-clear-messages', async () => {
      await openDetail()
      await clickContaining(wd, t('thread', 'clearMessages'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await cancelDialog(wd)
      await waitFor(async () => (await tryFind(wd, CSS, '[role="dialog"]')) === null, 'dialog to close')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'DELETE' && r.path === '/api/threads/thread-1/messages')).toBe(false)
      }
    })
  })

  it('select-all enters selection mode and a confirmed batch deletes every row', async () => {
    await step(wd, 'batch-delete', async () => {
      if (!info.allowDestructive) return
      expect((await wd.findAll(CSS, '.thread-check')).length).toBe(0)
      await click(wd, CSS, '.thread-checkall input[type="checkbox"]')
      const checks = await waitFor(async () => {
        const found = await wd.findAll(CSS, '.thread-check')
        return found.length > 0 ? found : null
      }, 'selection mode')
      expect(checks.length).toBeGreaterThan(0)
      await clickContaining(wd, t('thread', 'deleteSelected'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await confirmDialog(wd)
      if (info.backend === 'stub') {
        await waitFor(async () => (await wd.findAll(CSS, '.thread-card')).length === 0, 'list to empty')
        const seen = await requests()
        expect(seen.filter((r) => r.method === 'DELETE' && r.path.startsWith('/api/threads/')).length).toBe(2)
      }
    })
  })

  it.skipIf(!fixtures)('the back link returns to the list even when the thread failed to load', async () => {
    await step(wd, 'thread-back-link', async () => {
      await openDetail()
      expect(await tryFind(wd, CSS, '.thread-back')).toBeTruthy()
      if (proxy.isStub) {
        await proxy.scenario('/api/threads/thread-1', 'unavailable')
        await wd.execute('window.location.reload()')
        await waitForElement(wd, CSS, '.thread-back', info.timeoutMs)
        await proxy.scenario('/api/threads/thread-1', 'ok')
      }
      await click(wd, CSS, '.thread-back')
      await waitFor(async () => (await rootState(wd)).hash === '#/threads', 'threads list')
    })
  })

  it('a failed list request shows a localised banner instead of a blank screen', async () => {
    await step(wd, 'thread-list-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/threads', 'server_error')
      await wd.execute('window.location.reload()')
      await waitFor(async () => (await tryFind(wd, CSS, '.banner')) !== null, 'error banner')
      expect(await tryFind(wd, CSS, '#app')).toBeTruthy()
      await proxy.scenario('/api/threads', 'ok')
    })
  })
})
