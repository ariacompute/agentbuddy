<script setup>
import { onUnmounted, ref } from 'vue'
import { createRecorder, VoiceState } from '../lib/voice.js'
import { postThreadAudio } from '../lib/api.js'
import { useCopy } from '../lib/use-copy.js'
import { Mic, Square } from 'lucide-vue-next'

const props = defineProps({ threadId: { type: String, required: true } })
const { t } = useCopy('thread')
const error = ref(null)

function upload(blob) {
  return postThreadAudio(props.threadId, blob)
}

const recorder = createRecorder({
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  MediaRecorderImpl: typeof window !== 'undefined' ? window.MediaRecorder : null,
  upload,
  onState: (state, detail) => {
    if (state === VoiceState.Error) error.value = t('voiceDenied')
    else error.value = null
  },
})

onUnmounted(() => recorder.reset())

function toggle() {
  if (recorder.state === VoiceState.Recording) recorder.stop()
  else recorder.start()
}
</script>

<template>
  <div class="row" style="gap:8px">
    <button
      v-if="recorder.supported"
      class="voice-btn"
      :data-state="recorder.state"
      :aria-label="t('voiceRecord')"
      @click="toggle"
    >
      <span v-if="recorder.state === 'recording'" class="wave">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <component :is="recorder.state === 'recording' ? Square : Mic" v-else :size="17" />
    </button>
    <span v-if="!recorder.supported" class="muted" style="font-size:12px">{{ t('voiceUnavailable') }}</span>
    <span v-if="error" class="muted" style="font-size:12px">{{ error }}</span>
  </div>
</template>
