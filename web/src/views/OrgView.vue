<script setup>
import { reactive, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { listResources, createResource } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { enumLabel } from '../lib/use-copy.js'
import { formatBytes, formatDuration, resourceLabel } from '../lib/format.js'
import { errorMessage } from '../lib/errors.js'
import PersonaAvatar from '../components/PersonaAvatar.vue'

const { t } = useCopy('org')
const { t: to } = useCopy('ops')
const workbench = useWorkbenchStore()

// The catalogue is read one server-side window at a time: agenthub reports the
// size of the whole filtered set with each page, so this screen never has to
// hold — or count — every registered resource. Only the current page is here.
const PAGE_SIZES = [25, 50, 100]
const resources = ref([])
const counts = ref({})
const health = ref({})
const total = ref(0)
const skills = ref([])
const loading = ref(true)
const pageSize = ref(PAGE_SIZES[0])
const pageIndex = ref(0)
const kindFilter = ref('')
const query = ref('')

const kinds = ['model', 'agent', 'mcp', 'skill', 'cli', 'custom']

// `POST /api/resources` had a wrapper and no form, so registering anything meant
// curl. The catalogue is the console's front door; it should not be the one place
// that needs a terminal.
const form = reactive({ kind: 'agent', name: '', version: '', endpoint: '' })
const creating = ref(false)
const created = ref('')
const formError = ref('')

/** Applies one page. A server that predates paging answers without `total`, and
 *  then the page it sent is the whole catalogue it has. */
function applyPage(data) {
  resources.value = data.resources || []
  counts.value = data.counts || {}
  health.value = data.health || {}
  total.value = Number.isFinite(data.total) ? data.total : resources.value.length
}

async function load() {
  try {
    applyPage(await listResources(kindFilter.value || undefined, {
      q: query.value.trim() || undefined,
      limit: pageSize.value,
      offset: pageIndex.value * pageSize.value,
    }))
  } catch (e) {
    console.error('agentbuddy: org load failed', e)
  } finally {
    loading.value = false
  }
}

/**
 * Reads the skill manuals on their own, without the window.
 *
 * The chart above is one page of a mixed catalogue, so a page that happens to
 * hold no skill would read as "no skills registered". `limit: 0` is the server's
 * "everything" window, which is exactly the question this section asks. The
 * local kind check keeps an entry out of Skills when an older server ignored
 * `kind=`; a stray row must not appear twice.
 */
async function loadSkills() {
  try {
    const data = await listResources('skill', { limit: 0 })
    skills.value = (data.resources || []).filter((entry) => entry.kind === 'skill')
  } catch {
    skills.value = []
  }
}

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
    await load()
    await loadSkills()
  } catch (e) {
    formError.value = errorMessage(e.code) || e.message
  } finally {
    creating.value = false
  }
}

// The tab strip states the whole catalogue, which is why the server computes the
// counts without the kind filter: a tab must not read "0" because the page in
// view happens to belong to another kind.
const kindTabs = computed(() => [
  { key: '', label: t('kindAll'), count: total.value },
  ...kinds.map((kind) => ({ key: kind, label: enumLabel('kind', kind), count: counts.value[kind] || 0 })),
])

const byKind = computed(() => {
  const map = {}
  for (const k of kinds) map[k] = []
  for (const r of resources.value) (map[r.kind] || (map[r.kind] = [])).push(r)
  return map
})

const healthEntries = computed(() =>
  Object.entries(health.value).map(([key, count]) => ({ key, label: enumLabel('health', key), count })),
)

// The pager describes the window the server reported, not one inferred from the
// rows: an offset past the end is an empty page with an honest range.
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const rangeStart = computed(() => pageIndex.value * pageSize.value + 1)
const rangeEnd = computed(() => Math.min(total.value, pageIndex.value * pageSize.value + resources.value.length))
const canPrev = computed(() => pageIndex.value > 0)
const canNext = computed(() => pageIndex.value + 1 < pageCount.value)
const rangeLabel = computed(() =>
  t('pageRange')
    .replace('{from}', String(rangeStart.value))
    .replace('{to}', String(rangeEnd.value))
    .replace('{total}', String(total.value)),
)

function prevPage() {
  if (!canPrev.value) return
  pageIndex.value -= 1
  load()
}

function nextPage() {
  if (!canNext.value) return
  pageIndex.value += 1
  load()
}

// A filter change starts at the first page: staying on page four of a result set
// that just shrank to two pages would show an empty grid over a catalogue that
// still has rows.
function reloadFromFirstPage() {
  pageIndex.value = 0
  load()
}

watch([kindFilter, pageSize], reloadFromFirstPage)

// The search runs on the server, so one keystroke must not become one request:
// 250ms is short enough to feel live and long enough to type a word.
let searchTimer = null
watch(query, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(reloadFromFirstPage, 250)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

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

onMounted(() => {
  load()
  loadSkills()
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

      <div class="row row-wrap" role="group" :aria-label="t('kindLabel')">
        <button
          v-for="tab in kindTabs"
          :key="tab.key"
          class="btn btn-sm"
          :class="kindFilter === tab.key ? 'btn-primary' : 'btn-ghost'"
          @click="kindFilter = tab.key"
        >
          {{ tab.label }} <span class="chip">{{ tab.count }}</span>
        </button>
      </div>

      <input
        v-model="query"
        class="org-search"
        type="search"
        :placeholder="t('searchPlaceholder')"
        :aria-label="t('searchPlaceholder')"
      />

      <nav v-if="total > 0" class="pager" :aria-label="t('paginationLabel')">
        <button class="btn btn-ghost btn-sm" :disabled="!canPrev" @click="prevPage">{{ t('pagePrev') }}</button>
        <span class="pager-range mono">{{ rangeLabel }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="!canNext" @click="nextPage">{{ t('pageNext') }}</button>
        <label class="row pager-size">
          <span>{{ t('pageSize') }}</span>
          <select v-model.number="pageSize">
            <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
      </nav>

      <div v-if="healthEntries.length" class="row row-wrap org-health">
        <span class="muted" style="font-size:12px">{{ t('healthSummary') }}</span>
        <span v-for="entry in healthEntries" :key="entry.key" class="chip">
          {{ entry.label }} <strong>{{ entry.count }}</strong>
        </span>
      </div>

      <div v-if="total === 0 && !loading" class="empty">{{ t('chartEmpty') }}</div>
      <div class="org-grid">
        <div v-for="kind in kinds" :key="kind" class="org-col" v-show="byKind[kind].length">
          <h3>
            <span class="kind-mark" :data-kind="kind" />
            {{ enumLabel('kind', kind) }}
            <span class="chip" style="margin-inline-start:auto">{{ byKind[kind].length }}</span>
          </h3>
          <div class="stack" style="gap:8px">
            <div v-for="r in byKind[kind]" :key="r.id" class="row" style="gap:8px">
              <PersonaAvatar :persona="r.persona" :name="resourceLabel(r)" :size="26" />
              <span class="truncate">{{ resourceLabel(r) }}</span>
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
          <strong>{{ resourceLabel(s) }}</strong>
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
