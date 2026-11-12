// F7 / F19 — connectors: policies, action catalogue, execution and the
// approval queue. Native window.confirm is handled through the WebDriver alert
// API, exactly as a user would press "OK".
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickContaining, clickWithAlert, pageText, remount, step,
  waitForElement, waitForText, waitFor, tryFind,
} from '../driver/helpers.mjs'
import { errorMessage, t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests } = e2eContext()

/** Each journey needs a fresh view: the declared-action list is cached per
 * visit, and an approval decision changes the queue. Setting the same hash
 * again fires no hashchange, so leave the route and come back. */
async function open() {
  await remount(wd, '/connectors', info.timeoutMs)
  // `.policy-opt` exists only on this screen, and unlike a translated heading
  // it stays findable when the preceding journey switched the UI language.
  await waitFor(async () => (await tryFind(wd, CSS, '.policy-opt')) !== null, 'connectors view', info.timeoutMs)
  await waitForElement(wd, CSS, '.grid.grid-2, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F7/F19 · connectors and approvals', () => {
  beforeEach(async () => {
    await reset()
    await open()
  })

  it('lists connectors with their policy and health', async () => {
    await step(wd, 'connector-list', async () => {
      expect(await pageText(wd)).toContain(t('connector', 'policyLabel'))
      if (info.backend === 'stub') expect((await wd.findAll(CSS, '.grid.grid-2 > .card')).length).toBe(2)
      expect((await wd.findAll(CSS, '.policy-opt.is-on')).length).toBeGreaterThan(0)
      expect((await wd.findAll(CSS, '.state-dot')).length).toBeGreaterThan(0)
    })
  })

  it('changes a policy after a native confirmation', async () => {
    await step(wd, 'connector-policy', async () => {
      const options = await wd.findAll(CSS, '.policy-opt')
      expect(options.length).toBeGreaterThanOrEqual(3)
      const allowed = await tryFind(wd, CSS, '.policy-opt:nth-of-type(1)')
      if (allowed) await clickWithAlert(wd, CSS, '.policy-opt:nth-of-type(1)', { accept: true })
      else await wd.click(options[0]).then(() => wd.acceptAlert().catch(() => {}))
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'PUT' && r.path.endsWith('/policy')), 'policy save')
      }
    })
  })

  it('dismissing the policy confirmation does not change the server', async () => {
    await step(wd, 'connector-policy-cancel', async () => {
      const options = await wd.findAll(CSS, '.policy-opt:not(.is-on)')
      if (!options.length) return
      await clickWithAlert(wd, CSS, '.policy-opt:not(.is-on)', { accept: false })
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'PUT' && r.path.endsWith('/policy'))).toBe(false)
      }
    })
  })

  it('expands declared actions once, and collapsing does not re-fetch', async () => {
    await step(wd, 'connector-actions-expand', async () => {
      await clickContaining(wd, t('ops', 'connectorActions'), { tag: 'button' })
      await waitFor(async () => (await tryFind(wd, CSS, '.trigger-list')) !== null, 'action list')
      if (info.backend === 'stub') {
        const first = (await requests()).filter((r) => r.path === '/api/connectors/connector-1/actions').length
        expect(first).toBe(1)
        await clickContaining(wd, t('ops', 'connectorActions'), { tag: 'button' })
        expect((await requests()).filter((r) => r.path === '/api/connectors/connector-1/actions').length).toBe(1)
      }
    })
  })

  it('shows the failure reason when the action catalogue cannot be read', async () => {
    await step(wd, 'connector-actions-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('GET /api/connectors/connector-1/actions', 'server_error')
      await clickContaining(wd, t('ops', 'connectorActions'), { tag: 'button' })
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('internal_error')), 'catalogue error')
      await proxy.scenario('GET /api/connectors/connector-1/actions', 'ok')
    })
  })

  it('runs an action and reports whether it was parked for approval', async () => {
    await step(wd, 'connector-run', async () => {
      // Every journey now starts from a fresh (collapsed) view, so expand the
      // declared actions instead of relying on the previous test's UI state.
      await clickContaining(wd, t('ops', 'connectorActions'), { tag: 'button' })
      const inputs = await waitForElement(wd, CSS, '.connector-actions input', info.timeoutMs)
      expect(inputs).toBeTruthy()
      await waitFor(async () => (await wd.findAll(CSS, '.connector-actions input')).length >= 2, 'action inputs', info.timeoutMs)
      expect(inputs.length).toBeGreaterThanOrEqual(2)
      await wd.type(inputs[0], 'create_issue')
      await click(wd, CSS, '.connector-actions .btn.btn-sm.btn-primary')
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path.endsWith('/actions')), 'action run')
        expect(await pageText(wd)).toContain(t('connector', 'runParked'))
      }
    })
  })

  it('approves a parked action and removes it from the queue', async () => {
    await step(wd, 'connector-approve', async () => {
      await waitForText(wd, t('connector', 'approvalsTitle'))
      await clickContaining(wd, t('connector', 'approvalApprove'), { tag: 'button' })
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.path === '/api/connectors/approvals/approval-1/approve'), 'approval request')
        // The request log is written before the client re-reads the queue, so
        // poll the DOM instead of asserting the row count in the same tick.
        await waitFor(async () => (await wd.findAll(CSS, '.trigger-list > .trigger-row')).length === 0, 'approval queue to empty', info.timeoutMs)
      }
    })
  })

  it('rejecting an already-closed approval keeps the row and shows the reason', async () => {
    await step(wd, 'connector-reject-conflict', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('POST /api/connectors/approvals/approval-1/reject', 'server_error', { status: 409, code: 'connector_approval_closed' })
      await clickContaining(wd, t('connector', 'approvalReject'), { tag: 'button' })
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('connector_approval_closed')), 'closed-approval error')
      expect((await wd.findAll(CSS, '.trigger-list > .trigger-row')).length).toBeGreaterThan(0)
      await proxy.scenario('POST /api/connectors/approvals/approval-1/reject', 'ok')
    })
  })

  it('a failed approval-queue request shows a retry affordance', async () => {
    await step(wd, 'connector-approvals-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/connectors/approvals', 'server_error')
      await wd.execute('window.location.reload()')
      await waitFor(async () => (await tryFind(wd, CSS, '.banner.banner-error')) !== null, 'approvals error banner')
      expect(await pageText(wd)).toContain(t('hub', 'sbRetry'))
      await proxy.scenario('/api/connectors/approvals', 'ok')
    })
  })
})
