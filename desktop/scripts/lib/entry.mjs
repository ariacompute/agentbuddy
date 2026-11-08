// The three lines every script in `scripts/` used to repeat at the bottom:
//
//   if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
//     process.exitCode = main(process.argv.slice(2))
//   }
//
// Keeping that inline made the line impossible to cover: a spec imports the
// module, so the body only ever ran in a spawned process, which v8 does not
// instrument. Hoisting it here means each script ends with a single statement
// that *is* executed on import (`runAsEntry` decides whether to act), and the
// decision itself is an ordinary, fully testable function — no `exclude`, no
// `/* v8 ignore */`, which the acceptance criteria forbid.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** Is `url` the module the process was started with? */
function isMain(url, argv1 = process.argv[1]) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(url)
}

/**
 * Run `main` when `url` is the process entry point.
 *
 * `main` takes no arguments on purpose: each script reads `process.argv` (or
 * `process.env`) through its own defaulted parameters, so a test can call it with
 * injected values while this wrapper stays argument-free — an arrow here would be
 * a body only a spawned process could ever execute, and the gate would be back
 * where it started.
 */
function runAsEntry(url, main, { exit = process } = {}) {
  if (!isMain(url)) return undefined
  exit.exitCode = main()
  return exit.exitCode
}

export { isMain, runAsEntry }
