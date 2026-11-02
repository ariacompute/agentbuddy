import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api.js', () => ({ getShellConfig: vi.fn() }))

import { getShellConfig } from '../src/lib/api.js'
import {
  MAX_QUIET_MINUTES,
  SHELL_SETTINGS_TTL_MS,
  applyShellNotifySettings,
  loadShellNotifySettings,
  notifySettingsFrom,
  resetShellNotifySettings,
} from '../src/lib/shell-settings.js'

// These preferences live in the desktop shell, but the decision they steer is
// made in the workbench. Before this module the settings page wrote them and
// nobody read them back; the switch was decoration.

describe('notifySettingsFrom', () => {
  it('maps a shell config onto the two fields decide() reads', () => {
    const now = 1_000_000
    const s = notifySettingsFrom({ notifyEnabled: true, notifyQuietMinutes: 5 }, now, now)
    expect(s).toEqual({ enabled: true, quietMinutes: 5, quietUntil: now + 5 * 60 * 1000, inShell: true })
  })

  it('treats a missing enabled flag as on', () => {
    // The shell omits the field for a config written before the switch existed.
    expect(notifySettingsFrom({}, 0, 0).enabled).toBe(true)
    expect(notifySettingsFrom({ notifyEnabled: false }, 0, 0).enabled).toBe(false)
  })

  it('clamps the quiet minutes into the range the settings page allows', () => {
    expect(notifySettingsFrom({ notifyQuietMinutes: -30 }, 0, 0).quietMinutes).toBe(0)
    expect(notifySettingsFrom({ notifyQuietMinutes: 9999 }, 0, 0).quietMinutes).toBe(MAX_QUIET_MINUTES)
    expect(notifySettingsFrom({ notifyQuietMinutes: 'abc' }, 0, 0).quietMinutes).toBe(0)
    expect(notifySettingsFrom({ notifyQuietMinutes: 2.4 }, 0, 0).quietMinutes).toBe(2)
  })

  it('anchors the quiet window on when it started, not on the read', () => {
    // Re-reading the config must not push the window forward, or a quiet period
    // would never lapse on a long-lived window.
    const started = 1_000_000
    const later = started + 30_000
    expect(notifySettingsFrom({ notifyQuietMinutes: 1 }, later, started).quietUntil)
      .toBe(started + 60_000)
  })

  it('answers the defaults for a missing config', () => {
    expect(notifySettingsFrom(null, 0, 0)).toMatchObject({ enabled: true, quietUntil: 0, inShell: false })
  })
})

describe('loadShellNotifySettings', () => {
  beforeEach(() => {
    resetShellNotifySettings()
    vi.clearAllMocks()
  })

  it('falls back to permissive defaults when there is no shell', async () => {
    getShellConfig.mockRejectedValue(Object.assign(new Error('404'), { code: 'not_found' }))
    const s = await loadShellNotifySettings()
    expect(s).toMatchObject({ enabled: true, quietUntil: 0, inShell: false })
  })

  it('reads the shell once per TTL, and again when forced', async () => {
    getShellConfig.mockResolvedValue({ notifyEnabled: true, notifyQuietMinutes: 0 })
    await loadShellNotifySettings({ now: 10_000 })
    await loadShellNotifySettings({ now: 10_000 + SHELL_SETTINGS_TTL_MS - 1 })
    expect(getShellConfig).toHaveBeenCalledTimes(1)

    await loadShellNotifySettings({ now: 10_000 + SHELL_SETTINGS_TTL_MS })
    expect(getShellConfig).toHaveBeenCalledTimes(2)

    await loadShellNotifySettings({ now: 10_000 + SHELL_SETTINGS_TTL_MS, force: true })
    expect(getShellConfig).toHaveBeenCalledTimes(3)
  })

  it('re-reads after a reset', async () => {
    getShellConfig.mockResolvedValue({ notifyEnabled: true })
    await loadShellNotifySettings({ now: 1 })
    resetShellNotifySettings()
    await loadShellNotifySettings({ now: 2 })
    expect(getShellConfig).toHaveBeenCalledTimes(2)
  })
})

describe('applyShellNotifySettings', () => {
  beforeEach(() => resetShellNotifySettings())

  it('lets the settings page take effect without a reload', async () => {
    getShellConfig.mockResolvedValue({ notifyEnabled: true, notifyQuietMinutes: 0 })
    await loadShellNotifySettings({ now: 1 })

    const applied = applyShellNotifySettings({ notifyEnabled: false, notifyQuietMinutes: 0 }, 2)
    expect(applied.enabled).toBe(false)

    // The next read inside the TTL must see the applied value, not the stale one.
    const again = await loadShellNotifySettings({ now: 3 })
    expect(again.enabled).toBe(false)
  })
})
