<script setup>
import { onMounted, ref } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'

const { t } = useCopy('hub')
const schedules = ref([])
const loading = ref(true)
const error = ref('')

const goal = ref('')
const cron = ref('')
const enabled = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    schedules.value = await listSchedules()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    loading.value = false
  }
}

async function add() {
  if (!goal.value.trim() || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await createSchedule(goal.value.trim(), cron.value.trim(), enabled.value)
    goal.value = ''
    cron.value = ''
    enabled.value = false
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    saving.value = false
  }
}

async function toggle(s) {
  try {
    await updateSchedule(s.id, { goal: s.goal, trigger: s.trigger || 'cron', cronExpr: s.cronExpr || '', enabled: !s.enabled })
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

async function remove(s) {
  try {
    await deleteSchedule(s.id)
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div><h1>{{ t('schedulesTitle') }}</h1></div>
    </div>

    <section class="card stack">
      <h2 class="card-title">{{ t('scheduleNew') }}</h2>
      <label class="field">
        <span>{{ t('scheduleGoal') }}</span>
        <input v-model="goal" type="text" :placeholder="t('scheduleGoal')" />
      </label>
      <label class="field">
        <span>{{ t('scheduleCron') }}</span>
        <input v-model="cron" type="text" placeholder="*/5 * * * *" />
      </label>
      <label class="row" style="gap:8px">
        <input v-model="enabled" type="checkbox" />
        <span>{{ t('scheduleEnabled') }}</span>
      </label>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" :disabled="!goal.trim() || saving" @click="add">{{ t('scheduleNew') }}</button>
      </div>
    </section>

    <p v-if="error" class="empty">{{ error }}</p>
    <div v-else-if="loading" class="empty"><p class="muted">…</p></div>
    <div v-else-if="schedules.length === 0" class="empty"><p>{{ t('schedulesEmpty') }}</p></div>

    <div v-else class="stack">
      <div v-for="s in schedules" :key="s.id" class="card row" style="gap:12px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <strong class="truncate">{{ s.goal }}</strong>
          <p class="muted truncate" style="font-size:12px">{{ s.cronExpr || '—' }} · {{ s.nextRun || '—' }}</p>
        </div>
        <span class="chip" :class="s.enabled ? 'chip-on' : ''">{{ s.enabled ? t('scheduleEnabled') : t('computerIdle') }}</span>
        <button class="btn btn-ghost btn-sm" @click="toggle(s)">{{ t('scheduleEnabled') }}</button>
        <button class="btn btn-ghost btn-sm" @click="remove(s)">×</button>
      </div>
    </div>
  </div>
</template>
