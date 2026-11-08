<script setup>
import { computed } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { File as FileIcon, Download } from 'lucide-vue-next'
import AudioPlayer from './AudioPlayer.vue'
import { formatBytes } from '../lib/format.js'

const props = defineProps({
  artifacts: { type: Array, default: () => [] },
})
const { t } = useCopy('task')

const items = computed(() => props.artifacts || [])

function textOf(artifact) {
  return (artifact.parts || [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim()
}

function filePart(artifact) {
  return (artifact.parts || []).find((p) => p.type === 'file' && p.file)
}

function srcOf(file) {
  if (file.uri) return file.uri
  if (file.bytes) return `data:${file.mimeType || 'application/octet-stream'};base64,${file.bytes}`
  return ''
}
</script>

<template>
  <div class="stack" style="gap:10px">
    <div v-if="items.length === 0" class="muted" style="font-size:12px">{{ t('artifactsEmpty') }}</div>
    <template v-for="(artifact, i) in items" :key="i">
      <AudioPlayer
        v-if="filePart(artifact) && (filePart(artifact).file.mimeType || '').startsWith('audio')"
        :part="filePart(artifact)"
        :name="filePart(artifact).file.name || t('artifactFile')"
      />
      <div v-else-if="filePart(artifact)" class="artifact">
        <div class="artifact-head">
          <FileIcon :size="14" />
          <span>{{ filePart(artifact).file.name || t('artifactFile') }}</span>
          <span class="chip chip-mono">{{ formatBytes(filePart(artifact).file.bytes?.length) }}</span>
        </div>
        <a v-if="srcOf(filePart(artifact).file)" class="btn btn-sm btn-ghost" :href="srcOf(filePart(artifact).file)" download>
          <Download :size="14" /> {{ t('artifactFile') }}
        </a>
      </div>
      <div v-else-if="textOf(artifact)" class="artifact pre-wrap">{{ textOf(artifact) }}</div>
      <div v-else class="artifact muted" style="font-size:12px">{{ t('artifactsEmpty') }}</div>
    </template>
  </div>
</template>
