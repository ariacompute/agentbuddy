<script setup>
import { computed } from 'vue'
import { enumLabel } from '../lib/use-copy.js'

const props = defineProps({
  state: { type: String, default: 'unknown' },
  label: { type: Boolean, default: true },
})

// enumLabel already falls back to the raw value, so an unknown state still prints.
const text = computed(() => enumLabel('taskState', props.state))
</script>

<template>
  <span class="row" style="gap:6px">
    <span class="state-dot" :data-state="state" />
    <span v-if="label" class="dim">{{ text }}</span>
  </span>
</template>
