<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { getConnectorActions } from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'
import ConnectorCard from '../components/ConnectorCard.vue'

const { t } = useCopy('connector')
const { t: to } = useCopy('ops')
const workbench = useWorkbenchStore()

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

onMounted(() => workbench.refreshConnectors())
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

    <div v-if="workbench.approvals.length" class="stack">
      <h2 class="card-title">{{ t('approvalsTitle') }}</h2>
      <div v-for="task in workbench.approvals" :key="task.id" class="card row">
        <span class="state-dot" data-state="input-required" />
        <span class="truncate">{{ task.id }}</span>
        <span class="spacer" />
        <span class="muted" style="font-size:12px">{{ t('approvalNote') }}</span>
      </div>
    </div>
  </div>
</template>
