// Cross-platform entry point. AGENTS.md requires Vitest to be started by Node
// (a bun runtime silently breaks vi.mock auto-mocking); starting it through the
// programmatic API also avoids the .cmd/.sh difference in node_modules/.bin.
import { fileURLToPath } from 'node:url'
import { startVitest } from 'vitest/node'

const live = process.argv.includes('--live')
process.env.E2E_BACKEND = live || process.env.E2E_BACKEND === 'live' ? 'live' : 'stub'

const config = fileURLToPath(new URL('./vitest.config.js', import.meta.url))
const vitest = await startVitest('test', [], { config, run: true })
const failed = vitest?.state?.getCountOfFailedTests?.() ?? 0
await vitest?.close()
process.exit(failed > 0 ? 1 : 0)
