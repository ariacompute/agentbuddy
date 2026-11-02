<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../lib/auth-store.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { LogOut } from 'lucide-vue-next'
import LanguageSwitcher from './LanguageSwitcher.vue'
import ThemeToggle from './ThemeToggle.vue'
import NotificationCenter from './NotificationCenter.vue'

const { t } = useCopy('shell')
// The execution and scheduling screens carry their labels in the hub table and
// the two round-4 screens in the ops table; the topbar title has to read from the
// same place the sidebar does, or it falls back to "Workspace" on those routes.
const { t: th } = useCopy('hub')
const { t: to } = useCopy('ops')
const auth = useAuthStore()
const workbench = useWorkbenchStore()
const route = useRoute()
const router = useRouter()

async function signOut() {
  await auth.logout()
  router.push('/login')
}

const title = computed(() => {
  const name = route.name || ''
  const map = {
    workbench: t('navWorkspace'),
    threads: t('navThreads'),
    thread: t('navThreads'),
    tasks: t('navTasks'),
    task: t('navTasks'),
    org: t('navOrg'),
    channels: t('navChannels'),
    connectors: t('navConnectors'),
    computers: th('navComputers'),
    schedules: th('navSchedules'),
    persona: to('navPersona'),
    knowledge: to('navKnowledge'),
    settings: t('navSettings'),
  }
  return map[name] || t('navWorkspace')
})
</script>

<template>
  <header class="topbar">
    <div class="title">{{ title }}</div>
    <span class="chip" :title="workbench.offline ? t('offline') : t('online')">
      <span class="state-dot" :data-state="workbench.offline ? 'failed' : 'completed'" />
      {{ workbench.offline ? t('offline') : t('online') }}
    </span>
    <span class="spacer" />
    <LanguageSwitcher />
    <NotificationCenter />
    <ThemeToggle />
    <button class="btn-icon" :aria-label="t('accountSignOut')" @click="signOut">
      <LogOut :size="17" />
    </button>
  </header>
</template>
