import { fileURLToPath } from 'node:url'

// A deliberately separate Vitest project. `desktop/vitest.config.js` owns the
// 100% gate over desktop/scripts, `web/vite.config.js` owns the 100% gate over
// web/src; neither matches e2e/**, so `make test` and both coverage gates stay
// untouched. One desktop process is shared by every spec, hence serial forks.
const root = fileURLToPath(new URL('./', import.meta.url))

export default {
  root,
  test: {
    environment: 'node',
    include: ['specs/**/*.spec.js'],
    globalSetup: [fileURLToPath(new URL('./harness/orchestrator.mjs', import.meta.url))],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // E2E exercises a built binary against a stub server; instrumenting it
    // would measure neither the app nor the existing coverage gates.
    coverage: { enabled: false },
  },
}
