<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import TaskCard from '../components/TaskCard.vue'
import BaseDialog from '../components/BaseDialog.vue'
import { Trash2 } from 'lucide-vue-next'

const { t } = useCopy('task')
const { t: ts } = useCopy('shell')
const workbench = useWorkbenchStore()
const filter = ref('all')
const showConfirm = ref(false)
const clearing = ref(false)
// A localized reason the clear did not happen, shown inside the confirmation so
// the dialog stays open on the operator's answer.
const error = ref('')
// What the server kept because those runs are still live: the list is empty of
// history, not of work, and the screen has to say which is which.
const notice = ref('')

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

function askClear() {
  error.value = ''
  notice.value = ''
  showConfirm.value = true
}

function cancelClear() {
  error.value = ''
  showConfirm.value = false
}

// The dialog closes only after the server answered, so a refusal is read in the
// place that asked the question; `clearing` keeps a double click to one request.
async function confirmClear() {
  if (clearing.value) return
  clearing.value = true
  error.value = ''
  notice.value = ''
  const result = await workbench.clearTasks()
  clearing.value = false
  if (result.code) {
    error.value = errorMessage(result.code)
    return
  }
  if (result.kept > 0) notice.value = t('clearAllKept').replace('{count}', String(result.kept))
  filter.value = 'all'
  showConfirm.value = false
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
      <div v-if="workbench.tasks.length" class="row">
        <button class="btn btn-ghost btn-sm task-clear" @click="askClear">
          <Trash2 :size="15" aria-hidden="true" /> {{ t('clearAll') }}
        </button>
      </div>
    </div>

    <p v-if="notice" class="banner">{{ notice }}</p>

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

    <BaseDialog
      v-model="showConfirm"
      :title="t('clearAllTitle')"
      :close-label="ts('actionClose')"
    >
      <p>{{ t('clearAllBody') }}</p>
      <p v-if="error" class="banner banner-error" data-test="clear-error">{{ error }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="clearing" @click="cancelClear">
          {{ ts('actionCancel') }}
        </button>
        <button class="btn btn-danger btn-sm" :disabled="clearing" @click="confirmClear">
          {{ t('clearAll') }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>
