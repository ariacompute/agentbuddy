<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import TaskCard from '../components/TaskCard.vue'

const { t } = useCopy('task')
const workbench = useWorkbenchStore()
const filter = ref('all')

const filters = [
  { key: 'all', label: t('filterAll') },
  { key: 'active', label: t('filterActive') },
  { key: 'waiting', label: t('filterWaiting') },
  { key: 'done', label: t('filterDone') },
]

const shown = computed(() => {
  const list = workbench.tasks
  if (filter.value === 'active') return list.filter((x) => ['submitted', 'working'].includes(x.status?.state))
  if (filter.value === 'waiting') return list.filter((x) => x.status?.state === 'input-required')
  if (filter.value === 'done') return list.filter((x) => ['completed', 'failed', 'canceled'].includes(x.status?.state))
  return list
})

onMounted(() => workbench.refreshTasks())
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
    </div>

    <div class="row row-wrap">
      <button
        v-for="f in filters"
        :key="f.key"
        class="btn btn-sm"
        :class="filter === f.key ? 'btn-primary' : 'btn-ghost'"
        @click="filter = f.key"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="workbench.tasks.length === 0" class="empty">
      <p>{{ t('listEmpty') }}</p>
      <p class="muted" style="font-size:12px">{{ t('listEmptyNote') }}</p>
    </div>
    <div v-else class="grid grid-2">
      <TaskCard v-for="task in shown" :key="task.id" :task="task" />
    </div>
  </div>
</template>
