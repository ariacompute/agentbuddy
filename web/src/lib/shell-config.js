// Preferences the workbench owns but cannot persist by itself.
//
// The desktop shell serves the page from `http://127.0.0.1:<port>` and the OS
// picks a new port on every start, so the origin — and with it `localStorage` —
// is empty at every launch. The shell's own `config.json` is the copy that
// survives a restart, and the proxy plants it back into the page before the
// first paint (see `proxy/static_files.rs`), so writing here is what makes a
// language or theme choice stick.
//
// Not in `api.js` on purpose: `api.js` is the agenthub client, whose failures
// surface as `ApiError` codes. This one is fire-and-forget — the caller has
// already applied the change locally, and a plain browser build has no
// `/__shell` at all.

/** The shell's config endpoint. 404 outside the desktop shell. */
export const SHELL_CONFIG_PATH = '/__shell/config'

/**
 * Pushes one patch of preferences to the shell.
 *
 * A failed request is swallowed: it means the workbench is not running inside
 * the desktop shell (or the shell is shutting down), and there is nothing the
 * user could do about it.
 */
export function pushShellConfig(patch) {
  fetch(SHELL_CONFIG_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {})
}
