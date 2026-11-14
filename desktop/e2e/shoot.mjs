// Standalone screenshot generator. Reuses the e2e orchestrator (globalSetup):
// it builds/verifies the Tauri debug binary, starts tauri-driver, connects to a
// REAL agenthub server and signs in, then runs ONLY specs/screenshots.spec.js,
// which writes agentbuddy/screenshots/<lang>/<feature>.png.
//
// Usage:
//   node desktop/e2e/shoot.mjs
// Required env: E2E_SERVER_URL  (the real agenthub base URL)
//               E2E_LIVE_EMAIL / E2E_LIVE_PASSWORD (login account — no committed
//               defaults; supply them in your environment, never commit them)
// Optional env: E2E_APP_BIN, E2E_NATIVE_DRIVER, E2E_DRIVER_URL, E2E_SCREENSHOTS_DIR
//
// Cross-platform entry point: Vitest must be started by Node (a bun runtime
// silently breaks vi.mock auto-mocking), and the programmatic API avoids the
// .cmd/.sh difference in node_modules/.bin.
import { fileURLToPath } from 'node:url'
import { startVitest } from 'vitest/node'

// --- live backend wiring -----------------------------------------------------
process.env.E2E_BACKEND = 'live'

if (!process.env.E2E_SERVER_URL) {
  console.error('[shoot] E2E_SERVER_URL is required (the real agenthub base URL).')
  process.exit(2)
}

// Login account — supplied via environment only (no committed defaults).
if (!process.env.E2E_LIVE_EMAIL || !process.env.E2E_LIVE_PASSWORD) {
  console.error('[shoot] E2E_LIVE_EMAIL and E2E_LIVE_PASSWORD are required (no defaults).')
  process.exit(2)
}

const config = fileURLToPath(new URL('./vitest.config.js', import.meta.url))
const vitest = await startVitest('test', ['screenshots'], { config, run: true })
const failed = vitest?.state?.getCountOfFailedTests?.() ?? 0
await vitest?.close()
process.exit(failed > 0 ? 1 : 0)
