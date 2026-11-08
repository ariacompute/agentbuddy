<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  closeLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'close'])

const panel = ref(null)
let lastActive = null

const FOCUSABLE =
  "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
    return
  }
  if (e.key === 'Tab' && panel.value) {
    const els = [...panel.value.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    )
    if (els.length === 0) return
    const first = els[0]
    const last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      lastActive = document.activeElement
      document.addEventListener('keydown', onKeydown, true)
      await nextTick()
      const el = panel.value?.querySelector(FOCUSABLE)
      ;(el || panel.value)?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown, true)
      if (lastActive && typeof lastActive.focus === 'function') lastActive.focus()
    }
  },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modelValue" class="dialog-backdrop" @click.self="close">
        <div
          ref="panel"
          class="dialog-card"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <header class="dialog-head">
            <h2 class="dialog-title">{{ title }}</h2>
            <button
              class="btn-icon btn-sm dialog-close"
              :aria-label="closeLabel || title"
              @click="close"
            >
              <X :size="16" />
            </button>
          </header>
          <div class="dialog-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="dialog-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--backdrop);
  backdrop-filter: blur(6px);
}

.dialog-card {
  width: 100%;
  max-width: 520px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--stroke-2);
  border-radius: var(--radius-lg);
  box-shadow: var(--glow);
  color: var(--text-1);
  outline: none;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.dialog-title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.dialog-close {
  flex: none;
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.dialog-card:focus-visible {
  box-shadow: var(--glow), 0 0 0 2px var(--bg-base), 0 0 0 4px var(--stroke-3);
}

:deep(.dialog-card button:focus-visible),
:deep(.dialog-card a:focus-visible),
:deep(.dialog-card input:focus-visible),
:deep(.dialog-card select:focus-visible),
:deep(.dialog-card textarea:focus-visible) {
  outline: 2px solid var(--stroke-3);
  outline-offset: 2px;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--dur) var(--ease);
}

.dialog-enter-active .dialog-card,
.dialog-leave-active .dialog-card {
  transition:
    transform var(--dur) var(--ease),
    opacity var(--dur) var(--ease);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-card,
.dialog-leave-to .dialog-card {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>
