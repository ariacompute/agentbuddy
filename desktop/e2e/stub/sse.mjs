// Server-sent events, with the `since=<seq>` replay the workbench uses to
// recover after a dropped stream. Frames are stored per channel so a reconnect
// only replays what the client missed, not the entire history.
const KEEPALIVE_MS = 15_000

function channelEvents(state, channel) {
  if (!state.sse.events.has(channel)) state.sse.events.set(channel, [])
  return state.sse.events.get(channel)
}

function frame(event, data, id) {
  const lines = []
  if (id !== undefined) lines.push(`id: ${id}`)
  if (event && event !== 'message') lines.push(`event: ${event}`)
  lines.push(`data: ${JSON.stringify(data)}`)
  return `${lines.join('\n')}\n\n`
}

/** Opens one long-lived EventSource response and replays frames after `since`. */
export function openSse(state, channel, req, res, since = 0, defaultEvent = 'message') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')

  for (const item of channelEvents(state, channel)) {
    if (item.seq > since) res.write(frame(item.event, item.data, item.seq))
  }

  const client = { channel, res, defaultEvent, timer: null }
  state.sse.clients.add(client)
  client.timer = setInterval(() => {
    try { res.write(': keep-alive\n\n') } catch { closeClient(state, client) }
  }, KEEPALIVE_MS)
  client.timer.unref?.()

  const onClose = () => {
    closeClient(state, client)
    // An EventSource that loses its socket reconnects with `since`; the stored
    // frames are what make that replay observable from the UI.
  }
  req.on('close', onClose)
  res.on('close', onClose)
  res.on('error', onClose)
  return client
}

export function closeClient(state, client) {
  if (client.closed) return
  client.closed = true
  if (client.timer) clearInterval(client.timer)
  state.sse.clients.delete(client)
}

/** Appends a frame to a channel and pushes it to every live subscriber. */
export function pushEvent(state, channel, event, data) {
  state.sse.seq += 1
  const item = { seq: state.sse.seq, event: event || 'message', data }
  channelEvents(state, channel).push(item)
  for (const client of [...state.sse.clients]) {
    if (client.channel !== channel) continue
    try { client.res.write(frame(item.event, item.data, item.seq)) } catch { closeClient(state, client) }
  }
  return item
}

export function closeAllSse(state) {
  for (const client of [...state.sse.clients]) {
    closeClient(state, client)
    try { client.res.end() } catch { /* already gone */ }
  }
  state.sse.clients.clear()
}
