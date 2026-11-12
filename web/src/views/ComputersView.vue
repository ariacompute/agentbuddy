<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import {
  listSandboxes, sandboxStats, listSandboxProviders, refreshSandboxProviders,
  listSandboxNodes, getSandbox, execSandbox, renewSandbox, terminateSandbox,
  createComputer, subscribeSandboxEvents, listComputers, getComputer, deleteComputer,
} from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'
import BaseDialog from '../components/BaseDialog.vue'

// The execution-environment vocabulary is folded into the hub namespace, so one
// `t` covers this screen and the neighbours it links to.
const { t } = useCopy('hub')
const { t: to } = useCopy('ops')

const leases = ref([])
const stats = ref({})
const groups = ref([])
const defaultProvider = ref('')
const nodes = ref([])
const loading = ref(true)
const error = ref('')
// The control plane is a server switch. When it is off the endpoints answer 503
// and the screen says "sandboxes are off" rather than showing a level of zero as
// if that were healthy.
const sandboxOff = ref(false)
const refreshing = ref(false)

const busy = ref('')
const selected = ref(null)
const audit = ref([])
const auditOpen = ref(false)
const auditLoading = ref(false)

const trialCommand = ref('')
const trialArgs = ref('')
const trialResult = ref(null)
const trialRunning = ref(false)

const createOpen = ref(false)
const createKind = ref('shell')
const createAgent = ref('')
const creating = ref(false)

const pendingTerminate = ref(null)

// The F11 cards. `/api/computers` is a different table from `/api/sandboxes`:
// the card is the agent-facing object, the lease is the execution side. The list
// endpoint and the delete endpoint both shipped with wrappers and no screen, so a
// card could only be created (from the dialog below) and never seen or removed.
const computers = ref([])
const computersOff = ref(false)
const computersError = ref('')
const pendingDeleteCard = ref(null)
const deletingCard = ref('')

// The countdown is the only thing that changes without a request, so a 30s tick
// re-renders it and nothing else. It stops with the screen.
const now = ref(Date.now())
let ticker = null
let stream = null

const layerTitle = (layer) => {
  const map = {
    container: 'sbLayerContainer',
    'usermode-kernel': 'sbLayerUserKernel',
    microvm: 'sbLayerMicrovm',
    process: 'sbLayerProcess',
    platform: 'sbLayerPlatform',
    remote: 'sbLayerRemote',
    none: 'sbLayerNone',
  }
  return map[layer] ? t(map[layer]) : layer
}

const stateTitle = (state) => {
  const map = {
    starting: 'sbStateStarting',
    ready: 'sbStateReady',
    expired: 'sbStateExpired',
    terminated: 'sbStateTerminated',
    failed: 'sbStateFailed',
  }
  return map[state] ? t(map[state]) : state
}

/** The node strip reflects the last node this user enrolled, if any. */
const node = computed(() => nodes.value[0] || null)
const nodeOnline = computed(() => {
  if (!node.value) return false
  if (node.value.status === 'online') return true
  const seen = Date.parse(node.value.lastSeenAt || '')
  // A node is online if it polled within the last two minutes: a long poll parks
  // for at most one minute, so two is "alive" with room for a slow network.
  return Number.isFinite(seen) && Date.now() - seen < 120000
})

/** Seconds left on a lease; negative when it is past its deadline. */
function secondsLeft(lease) {
  const at = Date.parse(lease?.expiresAt || '')
  if (!Number.isFinite(at)) return 0
  return Math.round((at - now.value) / 1000)
}

function countdown(lease) {
  const left = secondsLeft(lease)
  if (left <= 0) return t('sbExpired')
  const minutes = Math.floor(left / 60)
  const seconds = left % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Under three minutes the number goes bold rather than coloured: no hue here. */
const urgent = (lease) => secondsLeft(lease) > 0 && secondsLeft(lease) <= 180

function when(iso) {
  const at = Date.parse(iso || '')
  if (!Number.isFinite(at)) return ''
  const diff = Math.max(0, Math.round((now.value - at) / 1000))
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.round(diff / 60)}m`
  return `${Math.round(diff / 3600)}h`
}

async function load() {
  error.value = ''
  await loadComputers()
  try {
    const [s, list, providers, nodeList] = await Promise.all([
      sandboxStats(), listSandboxes(), listSandboxProviders(), listSandboxNodes(),
    ])
    stats.value = s || {}
    leases.value = list?.leases || []
    groups.value = providers?.groups || []
    defaultProvider.value = providers?.default || ''
    nodes.value = nodeList?.nodes || []
    sandboxOff.value = false
  } catch (e) {
    if (e.code === 'feature_unavailable') {
      sandboxOff.value = true
      stats.value = {}
      leases.value = []
      groups.value = []
      nodes.value = []
      loading.value = false
      return
    }
    error.value = errorMessage(e.code) || e.message
  }
  loading.value = false
}

/**
 * Loads the agent computer cards. Kept apart from the sandbox load on purpose:
 * the two surfaces share a permission, not a store, and a missing computers
 * endpoint must not blank the sandbox level above it.
 */
async function loadComputers() {
  computersError.value = ''
  try {
    const data = await listComputers()
    computers.value = Array.isArray(data) ? data : data?.computers || []
    computersOff.value = false
  } catch (e) {
    if (e.code === 'feature_unavailable') {
      computersOff.value = true
      computers.value = []
      return
    }
    computersError.value = errorMessage(e.code) || e.message
  }
}

/**
 * Reads the card again before offering to delete it: the list may be a minute
 * old, and deleting a card that was re-attached in the meantime would take the
 * lease with it.
 */
async function askDeleteCard(card) {
  computersError.value = ''
  try {
    pendingDeleteCard.value = (await getComputer(card.id)) || card
  } catch (e) {
    computersError.value = errorMessage(e.code) || e.message
  }
}

async function confirmDeleteCard() {
  const card = pendingDeleteCard.value
  if (!card) return
  deletingCard.value = card.id
  try {
    await deleteComputer(card.id)
    pendingDeleteCard.value = null
    await loadComputers()
  } catch (e) {
    // The delete answers 404 for a card the server cannot see, so the card is
    // already gone. Reloading is the whole point: the operator asked for it to
    // disappear, and it has.
    if (e.code === 'computer_not_found') {
      pendingDeleteCard.value = null
      await loadComputers()
      return
    }
    computersError.value = errorMessage(e.code) || e.message
  } finally {
    deletingCard.value = ''
  }
}

async function refresh() {
  refreshing.value = true
  try {
    await refreshSandboxProviders()
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    refreshing.value = false
  }
}

async function refreshAudit() {
  if (!selected.value) return
  auditLoading.value = true
  try {
    const detail = await getSandbox(selected.value.id)
    audit.value = detail?.execs || []
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    auditLoading.value = false
  }
}

async function openAudit(lease) {
  selected.value = lease
  auditOpen.value = true
  audit.value = []
  trialResult.value = null
  error.value = ''
  await refreshAudit()
}

function closeAudit() {
  auditOpen.value = false
  selected.value = null
  trialResult.value = null
}

async function runTrial() {
  if (!selected.value || !trialCommand.value.trim() || trialRunning.value) return
  trialRunning.value = true
  error.value = ''
  try {
    const args = trialArgs.value.trim() ? trialArgs.value.trim().split(/\s+/) : []
    trialResult.value = await execSandbox(selected.value.id, {
      command: trialCommand.value.trim(),
      args,
    })
    // Refreshing only the audit list keeps the receipt on screen: reopening the
    // drawer would clear the output the operator just asked for.
    await refreshAudit()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    trialRunning.value = false
  }
}

async function renew(lease) {
  busy.value = lease.id
  error.value = ''
  try {
    await renewSandbox(lease.id)
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    busy.value = ''
  }
}

async function confirmTerminate() {
  const lease = pendingTerminate.value
  if (!lease) return
  busy.value = lease.id
  error.value = ''
  try {
    await terminateSandbox(lease.id)
    pendingTerminate.value = null
    if (selected.value?.id === lease.id) closeAudit()
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    busy.value = ''
  }
}

async function create() {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    await createComputer(createKind.value, createAgent.value.trim())
    createOpen.value = false
    createAgent.value = ''
    await load()
  } catch (e) {
    error.value = errorMessage(e.code) || e.message
  } finally {
    creating.value = false
  }
}

function onKey(lease, event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openAudit(lease)
  }
}

onMounted(async () => {
  await load()
  ticker = setInterval(() => { now.value = Date.now() }, 30000)
  // Live frames keep the counts honest while a task holds a lease. Replay starts
  // at 0 so a screen opened mid-run still sees the leases that already exist.
  if (typeof EventSource !== 'undefined') {
    let pending = null
    stream = subscribeSandboxEvents(0, {
      event: () => {
        if (pending) return
        pending = setTimeout(() => { pending = null; load() }, 1500)
      },
    })
  }
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (stream) stream.close()
})
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('sbTitle') }}</h1>
        <p class="sub">{{ t('sbSub') }}</p>
      </div>
      <div class="row" style="gap:8px">
        <span v-if="sandboxOff" class="chip">{{ t('sbOffTitle') }}</span>
        <span v-else class="chip" :class="nodeOnline ? 'chip-on' : ''">
          {{ nodeOnline ? t('sbNodeOnline') : t('sbNodeOffline') }}
        </span>
        <button class="btn btn-ghost btn-sm" :disabled="refreshing" @click="refresh">
          {{ t('sbRefresh') }}
        </button>
      </div>
    </div>

    <div v-if="error" class="banner banner-error">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-sm" @click="load">{{ t('sbRetry') }}</button>
    </div>

    <!-- Agent computer cards. Outside the sandbox switch on purpose: a server can
         have the cards table without a control plane, and the cards are what an
         agent is attached to. -->
    <section class="stack">
      <div class="row" style="justify-content:space-between">
        <h2 class="card-title">{{ t('computersTitle') }}</h2>
        <span class="chip">{{ computers.length }}</span>
      </div>
      <p v-if="computersError" class="muted" style="font-size:12px">{{ computersError }}</p>
      <p v-else-if="computersOff" class="muted" style="font-size:12px">{{ t('featureOff') }}</p>
      <p v-else-if="computers.length === 0" class="muted" style="font-size:12px">{{ t('computersEmpty') }}</p>
      <div v-else class="grid grid-agents">
        <article v-for="card in computers" :key="card.id" class="card stack" style="gap:6px">
          <div class="row" style="justify-content:space-between;gap:8px">
            <code class="mono">{{ card.kind }}</code>
            <span class="chip" :class="card.status === 'active' ? 'chip-on' : ''">
              {{ card.status === 'active' ? t('computerActive') : card.status === 'disabled' ? t('computerDisabled') : t('computerIdle') }}
            </span>
          </div>
          <code class="mono muted" style="font-size:11px">{{ card.id }}</code>
          <div class="lease-meta">
            <span>{{ to('computerAgentId') }}</span>
            <code class="mono">{{ card.agentId || '—' }}</code>
          </div>
          <div class="lease-meta">
            <span>{{ t('computerAttach') }}</span>
            <code class="mono">{{ card.lastAction || '—' }}</code>
          </div>
          <div class="row" style="gap:8px">
            <button
              class="btn btn-ghost btn-sm"
              :disabled="deletingCard === card.id"
              @click="askDeleteCard(card)"
            >
              {{ to('computerDelete') }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- Deleting a card terminates its lease first, so it is confirmed in place
         rather than in the lease drawer. -->
    <section v-if="pendingDeleteCard" class="card stack">
      <p>{{ to('computerDeleteConfirm') }}</p>
      <code class="mono">{{ pendingDeleteCard.id }}</code>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" :disabled="deletingCard === pendingDeleteCard.id" @click="confirmDeleteCard">
          {{ to('computerDelete') }}
        </button>
        <button class="btn btn-ghost btn-sm" @click="pendingDeleteCard = null">{{ t('sbCancel') }}</button>
      </div>
    </section>

    <section v-if="sandboxOff" class="card stack">
      <h2 class="card-title">{{ t('sbOffTitle') }}</h2>
      <p class="muted" style="font-size:12px">{{ t('sbOffBody') }}</p>
    </section>

    <template v-else>
      <section class="card stack">
        <div class="row" style="justify-content:space-between">
          <h2 class="card-title">{{ t('sbNodeTitle') }}</h2>
          <router-link class="btn btn-ghost btn-sm" to="/settings">{{ t('sbOpenSettings') }}</router-link>
        </div>
        <div class="row row-wrap" style="gap:18px">
          <span class="chip" :class="nodeOnline ? 'chip-on' : ''">
            {{ !node ? t('sbNodeDisabled') : nodeOnline ? t('sbNodeOnline') : t('sbNodeOffline') }}
          </span>
          <span class="muted" style="font-size:12px">
            {{ t('sbNodeBeat') }}:
            <code class="mono">{{ node ? (when(node.lastSeenAt) || t('sbNodeNever')) : t('sbNodeNever') }}</code>
          </span>
          <span class="muted" style="font-size:12px" v-if="node">
            {{ node.name }} · <code class="mono">{{ node.id }}</code>
          </span>
        </div>
      </section>

      <div class="stats-strip">
        <div class="stat">
          <span class="stat-value">{{ stats.activeLeases ?? 0 }}</span>
          <span class="stat-label">{{ t('sbStatLeases') }}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ stats.pendingJobs ?? 0 }}</span>
          <span class="stat-label">{{ t('sbStatJobs') }}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ stats.onlineNodes ?? 0 }}</span>
          <span class="stat-label">{{ t('sbStatNodes') }}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ stats.recentExecs ?? 0 }}</span>
          <span class="stat-label">{{ t('sbStatExecs') }}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ stats.lastSweepAt ? when(stats.lastSweepAt) : '—' }}</span>
          <span class="stat-label">{{ t('sbStatSweep') }}</span>
        </div>
      </div>

      <section class="stack">
        <div>
          <h2 class="card-title">{{ t('sbCatalogTitle') }}</h2>
          <p class="muted" style="font-size:12px">{{ t('sbCatalogSub') }}</p>
        </div>
        <div class="catalog-rail">
          <div v-for="group in groups" :key="group.layer" class="catalog-group">
            <h3 class="catalog-layer">{{ layerTitle(group.layer) }}</h3>
            <article
              v-for="p in group.providers"
              :key="p.name"
              class="catalog-card"
              :class="{ 'catalog-off': !p.available }"
            >
              <div class="row" style="justify-content:space-between;gap:6px">
                <strong class="mono">{{ p.name }}</strong>
                <span v-if="p.default || p.name === defaultProvider" class="chip chip-on">{{ t('sbDefaultBadge') }}</span>
              </div>
              <span class="muted" style="font-size:11px">{{ p.isolation }}</span>
              <span class="chip" :class="p.available ? 'chip-on' : ''">
                {{ p.available ? t('sbAvailable') : t('sbUnavailable') }}
              </span>
              <span v-if="!p.available && p.reason" class="catalog-reason">{{ p.reason }}</span>
              <span v-else-if="p.requires?.length" class="catalog-reason mono">{{ p.requires.join(' · ') }}</span>
            </article>
          </div>
        </div>
        <p class="muted" style="font-size:11px">{{ t('sbCatalogHint') }}</p>
      </section>

      <section class="stack">
        <div class="row" style="justify-content:space-between">
          <h2 class="card-title">{{ t('sbLeaseTitle') }}</h2>
          <button class="btn btn-ghost btn-sm" @click="createOpen = true">{{ t('sbCreateTitle') }}</button>
        </div>

        <div v-if="loading" class="card"><span class="muted">{{ t('sbLeaseTitle') }}…</span></div>
        <div v-else-if="leases.length === 0" class="card stack">
          <span class="muted">{{ t('sbLeaseEmpty') }}</span>
          <span class="muted" style="font-size:11px">{{ t('sbLeaseEmptyHint') }}</span>
        </div>
        <div v-else class="grid grid-agents">
          <article
            v-for="lease in leases"
            :key="lease.id"
            class="card card-hover lease-card"
            tabindex="0"
            role="button"
            @click="openAudit(lease)"
            @keydown="onKey(lease, $event)"
          >
            <div class="row" style="justify-content:space-between;gap:8px">
              <strong class="mono">{{ lease.provider }}</strong>
              <span class="chip" :class="lease.state === 'ready' ? 'chip-on' : ''">{{ stateTitle(lease.state) }}</span>
            </div>
            <code class="mono muted" style="font-size:11px">{{ lease.id }}</code>
            <div class="lease-meta">
              <span>{{ t('sbOwner') }}</span>
              <code class="mono">{{ lease.resourceId || '—' }}</code>
            </div>
            <div class="lease-meta">
              <span>{{ t('sbScope') }}</span>
              <code class="mono">{{ lease.scope }}</code>
            </div>
            <div class="lease-meta">
              <span>{{ t('sbBackend') }}</span>
              <code class="mono">{{ lease.nodeId || lease.ref || '—' }}</code>
            </div>
            <div class="lease-meta">
              <span>{{ t('sbExpiresIn') }}</span>
              <code class="mono lease-count" :class="{ 'lease-urgent': urgent(lease) }">{{ countdown(lease) }}</code>
            </div>
            <div class="lease-actions">
              <button class="btn btn-ghost btn-sm" @click.stop="openAudit(lease)">{{ t('sbTrial') }}</button>
              <button class="btn btn-ghost btn-sm" :disabled="busy === lease.id" @click.stop="renew(lease)">
                {{ t('sbRenew') }}
              </button>
              <button class="btn btn-ghost btn-sm" :disabled="busy === lease.id" @click.stop="pendingTerminate = lease">
                {{ t('sbTerminate') }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>

    <aside v-if="auditOpen" class="drawer" role="dialog" aria-modal="true" :aria-label="t('sbAuditTitle')">
      <header class="drawer-head">
        <div class="stack" style="gap:2px">
          <strong>{{ t('sbAuditTitle') }}</strong>
          <code class="mono muted" style="font-size:11px">{{ selected?.id }}</code>
        </div>
        <button class="btn btn-ghost btn-sm" @click="closeAudit">{{ t('sbAuditClose') }}</button>
      </header>
      <div class="drawer-body">
        <div class="stack" style="gap:8px">
          <strong style="font-size:12px">{{ t('sbTrialTitle') }}</strong>
          <div class="field">
            <label>{{ t('sbTrialCommand') }}</label>
            <input v-model="trialCommand" class="mono" :placeholder="'git'" />
          </div>
          <div class="field">
            <label>{{ t('sbTrialArgs') }}</label>
            <input v-model="trialArgs" class="mono" placeholder="status --short" />
          </div>
          <button class="btn btn-sm" :disabled="trialRunning || !trialCommand.trim()" @click="runTrial">
            {{ t('sbTrialRun') }}
          </button>
          <div v-if="trialResult" class="trial-out">
            <div class="row" style="gap:12px">
              <span class="chip">{{ t('sbExit') }} {{ trialResult.exitCode }}</span>
              <span class="chip">{{ trialResult.durationMs }}ms</span>
              <span v-if="trialResult.truncated" class="chip">{{ t('sbTruncated') }}</span>
            </div>
            <pre class="mono">{{ trialResult.stdout || trialResult.stderr || t('sbTrialNoOutput') }}</pre>
          </div>
        </div>

        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ t('sbAuditCommand') }}</th>
              <th>{{ t('sbExit') }}</th>
              <th>{{ t('sbDuration') }}</th>
              <th>{{ t('sbAuditWhen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="audit.length === 0">
              <td colspan="4" class="muted">{{ t('sbAuditEmpty') }}</td>
            </tr>
            <tr
              v-for="row in audit"
              :key="row.id"
              :class="{ 'audit-failed': row.exitCode !== 0 }"
            >
              <td>
                <code class="mono">{{ row.command }}</code>
                <span v-if="row.dryRun" class="chip" style="margin-inline-start:6px">{{ t('sbAuditDryRun') }}</span>
              </td>
              <td class="mono">{{ row.exitCode }}</td>
              <td class="mono">{{ row.durationMs }}ms</td>
              <td class="mono muted">{{ when(row.at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </aside>

    <BaseDialog v-model="createOpen" :title="t('sbCreateTitle')" :close-label="t('sbCancel')">
      <div class="field">
        <label>{{ t('sbCreateKind') }}</label>
        <select v-model="createKind">
          <option value="shell">{{ t('sbKindShell') }}</option>
          <option value="browser">{{ t('sbKindBrowser') }}</option>
          <option value="screen">{{ t('sbKindScreen') }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ t('sbCreateAgent') }}</label>
        <input v-model="createAgent" class="mono" placeholder="agent-…" />
      </div>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="createOpen = false">{{ t('sbCancel') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="creating" @click="create">{{ t('sbCreateSubmit') }}</button>
      </template>
    </BaseDialog>

    <BaseDialog
      :model-value="!!pendingTerminate"
      :title="t('sbTerminateTitle')"
      :close-label="t('sbCancel')"
      @update:model-value="pendingTerminate = null"
    >
      <p class="muted" style="font-size:12px">{{ t('sbTerminateBody') }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="pendingTerminate = null">{{ t('sbCancel') }}</button>
        <button class="btn btn-danger btn-sm" :disabled="busy === pendingTerminate?.id" @click="confirmTerminate">
          {{ t('sbConfirm') }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>
