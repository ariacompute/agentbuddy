// A real node:http server on an ephemeral loopback port. The desktop proxy
// forwards /api /a2a /healthz /.well-known here, while the specs talk to the
// /__e2e/* control plane directly (those paths are not a proxy prefix).
import http from 'node:http'
import { createState } from './state.mjs'
import { control, parseCookies, route } from './routes.mjs'
import { openSse, closeAllSse } from './sse.mjs'
import { recordRequest } from './state.mjs'

const MAX_BODY = 40 * 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('stub request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function writeJson(res, status, value, headers = {}) {
  const text = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
    ...headers,
  })
  res.end(text)
}

function writeEmpty(res, status, headers = {}) {
  res.writeHead(status, headers)
  res.end()
}

/**
 * Starts the stub. `port=0` picks a free port so parallel runs cannot clash.
 * Returns the state object too, so an in-process contract spec can assert on
 * fixtures without going through HTTP.
 */
export function startStub({ port = 0, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const state = createState()
    const server = http.createServer(async (req, res) => {
      let status = 200
      try {
        const url = new URL(req.url || '/', `http://${host}`)
        const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req)
        const cookies = parseCookies(req.headers.cookie)
        const ctx = {
          method: req.method,
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
          cookies,
          signedIn: cookies.ab_session === 'e2e-session' && state.sessions.has('e2e-session'),
        }
        const isControl = ctx.path === '/__e2e' || ctx.path.startsWith('/__e2e/')
        const result = isControl ? control(state, ctx) : route(state, ctx)

        if (result.drop) {
          req.destroy()
          return
        }
        if (result.delay) {
          await new Promise((done) => setTimeout(done, result.delay))
          if (res.writableEnded || res.destroyed) return
          writeJson(res, 200, {})
          status = 200
        } else if (result.sse) {
          status = 200
          openSse(state, result.sse.channel, req, res, result.sse.since, result.sse.defaultEvent)
        } else if (result.raw !== undefined) {
          status = result.status || 200
          res.writeHead(status, result.headers || {})
          res.end(result.raw)
        } else if (result.status === 204 || result.body === '') {
          status = 204
          writeEmpty(res, 204, result.headers || {})
        } else {
          status = result.status || 200
          writeJson(res, status, result.json === undefined ? {} : result.json, result.headers || {})
        }
      } catch (error) {
        status = 500
        if (!res.writableEnded && !res.destroyed) writeJson(res, 500, { code: 'internal_error', detail: error.message })
      } finally {
        if (req.url) recordRequest(state, { method: req.method, url: req.url }, status)
      }
    })
    server.once('error', reject)
    server.listen(port, host, () => {
      const actual = server.address().port
      const url = `http://${host}:${actual}`
      resolve({
        url,
        port: actual,
        state,
        close: () => new Promise((done) => {
          closeAllSse(state)
          server.closeAllConnections?.()
          server.close(() => done())
        }),
      })
    })
  })
}
