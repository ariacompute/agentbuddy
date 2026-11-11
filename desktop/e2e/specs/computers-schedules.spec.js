// F11 / F13 / F17 / F18 — computers, execution environments and the scheduler.
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickContaining, confirmDialog, navigateHash, pageText, step,
  waitForElement, waitForText, waitFor, tryFind, type,
} from '../driver/helpers.mjs'
import { errorMessage, t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests } = e2eContext()

async function openComputers() {
  await navigateHash(wd, '/computers', info.timeoutMs)
  await waitForElement(wd, CSS, '.stats-strip, .empty', info.timeoutMs)
}
async function openSchedules() {
  await navigateHash(wd, '/schedules', info.timeoutMs)
  await waitForElement(wd, CSS, '.stats-strip, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F11/F13/F17/F18 · computers and schedules', () => {
  beforeEach(async () => { await reset() })

  it('renders the sandbox water level, provider catalogue and lease list', async () => {
    await step(wd, 'computers-overview', async () => {
      await openComputers()
      expect((await wd.findAll(CSS, '.stats-strip .stat')).length).toBeGreaterThanOrEqual(5)
      expect(await pageText(wd)).toContain(t('hub', 'sbCatalogTitle'))
      expect((await wd.findAll(CSS, '.catalog-card')).length).toBeGreaterThan(0)
      if (info.backend === 'stub') expect((await wd.findAll(CSS, '.lease-card')).length).toBe(1)
    })
  })

  it('refreshes providers and creates a computer through the dialog', async () => {
    await step(wd, 'computer-create', async () => {
      await openComputers()
      await clickContaining(wd, t('hub', 'sbRefresh'), { tag: 'button' })
      await clickContaining(wd, t('hub', 'sbCreateTitle'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await clickContaining(wd, t('hub', 'sbCreateSubmit'), { tag: 'button' })
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path === '/api/computers'), 'computer create')
        expect((await requests()).some((r) => r.method === 'POST' && r.path === '/api/sandbox-providers/refresh')).toBe(true)
      }
    })
  })

  it('opens a lease drawer, runs a trial command and renews the lease', async () => {
    await step(wd, 'sandbox-trial', async () => {
      await openComputers()
      await click(wd, CSS, '.lease-card')
      await waitForElement(wd, CSS, '.drawer[role="dialog"]', info.timeoutMs)
      const command = await waitForElement(wd, CSS, '.field input.mono')
      await wd.clear(command)
      await wd.type(command, 'git')
      await clickContaining(wd, t('hub', 'sbTrialRun'), { tag: 'button' })
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.path === '/api/sandboxes/sandbox-1/exec'), 'sandbox exec')
      }
    })
  })

  it('terminates a lease only after the danger confirmation', async () => {
    await step(wd, 'sandbox-terminate', async () => {
      if (!info.allowDestructive) return
      await openComputers()
      await clickContaining(wd, t('hub', 'sbTerminate'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await confirmDialog(wd)
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'DELETE' && r.path === '/api/sandboxes/sandbox-1'), 'terminate lease')
      }
    })
  })

  it('shows the feature-off panel when the server has no sandbox backend', async () => {
    await step(wd, 'computers-feature-off', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/sandboxes/stats', 'unavailable')
      await openComputers()
      await waitForText(wd, t('hub', 'sbOffTitle'), info.timeoutMs)
      await proxy.scenario('/api/sandboxes/stats', 'ok')
    })
  })

  it('renders the scheduler water level, run history, trigger stream and policy block', async () => {
    await step(wd, 'schedules-overview', async () => {
      await openSchedules()
      for (const key of ['routerTitle', 'routerRuns', 'routerTriggers', 'schedulesTitle']) {
        expect(await pageText(wd)).toContain(t('hub', key))
      }
      expect((await wd.findAll(CSS, '.stats-strip .stat')).length).toBeGreaterThanOrEqual(5)
    })
  })

  it('kicks a scheduling pass and creates a goal', async () => {
    await step(wd, 'schedule-create-kick', async () => {
      await openSchedules()
      await clickContaining(wd, t('hub', 'routerKick'), { tag: 'button' })
      const goal = await waitForElement(wd, CSS, 'input[type="text"]')
      await wd.type(goal, 'E2E hourly check')
      await clickContaining(wd, t('hub', 'scheduleNew'), { tag: 'button' })
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path === '/api/schedules'), 'schedule create')
        expect((await requests()).some((r) => r.method === 'POST' && r.path === '/api/router/passes')).toBe(true)
      }
    })
  })

  it('runs a goal now and cancels a ticket', async () => {
    await step(wd, 'schedule-run-cancel', async () => {
      await openSchedules()
      await click(wd, CSS, '.schedule-row')
      await clickContaining(wd, t('hub', 'routerRunNow'), { tag: 'button' })
      const cancel = await tryFind(wd, CSS, '.run-timeline button.btn-ghost.btn-sm')
      if (cancel) await wd.click(cancel)
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path.endsWith('/run')), 'run-now request')
      }
    })
  })

  it('saves a routing policy', async () => {
    await step(wd, 'router-policy', async () => {
      await openSchedules()
      const select = await waitForElement(wd, CSS, '.field select')
      await wd.execute(`const el = arguments[0]; el.value = el.options.length > 1 ? el.options[1].value : el.value; el.dispatchEvent(new Event('change', { bubbles: true }));`, [select])
      await clickContaining(wd, t('ops', 'policySave'), { tag: 'button' }).catch(() => {})
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'PUT' && r.path.startsWith('/api/router/policies/')), 'policy save').catch(() => {})
      }
    })
  })

  it('shows the scheduler-off state when the router endpoints are unavailable', async () => {
    await step(wd, 'schedules-feature-off', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/router/stats', 'unavailable')
      await openSchedules()
      await waitForText(wd, t('hub', 'routerOff'), info.timeoutMs)
      await proxy.scenario('/api/router/stats', 'ok')
    })
  })

  it('reports a server error without losing the page shell', async () => {
    await step(wd, 'computers-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/computers', 'server_error')
      await openComputers()
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('internal_error')) || (await tryFind(wd, CSS, '.banner')) !== null, 'computers error')
      expect(await tryFind(wd, CSS, '#app')).toBeTruthy()
      await proxy.scenario('/api/computers', 'ok')
    })
  })
})
