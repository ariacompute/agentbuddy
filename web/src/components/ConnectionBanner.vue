<script setup>
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { AlertTriangle } from 'lucide-vue-next'

const { t } = useCopy('workspace')
const workbench = useWorkbenchStore()
</script>

<template>
  <div v-if="workbench.offline" class="content-banner">
    <div class="banner">
      <AlertTriangle :size="16" />
      <span>{{ t('connectionOffline') }}</span>
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
</style>
