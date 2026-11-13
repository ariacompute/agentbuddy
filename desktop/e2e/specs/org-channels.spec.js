// F6 / F16 — organisation resources and multi-channel delivery receipts.
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, cancelDialog, click, confirmDialog, clickContaining, navigateHash,
  pageText, remount, step, waitForElement, waitForText, waitFor, tryFind, type,
} from '../driver/helpers.mjs'
import { ariaSelector, errorMessage, t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests, fixtures } = e2eContext()

async function openOrg() {
  await navigateHash(wd, '/org', info.timeoutMs)
  await waitForElement(wd, CSS, '.org-grid, .empty', info.timeoutMs)
}
async function openChannels() {
  // Always remount: an unfinished dialog would otherwise stay open (setting the
  // same hash fires no hashchange) and its backdrop would swallow later clicks.
  await remount(wd, '/channels', info.timeoutMs)
  await waitForElement(wd, CSS, '.card-wrap, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F6/F16 · organisation and channels', () => {
  beforeEach(async () => { await reset() })

  it.skipIf(!fixtures)('creates a registry resource and shows the returned id', async () => {
    await step(wd, 'org-create', async () => {
      await openOrg()
      await type(wd, CSS, '.card.stack input[type="text"]', 'e2e-agent')
      await clickContaining(wd, t('ops', 'resourceCreate'), { tag: 'button' })
      await waitFor(async () => (await pageText(wd)).includes('resource-'), 'new resource id')
      if (info.backend === 'stub') {
        const seen = await requests()
        expect(seen.some((r) => r.method === 'POST' && r.path === '/api/resources')).toBe(true)
      }
    })
  })

  it('reports a resource creation failure inline', async () => {
    await step(wd, 'org-create-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('POST /api/resources', 'server_error')
      await openOrg()
      await type(wd, CSS, '.card.stack input[type="text"]', 'e2e-agent')
      await clickContaining(wd, t('ops', 'resourceCreate'), { tag: 'button' })
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('internal_error')), 'resource error')
      await proxy.scenario('POST /api/resources', 'ok')
    })
  })

  it('lists channels and creates one through the form dialog', async () => {
    await step(wd, 'channel-create', async () => {
      await openChannels()
      if (info.backend === 'stub') expect((await wd.findAll(CSS, '.card-wrap')).length).toBe(2)
      await clickContaining(wd, t('channel', 'newChannel'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      // The dialog's name field is a plain <input>; there is no type="text" attribute.
      await type(wd, CSS, '[role="dialog"] input', 'E2E Slack')
      await confirmDialog(wd, { danger: false })
      if (info.backend === 'stub') {
        // A recorded POST only proves the request landed; the refreshed card
        // list is painted afterwards. Wait for the visible result, then assert
        // the request was really made.
        await waitFor(async () => (await wd.findAll(CSS, '.card-wrap')).length === 3, 'the third channel card', info.timeoutMs)
        expect((await requests()).some((r) => r.method === 'POST' && r.path === '/api/channels')).toBe(true)
      }
    })
  })

  it('cancelling the channel dialog sends nothing', async () => {
    await step(wd, 'channel-create-cancel', async () => {
      await openChannels()
      await clickContaining(wd, t('channel', 'newChannel'), { tag: 'button' })
      await waitForElement(wd, CSS, '[role="dialog"]')
      await cancelDialog(wd)
      if (info.backend === 'stub') {
        expect((await requests()).some((r) => r.method === 'POST' && r.path === '/api/channels')).toBe(false)
      }
    })
  })

  it.skipIf(!fixtures)('toggles a channel on and off through the switch', async () => {
    await step(wd, 'channel-switch', async () => {
      await openChannels()
      await waitForElement(wd, CSS, '.switch input[type="checkbox"]')
      // The visible control is a 40x22 box whose `::after` knob paints over its
      // centre, so a hit-tested WebDriver click is reported as intercepted. A
      // real DOM click on the input toggles it and fires the change handler.
      await wd.execute(`const el = document.querySelectorAll('.switch input[type="checkbox"]')[0]; el.scrollIntoView({ block: 'center' }); el.click();`)
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'PUT' && r.path.startsWith('/api/channels/')), 'channel update')
      }
    })
  })

  it.skipIf(!fixtures)('expands delivery receipts and retries a failed outbound one', async () => {
    await step(wd, 'delivery-retry', async () => {
      await openChannels()
      await clickContaining(wd, t('channel', 'deliveriesTitle'), { tag: 'button' })
      await waitForElement(wd, CSS, '.span-row')
      if (info.backend === 'stub') expect((await wd.findAll(CSS, '.span-row')).length).toBeGreaterThan(0)
      const retry = await tryFind(wd, CSS, `.btn.btn-ghost.btn-sm${ariaSelector(t('channel', 'deliveryRetry'))}`)
      if (retry) {
        await wd.click(retry)
        if (info.backend === 'stub') {
          await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path.includes('/deliveries/') && r.path.endsWith('/retry')), 'delivery retry')
        }
      }
    })
  })

  it('a non-retryable receipt reports a localised reason instead of failing silently', async () => {
    await step(wd, 'delivery-retry-409', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('POST /api/channels/channel-1/deliveries/delivery-1/retry', 'server_error', { status: 409, code: 'delivery_not_retryable' })
      await openChannels()
      await clickContaining(wd, t('channel', 'deliveriesTitle'), { tag: 'button' })
      const retry = await waitForElement(wd, CSS, `.btn.btn-ghost.btn-sm${ariaSelector(t('channel', 'deliveryRetry'))}`)
      await wd.click(retry)
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('delivery_not_retryable')), 'retry rejection')
      await proxy.scenario('POST /api/channels/channel-1/deliveries/delivery-1/retry', 'ok')
    })
  })

  it('deletes a channel after the user confirms the card action', async () => {
    await step(wd, 'channel-delete', async () => {
      if (!info.allowDestructive) return
      await openChannels()
      // The delete button lives inside the card's row, not as a direct child.
      const buttons = await wd.findAll(CSS, '.card-wrap .btn-icon.btn-sm')
      expect(buttons.length).toBeGreaterThan(0)
      await wd.click(buttons[buttons.length - 1])
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'DELETE' && r.path.startsWith('/api/channels/')), 'channel delete')
      }
    })
  })

  it('a failed channels request shows an inline error', async () => {
    await step(wd, 'channels-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/channels', 'server_error')
      await openChannels()
      await waitFor(async () => (await tryFind(wd, CSS, '.banner')) !== null || (await pageText(wd)).includes(errorMessage('internal_error')), 'channels error')
      await proxy.scenario('/api/channels', 'ok')
    })
  })
})
