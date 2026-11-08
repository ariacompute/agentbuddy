<script setup>
import { ref, onMounted } from 'vue'
import { Sun, Moon } from 'lucide-vue-next'
import { pushShellConfig } from '../lib/shell-config.js'

const KEY = 'agentbuddy.theme'
const isLight = ref(false)

function read() {
  const v = (typeof window !== 'undefined' && window.localStorage.getItem(KEY)) || 'light'
  isLight.value = v === 'light'
  apply()
}

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = isLight.value ? 'light' : 'dark'
}

function toggle() {
  isLight.value = !isLight.value
  apply()
  if (typeof window !== 'undefined') {
    const theme = isLight.value ? 'light' : 'dark'
    window.localStorage.setItem(KEY, theme)
    // The page's storage is keyed by an origin whose port changes on every
    // start, so the shell config is what carries the choice into the next
    // launch — the proxy seeds it back before the first paint.
    pushShellConfig({ theme })
  }
}

onMounted(read)
</script>

<template>
  <button class="btn-icon" :aria-label="'Theme'" @click="toggle">
    <component :is="isLight ? Moon : Sun" :size="17" />
  </button>
</template>


