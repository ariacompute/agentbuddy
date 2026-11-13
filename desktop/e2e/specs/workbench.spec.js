// F2 / F15 — the workbench landing screen: agents, activity and approvals.
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickContaining, clickCopy, navigateHash, pageText, rootState,
  step, waitForElement, waitForText, waitFor, tryFind,
} from '../driver/helpers.mjs'
import { t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests, fixtures } = e2eContext()

async function open() {
  await navigateHash(wd, '/', info.timeoutMs)
  await waitForElement(wd, CSS, '.agent-card, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F2 · workbench and approvals', () => {
  beforeEach(async () => {
    await reset()
    await open()
  })

  it('shows agent cards, the activity feed and the connection chip', async () => {
    await step(wd, 'workbench-renders', async () => {
      expect(await pageText(wd)).toContain(t('workspace', 'title'))
      expect(await pageText(wd)).toContain(t('workspace', 'agentsTitle'))
      expect(await pageText(wd)).toContain(t('workspace', 'activityTitle'))
      const cards = await wd.findAll(CSS, '.agent-card')
      if (info.backend === 'stub') expect(cards.length).toBe(2)
      expect((await wd.findAll(CSS, '.topbar .chip')).length).toBeGreaterThan(0)
    })
  })

  // ApprovalCard renders its three actions in a scoped row; the labels come from
  // a different copy namespace than the rest of the card, so a CSS selector is
  // the stable locator here (the suite never depends on a possibly blank label).
  // The `.approval-card` class keeps these locators off the activity rows, which
  // share `.card.card-hover.row`.
  const APPROVAL = {
    approve: '.approval-card .btn.btn-primary',
    reject: '.approval-card .btn.btn-danger',
    view: '.approval-card .btn.btn-ghost',
  }

  it.skipIf(!fixtures)('groups input-required tasks into an approval card and approves one', async () => {
    await step(wd, 'approve-task', async () => {
      await waitForText(wd, t('workspace', 'approvalsTitle'))
      await click(wd, CSS, APPROVAL.approve)
      await waitFor(async () => (await tryFind(wd, CSS, '.approval-card')) === null, 'approval card to disappear')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'POST' && r.path === '/api/tasks/task-2/resume')).toBe(true)
      }
    })
  })

  it.skipIf(!fixtures)('rejects an approval without running the task', async () => {
    await step(wd, 'reject-task', async () => {
      await waitForText(wd, t('workspace', 'approvalsTitle'))
      await click(wd, CSS, APPROVAL.reject)
      await waitFor(async () => (await tryFind(wd, CSS, '.approval-card')) === null, 'approval card to disappear')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'POST' && r.path === '/api/tasks/task-2/cancel')).toBe(true)
        expect(seen.some((r) => r.path === '/api/tasks/task-2/resume')).toBe(false)
      }
    })
  })

  it.skipIf(!fixtures)('view opens the task trace and new thread opens the thread list', async () => {
    await step(wd, 'workbench-links', async () => {
      await click(wd, CSS, APPROVAL.view)
      await waitFor(async () => (await rootState(wd)).hash.startsWith('#/tasks/'), 'task trace route')
      await clickContaining(wd, t('task', 'backToTasks'), { tag: 'a' }).catch(() => {})
      await open()
      await clickCopy(wd, 'workspace', 'newThread')
      await waitFor(async () => (await rootState(wd)).hash === '#/threads', 'threads route')
    })
  })

  it('an activity row opens the matching task trace', async () => {
    await step(wd, 'activity-link', async () => {
      // The first `.card.card-hover.row` is the approval card, which has no click
      // handler on its body; the activity rows carry `.activity-row`.
      await click(wd, CSS, '.activity-row')
      await waitFor(async () => (await rootState(wd)).hash.startsWith('#/tasks/'), 'activity deep link')
    })
  })

  it('renders the empty state when the server has no agents', async () => {
    await step(wd, 'workbench-empty', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/workspace', 'empty')
      await wd.execute('window.location.reload()')
      await waitForText(wd, t('workspace', 'agentsEmpty'), info.timeoutMs)
      expect((await wd.findAll(CSS, '.agent-card')).length).toBe(0)
      await proxy.scenario('/api/workspace', 'ok')
    })
  })

  it('shows a server error as a localised banner rather than a blank screen', async () => {
    await step(wd, 'workbench-server-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/workspace', 'server_error')
      await wd.execute('window.location.reload()')
      await waitFor(async () => (await pageText(wd)).includes('internal_error') || (await tryFind(wd, CSS, '.banner')) !== null, 'error banner')
      expect(await tryFind(wd, CSS, '#app')).toBeTruthy()
      await proxy.scenario('/api/workspace', 'ok')
    })
  })
})
