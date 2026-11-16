// Cross-platform entry point. AGENTS.md requires Vitest to be started by Node
// (a bun runtime silently breaks vi.mock auto-mocking); starting it through the
// programmatic API also avoids the .cmd/.sh difference in node_modules/.bin.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startVitest } from 'vitest/node'

const live = process.argv.includes('--live')
process.env.E2E_BACKEND = live || process.env.E2E_BACKEND === 'live' ? 'live' : 'stub'

const config = fileURLToPath(new URL('./vitest.config.js', import.meta.url))
const sessionFile = fileURLToPath(new URL('./artifacts/session.json', import.meta.url))

const vitest = await startVitest('test', [], { config, run: true })
const state = vitest?.state
const failed = state?.getCountOfFailedTests?.() ?? 0
// Every desktop suite is `describe.skipIf(info.skipped)`, so a refused preflight
// exits through "no tests" rather than through a failure: all of them skipped
// and exit code 0, which is exactly the green-but-empty run CI must not accept.
// `getUnhandledErrors()` is checked because a global setup error may surface
// there, and the published session is checked because in Vitest 2.1.9 it does
// not — the orchestrator records the decision either way.
const unhandled = state?.getUnhandledErrors?.()?.length ?? 0
const skippedButRequired = (() => {
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    return session?.requireDesktop === true && session?.skipped === true
  } catch {
    return false // no session published: nothing to enforce
  }
})()
await vitest?.close()
process.exit(failed > 0 || unhandled > 0 || skippedButRequired ? 1 : 0)
