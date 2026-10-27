<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from './lib/auth-store.js'
import { useWorkbenchStore } from './lib/workbench-store.js'
import { ActivityMonitor } from './lib/monitor.js'
import Sidebar from './components/Sidebar.vue'
import Topbar from './components/Topbar.vue'
import ConnectionBanner from './components/ConnectionBanner.vue'

const auth = useAuthStore()
const workbench = useWorkbenchStore()

let monitor = null

onMounted(async () => {
  await auth.refresh()
  if (!auth.signedIn) return
  await workbench.refreshAll()
  monitor = new ActivityMonitor(workbench, {
    visible: () => document.visibilityState === 'visible',
  })
  monitor.start()
})
</script>

<template>
  <div class="app-shell" v-if="auth.signedIn">
    <Sidebar />
    <div class="app-main">
      <Topbar />
      <ConnectionBanner />
      <main class="app-content">
        <router-view />
      </main>
    </div>
  </div>
  <router-view v-else />
</template>
