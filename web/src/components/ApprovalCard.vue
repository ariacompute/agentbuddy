<script setup>
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { Check, X, ChevronRight } from 'lucide-vue-next'

const props = defineProps({
  task: { type: Object, required: true },
})
const { t } = useCopy('task')
const workbench = useWorkbenchStore()
const router = useRouter()

async function approve() {
  try {
    await workbench.approve(task.id)
  } catch (e) {
    console.error('agentbuddy: approve failed', e)
  }
}
async function reject() {
  try {
    await workbench.reject(task.id)
  } catch (e) {
    console.error('agentbuddy: reject failed', e)
  }
}
</script>

<template>
  <div class="card card-hover row" style="align-items:flex-start;gap:12px">
    <div class="state-dot" data-state="input-required" style="margin-top:6px" />
    <div style="min-width:0;flex:1">
      <div class="row" style="gap:8px">
        <strong class="truncate">{{ task.resourceId || task.id }}</strong>
        <span class="chip chip-mono">{{ task.id }}</span>
      </div>
      <p class="muted" style="font-size:12px;margin-top:2px">{{ t('approvalBody') }}</p>
    </div>
    <div class="row">
      <button class="btn btn-sm btn-primary" @click="approve"><Check :size="15" /> {{ t('approvalApprove') }}</button>
      <button class="btn btn-sm btn-danger" @click="reject"><X :size="15" /> {{ t('approvalReject') }}</button>
      <button class="btn btn-sm btn-ghost" @click="router.push(`/tasks/${task.id}`)">
        {{ t('approvalView') }} <ChevronRight :size="15" />
      </button>
    </div>
  </div>
</template>
