// F20 — binding MCP servers and skill manuals to an agent, then handing the
// server-resolved package over as one task. The screen edits kind_config on the
// agent itself, so the save is a whole-record PUT and the delivery is a POST
// that answers a task id; both are asserted through the request log, never by
// reaching into the store.
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickContaining, hash, pageText, remount, step,
  waitFor, waitForElement, waitForText,
} from '../driver/helpers.mjs'
import { errorMessage, t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests, fixtures } = e2eContext()

const AGENT = 'resource-1'

/** Opens the screen and waits for something it renders in every mode. */
async function open() {
  // Leave and return: navigating to the hash the screen already sits on fires no
  // hashchange, so the component keeps the entry it cached in the previous case
  // and the freshly seeded bindings would never be read.
  await remount(wd, '/abilities', info.timeoutMs)
  await waitForText(wd, t('abilities', 'title'), info.timeoutMs)
}

async function pickAgent() {
  await waitForElement(wd, CSS, '.agent-item', info.timeoutMs)
  await click(wd, CSS, '.agent-item', info.timeoutMs)
  await waitForElement(wd, CSS, '.ability-row input', info.timeoutMs)
}

const packageCards = async () => (await wd.findAll(CSS, '.pkg-card')).length

/** Concatenated text of the package cards only — candidate rows share names. */
async function packageText() {
  const out = []
  for (const card of await wd.findAll(CSS, '.pkg-card')) out.push(await wd.text(card))
  return out.join('\n')
}

describe.skipIf(info.skipped)('F20 · abilities', () => {
  beforeEach(async () => { await reset() })

  it('renders the screen and lists the agents it can manage', async () => {
    await step(wd, 'abilities-open', async () => {
      await open()
      if (!fixtures) return
      // Nothing is picked yet, so the work area is the prompt rather than the
      // two blocks: assert the list heading and that the list is populated.
      const text = await pageText(wd)
      expect(text).toContain(t('abilities', 'agents'))
      expect(text).toContain(t('abilities', 'pickAgent'))
      await waitForElement(wd, CSS, '.agent-item', info.timeoutMs)
      expect((await wd.findAll(CSS, '.agent-item')).length).toBe(1)
      expect(text).not.toContain(t('abilities', 'agentsEmpty'))
    })
  })

  it.skipIf(!fixtures)('previews the package the bindings resolve to', async () => {
    await step(wd, 'abilities-package', async () => {
      await open()
      await pickAgent()
      // The fixture agent is bound to one MCP server and one skill manual, so
      // the preview has exactly one card of each.
      await waitFor(async () => (await packageCards()) === 2, 'package cards')
      const text = await pageText(wd)
      expect(text).toContain('Jira MCP')
      expect(text).toContain('Refund skill')
      // Both checkboxes start checked: the draft mirrors the stored bindings.
      const boxes = await wd.findAll(CSS, '.ability-row input')
      expect(boxes.length).toBe(2)
      expect(await wd.selected(boxes[0])).toBe(true)
      expect(await wd.selected(boxes[1])).toBe(true)
      expect(text).not.toContain(t('abilities', 'packageEmpty'))
    })
  })

  it.skipIf(!fixtures)('saves a binding change as a whole record and re-reads the package', async () => {
    await step(wd, 'abilities-save', async () => {
      await open()
      await pickAgent()
      const boxes = await wd.findAll(CSS, '.ability-row input')
      // Index 1 is the skill manual: the MCP column comes first in the DOM.
      await wd.click(boxes[1])
      await clickContaining(wd, t('abilities', 'save'), { tag: 'button' })
      await waitForText(wd, t('abilities', 'saved'), info.timeoutMs)

      // A whole-record PUT, not a patch: agenthub replaces the entry, so the
      // record has to arrive complete (the package below proves the rest of the
      // record survived: the agent is still listed and still an agent).
      await waitFor(async () => (await requests()).some(
        (r) => r.method === 'PUT' && r.path === `/api/resources/${AGENT}`,
      ), 'binding save')
      // The package is derived from the bindings, so the screen re-reads it.
      // Only the package is asserted: the skill still appears as a candidate
      // row, it just is not bound any more.
      await waitFor(async () => (await packageCards()) === 1, 'package without the skill')
      expect(await packageText()).not.toContain('Refund skill')
      expect((await wd.findAll(CSS, '.agent-item')).length).toBe(1)
    })
  })

  it.skipIf(!fixtures)('clears every binding and saves the empty set', async () => {
    await step(wd, 'abilities-clear', async () => {
      await open()
      await pickAgent()
      // Clear all is offered on a freshly opened record even though nothing was
      // edited yet: withdrawing every ability is itself the edit.
      await clickContaining(wd, t('abilities', 'clear'), { tag: 'button' })
      await clickContaining(wd, t('abilities', 'save'), { tag: 'button' })
      await waitForText(wd, t('abilities', 'saved'), info.timeoutMs)
      await waitFor(async () => (await packageCards()) === 0, 'empty package')
      expect(await pageText(wd)).toContain(t('abilities', 'packageEmpty'))
      expect((await wd.findAll(CSS, '.ability-row input')).length).toBe(2)
      for (const box of await wd.findAll(CSS, '.ability-row input')) {
        expect(await wd.selected(box)).toBe(false)
      }
    })
  })

  it.skipIf(!fixtures)('delivers the package and opens the task it created', async () => {
    await step(wd, 'abilities-deliver', async () => {
      await open()
      await pickAgent()
      await clickContaining(wd, t('abilities', 'deliver'), { tag: 'button' })
      await waitForText(wd, t('abilities', 'delivered'), info.timeoutMs)
      await waitFor(async () => (await requests()).some(
        (r) => r.method === 'POST' && r.path === `/api/resources/${AGENT}/distribution`,
      ), 'distribution delivery')

      const link = await waitForElement(wd, CSS, 'a[href*="/tasks/"]', info.timeoutMs)
      const href = (await wd.attribute(link, 'href')) || ''
      const taskId = (/\/tasks\/([^/?#]+)/.exec(href) || [])[1]
      expect(taskId).toBeTruthy()

      // The id is only worth showing if it opens: follow the link and let the
      // task screen fetch the record the delivery created.
      await wd.click(link)
      await waitFor(async () => (await hash(wd)).startsWith(`#/tasks/${taskId}`), `route /tasks/${taskId}`)
      await waitForText(wd, taskId, info.timeoutMs)
    })
  })

  it.skipIf(!fixtures)('reports a refused delivery with the server reason', async () => {
    await step(wd, 'abilities-deliver-refused', async () => {
      await proxy.scenario(`POST /api/resources/${AGENT}/distribution`, 'feature_off')
      await open()
      await pickAgent()
      await clickContaining(wd, t('abilities', 'deliver'), { tag: 'button' })
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('feature_unavailable')), 'delivery error')
      expect(await pageText(wd)).not.toContain(t('abilities', 'delivered'))
      await proxy.scenario(`POST /api/resources/${AGENT}/distribution`, 'ok')
    })
  })

  it.skipIf(!fixtures)('keeps a binding it cannot resolve visible and removable', async () => {
    await step(wd, 'abilities-unresolved', async () => {
      // The picker can only remove unresolved ids, never create them, so the
      // record is seeded the way an invisible binding would arrive.
      const before = await (await fetch(`${info.stubUrl}/api/resources/${AGENT}`)).json()
      await fetch(`${info.stubUrl}/api/resources/${AGENT}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...before,
          kind_config: { ...before.kind_config, agent: { ...before.kind_config.agent, mcp: ['connector-1', 'mcp_gone'] } },
        }),
      })

      await open()
      await pickAgent()
      const chip = await waitForElement(wd, CSS, '.ability-chip.is-unresolved', info.timeoutMs)
      expect(await wd.text(chip)).toContain('mcp_gone')
      // The server reports what it could not render, so the preview says so too.
      expect(await pageText(wd)).toContain(t('abilities', 'unresolved'))

      await wd.click(chip)
      await clickContaining(wd, t('abilities', 'save'), { tag: 'button' })
      await waitForText(wd, t('abilities', 'saved'), info.timeoutMs)
      await waitFor(async () => (await wd.findAll(CSS, '.ability-chip.is-unresolved')).length === 0, 'chip removed')
      // Only the unresolvable id went away: the MCP server and the skill the
      // record really carries are still in the package.
      await waitFor(async () => (await packageCards()) === 2, 'package after removal')
      expect(await pageText(wd)).not.toContain('mcp_gone')
    })
  })
})
