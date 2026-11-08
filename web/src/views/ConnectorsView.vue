<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Check, RefreshCw, X } from 'lucide-vue-next'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import {
  approveConnectorAction, getConnectorActions, listConnectorApprovals, rejectConnectorAction,
} from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'
import ConnectorCard from '../components/ConnectorCard.vue'

const { t } = useCopy('connector')
const { t: to } = useCopy('ops')
// Refresh/retry are the two words every operational screen uses; the sandbox
// screen coined them and they are folded into `hub`.
const { t: th } = useCopy('hub')
const workbench = useWorkbenchStore()

// The approval queue is derived from the parked A2A tasks, so it is read here
// rather than from the store's own task list: a store refresh is about activity,
// and an approval is about a decision somebody still owes.
const queue = ref([])
const queueLoading = ref(false)
const queueError = ref('')
const busy = ref('')

async function loadApprovals() {
  queueLoading.value = true
  queueError.value = ''
  try {
    const data = await listConnectorApprovals()
    queue.value = Array.isArray(data) ? data : []
  } catch (e) {
    queueError.value = errorMessage(e.code) || e.message
  } finally {
    queueLoading.value = false
  }
}

/**
 * Decides one request. The row is disabled while it is in flight: the same
 * approval decided twice is a 409, and asking for it twice is pointless.
 */
async function decide(row, approve) {
  busy.value = row.taskId
  queueError.value = ''
  try {
    if (approve) await approveConnectorAction(row.taskId)
    else await rejectConnectorAction(row.taskId)
    await loadApprovals()
    // The task list on the other screens changed state too.
    await workbench.refreshTasks()
  } catch (e) {
    queueError.value = errorMessage(e.code) || e.message
  } finally {
    busy.value = ''
  }
}

/** The arguments a human is agreeing to, on one line. */
function argsSummary(args) {
  if (!args || Object.keys(args).length === 0) return ''
  try {
    return JSON.stringify(args)
  } catch (e) {
    console.error('agentbuddy: cannot render the parked arguments', e)
    return ''
  }
}

// `/api/connectors/{id}/actions` answers what a connector will accept and how the
// policy gates it. It shipped with a wrapper and no screen, so the only way to see
// it was curl — which is a poor place for the answer to "what can this thing do to
// my data".
const open = ref('')
const loading = ref('')
const actions = reactive({})
const failures = reactive({})

async function toggle(id) {
  if (open.value === id) {
    open.value = ''
    return
  }
  open.value = id
  failures[id] = ''
  // One fetch per connector per visit: the declared action list is static until
  // the resource is re-registered, and re-reading it on every expand is noise.
  if (actions[id] || loading.value === id) return
  loading.value = id
  try {
    actions[id] = await getConnectorActions(id)
  } catch (e) {
    failures[id] = errorMessage(e.code) || e.message
  } finally {
    loading.value = ''
  }
}

onMounted(() => {
  workbench.refreshConnectors()
  loadApprovals()
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

    <div v-if="workbench.connectors.length === 0" class="empty">
      <p>{{ t('listEmpty') }}</p>
      <p class="muted" style="font-size:12px">{{ t('listEmptyNote') }}</p>
    </div>

    <div class="grid grid-2" v-else>
      <ConnectorCard v-for="c in workbench.connectors" :key="c.id" :connector="c" />
    </div>

    <!-- Declared actions per connector: the capability list, not a call history.
         A call is still gated by the connector policy (off / allowed / ask). -->
    <section v-if="workbench.connectors.length" class="card stack">
      <div>
        <h2 class="card-title">{{ to('connectorActions') }}</h2>
        <p class="muted" style="font-size:12px">{{ to('connectorActionsHint') }}</p>
      </div>
      <div v-for="c in workbench.connectors" :key="c.id" class="card stack" style="gap:6px">
        <div class="row" style="justify-content:space-between;gap:8px">
          <span class="truncate">{{ c.name || c.id }}</span>
          <button class="btn btn-ghost btn-sm" @click="toggle(c.id)">{{ to('connectorActions') }}</button>
        </div>
        <template v-if="open === c.id">
          <div v-if="loading === c.id" class="muted" style="font-size:12px">…</div>
          <p v-else-if="failures[c.id]" class="muted" style="font-size:12px">{{ failures[c.id] }}</p>
          <template v-else-if="actions[c.id]">
            <div class="row row-wrap" style="gap:8px">
              <span class="chip">{{ actions[c.id].id || c.id }}</span>
              <span v-if="actions[c.id].policy" class="chip chip-on">{{ actions[c.id].policy }}</span>
            </div>
            <ul v-if="actions[c.id].actions && actions[c.id].actions.length" class="trigger-list">
              <li v-for="a in actions[c.id].actions" :key="a.name" class="trigger-row">
                <code class="mono">{{ a.name }}</code>
                <span class="muted truncate" style="flex:1;min-width:0">{{ a.description }}</span>
              </li>
            </ul>
            <p v-else class="muted" style="font-size:12px">{{ to('connectorActionsHint') }}</p>
          </template>
        </template>
      </div>
    </section>

    <!-- The queue: one row per parked action, with the arguments and the two
         decisions. Approving resumes the task (the connector runs once);
         rejecting cancels it and nothing runs. -->
    <section class="card stack">
      <div class="row" style="justify-content:space-between;gap:8px">
        <div>
          <h2 class="card-title">
            {{ t('approvalsTitle') }}
            <span class="chip mono">{{ queue.length }}</span>
          </h2>
          <p class="muted" style="font-size:12px">{{ t('approvalNote') }}</p>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="queueLoading" @click="loadApprovals">
          <RefreshCw :size="14" />
          {{ th('sbRefresh') }}
        </button>
      </div>

      <div v-if="queueError" class="banner banner-error">
        <span>{{ queueError }}</span>
        <button class="btn btn-ghost btn-sm" @click="loadApprovals">{{ th('sbRetry') }}</button>
      </div>

      <p v-if="!queueLoading && queue.length === 0" class="muted" style="font-size:12px">
        {{ t('approvalsEmpty') }}
      </p>

      <ul v-else class="trigger-list">
        <li v-for="row in queue" :key="row.taskId" class="trigger-row">
          <span class="state-dot" data-state="input-required" />
          <span class="truncate">{{ row.connectorName || row.connectorId || '—' }}</span>
          <code class="mono">{{ row.action }}</code>
          <span
            v-if="argsSummary(row.args)"
            class="muted mono truncate"
            style="flex:1;min-width:0;font-size:11px"
            :title="argsSummary(row.args)"
          >{{ argsSummary(row.args) }}</span>
          <span v-else class="spacer" />
          <span v-if="row.createdAt" class="muted mono" style="font-size:11px">{{ row.createdAt }}</span>
          <button class="btn btn-primary btn-sm" :disabled="busy === row.taskId" @click="decide(row, true)">
            <Check :size="14" />
            {{ t('approvalApprove') }}
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="busy === row.taskId" @click="decide(row, false)">
            <X :size="14" />
            {{ t('approvalReject') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
