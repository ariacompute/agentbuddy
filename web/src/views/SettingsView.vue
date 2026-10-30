<script setup>
import { ref, onMounted } from 'vue'
import { useCopy, useLang, setLang } from '../lib/use-copy.js'
import { LANGUAGES } from '../lib/languages.js'
import { checkHealth, request } from '../lib/api.js'

const { t } = useCopy('settings')
const lang = useLang()

const KEY = 'agentbuddy.settings'
const background = ref(true)
const notify = ref(true)
const quiet = ref(0)
const voiceInput = ref(true)
const themeLight = ref(false)
const server = ref('')
const version = ref('')
const build = ref('')

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
  try {
    const cfg = await request('/__shell/config')
    background.value = cfg.background ?? true
    notify.value = cfg.notifyEnabled ?? true
    quiet.value = cfg.notifyQuietMinutes ?? 0
  } catch (e) {
    const saved = readLocal()
    background.value = saved.background ?? true
    notify.value = saved.notify ?? true
    quiet.value = saved.quiet ?? 0
  }
  const local = readLocal()
  voiceInput.value = local.voiceInput ?? true
  themeLight.value = local.theme !== 'dark'
  try {
    const h = await checkHealth()
    server.value = h.server || ''
    version.value = h.version || t('unknown')
    build.value = h.commit || t('unknown')
  } catch (e) { /* ignore */ }
})

function saveLocal() {
  const local = readLocal()
  local.theme = themeLight.value ? 'light' : 'dark'
  local.voiceInput = voiceInput.value
  // Mirror the shell-managed flags so the dev fallback reflects the latest choice.
  local.background = background.value
  local.notify = notify.value
  local.quiet = quiet.value
  window.localStorage.setItem(KEY, JSON.stringify(local))
}

async function save() {
  saveLocal()
  try {
    await request('/__shell/config', {
      method: 'POST',
      body: JSON.stringify({
        background: background.value,
        notify_enabled: notify.value,
        notify_quiet_minutes: quiet.value,
      }),
    })
  } catch (e) { /* not running inside the desktop shell */ }
}

function reset() {
  if (!window.confirm(t('resetConfirm'))) return
  background.value = true
  notify.value = true
  quiet.value = 0
  voiceInput.value = true
  themeLight.value = true
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
        <h2 class="card-title">{{ t('connection') }}</h2>
        <div class="row" style="gap:8px"><span class="muted">{{ t('server') }}</span><code class="mono">{{ server || t('unknown') }}</code></div>
        <div class="row" style="gap:8px"><span class="muted">{{ t('version') }}</span><code class="mono">{{ version }}</code></div>
        <div class="row" style="gap:8px"><span class="muted">{{ t('build') }}</span><code class="mono">{{ build }}</code></div>
      </section>
    </div>

    <div class="banner muted"><span>{{ t('changed') }}</span></div>

    <button class="btn btn-ghost" @click="reset">{{ t('reset') }}</button>
  </div>
</template>
