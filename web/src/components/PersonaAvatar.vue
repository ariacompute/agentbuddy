<script setup>
import { computed } from 'vue'

const props = defineProps({
  persona: { type: Object, default: () => ({}) },
  name: { type: String, default: '' },
  size: { type: Number, default: 40 },
})

// No hue anywhere: the grey step is chosen by a deterministic hash so the same
// identity always renders the same neutral shade.
const shade = computed(() => {
  const src = props.persona?.displayName || props.name || '?'
  let h = 0
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0
  const step = 30 + (h % 9) * 9 // 30%..93% luminance, neutral
  return `hsl(0 0% ${step}%)`
})

const initials = computed(() => {
  const src = props.persona?.displayName || props.name || '?'
  const parts = src.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
})

const hasImage = computed(() => !!props.persona?.avatarUrl)
</script>

<template>
  <span
    class="avatar"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.36) + 'px', background: hasImage ? undefined : shade }"
  >
    <img v-if="hasImage" :src="persona.avatarUrl" :alt="name" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
