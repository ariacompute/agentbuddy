<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  getResource, getResourceDistribution, listResources, pushResourceDistribution, updateResource,
} from '../lib/api.js'
import { useAuthStore } from '../lib/auth-store.js'
import { useCopy } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import { healthLabel } from '../lib/use-copy.js'
import {
  bindingsDiffer, bindingsOf, toggleRef, unresolvedRefs, withBindings,
} from '../lib/bindings.js'
import PersonaAvatar from '../components/PersonaAvatar.vue'

const { t } = useCopy('abilities')
const auth = useAuthStore()

// The catalogue question this screen asks is "everything I may see", which is the
// same question the org screen asks: no `discoverable` filter, no page window.
// `limit: 0` is the server's "whole set" window and these lists are small.
const agents = ref([])
const mcps = ref([])
const skills = ref([])
const query = ref('')
const loadingAgents = ref(true)
const loadError = ref('')

// Two different records drive the right column, and they must both come from the
// server: a row from the listing is fine to render and wrong to save, because
// PUT replaces the whole resource.
const selectedId = ref('')
const entry = ref(null)
const draft = ref({ mcp: [], skills: [] })
const detailLoading = ref(false)
const detailError = ref('')

const pkg = ref(null)
const pkgLoading = ref(false)
const pkgError = ref('')

const saving = ref(false)
const saveError = ref('')
const saved = ref(false)

const delivering = ref(false)
const deliverError = ref('')
const deliveredTask = ref(null)

const writeAllowed = computed(() => auth.can('resources:write'))
const dirty = computed(() => (entry.value ? bindingsDiffer(entry.value, draft.value) : false))
// Clearing everything is itself an edit, so it cannot hang off `dirty`: on a
// freshly opened record nothing has changed yet, and the operator still needs a
// way to withdraw every ability in one move.
const hasDraft = computed(() => draft.value.mcp.length > 0 || draft.value.skills.length > 0)

const filteredAgents = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return agents.value
  return agents.value.filter((agent) =>
    [agent.name, agent.display_name, agent.id].some((value) => (value || '').toLowerCase().includes(needle)),
  )
})

// Selected but not offered: invisible to this caller, or bound before the picker
// existed. They are kept in the draft and only leave it when the operator says so.
const unresolvedMCP = computed(() => unresolvedRefs(draft.value.mcp, mcps.value))
const unresolvedSkills = computed(() => unresolvedRefs(draft.value.skills, skills.value))

function bindingCount(agent) {
  const bindings = bindingsOf(agent)
  return bindings.mcp.length + bindings.skills.length
}

function agentLabel(agent) {
  return agent.display_name || agent.name || agent.id
}

function replaceAgent(record) {
  const index = agents.value.findIndex((agent) => agent.id === record.id)
  if (index >= 0) agents.value.splice(index, 1, { ...agents.value[index], ...record })
}

async function loadCatalogue() {
  loadingAgents.value = true
  loadError.value = ''
  try {
    const [agentPage, mcpPage, skillPage] = await Promise.all([
      listResources('agent', { limit: 0 }),
      listResources('mcp', { limit: 0 }),
      listResources('skill', { limit: 0 }),
    ])
    // The local kind check keeps a row out when an older server ignored `kind=`;
    // a stray entry must not appear as a candidate it is not.
    agents.value = (agentPage.resources || []).filter((row) => row.kind === 'agent')
    mcps.value = (mcpPage.resources || []).filter((row) => row.kind === 'mcp')
    skills.value = (skillPage.resources || []).filter((row) => row.kind === 'skill')
  } catch (e) {
    loadError.value = errorMessage(e.code) || e.message
  } finally {
    loadingAgents.value = false
  }
}

async function loadEntry(id) {
  detailLoading.value = true
  try {
    const record = await getResource(id)
    if (selectedId.value !== id) return
    entry.value = record
    draft.value = bindingsOf(record)
    replaceAgent(record)
  } catch (e) {
    if (selectedId.value === id) detailError.value = errorMessage(e.code) || e.message
  } finally {
    detailLoading.value = false
  }
}

async function loadPackage(id) {
  pkgLoading.value = true
  try {
    const data = await getResourceDistribution(id)
    if (selectedId.value === id) pkg.value = data
  } catch (e) {
    if (selectedId.value === id) pkgError.value = errorMessage(e.code) || e.message
  } finally {
    pkgLoading.value = false
  }
}

async function selectAgent(id) {
  if (!id || id === selectedId.value) return
  selectedId.value = id
  entry.value = null
  draft.value = { mcp: [], skills: [] }
  detailError.value = ''
  saveError.value = ''
  saved.value = false
  deliverError.value = ''
  deliveredTask.value = null
  pkg.value = null
  pkgError.value = ''
  await Promise.all([loadEntry(id), loadPackage(id)])
}

function toggle(kind, id) {
  draft.value = { ...draft.value, [kind]: toggleRef(draft.value[kind], id) }
}

function clearAll() {
  draft.value = { mcp: [], skills: [] }
}

async function save() {
  if (!entry.value || saving.value || !writeAllowed.value) return
  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    const record = await updateResource(selectedId.value, withBindings(entry.value, draft.value))
    entry.value = record
    draft.value = bindingsOf(record)
    replaceAgent(record)
    saved.value = true
    // The package is derived from the bindings, so it is stale the moment they
    // change: re-read it instead of rendering a mixture of old and new.
    await loadPackage(selectedId.value)
  } catch (e) {
    saveError.value = errorMessage(e.code) || e.message
  } finally {
    saving.value = false
  }
}

async function deliver() {
  if (!selectedId.value || delivering.value || !writeAllowed.value) return
  delivering.value = true
  deliverError.value = ''
  deliveredTask.value = null
  try {
    deliveredTask.value = await pushResourceDistribution(selectedId.value)
  } catch (e) {
    deliverError.value = errorMessage(e.code) || e.message
  } finally {
    delivering.value = false
  }
}

onMounted(loadCatalogue)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('intro') }}</p>
      </div>
    </div>

    <p v-if="!writeAllowed" class="muted notice">{{ t('needsWrite') }}</p>

    <div class="abilities-layout">
      <aside class="card stack abilities-agents">
        <h2 class="card-title">{{ t('agents') }}</h2>
        <input
          v-model="query"
          class="org-search"
          type="search"
          :placeholder="t('searchAgents')"
          :aria-label="t('searchAgents')"
        />

        <p v-if="loadError" class="muted small">{{ loadError }}</p>
        <template v-else-if="!loadingAgents">
          <p v-if="!agents.length" class="muted small">{{ t('agentsEmpty') }}</p>
          <p v-if="!agents.length" class="muted small">{{ t('agentsEmptyHint') }}</p>
          <p v-else-if="!filteredAgents.length" class="muted small">{{ t('agentsNoMatch') }}</p>
        </template>

        <ul v-if="filteredAgents.length" class="agent-list">
          <li v-for="agent in filteredAgents" :key="agent.id">
            <button
              class="agent-item"
              :class="{ 'is-active': agent.id === selectedId }"
              :aria-current="agent.id === selectedId ? 'true' : undefined"
              @click="selectAgent(agent.id)"
            >
              <PersonaAvatar :persona="agent.persona" :name="agentLabel(agent)" :size="26" />
              <span class="agent-name">{{ agentLabel(agent) }}</span>
              <span class="chip">{{ bindingCount(agent) }}</span>
              <span class="health-dot" :data-health="agent.health?.status || agent.health" :title="healthLabel(agent.health?.status)"></span>
            </button>
          </li>
        </ul>
      </aside>

      <section class="stack abilities-work">
        <p v-if="!selectedId" class="card muted small">{{ t('pickAgent') }}</p>

        <template v-else>
          <section class="card stack">
            <div class="row row-wrap abilities-head">
              <h2 class="card-title">{{ t('bindings') }}</h2>
              <div class="row" style="gap:8px">
                <button class="btn btn-ghost btn-sm" :disabled="!hasDraft || saving || !writeAllowed" @click="clearAll">
                  {{ t('clear') }}
                </button>
                <button class="btn btn-primary btn-sm" :disabled="!dirty || saving || !writeAllowed" @click="save">
                  {{ saving ? t('saving') : t('save') }}
                </button>
              </div>
            </div>
            <p class="muted small">{{ t('bindingsHint') }}</p>

            <p v-if="detailError" class="muted small">{{ detailError }}</p>
            <p v-else-if="detailLoading" class="muted small">…</p>

            <div v-else class="grid grid-2" style="gap:16px">
              <div class="stack tight">
                <h3 class="card-title">{{ t('mcpServers') }}</h3>
                <p v-if="!mcps.length" class="muted small">{{ t('candidatesEmpty') }}</p>
                <ul v-else class="ability-list">
                  <li v-for="item in mcps" :key="item.id">
                    <label class="ability-row">
                      <input
                        type="checkbox"
                        :checked="draft.mcp.includes(item.id)"
                        :disabled="!writeAllowed"
                        @change="toggle('mcp', item.id)"
                      />
                      <span class="ability-meta">
                        <strong>{{ agentLabel(item) }}</strong>
                        <code class="mono">{{ item.id }}</code>
                      </span>
                    </label>
                  </li>
                </ul>
              </div>

              <div class="stack tight">
                <h3 class="card-title">{{ t('skills') }}</h3>
                <p v-if="!skills.length" class="muted small">{{ t('candidatesEmpty') }}</p>
                <ul v-else class="ability-list">
                  <li v-for="item in skills" :key="item.id">
                    <label class="ability-row">
                      <input
                        type="checkbox"
                        :checked="draft.skills.includes(item.id)"
                        :disabled="!writeAllowed"
                        @change="toggle('skills', item.id)"
                      />
                      <span class="ability-meta">
                        <strong>{{ agentLabel(item) }}</strong>
                        <code class="mono">{{ item.id }}</code>
                      </span>
                    </label>
                  </li>
                </ul>
              </div>
            </div>

            <div v-if="unresolvedMCP.length || unresolvedSkills.length" class="stack tight">
              <h3 class="card-title">{{ t('unresolved') }}</h3>
              <p class="muted small">{{ t('unresolvedHint') }}</p>
              <div class="row row-wrap">
                <button
                  v-for="id in unresolvedMCP"
                  :key="`mcp-${id}`"
                  class="chip ability-chip is-unresolved"
                  :title="t('remove')"
                  :aria-label="`${t('remove')} ${id}`"
                  :disabled="!writeAllowed"
                  @click="toggle('mcp', id)"
                >
                  {{ id }} ×
                </button>
                <button
                  v-for="id in unresolvedSkills"
                  :key="`skill-${id}`"
                  class="chip ability-chip is-unresolved"
                  :title="t('remove')"
                  :aria-label="`${t('remove')} ${id}`"
                  :disabled="!writeAllowed"
                  @click="toggle('skills', id)"
                >
                  {{ id }} ×
                </button>
              </div>
            </div>

            <p v-if="saveError" class="muted small">{{ saveError }}</p>
            <p v-else-if="saved" class="muted small" aria-live="polite">{{ t('saved') }}</p>
          </section>

          <section class="card stack">
            <h2 class="card-title">{{ t('package') }}</h2>
            <p class="muted small">{{ t('packageHint') }}</p>

            <p v-if="pkgError" class="muted small">{{ pkgError }}</p>
            <p v-else-if="pkgLoading" class="muted small">…</p>
            <template v-else-if="pkg">
              <p v-if="!pkg.mcp?.length && !pkg.skills?.length" class="muted small">{{ t('packageEmpty') }}</p>

              <article v-for="server in pkg.mcp || []" :key="`pkg-${server.id}`" class="pkg-card stack tight">
                <div class="row row-wrap abilities-head">
                  <strong>{{ server.display_name || server.name }}</strong>
                  <code class="mono">{{ server.id }}</code>
                </div>
                <dl class="pkg-fields">
                  <dt>{{ t('transport') }}</dt>
                  <dd>{{ server.transport || '—' }}</dd>
                  <template v-if="server.url">
                    <dt>{{ t('endpoint') }}</dt>
                    <dd class="mono">{{ server.url }}</dd>
                  </template>
                  <template v-if="server.command">
                    <dt>{{ t('command') }}</dt>
                    <dd class="mono">{{ server.command }}</dd>
                  </template>
                  <template v-if="server.tool_allowlist?.length">
                    <dt>{{ t('tools') }}</dt>
                    <dd class="mono">{{ server.tool_allowlist.join(', ') }}</dd>
                  </template>
                  <template v-if="server.env_keys?.length">
                    <dt>{{ t('envKeys') }}</dt>
                    <dd class="mono">{{ server.env_keys.join(', ') }}</dd>
                  </template>
                  <template v-if="server.auth_schemes?.length">
                    <dt>{{ t('auth') }}</dt>
                    <dd>{{ server.auth_schemes.join(', ') }}</dd>
                  </template>
                </dl>
              </article>

              <article v-for="manual in pkg.skills || []" :key="`pkg-${manual.id}`" class="pkg-card stack tight">
                <div class="row row-wrap abilities-head">
                  <strong>{{ manual.display_name || manual.name }}</strong>
                  <code class="mono">{{ manual.id }}</code>
                </div>
                <dl class="pkg-fields">
                  <template v-if="manual.triggers?.length">
                    <dt>{{ t('triggers') }}</dt>
                    <dd>{{ manual.triggers.join(', ') }}</dd>
                  </template>
                  <template v-if="manual.steps?.length">
                    <dt>{{ t('steps') }}</dt>
                    <dd>{{ manual.steps.join(' → ') }}</dd>
                  </template>
                  <template v-if="manual.tools?.length">
                    <dt>{{ t('tools') }}</dt>
                    <dd class="mono">{{ manual.tools.join(', ') }}</dd>
                  </template>
                </dl>
                <p v-if="manual.docs_truncated" class="muted small">{{ t('docsTruncated') }}</p>
              </article>

              <p v-if="pkg.unresolved?.length" class="muted small">
                {{ t('unresolved') }}: <code class="mono">{{ pkg.unresolved.join(', ') }}</code>
              </p>
              <p v-if="pkg.missing?.length" class="muted small">
                {{ t('missing') }}: <code class="mono">{{ pkg.missing.join(', ') }}</code>
                — {{ t('missingHint') }}
              </p>
            </template>
          </section>

          <section class="card stack">
            <div class="row row-wrap abilities-head">
              <div>
                <h2 class="card-title">{{ t('task') }}</h2>
                <p class="muted small">{{ t('deliverEmpty') }}</p>
              </div>
              <button class="btn btn-primary" :disabled="delivering || !writeAllowed" @click="deliver">
                {{ delivering ? t('delivering') : t('deliver') }}
              </button>
            </div>

            <p v-if="deliverError" class="muted small">{{ deliverError }}</p>
            <p v-else-if="deliveredTask" class="muted small" aria-live="polite">
              {{ t('delivered') }} · <code class="mono">{{ deliveredTask.id }}</code>
              <router-link :to="`/tasks/${deliveredTask.id}`">{{ t('openTask') }}</router-link>
            </p>
          </section>
        </template>
      </section>
    </div>
  </div>
</template>
