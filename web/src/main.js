import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router.js'
import { setLang, detectLang } from './lib/use-copy.js'

// Apply the persisted language before the first paint-driven render. This file is
// the browser entry point (index.html loads it as a module), so `window` is a
// given: a `typeof window` guard here would add a branch that no browser takes and
// that therefore could never be covered — the reason this file used to sit outside
// the coverage gate altogether.
setLang(detectLang(window.location.search, window.localStorage))

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
