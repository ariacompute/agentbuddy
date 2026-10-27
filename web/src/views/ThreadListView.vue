<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { createThread as apiCreateThread } from '../lib/api.js'
import { Plus, MessageSquare } from 'lucide-vue-next'

const { t } = useCopy('thread')
const workbench = useWorkbenchStore()
const router = useRouter()

onMounted(() => workbench.refreshThreads())

async function createThread() {
  const title = window.prompt(t('titlePlaceholder')) || 'New thread'
  const res = await apiCreateThread(title)
  if (res?.thread?.id) router.push(`/threads/${res.thread.id}`)
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
      <button class="btn btn-primary" @click="createThread"><Plus :size="16" /> {{ t('newThread') }}</button>
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
  </div>
</template>
