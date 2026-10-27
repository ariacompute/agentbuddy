import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router.js'
import { setLang, detectLang } from './lib/use-copy.js'

// Apply persisted language before the first paint-driven render.
const lang = detectLang(
  typeof window !== 'undefined' ? window.location.search : '',
  typeof window !== 'undefined' ? window.localStorage : null,
)
setLang(lang)

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
