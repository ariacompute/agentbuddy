<script setup>
import { ref, computed, onMounted } from 'vue'
import { listResources } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { enumLabel } from '../lib/use-copy.js'
import { formatBytes, formatDuration } from '../lib/format.js'
import PersonaAvatar from '../components/PersonaAvatar.vue'

const { t } = useCopy('org')
const workbench = useWorkbenchStore()

const resources = ref([])
const loading = ref(true)

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
