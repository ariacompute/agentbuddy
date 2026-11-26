import { describe, it, expect } from 'vitest'
import {
  desktopPlatformDecision,
  preflight,
  readE2eConfig,
  requireDesktopOrThrow,
} from '../e2e/harness/config.mjs'

// The desktop journeys are only authoritative on Linux, and CI must not accept
// a run where every one of them was skipped. Both rules are pure functions in
// the harness, so they are pinned here instead of by reading the workflow.
// Nothing below touches a driver, a binary or the network.

describe('desktopPlatformDecision', () => {
  it('treats Linux as the authoritative platform', () => {
    const decision = desktopPlatformDecision('linux', {})
    expect(decision).toEqual({ allowed: true, authoritative: true, reason: '' })
  })

  it('refuses a best-effort platform until it is opted into', () => {
    const decision = desktopPlatformDecision('win32', {})
    expect(decision.allowed).toBe(false)
    expect(decision.authoritative).toBe(false)
    // The refusal has to say how to unblock, or it is just a wall.
    expect(decision.reason).toContain('E2E_ALLOW_BEST_EFFORT=1')
    expect(decision.reason).toContain('Windows')
  })

  it('allows the opt-in but never calls it authoritative', () => {
    const decision = desktopPlatformDecision('win32', { E2E_ALLOW_BEST_EFFORT: '1' })
    expect(decision.allowed).toBe(true)
    expect(decision.authoritative).toBe(false)
    expect(decision.reason).toContain('advisory')
    expect(decision.reason).toContain('Linux')
  })

  it('names macOS by its own name in the refusal', () => {
    expect(desktopPlatformDecision('darwin', {}).reason).toContain('darwin')
  })
})

describe('readE2eConfig platform fields', () => {
  it('carries the Linux policy into the config', () => {
    const cfg = readE2eConfig({}, 'linux')
    expect(cfg.platform).toBe('linux')
    expect(cfg.authoritative).toBe(true)
    expect(cfg.bestEffortAllowed).toBe(true)
    expect(cfg.platformReason).toBe('')
    expect(cfg.requireDesktop).toBe(false)
  })

  it('marks a Windows run as advisory once opted in', () => {
    const cfg = readE2eConfig({ E2E_ALLOW_BEST_EFFORT: 'true' }, 'win32')
    expect(cfg.platform).toBe('win32')
    expect(cfg.bestEffortAllowed).toBe(true)
    expect(cfg.authoritative).toBe(false)
  })

  it('parses E2E_REQUIRE_DESKTOP with the same truthy spelling as every other knob', () => {
    expect(readE2eConfig({ E2E_REQUIRE_DESKTOP: 'yes' }, 'linux').requireDesktop).toBe(true)
    expect(readE2eConfig({ E2E_REQUIRE_DESKTOP: '0' }, 'linux').requireDesktop).toBe(false)
  })
})

describe('requireDesktopOrThrow', () => {
  it('turns a skipped run into a failure when the caller forbade skips', () => {
    const cfg = readE2eConfig({ E2E_REQUIRE_DESKTOP: '1' }, 'linux')
    expect(() => requireDesktopOrThrow(cfg, true, 'no WebKitWebDriver')).toThrow(/E2E_REQUIRE_DESKTOP=1/)
    // The reason travels with the message: a red job that does not say why is
    // no better than a green one that lies.
    expect(() => requireDesktopOrThrow(cfg, true, 'no WebKitWebDriver')).toThrow(/no WebKitWebDriver/)
  })

  it('stays out of the way when the run is fine or skips are allowed', () => {
    const strict = readE2eConfig({ E2E_REQUIRE_DESKTOP: '1' }, 'linux')
    const relaxed = readE2eConfig({}, 'linux')
    expect(() => requireDesktopOrThrow(strict, false, '')).not.toThrow()
    expect(() => requireDesktopOrThrow(relaxed, true, 'no display')).not.toThrow()
    expect(() => requireDesktopOrThrow(undefined, true, 'no display')).not.toThrow()
  })
})

describe('preflight platform gate', () => {
  it('fails the authoritative check on a best-effort platform that was not opted in', async () => {
    const cfg = readE2eConfig({}, 'win32')
    const result = await preflight(cfg, 'http://stub.invalid')
    const gate = result.checks.find((c) => c.name === 'authoritative platform')
    expect(gate).toBeTruthy()
    expect(gate.ok).toBe(false)
    expect(gate.detail).toContain('E2E_ALLOW_BEST_EFFORT=1')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('authoritative platform')
  })

  it('drops the check once the advisory path is opted into', async () => {
    const cfg = readE2eConfig({ E2E_ALLOW_BEST_EFFORT: '1' }, 'win32')
    const result = await preflight(cfg, 'http://stub.invalid')
    expect(result.checks.some((c) => c.name === 'authoritative platform')).toBe(false)
  })

  it('never gates the authoritative platform itself', async () => {
    const cfg = readE2eConfig({}, 'linux')
    const result = await preflight(cfg, 'http://stub.invalid')
    expect(result.checks.some((c) => c.name === 'authoritative platform')).toBe(false)
  })
})

describe('preflight in contract-only mode', () => {
  it('asks for nothing desktop-shaped when only the contract specs run', async () => {
    // A Windows box without a binary, a driver or an authoritative platform can
    // still prove the stub/live error contract; demanding those prerequisites
    // would turn a green contract into a wall of unrelated red checks.
    const cfg = readE2eConfig({ E2E_CONTRACT_ONLY: '1' }, 'win32')
    const result = await preflight(cfg, 'http://127.0.0.1:1')
    expect(result.checks.map((c) => c.name)).toEqual(['server URL'])
    expect(result.ok).toBe(true)
  })

  it('still requires live credentials and a reachable server', async () => {
    const cfg = readE2eConfig(
      { E2E_CONTRACT_ONLY: '1', E2E_BACKEND: 'live', E2E_SERVER_URL: 'http://127.0.0.1:1' },
      'linux',
    )
    const result = await preflight(cfg, 'http://127.0.0.1:1')
    expect(result.checks.map((c) => c.name)).toEqual(['server URL', 'live credentials', 'live /healthz'])
    expect(result.checks.find((c) => c.name === 'live credentials').ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'live /healthz').ok).toBe(false)
    expect(result.ok).toBe(false)
  })
})
