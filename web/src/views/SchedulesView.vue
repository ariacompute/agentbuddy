<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import {
  listSchedules, createSchedule, updateSchedule, deleteSchedule, runSchedule,
  routerStats, listRouterTriggers, listRouterTickets, kickRouterPass,
  cancelRouterTicket, handbackRouterTrigger, getRouterTrigger, getRouterTicket,
  listRouterPolicies, saveRouterPolicy, subscribeRouterEvents,
} from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'
import { enumLabel } from '../lib/use-copy.js'

// The scheduler's own vocabulary (trigger, ticket, pass, disposition) is merged
// into the hub namespace, so one `t` covers both halves of this screen.
const { t } = useCopy('hub')
const { t: to } = useCopy('ops')

const schedules = ref([])
const stats = ref({})
const triggers = ref([])
const tickets = ref([])
const policies = ref([])
// One row expanded at a time, fetched on demand: the list endpoints carry the
// summary, the detail endpoint carries the body and the decision trail, and
// nothing here should pay for that on every load.
const detail = ref(null)
const detailLoading = ref(false)
const loading = ref(true)
const error = ref('')
let stream = null
let reloadTimer = null
// The scheduler is a server switch: when it is off the endpoints answer 503 and
// the screen says so instead of rendering a level of zero as if it were healthy.
const routerOff = ref(false)

const goal = ref('')
const cron = ref('')
const enabled = ref(false)
const saving = ref(false)
const selected = ref('')

// A one second tick is what turns next_run into a countdown; it stops with the
// component so nothing keeps running behind a closed screen.
const now = ref(Date.now())
let ticker = null

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listSchedules()
    schedules.value = data?.schedules || []
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
    loading.value = false
    return
  }
  await loadRouter()
  loading.value = false
}

async function loadRouter() {
  try {
    const [s, tr, tk, po] = await Promise.all([
      routerStats(), listRouterTriggers({ limit: 50 }), listRouterTickets({ limit: 50 }),
      listRouterPolicies(),
    ])
    stats.value = s || {}
    triggers.value = tr?.triggers || []
    tickets.value = tk?.tickets || []
    policies.value = po?.policies || []
    routerOff.value = false
  } catch (e) {
    if (e.code === 'feature_unavailable') {
      routerOff.value = true
      stats.value = {}
      triggers.value = []
      tickets.value = []
      policies.value = []
      return
    }
    error.value = errorMessage(e.code) || e.message
  }
}

/** Saves one intake policy. The source is part of the path, never the body. */
async function savePolicy(policy, mode) {
  error.value = ''
  try {
    await saveRouterPolicy(policy.source, {
      mode,
      allow: policy.allow || [],
      keywords: policy.keywords || [],
      resource: policy.resource || '',
    })
    await loadRouter()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

/** Expands a trigger: the body plus the router's verdict on it. */
async function openTrigger(trig) {
  if (detail.value?.kind === 'trigger' && detail.value.data?.id === trig.id) {
    detail.value = null
    return
  }
  detailLoading.value = true
  error.value = ''
  try {
    const data = await getRouterTrigger(trig.id)
    // An empty body is not a trigger: opening a panel for it would render
    // undefined fields, so it stays closed and the row simply does nothing.
    detail.value = data ? { kind: 'trigger', data } : null
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    detailLoading.value = false
  }
}

/** Expands a ticket: its attempts, the last error and the task it owns. */
async function openTicket(run) {
  if (detail.value?.kind === 'ticket' && detail.value.data?.id === run.id) {
    detail.value = null
    return
  }
  detailLoading.value = true
  error.value = ''
  try {
    const data = await getRouterTicket(run.id)
    detail.value = data ? { kind: 'ticket', data } : null
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    detailLoading.value = false
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
    if (selected.value === s.id) selected.value = ''
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

/** Fires a goal now: it becomes a trigger, so it shows up in the stream below. */
async function runNow(s) {
  error.value = ''
  try {
    await runSchedule(s.id)
    await loadRouter()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

/** A ticket still in flight can be ended: the task behind it stops too. */
const canCancel = (run) => ['queued', 'running', 'waiting'].includes(run.state)

/** Only a running ticket holds a trigger it could give back, and only once. */
const canHandback = (run) => run.state === 'running' && Boolean(run.originTriggerId)

async function cancelRun(run) {
  error.value = ''
  try {
    await cancelRouterTicket(run.id)
    await loadRouter()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

async function handbackRun(run) {
  error.value = ''
  try {
    await handbackRouterTrigger(run.id, run.originTriggerId)
    await loadRouter()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

/** Runs one scheduling beat instead of waiting for the next tick. */
async function kick() {
  error.value = ''
  try {
    await kickRouterPass()
    await loadRouter()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  }
}

/** Triggers this goal produced. The cron source stamps the schedule id on them. */
const triggersOf = (id) => triggers.value.filter((x) => x.sourceId === id)

/** The work a goal opened: tickets whose origin trigger came from it. */
const ticketsOf = (id) => {
  const ids = new Set(triggersOf(id).map((x) => x.id))
  return tickets.value.filter((x) => ids.has(x.originTriggerId))
}

const history = computed(() => (selected.value ? ticketsOf(selected.value) : []))

/** The hub task behind a ticket, so a trigger row can open the real trace. */
const taskOf = (ticketId) => tickets.value.find((x) => x.id === ticketId)?.taskId || ''

function countdown(next) {
  if (!next) return '—'
  const at = Date.parse(next)
  if (Number.isNaN(at)) return '—'
  const diff = at - now.value
  if (diff <= 0) return t('routerRunNow')
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// Dispositions are the audit trail: every trigger says what the router did with
// it, including the ones that never reached a worker.
const DISPOSITION_COPY = {
  routed: 'routerAccepted',
  filtered: 'routerFiltered',
  ignored: 'routerIgnored',
  stopped: 'routerStopped',
  unavailable: 'routerUndecided',
  pending: 'routerQueue',
}

const dispositionLabel = (d) => t(DISPOSITION_COPY[d] || 'routerUndecided')

const stateLabel = (s) => {
  if (s === 'done') return t('routerAccepted')
  if (s === 'running') return t('routerRunning')
  if (s === 'waiting') return t('routerWaiting')
  if (s === 'queued') return t('routerQueue')
  return s || '—'
}

const short = (v) => (v && v.length > 48 ? `${v.slice(0, 48)}…` : v || '—')
const clock = (v) => {
  const at = Date.parse(v)
  return Number.isNaN(at) ? '—' : new Date(at).toLocaleString()
}

onMounted(() => {
  load()
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  // Live router frames: a beat can route a trigger or close a ticket while this
  // screen is open, and a 30s poll would show a level that is already stale. The
  // reload is debounced because one beat emits several frames.
  if (typeof EventSource !== 'undefined') {
    stream = subscribeRouterEvents(0, {
      event: () => {
        if (reloadTimer) return
        reloadTimer = setTimeout(() => { reloadTimer = null; loadRouter() }, 800)
      },
    })
  }
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  ticker = null
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = null
  if (stream) stream.close()
  stream = null
})
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('schedulesTitle') }}</h1>
        <p class="sub">{{ t('routerTitle') }}</p>
      </div>
      <button v-if="!routerOff" class="btn btn-ghost btn-sm" @click="kick">
        {{ t('routerKick') }}
      </button>
    </div>

    <p v-if="routerOff" class="empty">{{ t('routerOff') }}</p>

    <!-- Water level: what the next beat will look at, and what is already running. -->
    <section v-else class="stats-strip" :aria-label="t('routerTitle')">
      <div class="stat">
        <span class="stat-value">{{ stats.pending ?? 0 }}</span>
        <span class="stat-label">{{ t('routerQueue') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ stats.runningTickets ?? 0 }}</span>
        <span class="stat-label">{{ t('routerRunning') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ stats.waiting ?? 0 }}</span>
        <span class="stat-label">{{ t('routerWaiting') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ stats.batchSize ?? 0 }}</span>
        <span class="stat-label">{{ t('routerBatch') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value mono">{{ stats.passes ?? 0 }}</span>
        <span class="stat-label">{{ t('routerLastPass') }}</span>
      </div>
    </section>

    <!-- Intake policies: what the router does with an incoming message per
         source. They were readable and writable over HTTP with no screen. -->
    <section v-if="!routerOff" class="card stack">
      <div>
        <h2 class="card-title">{{ to('policyTitle') }}</h2>
        <p class="muted" style="font-size:12px">{{ t('routerTitle') }}</p>
      </div>
      <p v-if="policies.length === 0" class="muted" style="font-size:12px">{{ t('routerTriggersEmpty') }}</p>
      <div v-for="policy in policies" :key="policy.source" class="card stack" style="gap:6px">
        <code class="mono">{{ policy.source }}</code>
        <div class="row row-wrap" style="gap:12px">
          <span v-if="policy.allow && policy.allow.length" class="muted" style="font-size:12px">
            {{ to('policyAllow') }}: <code class="mono">{{ policy.allow.join(' · ') }}</code>
          </span>
          <span v-if="policy.keywords && policy.keywords.length" class="muted" style="font-size:12px">
            {{ to('policyKeywords') }}: <code class="mono">{{ policy.keywords.join(' · ') }}</code>
          </span>
          <span v-if="policy.resource" class="muted" style="font-size:12px">
            {{ to('policyResource') }}: <code class="mono">{{ policy.resource }}</code>
          </span>
        </div>
        <label class="field">
          <span>{{ to('policySave') }}</span>
          <select :value="policy.mode || 'off'" @change="savePolicy(policy, $event.target.value)">
            <option value="off">{{ enumLabel('policy', 'off') }}</option>
            <option value="candidate">{{ enumLabel('policy', 'candidate') }}</option>
            <option value="request_only">{{ enumLabel('policy', 'request_only') }}</option>
          </select>
        </label>
      </div>
    </section>

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
      <div
        v-for="s in schedules"
        :key="s.id"
        class="card row schedule-row"
        :class="{ selected: selected === s.id }"
        style="gap:12px;align-items:flex-start"
        @click="selected = selected === s.id ? '' : s.id"
      >
        <div style="flex:1;min-width:0">
          <strong class="truncate">{{ s.goal }}</strong>
          <p class="muted truncate" style="font-size:12px">
            {{ s.cronExpr || '—' }} · {{ t('routerNextRun') }} {{ countdown(s.nextRun) }} · {{ s.lastStatus || '—' }}
          </p>
        </div>
        <span class="chip" :class="s.enabled ? 'chip-on' : ''">{{ s.enabled ? t('scheduleEnabled') : t('computerIdle') }}</span>
        <button v-if="!routerOff" class="btn btn-ghost btn-sm" @click.stop="runNow(s)">{{ t('routerRunNow') }}</button>
        <button class="btn btn-ghost btn-sm" @click.stop="toggle(s)">{{ t('scheduleEnabled') }}</button>
        <button class="btn btn-ghost btn-sm" @click.stop="remove(s)">×</button>
      </div>
    </div>

    <!-- Run history of the selected goal: one node per ticket it opened. -->
    <section v-if="selected && !routerOff" class="card stack">
      <h2 class="card-title">{{ t('routerRuns') }}</h2>
      <p v-if="history.length === 0" class="muted">{{ t('routerRunsEmpty') }}</p>
      <ol v-else class="run-timeline">
        <li v-for="run in history" :key="run.id" class="timeline-node" @click="openTicket(run)">
          <span class="timeline-dot" :class="{ live: run.state === 'running' }" aria-hidden="true" />
          <div class="timeline-body">
            <p class="truncate">
              <span class="chip">{{ stateLabel(run.state) }}</span>
              <span class="muted">{{ clock(run.updatedAt || run.createdAt) }}</span>
            </p>
            <p class="muted truncate" style="font-size:12px">
              {{ t('routerTicket') }} {{ run.id }}
              <template v-if="run.lastError"> · {{ run.lastError }}</template>
            </p>
          </div>
          <RouterLink v-if="run.taskId" class="btn btn-ghost btn-sm" :to="`/tasks/${run.taskId}`">
            {{ t('routerOpenTask') }}
          </RouterLink>
          <button v-if="canHandback(run)" class="btn btn-ghost btn-sm" @click="handbackRun(run)">
            {{ t('routerHandback') }}
          </button>
          <button v-if="canCancel(run)" class="btn btn-ghost btn-sm" @click="cancelRun(run)">
            {{ t('routerCancel') }}
          </button>
        </li>
      </ol>
    </section>

    <!-- One row at a time, fetched on demand: the list carries the summary, the
         detail carries the body and the decision trail. -->
    <section v-if="detail && detail.data" class="card stack">
      <div class="row" style="justify-content:space-between">
        <h2 class="card-title">
          {{ detail.kind === 'trigger' ? t('routerTriggers') : t('routerTicket') }}
        </h2>
        <button class="btn btn-ghost btn-sm" @click="detail = null">×</button>
      </div>
      <template v-if="detail.kind === 'trigger'">
        <p class="pre-wrap">{{ detail.data.body || '—' }}</p>
        <div class="row row-wrap" style="gap:12px">
          <span class="chip">{{ detail.data.source }}</span>
          <span class="chip" :class="detail.data.disposition === 'routed' ? 'chip-on' : ''">
            {{ dispositionLabel(detail.data.disposition) }}
          </span>
          <span class="muted" style="font-size:12px">{{ clock(detail.data.at) }}</span>
          <code v-if="detail.data.ticketId" class="mono muted" style="font-size:11px">{{ detail.data.ticketId }}</code>
        </div>
      </template>
      <template v-else>
        <div class="row row-wrap" style="gap:12px">
          <span class="chip">{{ stateLabel(detail.data.state) }}</span>
          <span class="muted" style="font-size:12px">{{ clock(detail.data.updatedAt || detail.data.createdAt) }}</span>
          <span v-if="detail.data.attempts" class="muted" style="font-size:12px">×{{ detail.data.attempts }}</span>
        </div>
        <p v-if="detail.data.lastError" class="muted" style="font-size:12px">{{ detail.data.lastError }}</p>
        <RouterLink v-if="detail.data.taskId" class="btn btn-ghost btn-sm" :to="`/tasks/${detail.data.taskId}`">
          {{ t('routerOpenTask') }}
        </RouterLink>
      </template>
    </section>

    <!-- Recent triggers: the stream itself, with the verdict on each row. -->
    <section v-if="!routerOff" class="card stack">
      <h2 class="card-title">{{ t('routerTriggers') }}</h2>
      <p v-if="triggers.length === 0" class="muted">{{ t('routerTriggersEmpty') }}</p>
      <ul v-else class="trigger-list">
        <li v-for="trig in triggers" :key="trig.id" class="trigger-row trigger-row-click" @click="openTrigger(trig)">
          <span class="muted mono">{{ clock(trig.at) }}</span>
          <span class="chip">{{ trig.source }}</span>
          <span class="truncate" style="flex:1;min-width:0">{{ short(trig.body) }}</span>
          <span class="chip" :class="trig.disposition === 'routed' ? 'chip-on' : ''">
            {{ dispositionLabel(trig.disposition) }}
          </span>
          <RouterLink v-if="taskOf(trig.ticketId)" class="btn btn-ghost btn-sm" :to="`/tasks/${taskOf(trig.ticketId)}`">
            {{ t('routerOpenTask') }}
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
