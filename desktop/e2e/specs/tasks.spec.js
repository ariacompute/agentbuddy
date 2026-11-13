// F4 — task list, state filters, server-side clear, trace view and HITL resume.
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, cancelDialog, click, confirmDialog, navigateHash, pageText, remount, rootState,
  step, waitForElement, waitForSelectorText, waitForText, waitFor, tryFind, type,
} from '../driver/helpers.mjs'
import { errorMessage, t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests, fixtures } = e2eContext()

/** A fresh mount is what makes the "GET before clear, GET after clear"
 * assertion meaningful: re-setting the same hash fires no hashchange. */
async function openList() {
  await remount(wd, '/tasks', info.timeoutMs)
  if (proxy.isStub) {
    await waitFor(async () => (await requests()).some((r) => r.method === 'GET' && r.path === '/api/tasks'), 'task list fetch', info.timeoutMs)
  }
  await waitForElement(wd, CSS, '.grid.grid-2, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F4 · tasks and traces', () => {
  beforeEach(async () => {
    await reset()
    await openList()
  })

  it('lists tasks across the whole state machine and filters completed ones', async () => {
    await step(wd, 'task-filters', async () => {
      if (info.backend === 'stub') expect((await wd.findAll(CSS, '.grid.grid-2 > .card')).length).toBe(4)
      for (const label of [t('task', 'filterAll'), t('task', 'filterActive'), t('task', 'filterWaiting'), t('task', 'filterDone')]) {
        expect(await pageText(wd)).toContain(label)
      }
      await click(wd, CSS, '.row.row-wrap > button.btn.btn-sm:nth-of-type(4)')
      expect((await wd.findAll(CSS, '.grid.grid-2 > .card')).length).toBeLessThanOrEqual(2)
    })
  })

  it('clears finished tasks and reports how many in-flight records were kept', async () => {
    await step(wd, 'clear-tasks', async () => {
      if (!info.allowDestructive) return
      await click(wd, CSS, '.task-clear')
      await waitForElement(wd, CSS, '[role="dialog"]')
      await confirmDialog(wd)
      await waitFor(async () => (await tryFind(wd, CSS, '[role="dialog"]')) === null, 'clear dialog to close')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'DELETE' && r.path === '/api/tasks')).toBe(true)
        expect(seen.filter((r) => r.method === 'GET' && r.path === '/api/tasks').length).toBeGreaterThan(1)
        await waitFor(async () => (await pageText(wd)).includes(t('task', 'clearAllKept').replace('{count}', '2')), 'kept banner')
      }
    })
  })

  it('cancelling clear-all sends no delete request', async () => {
    await step(wd, 'cancel-clear-tasks', async () => {
      await click(wd, CSS, '.task-clear')
      await waitForElement(wd, CSS, '[role="dialog"]')
      await cancelDialog(wd)
      await waitFor(async () => (await tryFind(wd, CSS, '[role="dialog"]')) === null, 'dialog to close')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'DELETE' && r.path === '/api/tasks')).toBe(false)
      }
    })
  })

  it('an old server without DELETE /api/tasks degrades to a localised feature message', async () => {
    await step(wd, 'clear-tasks-405', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('DELETE /api/tasks', 'unavailable')
      await click(wd, CSS, '.task-clear')
      await waitForElement(wd, CSS, '[role="dialog"]')
      await confirmDialog(wd)
      await waitForSelectorText(wd, CSS, '[data-test="clear-error"]', errorMessage('feature_unavailable'), info.timeoutMs)
      expect(await tryFind(wd, CSS, '[role="dialog"]')).toBeTruthy()
      await proxy.scenario('DELETE /api/tasks', 'ok')
    })
  })

  it.skipIf(!fixtures)('the trace view shows timeline, spans and artifacts, and cancels a live task', async () => {
    await step(wd, 'task-trace-cancel', async () => {
      await navigateHash(wd, '/tasks/task-1', info.timeoutMs)
      await waitForElement(wd, CSS, '.timeline', info.timeoutMs)
      expect((await wd.findAll(CSS, '.timeline .step')).length).toBeGreaterThan(1)
      expect((await wd.findAll(CSS, '.spans .span-row')).length).toBeGreaterThan(0)
      await click(wd, CSS, '.btn.btn-sm.btn-danger')
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.path === '/api/tasks/task-1/cancel'), 'cancel request')
      }
    })
  })

  it.skipIf(!fixtures)('an input-required task can be resumed with an answer', async () => {
    await step(wd, 'task-resume', async () => {
      await navigateHash(wd, '/tasks/task-2', info.timeoutMs)
      await waitForElement(wd, CSS, 'textarea', info.timeoutMs)
      await type(wd, CSS, 'textarea', 'approved by E2E')
      await click(wd, CSS, '.btn.btn-primary.btn-sm')
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.path === '/api/tasks/task-2/resume'), 'resume request')
      }
    })
  })

  it('the back link is always visible, including for a missing task', async () => {
    await step(wd, 'task-back-link', async () => {
      await navigateHash(wd, '/tasks/does-not-exist', info.timeoutMs)
      await waitForElement(wd, CSS, '.task-back', info.timeoutMs)
      await waitForText(wd, t('task', 'notFound'), info.timeoutMs).catch(async () => {
        expect(await tryFind(wd, CSS, '.task-back')).toBeTruthy()
      })
      await click(wd, CSS, '.task-back')
      await waitFor(async () => (await rootState(wd)).hash === '#/tasks', 'tasks list')
    })
  })

  it('a failed tasks request shows a banner instead of an empty-looking success', async () => {
    await step(wd, 'tasks-server-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/tasks', 'server_error')
      await wd.execute('window.location.reload()')
      await waitFor(async () => (await tryFind(wd, CSS, '.banner')) !== null, 'error banner')
      await proxy.scenario('/api/tasks', 'ok')
    })
  })
})
