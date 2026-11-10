<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getThread, postThreadMessage, subscribeThreadEvents, dropRouterSubscription } from '../lib/api.js'
import { useWorkbenchStore } from '../lib/workbench-store.js'
import { useCopy } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import { formatTime, resourceLabel } from '../lib/format.js'
import BaseDialog from '../components/BaseDialog.vue'
import PersonaAvatar from '../components/PersonaAvatar.vue'
import VoiceRecorder from '../components/VoiceRecorder.vue'
import TaskCard from '../components/TaskCard.vue'
import SuggestionCard from '../components/SuggestionCard.vue'
import StateDot from '../components/StateDot.vue'
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
// Set while an agent is expected to answer: a delegated/routed task is in flight.
const awaitingReply = ref(false)
// Agent replies on screen when the current send started. A later increase is the
// reply we are waiting for, so an unrelated history replay cannot clear the wait.
const replyWatermark = ref(0)
// A localized reason the send produced no reply (no agent, refused delegation).
const notice = ref('')
let sub = null
// Timers that poll a fresh GET for asynchronously routed replies.
const refreshTimers = new Set()

const relatedTasks = computed(() => workbench.tasks.filter((task) => task.contextId === props.id))

// The conversation's live status, pinned to the end of the message stream:
// sending the POST first, then why nothing came back or which agent we are
// still waiting on.
const statusText = computed(() => {
  if (sending.value) return t('sending')
  if (notice.value) return notice.value
  if (awaitingReply.value) return t('replying')
  return ''
})

// Mention candidates: agents that already spoke here first, then every agent in
// the workspace. The server addresses agents by resource id, so each candidate
// carries the id to send plus a whitespace-free token inserted into the draft.
const mentionCandidates = computed(() => {
  const out = []
  const seen = new Set()
  const push = (id, token, label) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, token, label: label || token })
  }
  for (const m of messages.value) {
    if (m.AuthorType === 'user') continue
    const id = m.ResourceID || m.AuthorID
    if (!id) continue
    const token = m.AuthorName || id
    push(id, token, token)
  }
  // Declared participants stay addressable even when the workspace list does not
  // show the caller that agent, so offer them by id as a fallback.
  for (const pid of thread.value?.Participants || []) {
    const agent = workbench.agents.find((a) => a.id === pid)
    push(pid, pid, agent ? resourceLabel(agent) : pid)
  }
  for (const agent of workbench.agents) {
    push(agent.id, agent.name || agent.id, resourceLabel(agent))
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
  return mentionCandidates.value
    .filter((c) => c.label.toLowerCase().includes(q) || c.token.toLowerCase().includes(q))
    .slice(0, 6)
})

// Open while a token is being typed. A corpus with no agents at all still says
// so; once any agent exists the picker lists matches instead of empty text.
const mentionOpen = computed(
  () => mentionQuery.value !== null && (mentionMatches.value.length > 0 || mentionCandidates.value.length === 0),
)

/** Replaces the half-typed token with a complete handle. */
function insertMention(candidate) {
  draft.value = draft.value.replace(/(^|\s)@[^\s@]*$/, (_, lead) => `${lead}@${candidate.token} `)
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
 * Maps every `@token` in the draft back to a resource id. A token may match the
 * inserted token, the display label or the id itself, so a hand-typed mention
 * still resolves. Returns unique ids in first-seen order.
 */
function resolveMentions(body) {
  const ids = []
  const seen = new Set()
  for (const match of body.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
    const token = match[1].toLowerCase()
    const hit = mentionCandidates.value.find(
      (c) => c.token.toLowerCase() === token ||
        c.label.toLowerCase() === token ||
        c.id.toLowerCase() === token,
    )
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id)
      ids.push(hit.id)
    }
  }
  return ids
}

/** The agent a plain (unmentioned) message goes to: latest speaker, declared participant, first agent. */
function defaultAgentId() {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const m = messages.value[i]
    if (m.AuthorType === 'user') continue
    const id = m.ResourceID || m.AuthorID
    if (id) return id
  }
  const declared = thread.value?.Participants || []
  if (declared.length > 0) return declared[declared.length - 1]
  return workbench.agents[0]?.id || null
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

/**
 * Adds one row, or merges into the row with the same id when it is already on
 * screen. The server writes an empty-bodied agent placeholder and fills the same
 * message id later; without the merge the reply would stay blank.
 */
function appendMessage(msg) {
  if (!msg || !msg.ID) return
  const index = messages.value.findIndex((m) => m.ID === msg.ID)
  if (index === -1) {
    messages.value.push(msg)
    return
  }
  const current = messages.value[index]
  messages.value[index] = { ...current, ...msg, Body: msg.Body || current.Body }
}

/** True while an agent message is a server placeholder waiting for its body. */
function pendingReply(msg) {
  return msg.AuthorType !== 'user' && Boolean(msg.TaskID) && !msg.Body
}

/** How many agent replies with a body are on screen right now. */
function agentReplyCount() {
  return messages.value.filter((m) => m.AuthorType !== 'user' && m.Body).length
}

/**
 * Clears the wait only when a reply newer than the send arrives. Plain history
 * frames (the user's own message, old replies) replay on every reconnect and must
 * not hide the "Replying…" status before the agent has actually answered.
 */
function settleIfReplied() {
  if (awaitingReply.value && agentReplyCount() > replyWatermark.value) awaitingReply.value = false
}

/** Opens the destructive confirmation; the trigger only exists with rows to lose. */
function askClear() {
  error.value = ''
  showClearConfirm.value = true
}

function cancelClear() {
  showClearConfirm.value = false
}

function clearRefreshTimers() {
  for (const timer of refreshTimers) clearInterval(timer)
  refreshTimers.clear()
}

/**
 * Re-reads the thread a bounded number of times after a send. The SSE stream
 * freezes its task-id list at connect time, so an asynchronously routed reply is
 * only visible through a fresh GET; the timer stops itself once nothing is
 * pending, and never runs longer than the cap.
 */
function scheduleRefresh() {
  clearRefreshTimers()
  let attempts = 0
  const timer = setInterval(async () => {
    attempts += 1
    try {
      const data = await getThread(props.id)
      for (const m of data.messages || []) appendMessage(m)
    } catch (e) {
      // A transient read failure must not break the conversation; the next tick retries.
    }
    settleIfReplied()
    // Reconnecting makes the server replay this thread and fill any placeholder
    // whose reply frame was persisted after our previous connection; the live
    // broker subscription only covers frames emitted while it was attached.
    if (awaitingReply.value) subscribe()
    // Stop on a reply, or hand back to the user when the window closes so a
    // spinner never dangles on a task the server stopped mentioning.
    if (attempts >= 6 || !awaitingReply.value) {
      awaitingReply.value = false
      clearInterval(timer)
      refreshTimers.delete(timer)
    }
  }, 3000)
  refreshTimers.add(timer)
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
  error.value = ''
  notice.value = ''
  // Show "Sending" the instant the button is pressed: resolving a default agent
  // may await a workspace refresh, and a blank composer in that gap reads as a
  // dead button.
  sending.value = true
  try {
    // Mentions in the body win; otherwise hand the message to one default agent.
    const mentions = resolveMentions(body)
    if (mentions.length === 0) {
      // A cold start can reach this point before the workspace poll has filled the
      // list; one refresh turns a silent no-op into a real delegation.
      if (workbench.agents.length === 0) await workbench.refreshWorkspace()
      const fallback = defaultAgentId()
      if (fallback) mentions.push(fallback)
    }
    const res = await postThreadMessage(props.id, body, mentions)
    // The event stream replays the history once when it connects and then follows
    // only the tasks from that snapshot: a message posted on this open page never
    // arrives as a frame. The POST already returns the persisted row, so put it on
    // screen now instead of making the user leave and re-enter the thread.
    appendMessage(res?.message)
    draft.value = ''
    const delegated = Array.isArray(res?.delegated) ? res.delegated : []
    const expectsReply = Boolean(res?.routed || delegated.length > 0)
    if (expectsReply) {
      replyWatermark.value = agentReplyCount()
      awaitingReply.value = true
      if (delegated.length > 0) await workbench.refreshTasks()
    } else if (mentions.length === 0) {
      // Nothing to hand the message to: it is still posted, but say why.
      notice.value = t('participantsEmpty')
    } else {
      // The message was posted but every mention failed to delegate: say so
      // rather than leave the composer looking like it ignored the user.
      notice.value = t('delegateFailed')
    }
    // Reconnect so the fresh replay also carries any task this send started.
    subscribe()
    // Router-on replies arrive after the POST, so poll a fresh GET for a while.
    if (expectsReply) scheduleRefresh()
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
  // Replies already on screen at load time are not the answer to a send.
  replyWatermark.value = agentReplyCount()
  awaitingReply.value = messages.value.some(pendingReply)
  subscribe()
}

function subscribe() {
  if (sub) sub.close()
  const receive = (msg) => {
    appendMessage(msg)
    settleIfReplied()
  }
  sub = subscribeThreadEvents(props.id, {
    message: receive,
    agent: receive,
  })
}

onMounted(() => { load(); workbench.refreshTasks() })
onUnmounted(() => {
  if (sub) sub.close()
  clearRefreshTimers()
})
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
          <div v-if="messages.length === 0 && !statusText" class="empty">{{ t('messagesEmpty') }}</div>
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
              <div class="msg-body pre-wrap">
                <span v-if="msg.Body">{{ msg.Body }}</span>
                <span v-else-if="pendingReply(msg)" class="msg-pending">
                  <StateDot state="working" :label="false" />
                  <span>{{ t('replying') }}</span>
                </span>
              </div>
            </div>
          </div>
          <!-- The live send/reply status trails the message stream instead of
               sitting under the composer, so it reads as the outcome of the
               message just posted. -->
          <p v-if="statusText" class="messages-status" role="status" aria-live="polite">
            <StateDot v-if="sending || awaitingReply" state="working" :label="false" />
            <span>{{ statusText }}</span>
          </p>
        </div>

        <div class="composer">
          <div class="line">
            <textarea
              v-model="draft"
              :placeholder="t('composerPlaceholder')"
              @keydown.enter.exact.prevent="send"
            />
          </div>
          <!-- Mention picker: agents already in this thread first, then the whole
               workspace. It shows only while a `@token` is being typed. -->
          <div v-if="mentionOpen" class="mention-pop" role="listbox" :aria-label="to('mentionTitle')">
            <p v-if="mentionMatches.length === 0" class="muted" style="font-size:12px;padding:6px 8px">
              {{ t('participantsEmpty') }}
            </p>
            <button
              v-for="candidate in mentionMatches"
              :key="candidate.id"
              class="mention-item"
              role="option"
              :aria-selected="false"
              @click="insertMention(candidate)"
            >
              <PersonaAvatar :name="candidate.label" :size="20" />
              <span class="truncate">{{ candidate.label }}</span>
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
