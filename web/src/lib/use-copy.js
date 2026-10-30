// Locale resolution for agentbuddy.
// Rules, in priority order: ?lang= > localStorage > matchLang(navigator.language)
// > en. Resolution is a shallow merge over the English block plus English
// fallback, exactly like the aria compute family.
import { computed, ref } from 'vue'
import { isRTL, isValidLang, matchLang } from './languages.js'
import { shellCopy } from './copy/shell-copy.js'
import { workspaceCopy } from './copy/workspace-copy.js'
import { threadCopy } from './copy/thread-copy.js'
import { taskCopy } from './copy/task-copy.js'
import { orgCopy } from './copy/org-copy.js'
import { channelCopy } from './copy/channel-copy.js'
import { connectorCopy } from './copy/connector-copy.js'
import { enumsCopy } from './copy/enums-copy.js'
import { errorsCopy } from './copy/errors-copy.js'
import { settingsCopy } from './copy/settings-copy.js'

export const STORAGE_KEY = 'agentbuddy.lang'

const COPIES = {
  shell: shellCopy,
  workspace: workspaceCopy,
  thread: threadCopy,
  task: taskCopy,
  org: orgCopy,
  channel: channelCopy,
  connector: connectorCopy,
  settings: settingsCopy,
  errors: errorsCopy,
}

/** Shallow merge with English fallback. */
export function resolve(copy, lang) {
  return { ...copy.en, ...(copy[lang] || {}) }
}

/** Reads the requested language from the URL, storage or the browser. */
export function detectLang(search, storage) {
  const fromQuery = search ? new URLSearchParams(search).get('lang') : null
  if (fromQuery && isValidLang(fromQuery)) return fromQuery
  if (storage) {
    const stored = storage.getItem(STORAGE_KEY)
    if (stored && isValidLang(stored)) return stored
  }
  if (typeof navigator !== 'undefined') return matchLang(navigator.language)
  return 'en'
}

const langRef = ref(
  detectLang(
    typeof window !== 'undefined' ? window.location.search : '',
    typeof window !== 'undefined' ? window.localStorage : null,
  ),
)

/** Applies a language: persists it and mirrors it onto <html lang|dir>. */
export function setLang(next) {
  const lang = isValidLang(next) ? next : 'en'
  langRef.value = lang
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
    document.documentElement.dir = isRTL(lang) ? 'rtl' : 'ltr'
    // Keep the desktop shell's tray menu in sync with the app language.
    // agentbuddy.lang lives in browser storage, which Rust cannot read directly,
    // so the workbench pushes it to the shell config the tray is built from.
    // Fails silently outside the desktop shell (no /__shell endpoint).
    fetch('/__shell/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    }).catch(() => {})
  }
  return lang
}

/** Current language. */
export function useLang() {
  return langRef
}

/** Translation helper bound to one copy namespace. */
export function useCopy(namespace) {
  const table = computed(() => resolve(COPIES[namespace] || {}, langRef.value))
  return {
    lang: langRef,
    t: (key) => table.value[key],
    te: (key) => typeof table.value[key] === 'string' && table.value[key].length > 0,
  }
}

/** Localised label for a backend enum value; falls back to the raw value. */
export function enumLabel(group, value) {
  if (!value) return ''
  const table = resolve(enumsCopy[group] || {}, langRef.value)
  return table[value] || value
}

export function taskStateLabel(value) {
  return enumLabel('taskState', value)
}

export function kindLabel(value) {
  return enumLabel('kind', value)
}

export function healthLabel(value) {
  return enumLabel('health', value)
}
