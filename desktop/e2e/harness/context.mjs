// Shared per-spec context. Every journey attaches to the single desktop
// session created by globalSetup; nothing here starts a second app.
import { readE2eConfig } from './config.mjs'
import { loadSession } from './orchestrator.mjs'
import { createProxyClient } from './proxy-client.mjs'
import { attachFromSessionInfo } from '../driver/session.mjs'

/** Returns the shared session; `wd` and `proxy` are null when skipped. */
export function e2eContext() {
  const info = loadSession()
  const cfg = readE2eConfig()
  const wd = info.skipped ? null : attachFromSessionInfo(info)
  const proxy = info.skipped ? null : createProxyClient({
    wd,
    proxyOrigin: info.proxyOrigin,
    stubUrl: info.stubUrl,
    backend: info.backend,
    timeoutMs: info.timeoutMs,
  })

  const reset = async () => {
    if (!proxy?.isStub) return
    await proxy.reset()
  }

  /** Deterministic fixtures and the /__e2e/* control plane exist only in stub
   * mode. Journeys that navigate hard-coded ids (`thread-1`, `task-2`, …),
   * expect a fixed row count or inject faults must gate on this: a live server
   * has different data on every run and offers no fault injection. */
  const fixtures = !info.skipped && !!proxy?.isStub

  return {
    info,
    cfg,
    wd,
    proxy,
    reset,
    fixtures,
    /** All requests the stub saw, with credentials stripped. */
    requests: async () => (proxy?.isStub ? proxy.requests() : []),
  }
}

/** True when a destructive journey must be skipped against a real server. */
export function destructiveAllowed(info) {
  return !!info.allowDestructive
}
