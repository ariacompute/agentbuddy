// Resolve the theme before the first paint so the shell never flashes the wrong
// grey scale: an explicit choice wins, otherwise default to light.
//
// Why this is a file and not an inline <script>: the desktop shell sends a
// content security policy with `script-src 'self'`, and an inline script would
// force the whole origin to accept 'unsafe-inline'. It is loaded synchronously
// from <head>, so it still runs before the body is painted.
;(function () {
  try {
    var stored = window.localStorage.getItem('agentbuddy.theme')
    document.documentElement.dataset.theme =
      stored === 'light' || stored === 'dark' ? stored : 'light'
  } catch (error) {
    document.documentElement.dataset.theme = 'light'
  }
})()
