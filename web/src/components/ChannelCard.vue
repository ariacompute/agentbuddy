<script setup>
import { ref, computed } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { updateChannel } from '../lib/api.js'
import { enumLabel } from '../lib/use-copy.js'
import DeliveryList from './DeliveryList.vue'
import { formatTime } from '../lib/format.js'

const props = defineProps({
  channel: { type: Object, required: true },
  deliveries: { type: Array, default: () => [] },
})
const { t } = useCopy('channel')
const workbench = useWorkbenchStore()
const expanded = ref(false)
const saving = ref(false)

const typeLabel = computed(() => enumLabel('channelType', props.channel.kind))
const lastDelivery = computed(() => props.deliveries[0])

async function toggle() {
  saving.value = true
  try {
    await updateChannel(props.channel.id, { ...props.channel, enabled: !props.channel.enabled })
    await workbench.refreshChannels()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="card card-hover">
    <div class="row" style="justify-content:space-between;gap:10px">
      <div class="row" style="gap:10px;min-width:0">
        <span class="kind-mark" :data-kind="channel.kind === 'sms' ? 'cli' : 'mcp'" />
        <div style="min-width:0">
          <div class="name truncate">{{ channel.name }}</div>
          <div class="muted" style="font-size:12px">{{ typeLabel }}</div>
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" :checked="channel.enabled" :disabled="saving" @change="toggle" />
        <span>{{ t('enabledLabel') }}</span>
      </label>
    </div>

    <div class="row muted" style="font-size:12px;gap:8px;margin-top:8px">
      <span>{{ t('fieldThread') }}: <code class="mono">{{ channel.threadId || '—' }}</code></span>
      <span v-if="lastDelivery" class="spacer" />
      <span v-if="lastDelivery">{{ t('lastDelivery') }}: {{ formatTime(lastDelivery.at) }}</span>
      <span v-else>{{ t('neverUsed') }}</span>
    </div>

    <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="expanded = !expanded">
      {{ t('deliveriesTitle') }} ({{ deliveries.length }})
    </button>
    <DeliveryList v-if="expanded" :deliveries="deliveries" />
  </div>
</template>
