// Small helper for auto-dismissing transient UI (toasts, banners). Returns a
// ref and a `dismiss` that cancels any pending timer; pass `ttl=0` to keep it
// until the caller dismisses it manually.
import { ref, onUnmounted } from 'vue'

export function useDismiss(initial = null, ttl = 5000) {
  const value = ref(initial)
  let timer = null

  function clear() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function show(next) {
    value.value = next
    clear()
    if (ttl > 0 && next) timer = setTimeout(() => { value.value = null }, ttl)
  }

  function dismiss() {
    clear()
    value.value = null
  }

  onUnmounted(clear)
  return { value, show, dismiss }
}
