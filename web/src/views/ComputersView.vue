<script setup>
import { onMounted, ref } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { listComputers, createComputer } from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'

const { t } = useCopy('hub')
const computers = ref([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    computers.value = await listComputers()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    loading.value = false
  }
}

async function add(kind) {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    await createComputer(kind, '')
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    creating.value = false
  }
}

const statusLabel = (s) =>
  s === 'active' ? t('computerActive') : s === 'disabled' ? t('computerDisabled') : t('computerIdle')

onMounted(load)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div><h1>{{ t('computersTitle') }}</h1></div>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" :disabled="creating" @click="add('browser')">+ browser</button>
        <button class="btn btn-sm" :disabled="creating" @click="add('shell')">+ shell</button>
        <button class="btn btn-sm" :disabled="creating" @click="add('screen')">+ screen</button>
      </div>
    </div>

    <p v-if="error" class="empty">{{ error }}</p>
    <div v-else-if="loading" class="empty"><p class="muted">…</p></div>
    <div v-else-if="computers.length === 0" class="empty"><p>{{ t('computersEmpty') }}</p></div>

    <div v-else class="grid grid-agents">
      <div v-for="c in computers" :key="c.id" class="card stack">
        <div class="row" style="gap:8px;justify-content:space-between">
          <strong>{{ c.kind }}</strong>
          <span class="chip">{{ statusLabel(c.status) }}</span>
        </div>
        <p class="muted truncate" style="font-size:12px">{{ c.id }}</p>
        <button class="btn btn-ghost btn-sm" disabled :title="t('featureOff')">{{ t('computerAttach') }}</button>
      </div>
    </div>
  </div>
</template>
