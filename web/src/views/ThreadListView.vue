<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import { createThread as apiCreateThread } from '../lib/api.js'
import { Plus, MessageSquare, Trash2 } from 'lucide-vue-next'
import BaseDialog from '../components/BaseDialog.vue'

const { t } = useCopy('thread')
const { t: ts } = useCopy('shell')
const workbench = useWorkbenchStore()
const router = useRouter()

const showDialog = ref(false)
const draftTitle = ref('')
const saving = ref(false)

// Selection lives behind the select-all control: the per-card checkbox is only
// rendered once that control turns selection mode on, so a plain list stays
// free of boxes. Checking select-all selects everything; unchecking a single
// card narrows the batch while mode stays on (the master box turns
// indeterminate); unchecking select-all leaves the mode and clears the batch.
// `selected` is the raw v-model value; `selectedIds` re-intersects it with the
// list the server most recently returned, so an id deleted on another machine
// can never be counted or sent again.
const selectMode = ref(false)
const selected = ref([])
const pending = ref([])
const showConfirm = ref(false)
const deleting = ref(false)
const error = ref('')

const visibleIds = computed(() => workbench.threads.map((thread) => thread.ID))
const selectedIds = computed(() => selected.value.filter((id) => visibleIds.value.includes(id)))
const allSelected = computed(() =>
  visibleIds.value.length > 0 && selectedIds.value.length === visibleIds.value.length,
)
const confirmMessage = computed(() => (
  pending.value.length === 1
    ? t('deleteConfirm')
    : t('deleteSelectedConfirm').replace('{count}', String(pending.value.length))
))

onMounted(() => workbench.refreshThreads())

function openDialog() {
  draftTitle.value = ''
  showDialog.value = true
}

async function submit() {
  // Enter and a double click on Create must not create two threads.
  if (saving.value) return
  const title = draftTitle.value.trim() || t('newThread')
  saving.value = true
  try {
    const res = await apiCreateThread(title)
    // POST /api/threads answers the thread object itself, with Go's field names
    // (ID / Title). Older builds wrapped it in { thread }, so read every shape
    // rather than keying the close on one guess that may not match.
    const id = res?.ID || res?.id || res?.thread?.ID || res?.thread?.id
    // The thread exists now, so the dialog has done its job whatever the body
    // looked like: close first, then go there (or reload the list).
    showDialog.value = false
    if (id) router.push(`/threads/${id}`)
    else await workbench.refreshThreads()
  } finally {
    saving.value = false
  }
}

function openThread(id) {
  router.push(`/threads/${id}`)
}

function toggleAll(checked) {
  selectMode.value = checked
  selected.value = checked ? [...visibleIds.value] : []
}

function clearSelection() {
  selected.value = []
  selectMode.value = false
}

function askDelete(ids) {
  pending.value = [...ids]
  showConfirm.value = true
  error.value = ''
}

function cancelDelete() {
  pending.value = []
  showConfirm.value = false
}

async function confirmDelete() {
  // A second click (or Enter while the dialog is closing) must not send the
  // batch twice.
  if (deleting.value) return
  const ids = [...pending.value]
  deleting.value = true
  try {
    const code = await workbench.deleteThreads(ids)
    // The refreshed list is the truth: drop ids that are no longer there, but
    // keep the ones a refused delete left behind so they can be retried.
    selected.value = selected.value.filter((id) => visibleIds.value.includes(id))
    // Nothing left checked: leave selection mode so the empty boxes go away.
    if (!selected.value.length) selectMode.value = false
    if (code) {
      error.value = errorMessage(code)
      return
    }
    cancelDelete()
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
      <div class="row" style="gap: 8px">
        <button
          v-if="selectedIds.length"
          class="btn btn-danger"
          @click="askDelete(selectedIds)"
        >
          <Trash2 :size="16" />
          {{ t('deleteSelected') }} ({{ selectedIds.length }})
        </button>
        <button class="btn btn-primary" @click="openDialog"><Plus :size="16" /> {{ t('newThread') }}</button>
      </div>
    </div>

    <div v-if="error" class="banner banner-error"><span>{{ error }}</span></div>

    <div v-if="workbench.threads.length === 0" class="empty">
      <MessageSquare :size="28" />
      <p>{{ t('listEmpty') }}</p>
      <p class="muted" style="font-size:12px">{{ t('listEmptyNote') }}</p>
    </div>

    <template v-else>
      <div class="row thread-toolbar">
        <label class="thread-checkall">
          <input
            type="checkbox"
            :checked="selectMode"
            :indeterminate="selectMode && !allSelected"
            :aria-label="t('selectAll')"
            @change="toggleAll($event.target.checked)"
          />
          <span>{{ t('selectAll') }}</span>
        </label>
        <span class="muted">{{ t('selectedCount').replace('{count}', String(selectedIds.length)) }}</span>
        <button v-if="selectedIds.length" class="btn btn-ghost btn-sm" @click="clearSelection">
          {{ t('clearSelection') }}
        </button>
      </div>

      <div class="grid grid-2">
        <div
          v-for="thread in workbench.threads"
          :key="thread.ID"
          class="card card-hover thread-card"
          :class="{ 'is-selected': selectedIds.includes(thread.ID) }"
          style="cursor:pointer"
          @click="openThread(thread.ID)"
        >
          <div class="card-head">
            <label v-if="selectMode" class="thread-check-label" @click.stop>
              <input
                v-model="selected"
                class="thread-check"
                type="checkbox"
                :value="thread.ID"
                :aria-label="t('selectThread')"
              />
            </label>
            <MessageSquare :size="18" />
            <strong class="truncate">{{ thread.Title || thread.ID }}</strong>
            <button
              class="btn btn-icon btn-sm thread-delete"
              :aria-label="ts('actionDelete')"
              @click.stop="askDelete([thread.ID])"
            >
              <Trash2 :size="14" />
            </button>
          </div>
          <div class="row muted" style="font-size:12px;gap:6px">
            <span>{{ thread.Participants?.length || 0 }} {{ t('participants') }}</span>
          </div>
        </div>
      </div>
    </template>

    <BaseDialog
      v-model="showDialog"
      :title="t('newThread')"
      :close-label="ts('actionClose')"
    >
      <div class="field">
        <label for="new-thread-title">{{ t('titlePlaceholder') }}</label>
        <input
          id="new-thread-title"
          v-model="draftTitle"
          type="text"
          :placeholder="t('titlePlaceholder')"
          :disabled="saving"
          @keydown.enter="submit"
        />
      </div>
      <template #footer>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="saving"
          @click="showDialog = false"
        >{{ ts('actionCancel') }}</button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="submit"
        >{{ ts('actionCreate') }}</button>
      </template>
    </BaseDialog>

    <BaseDialog
      v-model="showConfirm"
      :title="t('deleteTitle')"
      :close-label="ts('actionClose')"
    >
      <p>{{ confirmMessage }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="deleting" @click="cancelDelete">
          {{ ts('actionCancel') }}
        </button>
        <button class="btn btn-danger btn-sm" :disabled="deleting" @click="confirmDelete">
          {{ ts('actionDelete') }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>
