<script setup>
import { useLang, setLang, useCopy } from '../lib/use-copy.js'
import { LANGUAGES } from '../lib/languages.js'

const lang = useLang()
const { t } = useCopy('shell')

function onChange(e) {
  setLang(e.target.value)
}
</script>

<template>
  <select class="lang-select" :value="lang" @change="onChange" :aria-label="t('langLabel')">
    <option v-for="l in LANGUAGES" :key="l[0]" :value="l[0]">{{ l[1] }}</option>
  </select>
</template>

<style scoped>
.lang-select {
  min-height: 34px;
  width: auto;
}
</style>
