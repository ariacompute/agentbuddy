<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getThread, postThreadMessage, subscribeThreadEvents } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { formatTime } from '../lib/format.js'
import PersonaAvatar from '../components/PersonaAvatar.vue'
import VoiceRecorder from '../components/VoiceRecorder.vue'
import TaskCard from '../components/TaskCard.vue'
import { Send, AtSign } from 'lucide-vue-next'

const props = defineProps({ id: { type: String, required: true } })
const { t } = useCopy('thread')
const workbench = useWorkbenchStore()

const thread = ref(null)
const messages = ref([])
const draft = ref('')
const sending = ref(false)
let sub = null

const relatedTasks = computed(() => workbench.tasks.filter((task) => task.contextId === props.id))

function addMentions() {
  draft.value = (draft.value + ' @').trimStart()
}

async function send() {
  const body = draft.value.trim()
  if (!body) return
  sending.value = true
  try {
    const res = await postThreadMessage(props.id, body)
    if (res?.delegated) await workbench.refreshTasks()
    draft.value = ''
  } finally {
    sending.value = false
  }
}

async function load() {
  const data = await getThread(props.id)
  thread.value = data.thread
  messages.value = data.messages || []
  subscribe()
}

function subscribe() {
  if (sub) sub.close()
  sub = subscribeThreadEvents(props.id, {
    message: (msg) => { if (!messages.value.find((m) => m.ID === msg.ID)) messages.value.push(msg) },
    agent: (msg) => { if (!messages.value.find((m) => m.ID === msg.ID)) messages.value.push(msg) },
  })
}

onMounted(() => { load(); workbench.refreshTasks() })
onUnmounted(() => sub && sub.close())
</script>

<template>
  <div class="thread" v-if="thread">
    <div class="thread-main">
      <div class="messages">
        <div v-if="messages.length === 0" class="empty">{{ t('listEmpty') }}</div>
        <div
          v-for="msg in messages"
          :key="msg.ID"
          class="msg"
          :class="msg.AuthorType === 'user' ? 'from-user' : 'from-agent'"
        >
          <PersonaAvatar :name="msg.AuthorName || msg.AuthorID" :size="32" />
          <div>
            <div class="msg-meta">
              <span>{{ msg.AuthorName || msg.AuthorID }}</span>
              <span>{{ formatTime(msg.CreatedAt) }}</span>
            </div>
            <div class="msg-body pre-wrap">{{ msg.Body }}</div>
          </div>
        </div>
      </div>

      <div class="composer">
        <div class="line">
          <textarea
            v-model="draft"
            :placeholder="t('composerPlaceholder')"
            @keydown.enter.exact.prevent="send"
          />
        </div>
        <div class="composer-foot">
          <button class="voice-btn" :aria-label="t('voiceRecord')" @click="addMentions">
            <AtSign :size="17" />
          </button>
          <VoiceRecorder :thread-id="id" />
          <span class="spacer" />
          <span class="muted" style="font-size:12px">{{ t('mentionHint') }}</span>
          <button class="btn btn-primary" :disabled="!draft.trim() || sending" @click="send">
            <Send :size="15" /> {{ t('send') }}
          </button>
        </div>
      </div>
    </div>

    <div class="thread-side">
      <h3 class="card-title">{{ t('tasksPanel') }}</h3>
      <div v-if="relatedTasks.length === 0" class="muted" style="font-size:12px">{{ t('tasksPanelEmpty') }}</div>
      <TaskCard v-for="task in relatedTasks" :key="task.id" :task="task" dense />
    </div>
  </div>
</template>
