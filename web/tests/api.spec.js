import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  request,
  ApiError,
  createChannel,
  listChannels,
  getDeliveries,
  listConnectors,
  setConnectorPolicy,
  runConnectorAction,
} from '../src/lib/api.js'

let fetchMock

function jsonResponse(obj, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    json: async () => obj,
    text: async () => (obj === null ? '' : JSON.stringify(obj)),
  }
}

const lastCall = () => {
  const calls = fetchMock.mock.calls
  return calls[calls.length - 1]
}

describe('api client', () => {
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses a JSON 200 and sends credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ a: 1 }))
    const r = await request('/api/x')
    expect(r).toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }))
  })

  it('returns null on 204 and on empty body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' })
    expect(await request('/api/x', { method: 'DELETE' })).toBeNull()
    fetchMock.mockResolvedValue(jsonResponse(null))
    expect(await request('/api/x')).toBeNull()
  })

  it('throws ApiError carrying the server code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'not_found' }, { status: 404, ok: false }))
    await expect(request('/api/x')).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('falls back to the status string when the body is unreadable', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('bad') },
      text: async () => '',
    })
    await expect(request('/api/x')).rejects.toMatchObject({ code: '500' })
  })

  it('serialises a JSON body for post and omits it when undefined', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await createChannel({ name: 'x' })
    let opts = lastCall()[1]
    expect(lastCall()[0]).toBe('/api/channels')
    expect(opts.method).toBe('POST')
    expect(opts.body).toBe(JSON.stringify({ name: 'x' }))
    expect(opts.headers['Content-Type']).toBe('application/json')

    await createChannel()
    opts = lastCall()[1]
    expect(opts.body).toBeUndefined()
  })

  it('exposes typed helpers that build the right paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await listChannels()
    expect(lastCall()[0]).toBe('/api/channels')
    await getDeliveries('c1')
    expect(lastCall()[0]).toBe('/api/channels/c1/deliveries')
    await listConnectors()
    expect(lastCall()[0]).toBe('/api/connectors')
    await setConnectorPolicy('c1', 'ask')
    expect(lastCall()[0]).toBe('/api/connectors/c1/policy')
    await runConnectorAction('c1', 'do', { a: 1 })
    expect(lastCall()[0]).toBe('/api/connectors/c1/actions')
    expect(lastCall()[1].method).toBe('POST')
  })
})

describe('ApiError', () => {
  it('carries code, status and a localised message', () => {
    const e = new ApiError('bad_request', 400)
    expect(e.code).toBe('bad_request')
    expect(e.status).toBe(400)
    expect(e.message).toBeTruthy()
  })
})
