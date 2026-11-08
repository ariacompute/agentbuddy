<script setup>
import { computed } from 'vue'
import { useCopy } from '../lib/use-copy.js'

// Renders an audio artifact. The bytes arrive inline (base64) from the mock TTS
// adapter; a real backend would set uri instead. Either way the element is
// greyscaled by the global audio filter so no hue can leak in.
const props = defineProps({
  part: { type: Object, required: true },
  name: { type: String, default: 'audio' },
})
const { t } = useCopy('task')

const src = computed(() => {
  const f = props.part.file || props.part.data?.file
  if (!f) return ''
  if (f.uri) return f.uri
  if (f.bytes) return `data:${f.mimeType || 'audio/webm'};base64,${f.bytes}`
  return ''
})
</script>

<template>
  <div class="artifact">
    <div class="artifact-head">
      <span>{{ t('artifactAudio') }}</span>
      <span class="chip chip-mono">{{ name }}</span>
    </div>
    <audio v-if="src" :src="src" controls />
    <span v-else class="muted">—</span>
  </div>
</template>
