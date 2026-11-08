<script setup>
import { useCopy } from '../lib/use-copy.js'

const props = defineProps({
  value: { type: String, default: 'off' },
})
const emit = defineEmits(['change'])
const { t } = useCopy('connector')

const options = [
  { key: 'allowed', label: () => t('policyAllowed'), note: () => t('policyAllowedNote') },
  { key: 'ask', label: () => t('policyAsk'), note: () => t('policyAskNote') },
  { key: 'off', label: () => t('policyOff'), note: () => t('policyOffNote') },
]

function pick(key) {
  if (key === props.value) return
  if (!window.confirm(t('policyConfirm'))) return
  emit('change', key)
}
</script>

<template>
  <div class="policy-select">
    <button
      v-for="opt in options"
      :key="opt.key"
      class="policy-opt"
      :class="{ 'is-on': value === opt.key }"
      @click="pick(opt.key)"
    >
      <div class="row">
        <span class="state-dot" :data-state="opt.key === 'allowed' ? 'completed' : opt.key === 'ask' ? 'working' : 'failed'" />
        {{ opt.label() }}
      </div>
      <div class="muted" style="font-size:11px">{{ opt.note() }}</div>
    </button>
  </div>
</template>

<style scoped>
.policy-select {
  display: grid;
  gap: 8px;
}
.policy-opt {
  text-align: left;
  border: 1px solid var(--stroke-2);
  border-radius: var(--radius);
  padding: 10px 12px;
  background: var(--bg-elevated);
  display: block;
}
.policy-opt.is-on {
  border-color: var(--accent);
}
</style>
