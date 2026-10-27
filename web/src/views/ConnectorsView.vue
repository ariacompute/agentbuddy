<script setup>
import { onMounted } from 'vue'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import ConnectorCard from '../components/ConnectorCard.vue'

const { t } = useCopy('connector')
const workbench = useWorkbenchStore()

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
