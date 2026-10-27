<script setup>
import { ref } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { enumLabel } from '../lib/use-copy.js'
import { setConnectorPolicy, runConnectorAction } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import PolicySelect from './PolicySelect.vue'
import { Play } from 'lucide-vue-next'

const props = defineProps({ connector: { type: Object, required: true } })
const { t } = useCopy('connector')
const workbench = useWorkbenchStore()

const actionName = ref('')
const actionArgs = ref('')
const running = ref(false)
const runState = ref(null) // 'runQueued' | 'runParked' | 'runFailed'

async function changePolicy(key) {
  await setConnectorPolicy(props.connector.id, key)
  await workbench.refreshConnectors()
}

async function run() {
  if (!actionName.value) return
  running.value = true
  runState.value = null
  try {
    const args = actionArgs.value ? JSON.parse(actionArgs.value) : {}
    const res = await runConnectorAction(props.connector.id, actionName.value, args)
    runState.value = res?.parked ? 'runParked' : 'runQueued'
    await workbench.refreshTasks()
  } catch (e) {
    runState.value = 'runFailed'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="card card-hover">
    <div class="card-head">
      <span class="kind-mark" data-kind="mcp" />
      <strong class="truncate">{{ connector.displayName || connector.name }}</strong>
      <span class="spacer" />
      <span class="chip">{{ enumLabel('health', connector.health?.status || connector.health) }}</span>
    </div>

    <p class="muted" style="font-size:12px">{{ connector.endpoint }}</p>

    <div class="tag-row" style="margin-top:8px">
      <span v-for="cap in (connector.capabilities || []).slice(0, 10)" :key="cap" class="chip">{{ cap }}</span>
    </div>

    <div class="field" style="margin-top:14px">
      <label>{{ t('policyLabel') }}</label>
      <PolicySelect :value="connector.policy || 'off'" @change="changePolicy" />
    </div>

    <div class="field" style="margin-top:14px">
      <label>{{ t('actionsTitle') }}</label>
      <div class="row" style="gap:8px">
        <input v-model="actionName" :placeholder="t('actionName')" />
        <input v-model="actionArgs" :placeholder="t('actionArgs')" />
        <button class="btn btn-sm btn-primary" :disabled="running" @click="run">
          <Play :size="14" /> {{ t('actionRunSubmit') }}
        </button>
      </div>
      <p class="muted" style="font-size:11px">{{ t('actionArgsNote') }}</p>
      <p v-if="runState" class="muted" style="font-size:12px">{{ t(runState) }}</p>
    </div>
  </div>
</template>
