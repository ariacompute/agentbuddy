<script setup>
import { onMounted, ref, computed } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { listResources, updateResource } from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'

const { t } = useCopy('hub')
const agents = ref([])
const selectedId = ref('')
const loading = ref(true)
const error = ref('')
const saving = ref(false)

const form = ref({ role: '', instruction: '', mbti: '', avatar_ref: '', title: '' })

const selected = computed(() => agents.value.find((a) => a.id === selectedId.value) || null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    agents.value = await listResources('agent')
    if (agents.value.length) {
      selectedId.value = agents.value[0].id
      loadForm(agents.value[0])
    }
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    loading.value = false
  }
}

function loadForm(agent) {
  const p = agent.persona || {}
  form.value = {
    role: p.role || '',
    instruction: p.instruction || '',
    mbti: p.mbti || '',
    avatar_ref: p.avatar_ref || '',
    title: p.title || '',
  }
}

function onSelect() {
  if (selected.value) loadForm(selected.value)
}

async function save() {
  if (!selectedId.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await updateResource(selectedId.value, { persona: { ...form.value } })
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    saving.value = false
  }
}

const MBTI = ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP']

onMounted(load)
</script>

<template>
  <div class="stack">
    <div class="page-head"><div><h1>{{ t('personaTitle') }}</h1></div></div>

    <p v-if="error" class="empty">{{ error }}</p>
    <div v-else-if="loading" class="empty"><p class="muted">…</p></div>
    <div v-else-if="agents.length === 0" class="empty"><p>{{ t('computersEmpty') }}</p></div>

    <section v-else class="card stack">
      <label class="field">
        <span>{{ t('personaName') }}</span>
        <select v-model="selectedId" @change="onSelect">
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>{{ t('personaName') }} ({{ t('personaMbti') }})</span>
        <input v-model="form.title" type="text" />
      </label>
      <label class="field">
        <span>{{ t('personaMbti') }}</span>
        <select v-model="form.mbti">
          <option value="">—</option>
          <option v-for="m in MBTI" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label class="field">
        <span>{{ t('personaInstruction') }}</span>
        <textarea v-model="form.instruction" rows="4" />
      </label>
      <label class="field">
        <span>{{ t('personaAvatar') }}</span>
        <input v-model="form.avatar_ref" type="text" placeholder="ref://" />
      </label>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" :disabled="saving" @click="save">{{ t('personaSave') }}</button>
      </div>
    </section>
  </div>
</template>
