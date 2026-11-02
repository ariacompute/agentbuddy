<script setup>
import { computed, onMounted, ref } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import { listKnowledge } from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'

// `/api/knowledge` shipped with the RAG slice and had a wrapper no screen ever
// called, so the chunks an agent can quote were only visible through curl. The
// screen is deliberately read-only: retrieval belongs to the task, and this is
// the operator's view of what is in there.
const { t } = useCopy('hub')
const { t: to } = useCopy('ops')

const chunks = ref([])
const agent = ref('')
const loading = ref(true)
const error = ref('')
// A server built without the RAG slice answers 503 feature_unavailable; that is
// a switch, not a fault, and the screen says so instead of showing "no chunks".
const featureOff = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listKnowledge(agent.value.trim())
    chunks.value = Array.isArray(data) ? data : data?.chunks || []
    featureOff.value = false
  } catch (e) {
    if (e.code === 'feature_unavailable') {
      featureOff.value = true
      chunks.value = []
    } else {
      error.value = errorMessage(e.code) || e.message
    }
  } finally {
    loading.value = false
  }
}

const total = computed(() => chunks.value.length)

onMounted(load)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('knowledgeTitle') }}</h1>
        <p class="sub">{{ to('knowledgeSub') }}</p>
      </div>
      <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load">{{ t('sbRefresh') }}</button>
    </div>

    <section class="card stack">
      <label class="field">
        <span>{{ to('knowledgeAgent') }}</span>
        <input v-model="agent" type="text" placeholder="agent-…" @keyup.enter="load" />
      </label>
      <div class="row" style="gap:8px">
        <span class="chip">{{ total }}</span>
        <button class="btn btn-sm" :disabled="loading" @click="load">{{ t('sbRefresh') }}</button>
      </div>
    </section>

    <div v-if="error" class="banner banner-error">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-sm" @click="load">{{ t('sbRetry') }}</button>
    </div>

    <section v-else-if="featureOff" class="card stack">
      <h2 class="card-title">{{ t('knowledgeTitle') }}</h2>
      <p class="muted" style="font-size:12px">{{ t('featureOff') }}</p>
    </section>

    <div v-else-if="loading" class="empty"><p class="muted">…</p></div>
    <div v-else-if="chunks.length === 0" class="empty"><p>{{ t('knowledgeEmpty') }}</p></div>

    <section v-else class="stack">
      <article v-for="chunk in chunks" :key="chunk.id" class="card stack" style="gap:6px">
        <div class="row" style="justify-content:space-between;gap:8px">
          <code class="mono muted" style="font-size:11px">{{ chunk.agentId || '—' }}</code>
          <span v-if="chunk.createdAt" class="muted" style="font-size:11px">{{ chunk.createdAt }}</span>
        </div>
        <p style="white-space:pre-wrap">{{ chunk.chunkText }}</p>
        <p v-if="chunk.sourceRef" class="muted" style="font-size:12px">
          {{ to('knowledgeSource') }}: <code class="mono">{{ chunk.sourceRef }}</code>
        </p>
      </article>
    </section>
  </div>
</template>
