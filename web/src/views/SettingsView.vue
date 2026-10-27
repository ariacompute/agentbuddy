<script setup>
import { ref, onMounted } from 'vue'
import { useCopy, useLang, setLang } from '../lib/use-copy.js'
import { LANGUAGES } from '../lib/languages.js'
import { checkHealth } from '../lib/api.js'

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

onMounted(async () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}')
    background.value = saved.background ?? true
    notify.value = saved.notify ?? true
    quiet.value = saved.quiet ?? 0
    voiceInput.value = saved.voiceInput ?? true
    themeLight.value = saved.theme === 'light'
  } catch (e) { /* ignore */ }
  try {
    const h = await checkHealth()
    server.value = h.server || ''
    version.value = h.version || t('unknown')
    build.value = h.commit || t('unknown')
  } catch (e) { /* ignore */ }
})

function save() {
  window.localStorage.setItem(KEY, JSON.stringify({
    background: background.value,
    notify: notify.value,
    quiet: quiet.value,
    voiceInput: voiceInput.value,
    theme: themeLight.value ? 'light' : 'dark',
  }))
}

function reset() {
  if (!window.confirm(t('resetConfirm'))) return
  background.value = true
  notify.value = true
  quiet.value = 0
  voiceInput.value = true
  themeLight.value = false
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
