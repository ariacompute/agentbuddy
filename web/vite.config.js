import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The workbench only ever speaks relative URLs (BASE = '' in lib/api.js), so dev
// needs a proxy to the agenthub server. VITE_PROXY_TARGET lets a compose dev
// server reach it by service name; a local `bun run dev` keeps the default.
const target = process.env.VITE_PROXY_TARGET || 'http://localhost:3500'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': target,
      '/a2a': target,
      '/healthz': target,
      '/.well-known': target,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['tests/**/*.spec.js'] },
})
