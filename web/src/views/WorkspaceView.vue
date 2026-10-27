<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import AgentCard from '../components/AgentCard.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import StateDot from '../components/StateDot.vue'

const { t } = useCopy('workspace')
const workbench = useWorkbenchStore()
const router = useRouter()

const approvals = computed(() => workbench.approvals)

onMounted(() => workbench.refreshAll())
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
    </div>

    <section v-if="approvals.length" class="stack">
      <h2 class="card-title">{{ t('approvalsTitle') }}</h2>
      <ApprovalCard v-for="task in approvals" :key="task.id" :task="task" />
    </section>

    <section class="stack">
      <div class="card-head">
        <h2 class="card-title">{{ t('agentsTitle') }}</h2>
        <span class="chip">{{ workbench.agents.length }} {{ t('agentsCount') }}</span>
      </div>
      <div v-if="workbench.agents.length === 0" class="empty">
        <p>{{ t('agentsEmpty') }}</p>
        <p class="muted" style="font-size:12px">{{ t('agentsEmptyNote') }}</p>
      </div>
      <div class="grid grid-agents">
        <AgentCard v-for="agent in workbench.agents" :key="agent.id" :agent="agent" />
      </div>
    </section>

    <section class="stack">
      <div class="card-head">
        <h2 class="card-title">{{ t('activityTitle') }}</h2>
        <button class="btn btn-ghost btn-sm" @click="router.push('/threads')">{{ t('newThread') }}</button>
      </div>
      <div v-if="workbench.tasks.length === 0" class="empty">
        <p>{{ t('activityEmpty') }}</p>
      </div>
      <div v-else class="stack">
        <div
          v-for="task in workbench.tasks.slice(0, 8)"
          :key="task.id"
          class="card card-hover row"
          style="align-items:flex-start;gap:10px;cursor:pointer"
          @click="router.push(`/tasks/${task.id}`)"
        >
          <StateDot :state="task.status?.state" :label="false" />
          <div style="min-width:0;flex:1">
            <div class="row" style="gap:8px">
              <strong class="truncate">{{ task.resourceId || task.id }}</strong>
              <span class="chip chip-mono">{{ task.id }}</span>
            </div>
          </div>
          <StateDot :state="task.status?.state" />
        </div>
      </div>
    </section>
  </div>
</template>
