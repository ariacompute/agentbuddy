<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../lib/auth-store.js'
import { useCopy } from '../lib/use-copy.js'
import { errorMessage } from '../lib/errors.js'
import BrandMark from '../components/BrandMark.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import ThemeToggle from '../components/ThemeToggle.vue'

const { t } = useCopy('shell')
const auth = useAuthStore()
const router = useRouter()

const mode = ref('signin')
const email = ref('')
const password = ref('')
const confirm = ref('')
const displayName = ref('')
const errorCode = ref(null)
// The desktop shell stamps its own version (`vX.Y.Z@<7-char commit>`) into
// index.html at request time; in a plain web build the global is absent and the
// footer simply stays hidden.
const appVersion = ref('')

const canSubmit = computed(() => {
  if (!email.value || !password.value) return false
  if (mode.value === 'signup') return confirm.value === password.value && displayName.value.length > 0
  return true
})

async function submit() {
  errorCode.value = null
  const res = mode.value === 'signup'
    ? await auth.register(email.value, password.value, displayName.value)
    : await auth.login(email.value, password.value)
  if (res.ok) router.push('/')
  else errorCode.value = res.code
}

onMounted(() => {
  auth.loadConfig()
  appVersion.value = window.__AGENTBUDDY_VERSION__ || ''
})
</script>

<template>
  <div class="login-shell">
    <div class="login-head">
      <LanguageSwitcher />
      <ThemeToggle />
    </div>
    <div class="login-card card">
      <div class="login-brand">
        <BrandMark :size="44" />
        <div>
          <h1 style="font-size:20px">{{ t('loginTitle') }}</h1>
          <p class="tag muted">{{ t('loginSubtitle') }}</p>
        </div>
      </div>

      <form class="stack" @submit.prevent="submit">
        <div v-if="mode === 'signup'" class="field">
          <label>{{ t('loginName') }}</label>
          <input type="text" v-model="displayName" autocomplete="name" />
        </div>
        <div class="field">
          <label>{{ t('loginEmail') }}</label>
          <input type="email" v-model="email" autocomplete="email" />
        </div>
        <div class="field">
          <label>{{ t('loginPassword') }}</label>
          <input type="password" v-model="password" autocomplete="current-password" />
        </div>
        <div v-if="mode === 'signup'" class="field">
          <label>{{ t('loginConfirm') }}</label>
          <input type="password" v-model="confirm" autocomplete="new-password" />
        </div>

        <div v-if="errorCode" class="banner">
          <span>{{ errorMessage(errorCode) }}</span>
        </div>

        <button class="btn btn-primary" type="submit" :disabled="!canSubmit || auth.busy">
          {{ mode === 'signup' ? t('loginSignUp') : t('loginSignIn') }}
        </button>
      </form>

      <div class="divider">{{ t('loginOAuth') }}</div>

      <div class="oauth-row">
        <button
          v-for="p in auth.oauthProviders"
          :key="p.id"
          class="btn btn-ghost"
          @click="window.open(p.url, '_self')"
        >
          {{ p.name }}
        </button>
        <p v-if="auth.oauthProviders.length === 0" class="muted" style="font-size:12px;text-align:center">
          —
        </p>
      </div>

      <button class="btn btn-ghost btn-sm" @click="mode = mode === 'signup' ? 'signin' : 'signup'">
        {{ mode === 'signup' ? t('loginToggleSignIn') : t('loginToggleSignUp') }}
      </button>
    </div>

    <div class="login-version" v-if="appVersion">{{ appVersion }}</div>
  </div>
</template>
