<script setup>
import { ref, onMounted } from 'vue'
import { useCopy, useLang, setLang } from '../lib/use-copy.js'
import { LANGUAGES } from '../lib/languages.js'
import { checkHealth, request, getUpgrade, checkUpgrade, installUpgrade } from '../lib/api.js'
import { applyShellNotifySettings } from '../lib/shell-settings.js'

const { t } = useCopy('settings')
// The execution-node block speaks the execution-environment vocabulary, which
// lives in the hub namespace so the console and this screen stay consistent.
const { t: th } = useCopy('hub')
const lang = useLang()

const KEY = 'agentbuddy.settings'
const THEME_KEY = 'agentbuddy.theme'
const background = ref(true)
const notify = ref(true)
const quiet = ref(0)
const voiceInput = ref(true)
const themeLight = ref(false)
const server = ref('')
const version = ref('')
const build = ref('')

// Release checks are a desktop-shell capability. Outside the shell the read
// 404s and the card says updates are not configured here; nothing else on this
// screen depends on it.
const upgrade = ref(null)
const upgradeAuto = ref(true)
const upgradeError = ref('')
const upgradeBusy = ref(false)
const shellVersion = ref('')

const RELEASE_PAGES = {
  github: 'https://github.com/ariacompute/agentbuddy/releases/latest',
  gitee: 'https://gitee.com/ariacompute/agentbuddy/releases',
}

// The shell answers with machine codes. Every sentence on this card comes from
// the copy table; an unknown code falls back to the generic failure text.
const UPGRADE_STATUS = {
  idle: '',
  checking: 'upgradeChecking',
  up_to_date: 'upgradeUpToDate',
  available: 'upgradeAvailable',
  unsupported_platform: 'upgradeUnsupported',
  downloading: 'upgradeBusy',
  installing: 'upgradeBusy',
  not_configured: 'upgradeNotConfigured',
  network_failed: 'upgradeFailed',
  manifest_invalid: 'upgradeFailed',
  signature_failed: 'upgradeFailed',
  busy: 'upgradeChecking',
  unavailable: 'upgradeNotConfigured',
}

/** A manifest may name an asset URL. Never navigate to one we do not trust. */
function assetHostAllowed(raw) {
  if (!raw) return false
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    return (
      url.protocol === 'https:' &&
      (host === 'github.com' ||
        host === 'gitee.com' ||
        host.endsWith('.githubusercontent.com') ||
        host.endsWith('.gitee.com'))
    )
  } catch (e) { return false }
}

function upgradeStatusText() {
  const state = upgrade.value
  if (!state || !state.status) return t('upgradeNotConfigured')
  const key = UPGRADE_STATUS[state.status] ?? 'upgradeFailed'
  if (!key) return ''
  return t(key).replace('{v}', state.latestVersion || '')
}

function upgradeSourceLabel() {
  const source = upgrade.value?.source
  if (source === 'gitee') return 'Gitee'
  if (source === 'github') return 'GitHub'
  return '—'
}

function checkedAtText() {
  const ts = upgrade.value?.checkedAt
  if (!ts) return '—'
  const date = new Date(ts * 1000)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function releaseHref() {
  return RELEASE_PAGES[upgrade.value?.source] || RELEASE_PAGES.github
}

function currentVersionText() {
  return upgrade.value?.currentVersion || shellVersion.value || t('unknown')
}

const canInstall = () =>
  upgrade.value?.status === 'available' &&
  (!upgrade.value.downloadUrl || assetHostAllowed(upgrade.value.downloadUrl))

async function readUpgrade() {
  try {
    upgrade.value = (await getUpgrade()) || null
  } catch (e) { upgrade.value = null }
}

async function runCheck() {
  if (upgradeBusy.value) return
  upgradeBusy.value = true
  upgradeError.value = ''
  try {
    upgrade.value = (await checkUpgrade()) || { status: 'unavailable' }
  } catch (e) {
    upgradeError.value = e?.code || 'unavailable'
  } finally { upgradeBusy.value = false }
}

async function runInstall() {
  if (upgradeBusy.value) return
  upgradeBusy.value = true
  upgradeError.value = ''
  try {
    upgrade.value = (await installUpgrade()) || upgrade.value
  } catch (e) {
    upgradeError.value = e?.code || 'not_configured'
  } finally { upgradeBusy.value = false }
}

async function skipUpgrade() {
  const skipped = upgrade.value?.latestVersion
  if (!skipped) return
  try {
    await request('/__shell/config', {
      method: 'POST',
      body: JSON.stringify({ upgrade_skipped_version: skipped }),
    })
    upgrade.value = { ...upgrade.value, status: 'up_to_date', skippedVersion: skipped }
  } catch (e) { /* not running inside the desktop shell */ }
}

// The execution node. Its settings live in the shell's config, but whether it is
// actually running (and why not) only the local process knows, so the state is a
// separate read. Off by default: a desktop does not accept commands because the
// feature exists.
const executorEnabled = ref(false)
const executorRoot = ref('')
const executorAllowlist = ref('')
const executorMax = ref(1)
const executorApiKey = ref('')
const executorHasKey = ref(false)
const executorNodeId = ref('')
const executorSaved = ref(false)
const executorError = ref('')
const executorStatus = ref(null)

/**
 * The shell reports a refusal as a machine code; the copy table turns it into a
 * sentence. An unknown code is shown verbatim rather than swallowed, so a new
 * reason is visible before it is translated.
 */
function reasonText(raw) {
  if (!raw) return ''
  if (raw.startsWith('unreachable')) return th('sbReasonUnreachable')
  const map = {
    root_unusable: 'sbReasonRootUnusable',
    command_not_allowed: 'sbReasonCommandNotAllowed',
    server_not_configured: 'sbReasonServerMissing',
    dir_outside_root: 'sbReasonDirOutsideRoot',
    env_not_allowed: 'sbReasonEnvNotAllowed',
    spawn_failed: 'sbReasonSpawnFailed',
  }
  return map[raw] ? th(map[raw]) : raw
}

const executorOnline = () => executorStatus.value?.running === true


// The resident / notification preferences decide what the shell does after the
// window closes, so they live in the desktop shell's own config (written through
// /__shell/config) — not in the workbench's localStorage. localStorage is only a
// fallback for when the workbench is opened outside the shell (e.g. vite dev),
// where there is no tray to act on the preference anyway.
function readLocal() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}')
  } catch (e) { return {} }
}

onMounted(async () => {
  let cfg = null
  try {
    cfg = await request('/__shell/config')
    background.value = cfg.background ?? true
    notify.value = cfg.notifyEnabled ?? true
    quiet.value = cfg.notifyQuietMinutes ?? 0
    upgradeAuto.value = cfg.upgradeAutoCheck ?? true
    // The connected server is the shell's configured upstream — agenthub's
    // /healthz does not report its own URL, so we read it from the shell.
    server.value = cfg.serverUrl || ''
    readExecutorConfig(cfg)
    await readExecutorStatus()
  } catch (e) {
    const saved = readLocal()
    background.value = saved.background ?? true
    notify.value = saved.notify ?? true
    quiet.value = saved.quiet ?? 0
    upgradeAuto.value = saved.upgradeAuto ?? true
  }
  const local = readLocal()
  voiceInput.value = local.voiceInput ?? true
  // The canonical key, not the settings blob: the shell seeds it from its own
  // config before the first paint, so it is what the page is showing right now.
  themeLight.value = window.localStorage.getItem(THEME_KEY) !== 'dark'
  shellVersion.value = window.__AGENTBUDDY_VERSION__ || ''
  applyTheme()
  await readUpgrade()
  try {
    const h = await checkHealth()
    version.value = h.version || t('unknown')
    build.value = h.commit || t('unknown')
  } catch (e) { /* ignore */ }
})

function readExecutorConfig(cfg) {
  executorEnabled.value = cfg.executorEnabled ?? false
  executorRoot.value = cfg.executorRoot || ''
  executorAllowlist.value = (cfg.executorAllowlist || []).join('\n')
  executorMax.value = cfg.executorMaxConcurrency || 1
  executorHasKey.value = cfg.executorHasApiKey === true
  executorNodeId.value = cfg.executorNodeId || ''
}

/** The live state. Outside the desktop shell there is no node, and that is fine. */
async function readExecutorStatus() {
  try {
    const state = await request('/__shell/executor')
    executorStatus.value = state?.status || null
  } catch (e) {
    executorStatus.value = null
  }
}

/**
 * Turning the node on is the one click that has consequences, so it asks first.
 * Turning it off never asks: stopping is always the safe direction.
 */
async function toggleExecutor(next, event) {
  if (next && !window.confirm(th('sbExecutorRisk'))) {
    executorEnabled.value = false
    // Put the checkbox back by hand: the bound value did not change, so Vue has
    // no reason to re-render it, and a ticked box would claim the node is on.
    if (event?.target) event.target.checked = false
    return
  }
  executorEnabled.value = next
  await saveExecutor()
}

async function saveExecutor() {
  executorError.value = ''
  executorSaved.value = false
  try {
    const res = await request('/__shell/executor', {
      method: 'POST',
      body: JSON.stringify({
        enabled: executorEnabled.value,
        root: executorRoot.value,
        allowlist: executorAllowlist.value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        max_concurrency: Number(executorMax.value) || 1,
        // An empty string keeps the stored key: the shell only writes what it is
        // given, and the field is blank because the value is never sent back.
        api_key: executorApiKey.value,
      }),
    })
    const typedKey = executorApiKey.value.trim()
    executorApiKey.value = ''
    executorStatus.value = res?.status || null
    if (res?.status?.nodeId) executorNodeId.value = res.status.nodeId
    if (typedKey) executorHasKey.value = true
    executorSaved.value = true
  } catch (e) {
    // A refusal carries a machine code; a transport failure means the workbench
    // is running outside the desktop shell, where there is no node at all.
    executorError.value = reasonText(e.code) || th('sbReasonServerMissing')
  }
}

function applyTheme() {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = themeLight.value ? 'light' : 'dark'
  }
}

function saveLocal() {
  const local = readLocal()
  local.voiceInput = voiceInput.value
  // Mirror the shell-managed flags so the dev fallback reflects the latest choice.
  local.background = background.value
  local.notify = notify.value
  local.quiet = quiet.value
  local.upgradeAuto = upgradeAuto.value
  window.localStorage.setItem(KEY, JSON.stringify(local))
  // Keep the canonical theme key in sync so the pre-paint script in index.html
  // and the top-bar ThemeToggle honour the same choice, and apply it live.
  window.localStorage.setItem(THEME_KEY, themeLight.value ? 'light' : 'dark')
  applyTheme()
}

async function save() {
  saveLocal()
  try {
    await request('/__shell/config', {
      method: 'POST',
      body: JSON.stringify({
        // The theme travels with the rest: the shell is the only place that can
        // keep it across a restart (the window's origin changes every launch).
        theme: themeLight.value ? 'light' : 'dark',
        background: background.value,
        notify_enabled: notify.value,
        notify_quiet_minutes: quiet.value,
        upgrade_auto_check: upgradeAuto.value,
      }),
    })
  } catch (e) { /* not running inside the desktop shell */ }
  // The switch has to take effect now, not after the next reload: the workbench
  // reads these through shell-settings.js, and the cache would otherwise serve
  // the previous answer for up to a minute.
  applyShellNotifySettings({ notifyEnabled: notify.value, notifyQuietMinutes: quiet.value })
}

function reset() {
  if (!window.confirm(t('resetConfirm'))) return
  background.value = true
  notify.value = true
  quiet.value = 0
  voiceInput.value = true
  themeLight.value = true
  upgradeAuto.value = true
  save()
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('title') }}</h1>
        <p class="sub">{{ t('subtitle') }}</p>
      </div>
    </div>

    <div class="grid grid-2">
      <section class="card stack">
        <h2 class="card-title">{{ t('language') }}</h2>
        <p class="muted" style="font-size:12px">{{ t('languageNote') }}</p>
        <select :value="lang" @change="setLang($event.target.value)">
          <option v-for="l in LANGUAGES" :key="l[0]" :value="l[0]">{{ l[1] }}</option>
        </select>
      </section>

      <section class="card stack">
        <h2 class="card-title">{{ t('theme') }}</h2>
        <div class="row row-wrap">
          <button class="btn btn-sm" :class="!themeLight ? 'btn-primary' : 'btn-ghost'" @click="themeLight = false; save()">{{ t('themeDark') }}</button>
          <button class="btn btn-sm" :class="themeLight ? 'btn-primary' : 'btn-ghost'" @click="themeLight = true; save()">{{ t('themeLight') }}</button>
        </div>
      </section>

      <section class="card stack">
        <h2 class="card-title">{{ t('background') }}</h2>
        <p class="muted" style="font-size:12px">{{ t('backgroundNote') }}</p>
        <label class="switch"><input type="checkbox" v-model="background" @change="save" /><span>{{ background ? 'on' : 'off' }}</span></label>
      </section>

      <section class="card stack">
        <h2 class="card-title">{{ t('notify') }}</h2>
        <p class="muted" style="font-size:12px">{{ t('notifyNote') }}</p>
        <label class="switch"><input type="checkbox" v-model="notify" @change="save" /><span>{{ notify ? 'on' : 'off' }}</span></label>
        <div class="field" style="margin-top:8px">
          <label>{{ t('quiet') }} ({{ quiet }})</label>
          <input type="number" min="0" max="240" v-model.number="quiet" @change="save" />
          <p class="muted" style="font-size:11px">{{ t('quietNote') }}</p>
        </div>
      </section>

      <section class="card stack">
        <h2 class="card-title">{{ t('voiceInput') }}</h2>
        <p class="muted" style="font-size:12px">{{ t('voiceInputNote') }}</p>
        <label class="switch"><input type="checkbox" v-model="voiceInput" @change="save" /><span>{{ voiceInput ? 'on' : 'off' }}</span></label>
      </section>

      <section class="card stack">
        <div class="row" style="justify-content:space-between;gap:8px">
          <h2 class="card-title">{{ th('sbExecutorTitle') }}</h2>
          <span class="chip" :class="executorOnline() ? 'chip-on' : ''">
            {{ executorEnabled ? (executorOnline() ? th('sbNodeOnline') : th('sbNodeOffline')) : th('sbNodeDisabled') }}
          </span>
        </div>
        <p class="muted" style="font-size:12px">{{ th('sbExecutorSub') }}</p>
        <label class="switch">
          <input type="checkbox" :checked="executorEnabled" @change="toggleExecutor($event.target.checked, $event)" />
          <span>{{ th('sbExecutorEnable') }}</span>
        </label>

        <div class="field">
          <label>{{ th('sbExecutorRoot') }}</label>
          <input v-model="executorRoot" class="mono" placeholder="/home/me/work" />
          <p class="muted" style="font-size:11px">{{ th('sbExecutorRootHint') }}</p>
        </div>
        <div class="field">
          <label>{{ th('sbExecutorAllowlist') }}</label>
          <textarea v-model="executorAllowlist" class="mono" rows="3" placeholder="git&#10;npm"></textarea>
          <p class="muted" style="font-size:11px">{{ th('sbExecutorAllowlistHint') }}</p>
        </div>
        <div class="field">
          <label>{{ th('sbExecutorConcurrency') }}</label>
          <input type="number" min="1" max="8" v-model.number="executorMax" />
        </div>
        <div class="field">
          <label>{{ th('sbExecutorApiKey') }}</label>
          <input type="password" v-model="executorApiKey" class="mono" :placeholder="executorHasKey ? '••••••' : ''" />
          <p class="muted" style="font-size:11px">{{ th('sbExecutorApiKeyHint') }}</p>
        </div>
        <div class="row" style="gap:8px">
          <span class="muted" style="font-size:11px">{{ th('sbExecutorNodeId') }}</span>
          <code class="mono" style="font-size:11px">{{ executorNodeId || th('sbExecutorNoNode') }}</code>
        </div>
        <div class="row" style="gap:10px;align-items:center">
          <button class="btn btn-sm" @click="saveExecutor">{{ th('sbExecutorSave') }}</button>
          <span v-if="executorSaved" class="muted" style="font-size:11px">{{ th('sbExecutorSaved') }}</span>
        </div>
        <p v-if="executorError" class="muted" style="font-size:11px">{{ executorError }}</p>
        <p v-else-if="executorStatus?.lastError" class="muted" style="font-size:11px">
          {{ reasonText(executorStatus.lastError) }}
        </p>
      </section>

      <section class="card stack">
        <h2 class="card-title">{{ t('connection') }}</h2>
        <div class="row" style="gap:8px"><span class="muted">{{ t('server') }}</span><code class="mono">{{ server || t('unknown') }}</code></div>
        <div class="row" style="gap:8px"><span class="muted">{{ t('version') }}</span><code class="mono">{{ version }}</code></div>
        <div class="row" style="gap:8px"><span class="muted">{{ t('build') }}</span><code class="mono">{{ build }}</code></div>
      </section>

      <section class="card stack upgrade-card" data-testid="upgrade-card">
        <div class="row" style="justify-content:space-between;gap:8px">
          <h2 class="card-title">{{ t('upgradeTitle') }}</h2>
          <span class="chip" :class="upgrade?.status === 'available' ? 'chip-on' : ''">
            {{ t('upgradeSource') }} · {{ upgradeSourceLabel() }}
          </span>
        </div>

        <p class="upgrade-state" role="status" aria-live="polite">{{ upgradeStatusText() }}</p>
        <p v-if="upgradeError" class="muted" style="font-size:11px">
          {{ t('upgradeFailed') }} <code class="mono">{{ upgradeError }}</code>
        </p>
        <div v-if="upgradeBusy" class="upgrade-progress" role="progressbar" :aria-valuetext="t('upgradeBusy')"><span></span></div>

        <div class="row" style="gap:8px"><span class="muted">{{ t('upgradeCurrent') }}</span><code class="mono">{{ currentVersionText() }}</code></div>
        <div v-if="upgrade?.latestVersion" class="row" style="gap:8px"><span class="muted">{{ t('upgradeLatest') }}</span><code class="mono">{{ upgrade.latestVersion }}</code></div>
        <div class="row" style="gap:8px"><span class="muted">{{ t('upgradeChecked') }}</span><code class="mono">{{ checkedAtText() }}</code></div>

        <p v-if="upgrade?.notes" class="upgrade-notes muted">{{ upgrade.notes }}</p>

        <div v-if="canInstall()" class="row row-wrap" style="gap:8px">
          <button class="btn btn-sm" :disabled="upgradeBusy" @click="runInstall">{{ t('upgradeUpgrade') }}</button>
          <button class="btn btn-sm btn-ghost" :disabled="upgradeBusy" @click="skipUpgrade">{{ t('upgradeSkip') }}</button>
        </div>

        <label class="switch">
          <input type="checkbox" v-model="upgradeAuto" @change="save" />
          <span>{{ t('upgradeAuto') }}</span>
        </label>

        <div class="row row-wrap" style="gap:8px;align-items:center">
          <button class="btn btn-sm" :disabled="upgradeBusy" @click="runCheck">{{ t('upgradeCheck') }}</button>
          <a class="btn btn-sm btn-ghost upgrade-link" :href="releaseHref()" target="_blank" rel="noopener noreferrer">{{ t('upgradeDownload') }}</a>
        </div>
      </section>
    </div>

    <div class="banner muted"><span>{{ t('changed') }}</span></div>

    <button class="btn btn-ghost" @click="reset">{{ t('reset') }}</button>
  </div>
</template>
