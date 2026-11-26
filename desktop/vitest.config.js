// Coverage gate for the release-time scripts in `scripts/`.
//
// These scripts run on three CI hosts (and on the release job's own files), so
// they cannot be exercised from the workbench suite: `web/` owns `src/`, this
// package owns the tooling that stamps, signs and publishes the desktop app.
// Keeping a second (tiny) Vitest project here means both halves are covered by
// an instrumented 100% gate instead of one 100% and one "trust me".
//
// Nothing is excluded: `scripts/**/*.mjs` is the whole surface, and the specs
// import the real modules in-process — the `isMain` guard each script carries is
// what makes that safe. The CLI surface itself is pinned by a couple of
// subprocess cases so the guard cannot rot unnoticed.
//
// The thresholds are part of the gate: a printed v8 report is a map, not a
// gate, and without them deleting a spec would leave CI green while the
// published "100% across four metrics" became stale.
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.js'],
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      include: ['scripts/**/*.mjs'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
}
