import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from './lib/auth-store.js'
import LoginView from './views/LoginView.vue'
import WorkspaceView from './views/WorkspaceView.vue'
import ThreadListView from './views/ThreadListView.vue'
import ThreadView from './views/ThreadView.vue'
import TaskListView from './views/TaskListView.vue'
import TaskTraceView from './views/TaskTraceView.vue'
import OrgView from './views/OrgView.vue'
import ChannelsView from './views/ChannelsView.vue'
import ConnectorsView from './views/ConnectorsView.vue'
import SettingsView from './views/SettingsView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/', name: 'workbench', component: WorkspaceView },
  { path: '/threads', name: 'threads', component: ThreadListView },
  { path: '/threads/:id', name: 'thread', component: ThreadView, props: true },
  { path: '/tasks', name: 'tasks', component: TaskListView },
  { path: '/tasks/:id', name: 'task', component: TaskTraceView, props: true },
  { path: '/org', name: 'org', component: OrgView },
  { path: '/channels', name: 'channels', component: ChannelsView },
  { path: '/connectors', name: 'connectors', component: ConnectorsView },
  { path: '/settings', name: 'settings', component: SettingsView },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.signedIn && !auth.user && !auth.loggedOut) {
    await auth.refresh()
  }
  if (!to.meta.public && !auth.signedIn) return { name: 'login', query: { next: to.fullPath } }
  if (to.name === 'login' && auth.signedIn) return { name: 'workbench' }
  return true
})

export default router
