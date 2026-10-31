<script setup>
import { onMounted, watch } from 'vue'
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

// A poll/refresh that fails with an auth error means the session expired, not that
// the server is down. Re-check the principal: if it really is gone, drop to login
// so the user can re-authenticate instead of staring at a misleading "offline" banner.
watch(() => workbench.authExpired, async (expired) => {
  if (!expired) return
  const wasSignedIn = auth.signedIn
  await auth.refresh()
  if (wasSignedIn && !auth.signedIn) await auth.logout()
  workbench.authExpired = false
})
</script>

<template>
  <div class="shell" v-if="auth.signedIn">
    <Sidebar />
    <div class="main">
      <Topbar />
      <ConnectionBanner />
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
  <router-view v-else />
</template>
