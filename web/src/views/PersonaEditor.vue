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
const saved = ref(false)

const form = ref({ display_name: '', role: '', instruction: '', mbti: '', avatar_ref: '', title: '' })

const selected = computed(() => agents.value.find((a) => a.id === selectedId.value) || null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    agents.value = (await listResources('agent')).resources || []
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
    // The registry column is the only display name; persona carries no label.
    display_name: agent.display_name || '',
    role: p.role || '',
    instruction: p.instruction || '',
    mbti: p.mbti || '',
    avatar_ref: p.avatar_ref || '',
    title: p.title || '',
  }
}

function onSelect() {
  saved.value = false
  if (selected.value) loadForm(selected.value)
}

async function save() {
  const agent = selected.value
  if (!agent || saving.value) return
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    // PUT /api/resources/{id} replaces the whole record: a body holding only
    // `persona` has no kind/name to validate and would wipe every other field.
    // Re-send the entry untouched except for display_name and the persona fields
    // this form owns. A legacy persona.displayName must never be echoed back:
    // the server decodes strictly and now rejects that key.
    const { display_name, ...personaFields } = form.value
    const persona = { ...(agent.persona || {}), ...personaFields }
    delete persona.displayName
    const stored = await updateResource(agent.id, { ...agent, display_name, persona })
    // The server trims, caps and validates the persona. Mirror what it stored so
    // the form shows the saved values rather than a half-typed draft.
    if (stored && stored.id) {
      Object.assign(agent, stored)
      loadForm(agent)
    }
    saved.value = true
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
        <span>{{ t('personaDisplayName') }}</span>
        <input v-model="form.display_name" type="text" />
      </label>
      <label class="field">
        <span>{{ t('personaJobTitle') }}</span>
        <input v-model="form.title" type="text" />
      </label>
      <label class="field">
        <span>{{ t('personaRole') }}</span>
        <input v-model="form.role" type="text" />
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
        <button class="btn btn-sm" :disabled="saving || !selected" @click="save">{{ saving ? t('personaSaving') : t('personaSave') }}</button>
        <span v-if="saved" class="muted" style="font-size:11px">{{ t('personaSaved') }}</span>
      </div>
    </section>
  </div>
</template>
