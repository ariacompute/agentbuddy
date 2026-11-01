// Test setup shared by every spec. The node-environment lib specs skip the
// browser-only parts (guarded by `typeof window`), while the jsdom component/view
// specs get a minimal, working localStorage so agentbuddy's i18n bootstrap
// (use-copy.js reads agentbuddy.lang from storage at import time) does not throw.
if (typeof window !== 'undefined') {
  const noopStorage = window.localStorage
  if (!noopStorage || typeof noopStorage.getItem !== 'function') {
    const data = {}
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v) },
        removeItem: (k) => { delete data[k] },
        clear: () => { for (const k of Object.keys(data)) delete data[k] },
      },
    })
  }
}
