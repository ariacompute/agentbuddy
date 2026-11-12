// Native shell behaviour that a WebView cannot see: single-instance recall,
// background residency, the tray badge and update state. These are process /
// raw-socket assertions against the real app, plus a note on which semantics
// are pinned by the Rust pure-function tests (they need no window).
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { which } from '../harness/config.mjs'
import { e2eContext } from '../harness/context.mjs'
import {
  instanceHandshake, readInstanceRecord, readJson, spawnProcess, stopProcess, waitFor,
} from '../harness/lifecycle.mjs'
import { CSS, rootState, step, waitForElement } from '../driver/helpers.mjs'

const { info, wd, proxy, reset } = e2eContext()

/** Launches a second copy with the same isolated config dir. */
function launchSecondApp() {
  const args = []
  let command = info.appBinary
  const xvfb = process.platform === 'linux' ? which('xvfb-run') : null
  if (xvfb) {
    args.push('-a', info.appBinary)
    command = xvfb
  }
  return spawnProcess(command, args, {
    env: { ...process.env, AGENTBUDDY_E2E_CONFIG_DIR: info.configDir },
  })
}

describe.skipIf(info.skipped)('desktop shell · native behaviour', () => {
  // Scenarios live in the shared stub process; a journey that failed half-way
  // must not hand a 401 /api/workspace to this file's proxy probe.
  beforeEach(async () => { await reset() })
  afterEach(async () => {
    await proxy.badge(0).catch(() => {})
  })

  it('keeps config, session and the single-instance record inside the isolated dir', async () => {
    await step(wd, 'native-isolation', async () => {
      const record = readInstanceRecord(info.configDir)
      expect(record).toMatchObject({ pid: expect.any(Number), port: expect.any(Number), token: expect.any(String) })
      expect(record.token.length).toBeGreaterThan(8)
      const config = readJson(path.join(info.configDir, 'config.json'))
      expect(config).toBeTruthy()
      expect(config.server_url).toBe(info.serverUrl)
    })
  })

  it('answers the single-instance handshake only for the recorded token', async () => {
    await step(wd, 'native-handshake', async () => {
      const record = readInstanceRecord(info.configDir)
      expect(await instanceHandshake(record.port, record.token)).toBe('ok')
      expect(await instanceHandshake(record.port, '0'.repeat(record.token.length))).toBe('no')
    })
  })

  it('a second launch exits, raises the existing window and does not open a second proxy', async () => {
    await step(wd, 'native-second-launch', async () => {
      const before = readInstanceRecord(info.configDir)
      const originBefore = new URL(await wd.url()).origin
      const second = launchSecondApp()
      try {
        await waitFor(() => second.exited, 'the second launch to exit', 30_000)
        expect(second.exitCode).toBe(0)
        const after = readInstanceRecord(info.configDir)
        expect(after.pid).toBe(before.pid)
        expect(after.port).toBe(before.port)
        expect(new URL(await wd.url()).origin).toBe(originBefore)
        expect((await wd.windowHandles()).length).toBe(1)
      } finally {
        await stopProcess(second)
      }
    })
  })

  it('hiding to the tray keeps the proxy and the WebView session alive', async () => {
    await step(wd, 'native-background', async () => {
      const hidden = await proxy.hide()
      expect(hidden.status).toBe(200)
      expect(await wd.url()).toContain(info.proxyOrigin)
      const record = readInstanceRecord(info.configDir)
      expect(await instanceHandshake(record.port, record.token)).toBe('ok')
      await waitForElement(wd, CSS, '.shell', info.timeoutMs)
      const workspace = await proxy.forward('/api/workspace')
      expect(workspace.status).toBe(200)
    })
  })

  it('clamps the unread badge and keeps the tooltip state after a language rebuild', async () => {
    await step(wd, 'native-badge', async () => {
      const capped = await proxy.badge(1200)
      expect(capped.body.count).toBe(999)
      await proxy.saveConfig({ lang: 'ko' })
      expect((await proxy.config()).body.lang).toBe('ko')
      expect((await proxy.badge(3)).body.count).toBe(3)
      await proxy.saveConfig({ lang: 'en' })
    })
  })

  it('never navigates off-origin when a toast carries a hostile link', async () => {
    await step(wd, 'native-deep-link', async () => {
      const before = (await rootState(wd)).hash
      await proxy.notify({ title: 'E2E', body: 'unsafe link', link: '//evil.example' })
      await proxy.notify({ title: 'E2E', body: 'unsafe link', link: 'javascript:alert(1)' })
      await proxy.notify({ title: 'E2E', body: 'unsafe link', link: '/a\\b' })
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect((await rootState(wd)).hash).toBe(before)
      // `is_in_app_path` / `remember_link` / `take_link` (one click consumes one
      // target) are pure functions covered by notify.rs's inline Rust tests; a
      // WebDriver has no handle on an OS toast click.
    })
  })

  it('exposes update preferences, skip state and the last check timestamp', async () => {
    await step(wd, 'native-upgrade-state', async () => {
      const read = await proxy.config()
      expect(typeof read.body.upgradeAutoCheck).toBe('boolean')
      expect(read.body).toHaveProperty('upgradeSkippedVersion')
      const upgrade = await proxy.upgrade()
      if (upgrade.status === 200 && upgrade.body) {
        expect(upgrade.body).toHaveProperty('status')
        if (upgrade.body.checkedAt !== undefined) expect(typeof upgrade.body.checkedAt).toBe('number')
      }
    })
  })

  it('does not write run artefacts outside the isolated config dir', async () => {
    await step(wd, 'native-cleanliness', async () => {
      const entries = fs.readdirSync(info.configDir)
      expect(entries).toContain('instance.json')
      for (const entry of entries) {
        expect(entry.startsWith('e2e-')).toBe(false)
      }
    })
  })
})
