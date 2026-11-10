<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getThread, postThreadMessage, subscribeThreadEvents, dropRouterSubscription } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import { formatTime } from '../lib/format.js'
import BaseDialog from '../components/BaseDialog.vue'
import PersonaAvatar from '../components/PersonaAvatar.vue'
import VoiceRecorder from '../components/VoiceRecorder.vue'
import TaskCard from '../components/TaskCard.vue'
import SuggestionCard from '../components/SuggestionCard.vue'
import { Send, AtSign, ArrowLeft, Trash2 } from 'lucide-vue-next'

const props = defineProps({ id: { type: String, required: true } })
const { t } = useCopy('thread')
const { t: th } = useCopy('hub')
const { t: to } = useCopy('ops')
const { t: ts } = useCopy('shell')
const workbench = useWorkbenchStore()

const thread = ref(null)
const messages = ref([])
const draft = ref('')
const sending = ref(false)
const error = ref('')
const showClearConfirm = ref(false)
const clearing = ref(false)
let sub = null

const relatedTasks = computed(() => workbench.tasks.filter((task) => task.contextId === props.id))

// Mention candidates come from the people and agents that have already spoken
// here. The server has no participant list to ask for, and inventing one from the
// whole registry would offer names that cannot be addressed in this thread.
const mentionCandidates = computed(() => {
  const seen = new Set()
  const out = []
  for (const m of messages.value) {
    const name = m.AuthorName || m.AuthorID
    if (!name || m.AuthorType === 'user' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
})

// The token being typed after the last space, or null when the caret is not in a
// mention. Reading it off the draft keeps the picker in step with typing without
// a second piece of state to keep in sync.
const mentionQuery = computed(() => {
  const match = draft.value.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null
  return match[1].toLowerCase()
})

const mentionMatches = computed(() => {
  const q = mentionQuery.value
  if (q === null) return []
  return mentionCandidates.value.filter((name) => name.toLowerCase().includes(q)).slice(0, 6)
})

// Open while a token is being typed, including the empty thread case: an empty
// picker that says so is better than a key that appears to do nothing.
const mentionOpen = computed(
  () => mentionQuery.value !== null && (mentionMatches.value.length > 0 || mentionCandidates.value.length === 0),
)

/** Replaces the half-typed token with a complete handle. */
function insertMention(name) {
  draft.value = draft.value.replace(/(^|\s)@[^\s@]*$/, (_, lead) => `${lead}@${name} `)
  draft.value = draft.value.replace(/^\s+/, '')
}

/**
 * The @ button seeds the token. Typing after it narrows the picker, which is why
 * it appends rather than opening a modal: the caret has to stay in the textarea.
 * A trailing space is preserved so the token stays separate from the text before
 * it, and a draft that starts with the button never begins with whitespace.
 */
function addMentions() {
  draft.value = (draft.value + ' @').trimStart()
}

/**
 * Unsubscribes this thread from the router: new messages stop opening tickets.
 * A thread that was never subscribed answers not-found, which is the same outcome
 * the caller wanted, so it is not surfaced as an error.
 */
const unsubscribed = ref(false)
async function dropSubscription() {
  error.value = ''
  try {
    await dropRouterSubscription(props.id)
    unsubscribed.value = true
  } catch (e) {
    if (e.code === 'feature_unavailable' || e.code === 'not_found' || e.code === 'ticket_not_found') {
      unsubscribed.value = true
      return
    }
    error.value = e.message || String(e)
  }
}

/** Adds one row once: the POST receipt and an SSE replay can carry the same message. */
function appendMessage(msg) {
  if (!msg || messages.value.some((m) => m.ID === msg.ID)) return
  messages.value.push(msg)
}

/** Opens the destructive confirmation; the trigger only exists with rows to lose. */
function askClear() {
  error.value = ''
  showClearConfirm.value = true
}

function cancelClear() {
  showClearConfirm.value = false
}

/**
 * Clears the conversation on the server, drops every local row and rebuilds the
 * stream: the old SSE connection still follows tasks from a replay that predates
 * the delete, and would otherwise bring deleted rows back. The store normalises
 * refusals to a machine code; errors.js turns that code into the current language.
 */
async function confirmClear() {
  if (clearing.value) return
  clearing.value = true
  error.value = ''
  try {
    const code = await workbench.clearThreadMessages(props.id)
    if (code) {
      error.value = errorMessage(code)
      return
    }
    messages.value = []
    showClearConfirm.value = false
    subscribe()
  } finally {
    clearing.value = false
  }
}

async function send() {
  const body = draft.value.trim()
  if (!body) return
  sending.value = true
  error.value = ''
  try {
    const res = await postThreadMessage(props.id, body)
    // The event stream replays the history once when it connects and then follows
    // only the tasks from that snapshot: a message posted on this open page never
    // arrives as a frame. The POST already returns the persisted row, so put it on
    // screen now instead of making the user leave and re-enter the thread.
    appendMessage(res?.message)
    draft.value = ''
    if (res?.delegated) await workbench.refreshTasks()
    // Reconnect so the fresh replay also carries any task this send started; its
    // agent reply would otherwise have no subscriber on the old stream.
    subscribe()
  } catch (e) {
    // Keep the draft: a refused send stays available for a retry.
    error.value = e.message || String(e)
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
    message: appendMessage,
    agent: appendMessage,
  })
}

onMounted(() => { load(); workbench.refreshTasks() })
onUnmounted(() => sub && sub.close())
</script>

<template>
  <div class="thread-page">
    <RouterLink class="btn btn-ghost thread-back" to="/threads">
      <ArrowLeft :size="16" class="thread-back-icon" aria-hidden="true" />
      {{ t('backToThreads') }}
    </RouterLink>
    <div class="thread" v-if="thread">
      <div class="thread-main">
        <div class="messages">
          <div v-if="messages.length === 0" class="empty">{{ t('messagesEmpty') }}</div>
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
                <span v-if="msg.Origin && msg.Origin.startsWith('agent:')" class="chip chip-mono">agent</span>
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
          <!-- Mention picker: the names that have spoken in this thread. It shows
               only while a `@token` is being typed, so the composer stays quiet. -->
          <div v-if="mentionOpen" class="mention-pop" role="listbox" :aria-label="to('mentionTitle')">
            <p v-if="mentionMatches.length === 0" class="muted" style="font-size:12px;padding:6px 8px">
              {{ to('mentionEmpty') }}
            </p>
            <button
              v-for="name in mentionMatches"
              :key="name"
              class="mention-item"
              role="option"
              :aria-selected="false"
              @click="insertMention(name)"
            >
              <PersonaAvatar :name="name" :size="20" />
              <span class="truncate">{{ name }}</span>
            </button>
          </div>
          <div class="composer-foot">
            <button class="voice-btn" :aria-label="to('mentionTitle')" @click="addMentions">
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
        <h3 class="card-title">{{ th('suggestionTitle') }}</h3>
        <div v-if="messages.filter(m => m.Suggestion).length === 0" class="muted" style="font-size:12px">{{ t('tasksPanelEmpty') }}</div>
        <SuggestionCard v-for="m in messages.filter(x => x.Suggestion)" :key="m.ID" :suggestion="m.Suggestion" />

        <h3 class="card-title" style="margin-top:16px">{{ t('tasksPanel') }}</h3>
        <div v-if="relatedTasks.length === 0" class="muted" style="font-size:12px">{{ t('tasksPanelEmpty') }}</div>
        <TaskCard v-for="task in relatedTasks" :key="task.id" :task="task" dense />

        <div v-if="!unsubscribed" class="row" style="gap:8px;margin-top:16px">
          <button class="btn btn-ghost btn-sm" @click="dropSubscription">{{ to('subscriptionDrop') }}</button>
        </div>
        <div v-if="messages.length > 0" class="row" style="gap:8px;margin-top:16px">
          <button class="btn btn-ghost btn-sm thread-clear" :disabled="clearing" @click="askClear">
            <Trash2 :size="15" aria-hidden="true" /> {{ t('clearMessages') }}
          </button>
        </div>
        <p v-if="error" class="muted" style="font-size:12px">{{ error }}</p>
      </div>
    </div>

    <BaseDialog
      v-model="showClearConfirm"
      :title="t('clearMessagesTitle')"
      :close-label="ts('actionClose')"
    >
      <p>{{ t('clearMessagesConfirm') }}</p>
      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="clearing" @click="cancelClear">
          {{ ts('actionCancel') }}
        </button>
        <button class="btn btn-danger btn-sm" :disabled="clearing" @click="confirmClear">
          {{ ts('actionDelete') }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>
