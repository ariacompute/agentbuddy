<script setup>
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useAuthStore } from '../lib/auth-store.js'
import { useCopy } from '../lib/use-copy.js'
import { AlertTriangle, LogIn } from 'lucide-vue-next'

const { t } = useCopy('workspace')
const workbench = useWorkbenchStore()
const auth = useAuthStore()

function relogin() {
  auth.logout()
}
</script>

<template>
  <div v-if="workbench.authExpired || workbench.offline" class="content-banner">
    <div class="banner">
      <AlertTriangle :size="16" />
      <span v-if="workbench.authExpired">{{ t('connectionAuthExpired') }}</span>
      <span v-else>{{ t('connectionOffline') }}</span>
      <button v-if="workbench.authExpired" class="banner-action" type="button" @click="relogin">
        <LogIn :size="14" />
        <span>{{ t('connectionRelogin') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.content-banner {
  padding: 12px 28px 0;
}
@media (max-width: 1439px) {
  .content-banner {
    padding: 12px 20px 0;
  }
}
.banner-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-inline-start: 8px;
  padding: 4px 10px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.banner-action:hover {
  opacity: 0.8;
}
</style>
