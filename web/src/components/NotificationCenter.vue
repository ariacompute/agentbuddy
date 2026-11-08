<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { Bell, Check, X } from 'lucide-vue-next'

const { t } = useCopy('workspace')
const workbench = useWorkbenchStore()
const router = useRouter()
const open = ref(false)

const titleKey = (kind) => `notify${kind.charAt(0).toUpperCase()}${kind.slice(1)}`

function openNote(note) {
  open.value = false
  if (note.link) router.push(note.link)
}

function clearAll() {
  workbench.clearNotifications()
  open.value = false
}
</script>

<template>
  <div class="notif-bell">
    <button class="btn-icon" :aria-label="t('notifiesTitle')" @click="open = !open">
      <Bell :size="18" />
    </button>
    <span v-if="workbench.unreadCount > 0" class="notif-dot" />
    <div v-if="open" class="notif-center">
      <div class="row" style="padding:4px 6px 8px">
        <strong>{{ t('notifiesTitle') }}</strong>
        <span class="spacer" />
        <button class="btn-ghost btn-sm" @click="clearAll">{{ t('notifiesClear') }}</button>
        <button class="btn-icon btn-sm" @click="open = false" aria-label="close"><X :size="15" /></button>
      </div>
      <div v-if="workbench.notifications.length === 0" class="muted" style="padding:12px 8px">
        {{ t('notifiesEmpty') }}
      </div>
      <template v-else>
        <button
          v-for="(note, i) in workbench.notifications"
          :key="note.key + i"
          class="notif-item"
          @click="openNote(note)"
        >
          <div class="t">{{ t(titleKey(note.kind)) }}</div>
          <div class="b truncate">{{ note.body }}</div>
        </button>
      </template>
    </div>
    <span class="visually-hidden" v-if="false"><Check /></span>
  </div>
</template>

<style scoped>
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
