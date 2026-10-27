<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { enumLabel } from '../lib/use-copy.js'
import { createChannel, updateChannel, deleteChannel, retryDelivery } from '../lib/api.js'
import ChannelCard from '../components/ChannelCard.vue'
import { Plus, X } from 'lucide-vue-next'

const { t } = useCopy('channel')
const workbench = useWorkbenchStore()
const showForm = ref(false)
const errorCode = ref(null)
const saving = ref(false)

const form = ref({
  name: '', kind: 'slack', threadId: '', signingKeyEnv: '', destination: '', participants: '',
})

const types = ['slack', 'teams', 'telegram', 'sms']

async function save() {
  saving.value = true
  errorCode.value = null
  try {
    const payload = {
      name: form.value.name,
      kind: form.value.kind,
      threadId: form.value.threadId || undefined,
      signingKeyEnv: form.value.signingKeyEnv || undefined,
      destination: form.value.destination || undefined,
      participants: form.value.participants ? form.value.participants.split(',').map((s) => s.trim()) : [],
    }
    await createChannel(payload)
    await workbench.refreshChannels()
    showForm.value = false
    form.value = { name: '', kind: 'slack', threadId: '', signingKeyEnv: '', destination: '', participants: '' }
  } catch (e) {
    errorCode.value = e.code
  } finally {
    saving.value = false
  }
}

async function remove(id) {
  await deleteChannel(id)
  await workbench.refreshChannels()
}

async function retry(channelId, deliveryId) {
  await retryDelivery(channelId, deliveryId)
  await workbench.refreshChannels()
}

onMounted(() => workbench.refreshChannels())
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
      <button class="btn btn-primary" @click="showForm = true"><Plus :size="16" /> {{ t('newChannel') }}</button>
    </div>

    <div class="banner muted">
      <span>{{ t('securityNote') }}</span>
    </div>

    <div v-if="workbench.channels.length === 0" class="empty">
      <p>{{ t('listEmpty') }}</p>
      <p class="muted" style="font-size:12px">{{ t('listEmptyNote') }}</p>
    </div>

    <div class="grid grid-2" v-else>
      <div v-for="c in workbench.channels" :key="c.id" class="card-wrap">
        <div class="row" style="justify-content:flex-end">
          <button class="btn-icon btn-sm" :aria-label="'delete'" @click="remove(c.id)"><X :size="15" /></button>
        </div>
        <ChannelCard :channel="c" :deliveries="workbench.deliveries[c.id] || []" />
      </div>
    </div>

    <div v-if="showForm" class="modal" @click.self="showForm = false">
      <div class="modal-card card">
        <div class="card-head">
          <strong>{{ t('newChannel') }}</strong>
          <button class="btn-icon btn-sm" @click="showForm = false"><X :size="16" /></button>
        </div>
        <div class="stack">
          <div class="field">
            <label>{{ t('fieldName') }}</label>
            <input v-model="form.name" />
          </div>
          <div class="field">
            <label>{{ t('fieldType') }}</label>
            <select v-model="form.kind">
              <option v-for="ty in types" :key="ty" :value="ty">{{ enumLabel('channelType', ty) }}</option>
            </select>
          </div>
          <div class="field">
            <label>{{ t('fieldThread') }}</label>
            <input v-model="form.threadId" :placeholder="'thread id'" />
          </div>
          <div class="field">
            <label>{{ t('fieldSigningKeyEnv') }}</label>
            <input v-model="form.signingKeyEnv" />
            <p class="muted" style="font-size:11px">{{ t('fieldSigningKeyEnvNote') }}</p>
          </div>
          <div v-if="form.kind === 'sms'" class="field">
            <label>{{ t('fieldDestination') }}</label>
            <input v-model="form.destination" />
            <p class="muted" style="font-size:11px">{{ t('fieldDestinationNote') }}</p>
          </div>
          <div class="field">
            <label>{{ t('fieldParticipants') }}</label>
            <input v-model="form.participants" :placeholder="'agent-a, agent-b'" />
          </div>
          <div v-if="errorCode" class="banner"><span>{{ errorCode }}</span></div>
          <div class="row" style="justify-content:flex-end">
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">{{ t('newChannel') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
