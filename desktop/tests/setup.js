// Shared setup for the release-script specs.
//
// Every script reports failure the way a CLI must: by setting `process.exitCode`
// (see `fail()` in latest-json.mjs). A green test run must not inherit that, so
// the worker's original exit code is restored after each case — otherwise a spec
// that deliberately drives the failure path would leave the run exiting 1.
import { afterEach } from 'vitest'

const initial = process.exitCode

afterEach(() => {
  process.exitCode = initial
})
