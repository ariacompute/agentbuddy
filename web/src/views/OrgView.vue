<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { listResources, createResource } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { enumLabel } from '../lib/use-copy.js'
import { formatBytes, formatDuration } from '../lib/format.js'
import { errorMessage } from '../lib/errors.js'
import PersonaAvatar from '../components/PersonaAvatar.vue'

const { t } = useCopy('org')
const { t: to } = useCopy('ops')
const workbench = useWorkbenchStore()

const resources = ref([])
const loading = ref(true)

// `POST /api/resources` had a wrapper and no form, so registering anything meant
// curl. The catalogue is the console's front door; it should not be the one place
// that needs a terminal.
const form = reactive({ kind: 'agent', name: '', version: '', endpoint: '' })
const creating = ref(false)
const created = ref('')
const formError = ref('')

async function submit() {
  if (!form.name.trim() || creating.value) return
  creating.value = true
  formError.value = ''
  created.value = ''
  try {
    const entry = await createResource({
      kind: form.kind,
      name: form.name.trim(),
      display_name: form.name.trim(),
      version: form.version.trim(),
      endpoint: form.endpoint.trim(),
    })
    created.value = entry?.id || form.name.trim()
    form.name = ''
    form.version = ''
    form.endpoint = ''
    const data = await listResources()
    resources.value = data.resources || []
  } catch (e) {
    formError.value = errorMessage(e.code) || e.message
  } finally {
    creating.value = false
  }
}

const kinds = ['model', 'agent', 'mcp', 'skill', 'cli', 'custom']
const byKind = computed(() => {
  const map = {}
  for (const k of kinds) map[k] = []
  for (const r of resources.value) (map[r.kind] || (map[r.kind] = [])).push(r)
  return map
})

const skills = computed(() => byKind.value.skill || [])

const budget = computed(() => {
  const tasks = workbench.tasks
  const states = {}
  let bytes = 0
  let ms = 0
  for (const task of tasks) {
    const s = task.status?.state || 'unknown'
    states[s] = (states[s] || 0) + 1
    for (const a of task.artifacts || []) {
      for (const p of a.parts || []) {
        if (p.file?.bytes) bytes += p.file.bytes.length
      }
    }
    ms += task.status?.durationMs || 0
  }
  return {
    total: tasks.length,
    running: states.working || 0,
    waiting: states['input-required'] || 0,
    bytes,
    ms,
  }
})

onMounted(async () => {
  try {
    const data = await listResources()
    resources.value = data.resources || []
  } catch (e) {
    console.error('agentbuddy: org load failed', e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
    </div>

    <section class="card stack">
      <h2 class="card-title">{{ to('resourceTitle') }}</h2>
      <div class="grid grid-2" style="gap:12px">
        <label class="field">
          <span>{{ to('resourceKind') }}</span>
          <select v-model="form.kind">
            <option v-for="k in kinds" :key="k" :value="k">{{ enumLabel('kind', k) }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ to('resourceName') }}</span>
          <input v-model="form.name" type="text" placeholder="my-agent" />
        </label>
        <label class="field">
          <span>{{ to('resourceVersion') }}</span>
          <input v-model="form.version" type="text" placeholder="1.0.0" />
        </label>
        <label class="field">
          <span>{{ to('resourceEndpoint') }}</span>
          <input v-model="form.endpoint" type="text" placeholder="https://" />
        </label>
      </div>
      <div class="row" style="gap:10px">
        <button class="btn btn-sm" :disabled="!form.name.trim() || creating" @click="submit">
          {{ to('resourceCreate') }}
        </button>
        <span v-if="created" class="muted" style="font-size:12px">{{ to('resourceNew') }}: <code class="mono">{{ created }}</code></span>
      </div>
      <p v-if="formError" class="muted" style="font-size:12px">{{ formError }}</p>
    </section>

    <section class="stack">
      <h2 class="card-title">{{ t('chartTitle') }}</h2>
      <p class="muted" style="font-size:12px">{{ t('chartNote') }}</p>
      <div v-if="resources.length === 0 && !loading" class="empty">{{ t('chartEmpty') }}</div>
      <div class="org-grid">
        <div v-for="kind in kinds" :key="kind" class="org-col" v-show="byKind[kind].length">
          <h3>
            <span class="kind-mark" :data-kind="kind" />
            {{ enumLabel('kind', kind) }}
            <span class="chip" style="margin-inline-start:auto">{{ byKind[kind].length }}</span>
          </h3>
          <div class="stack" style="gap:8px">
            <div v-for="r in byKind[kind]" :key="r.id" class="row" style="gap:8px">
              <PersonaAvatar :persona="r.persona" :name="r.displayName || r.name" :size="26" />
              <span class="truncate">{{ r.displayName || r.name }}</span>
              <span class="spacer" />
              <span class="chip">{{ enumLabel('health', r.health?.status || r.health) }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="stack">
      <h2 class="card-title">{{ t('skillsTitle') }}</h2>
      <p class="muted" style="font-size:12px">{{ t('skillsNote') }}</p>
      <div v-if="skills.length === 0" class="empty">{{ t('skillsEmpty') }}</div>
      <div class="grid grid-2" v-else>
        <div v-for="s in skills" :key="s.id" class="card card-hover">
          <strong>{{ s.displayName || s.name }}</strong>
          <div class="tag-row" style="margin-top:8px">
            <span v-for="cap in (s.capabilities || []).slice(0, 8)" :key="cap" class="chip">{{ cap }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="stack">
      <h2 class="card-title">{{ t('budgetTitle') }}</h2>
      <p class="muted" style="font-size:12px">{{ t('budgetNote') }}</p>
      <div class="grid grid-2">
        <div class="card">
          <div class="stat-row">
            <div class="stat"><div class="k">{{ t('budgetTasks') }}</div><div class="v">{{ budget.total }}</div></div>
            <div class="stat"><div class="k">{{ t('budgetRunning') }}</div><div class="v">{{ budget.running }}</div></div>
            <div class="stat"><div class="k">{{ t('budgetWaiting') }}</div><div class="v">{{ budget.waiting }}</div></div>
          </div>
        </div>
        <div class="card">
          <div class="stat-row">
            <div class="stat"><div class="k">{{ t('budgetArtifacts') }}</div><div class="v">{{ formatBytes(budget.bytes) }}</div></div>
            <div class="stat"><div class="k">{{ t('budgetDuration') }}</div><div class="v">{{ formatDuration(budget.ms) }}</div></div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
