<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { createThread as apiCreateThread } from '../lib/api.js'
import { Plus, MessageSquare } from 'lucide-vue-next'
import BaseDialog from '../components/BaseDialog.vue'

const { t } = useCopy('thread')
const { t: ts } = useCopy('shell')
const workbench = useWorkbenchStore()
const router = useRouter()

const showDialog = ref(false)
const draftTitle = ref('')
const saving = ref(false)

onMounted(() => workbench.refreshThreads())

function openDialog() {
  draftTitle.value = ''
  showDialog.value = true
}

async function submit() {
  const title = draftTitle.value.trim() || t('newThread')
  saving.value = true
  try {
    const res = await apiCreateThread(title)
    if (res?.thread?.id) {
      showDialog.value = false
      router.push(`/threads/${res.thread.id}`)
    }
  } finally {
    saving.value = false
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
      <button class="btn btn-primary" @click="openDialog"><Plus :size="16" /> {{ t('newThread') }}</button>
    </div>

    <div v-if="workbench.threads.length === 0" class="empty">
      <MessageSquare :size="28" />
      <p>{{ t('listEmpty') }}</p>
      <p class="muted" style="font-size:12px">{{ t('listEmptyNote') }}</p>
    </div>

    <div v-else class="grid grid-2">
      <div
        v-for="thread in workbench.threads"
        :key="thread.ID"
        class="card card-hover"
        style="cursor:pointer"
        @click="router.push(`/threads/${thread.ID}`)"
      >
        <div class="card-head">
          <MessageSquare :size="18" />
          <strong class="truncate">{{ thread.Title || thread.ID }}</strong>
        </div>
        <div class="row muted" style="font-size:12px;gap:6px">
          <span>{{ thread.Participants?.length || 0 }} {{ t('participants') }}</span>
        </div>
      </div>
    </div>

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
  </div>
</template>
