<script setup>
import { useCopy } from '../lib/use-copy.js'
import { enumLabel } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import { formatTime } from '../lib/format.js'
import { RefreshCw } from 'lucide-vue-next'

const props = defineProps({
  deliveries: { type: Array, default: () => [] },
})
const { t } = useCopy('channel')

function statusKey(d) {
  if (d.status === 'delivered') return 'deliveryOk'
  if (d.status === 'pending') return 'deliveryPending'
  return 'deliveryFailed'
}
</script>

<template>
  <div class="stack" style="gap:6px;margin-top:10px">
    <div v-if="deliveries.length === 0" class="muted" style="font-size:12px">{{ t('deliveriesEmpty') }}</div>
    <div v-for="d in deliveries" :key="d.id" class="span-row">
      <span class="chip">{{ enumLabel('direction', d.direction) }}</span>
      <span class="chip" :data-on="d.status === 'delivered'">{{ t(statusKey(d)) }}</span>
      <span class="spacer truncate">{{ d.errorCode ? errorMessage(d.errorCode) : '' }}</span>
      <span class="dur">{{ formatTime(d.at) }}</span>
    </div>
  </div>
</template>
