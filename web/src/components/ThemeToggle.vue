<script setup>
import { ref, onMounted } from 'vue'
import { Sun, Moon } from 'lucide-vue-next'

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
  if (typeof window !== 'undefined') window.localStorage.setItem(KEY, isLight.value ? 'light' : 'dark')
}

onMounted(read)
</script>

<template>
  <button class="btn-icon" :aria-label="'Theme'" @click="toggle">
    <component :is="isLight ? Moon : Sun" :size="17" />
  </button>
</template>


