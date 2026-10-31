<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../lib/auth-store.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { LayoutDashboard, MessagesSquare, ListChecks, Network, Radio, Plug, Settings as Cog } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'

const { t } = useCopy('shell')
const auth = useAuthStore()
const workbench = useWorkbenchStore()
const route = useRoute()
const collapsed = ref(false)

// The desktop shell stamps its own version (`vX.Y.Z@<7-char commit>`) into
// index.html at request time; in a plain web build the global is absent and the
// footer version simply stays hidden. Same source/format as LoginView.
const appVersion = ref('')
onMounted(() => {
  appVersion.value = window.__AGENTBUDDY_VERSION__ || ''
})

const links = computed(() => [
  { to: '/', label: t('navWorkspace'), icon: LayoutDashboard, badge: 0 },
  { to: '/threads', label: t('navThreads'), icon: MessagesSquare, badge: workbench.threads.length },
  { to: '/tasks', label: t('navTasks'), icon: ListChecks, badge: workbench.activeTasks.length },
  { to: '/org', label: t('navOrg'), icon: Network, badge: 0 },
  { to: '/channels', label: t('navChannels'), icon: Radio, badge: workbench.channels.length },
  { to: '/connectors', label: t('navConnectors'), icon: Plug, badge: workbench.connectors.length },
  { to: '/settings', label: t('navSettings'), icon: Cog, badge: 0 },
])
</script>

<template>
  <aside class="sidebar" :data-collapsed="collapsed" :collapsed="collapsed">
    <div class="brand">
      <BrandMark :size="34" />
      <div v-if="!collapsed">
        <div class="name">AgentBuddy</div>
        <div class="tag">{{ t('brandTagline') }}</div>
      </div>
    </div>

    <router-link
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="nav-item"
      :class="{ 'is-active': route.path === link.to || (link.to !== '/' && route.path.startsWith(link.to)) }"
    >
      <component :is="link.icon" :size="18" />
      <span class="label">{{ link.label }}</span>
      <span v-if="link.badge > 0" class="badge">{{ link.badge }}</span>
    </router-link>

    <div class="sidebar-foot" v-if="!collapsed">
      <div>{{ auth.user?.displayName || auth.user?.email }}</div>
      <div>{{ t('ownerBadge') }}: {{ auth.isOwner ? t('online') : t('offline') }}</div>
      <div v-if="appVersion" class="sidebar-version">{{ appVersion }}</div>
    </div>
  </aside>
</template>
