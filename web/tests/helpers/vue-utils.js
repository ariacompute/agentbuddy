// Shared helpers for mounting agentbuddy's .vue components and views under jsdom.
// Components lean on Pinia stores and the Vue Router, so every mount wires both in.
// API calls are mocked at the spec level (vi.mock('../src/lib/api.js')) so the
// workbench never reaches a real agenthub and the tests stay deterministic.
import { mount as vMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

export function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', name: 'fallback', component: { template: '<div/>' } }],
  })
}

export function mountWith(component, options = {}) {
  const pinia = createPinia()
  const router = makeRouter()
  const wrapper = vMount(component, {
    global: {
      plugins: [pinia, router],
      stubs: options.stubs || {},
    },
    attachTo: options.attachTo || document.body,
    ...stripGlobal(options),
  })
  return { wrapper, pinia, router }
}

function stripGlobal(options) {
  const { stubs, attachTo, ...rest } = options
  return rest
}
