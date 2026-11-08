<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getTask, cancelTask, resumeTask, subscribeTaskEvents } from '../lib/api.js'
import { useCopy } from '../lib/use-copy.js'
import { formatDuration } from '../lib/format.js'
import StateDot from '../components/StateDot.vue'
import ArtifactList from '../components/ArtifactList.vue'
import { Ban, Send } from 'lucide-vue-next'

const props = defineProps({ id: { type: String, required: true } })
const { t } = useCopy('task')

const task = ref(null)
const loading = ref(true)
const errorCode = ref(null)
const answer = ref('')
const acting = ref(false)
let sub = null

const STEPS = ['submitted', 'working', 'completed']
const ORDER = { submitted: 0, working: 1, 'input-required': 1, completed: 2, failed: 2, canceled: 2 }
const state = computed(() => task.value?.status?.state)
const isWaiting = computed(() => state.value === 'input-required')
const isActive = computed(() => ['submitted', 'working'].includes(state.value))
const spans = computed(() => task.value?.spans || [])

function reached(step) {
  const cur = ORDER[state.value]
  return cur !== undefined && ORDER[step] !== undefined && cur >= ORDER[step]
}

async function load() {
  loading.value = true
  try {
    task.value = await getTask(props.id)
    subscribe()
  } catch (e) {
    errorCode.value = e.code
  } finally {
    loading.value = false
  }
}

function subscribe() {
  if (sub) sub.close()
  sub = subscribeTaskEvents(props.id, task.value?.lastSeq, {
    status: (data) => { if (data?.status) task.value = { ...task.value, ...data, status: data.status } },
    artifact: (data) => { if (data?.artifacts) task.value = { ...task.value, artifacts: data.artifacts } },
  })
}

async function cancel() {
  acting.value = true
  try { await cancelTask(props.id); await load() } finally { acting.value = false }
}

async function resume() {
  acting.value = true
  try { await resumeTask(props.id, answer.value); answer.value = ''; await load() } finally { acting.value = false }
}

onMounted(load)
onUnmounted(() => sub && sub.close())
</script>

<template>
  <div class="stack" v-if="task">
    <div class="page-head">
      <div>
        <div class="row" style="gap:10px">
          <h1>{{ task.resourceId || task.id }}</h1>
          <StateDot :state="state" />
        </div>
        <p class="sub mono">{{ task.id }}</p>
      </div>
      <div class="row">
        <button v-if="isActive || isWaiting" class="btn btn-sm btn-danger" :disabled="acting" @click="cancel">
          <Ban :size="15" /> {{ t('cancel') }}
        </button>
      </div>
    </div>

    <div class="timeline">
      <template v-for="(step, i) in STEPS" :key="step">
        <span class="sep" v-if="i > 0" />
        <span class="step" :data-on="reached(step)">{{ step }}</span>
      </template>
      <span class="sep" />
      <span class="step" :data-on="isWaiting">input-required</span>
    </div>

    <section class="stack" v-if="isWaiting">
      <h2 class="card-title">{{ t('approvalTitle') }}</h2>
      <p class="muted" style="font-size:13px">{{ t('approvalBody') }}</p>
      <div class="card stack">
        <textarea v-model="answer" :placeholder="t('resumePlaceholder')" />
        <div class="row" style="justify-content:flex-end">
          <button class="btn btn-primary btn-sm" :disabled="acting" @click="resume">
            <Send :size="15" /> {{ t('resumeSubmit') }}
          </button>
        </div>
      </div>
    </section>

    <section class="stack">
      <h2 class="card-title">{{ t('spans') }}</h2>
      <div v-if="spans.length === 0" class="muted" style="font-size:12px">{{ t('spansEmpty') }}</div>
      <div v-else class="spans">
        <div v-for="(span, i) in spans" :key="i" class="span-row">
          <span class="state-dot" :data-state="span.status === 'ok' ? 'completed' : 'failed'" />
          <span class="name truncate">{{ span.name }}</span>
          <span class="spacer" />
          <span class="dur">{{ formatDuration(span.durationMs) }}</span>
        </div>
      </div>
    </section>

    <section class="stack">
      <h2 class="card-title">{{ t('artifacts') }}</h2>
      <ArtifactList :artifacts="task.artifacts || []" />
    </section>
  </div>
  <div v-else-if="errorCode" class="empty">
    <p>{{ t('notFound') }}</p>
  </div>
</template>
