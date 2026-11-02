// The desktop shell's notification preferences, read from `/__shell/config`.
//
// They live in the shell (it is the process that owns the OS toast and the
// close behaviour), but the decision about *whether to announce* is made in the
// workbench. Without this module the settings page wrote `notify_enabled` and
// `notify_quiet_minutes` and nothing ever read them back: the switch looked
// wired and did nothing.
//
// Two properties matter and are both tested without a browser:
//   - outside the shell (plain `bun run dev`) every read fails, and the answer
//     must be the permissive default rather than a thrown error;
//   - the quiet period is a window, not a permanent mute: it is measured from
//     the first successful read, so it lapses on its own.

import { getShellConfig } from './api.js'

/** How long one read is reused before asking the shell again. */
export const SHELL_SETTINGS_TTL_MS = 60 * 1000

/** The settings page caps the input at 240; clamping here keeps a bad file from
 *  muting the workbench forever. */
export const MAX_QUIET_MINUTES = 240

const DEFAULTS = Object.freeze({ enabled: true, quietUntil: 0, inShell: false, quietMinutes: 0 })

// The quiet window is a window, so something has to anchor it. The anchor is
// "the moment this value was set", tracked per value rather than per process:
//
//   - re-reading the same minutes must NOT push the window forward, or a 60s
//     refresh would keep a 5 minute mute alive forever;
//   - changing the value MUST start a fresh window, or a mute chosen two hours
//     after the first read is already expired on arrival.
//
// An earlier version anchored on the process's first read and got the second
// case wrong, which made the setting look inert.
let seenMinutes = null
let quietUntil = 0
let cached = null
let cachedAt = 0

/** Pure mapping from the shell's config to what `decide()` needs. */
export function notifySettingsFrom(cfg, now = Date.now(), since = now) {
  if (!cfg || typeof cfg !== 'object') return { ...DEFAULTS }
  const enabled = cfg.notifyEnabled !== false
  const raw = Number(cfg.notifyQuietMinutes)
  const minutes = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 0), MAX_QUIET_MINUTES) : 0
  return {
    enabled,
    quietMinutes: minutes,
    quietUntil: minutes > 0 ? since + minutes * 60 * 1000 : 0,
    inShell: true,
  }
}

// anchored remembers where the window for `minutes` started. A value seen for the
// first time opens a window now; the same value seen again keeps the one it has.
function anchored(minutes, now) {
  if (minutes !== seenMinutes) {
    seenMinutes = minutes
    quietUntil = minutes > 0 ? now + minutes * 60 * 1000 : 0
  }
  return quietUntil
}

/**
 * Reads the shell config, reusing a recent answer. A failed read means "not
 * inside the shell": the caller gets the defaults so the in-app notification
 * centre keeps working exactly as before.
 */
export async function loadShellNotifySettings({ now = Date.now(), force = false } = {}) {
  if (!force && cached && now - cachedAt < SHELL_SETTINGS_TTL_MS) return cached
  let cfg
  try {
    cfg = await getShellConfig()
  } catch (error) {
    // 404 in the browser build, or the proxy answered 502 while the server was
    // down. Either way this is not an error the operator can act on.
    cached = { ...DEFAULTS }
    cachedAt = now
    return cached
  }
  const settings = notifySettingsFrom(cfg, now, now)
  cached = { ...settings, quietUntil: anchored(settings.quietMinutes, now) }
  cachedAt = now
  return cached
}

/** Applies a saved settings form without waiting for the next read. */
export function applyShellNotifySettings(raw, now = Date.now()) {
  const settings = notifySettingsFrom(raw, now, now)
  // Saving is always a fresh decision: the operator just said "from now on".
  seenMinutes = settings.quietMinutes
  quietUntil = settings.quietUntil
  cached = { ...settings }
  cachedAt = now
  return cached
}

/** Clears the cache and the quiet anchor; used by the settings page and tests. */
export function resetShellNotifySettings() {
  seenMinutes = null
  quietUntil = 0
  cached = null
  cachedAt = 0
}
