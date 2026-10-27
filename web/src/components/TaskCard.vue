<script setup>
import { useRouter } from 'vue-router'
import { useCopy } from '../lib/use-copy.js'
import StateDot from './StateDot.vue'
import { formatDuration } from '../lib/format.js'

const props = defineProps({
  task: { type: Object, required: true },
  dense: { type: Boolean, default: false },
})
const { t } = useCopy('task')
const router = useRouter()

function open() {
  router.push(`/tasks/${props.task.id}`)
}
</script>

<template>
  <div class="card card-hover" style="cursor:pointer" @click="open">
    <div class="row" style="justify-content:space-between;gap:10px">
      <div class="row" style="gap:8px;min-width:0">
        <strong class="truncate">{{ task.resourceId || task.id }}</strong>
        <span class="chip chip-mono">{{ task.id }}</span>
      </div>
      <StateDot :state="task.status?.state" />
    </div>
    <p v-if="!dense && task.status?.message?.parts?.length" class="muted truncate" style="font-size:12px;margin-top:6px">
      {{ task.status.message.parts.map((p) => p.text).join(' ') }}
    </p>
    <div v-if="!dense" class="row muted" style="font-size:11px;gap:8px;margin-top:6px">
      <span>{{ t('updated') }}</span>
      <span class="chip chip-mono">{{ formatDuration(task.status?.timestamp ? Date.now() - new Date(task.status.timestamp).getTime() : 0) }}</span>
    </div>
  </div>
</template>
