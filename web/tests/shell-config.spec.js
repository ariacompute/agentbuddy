import { describe, it, expect, vi, afterEach } from 'vitest'
import { pushShellConfig, SHELL_CONFIG_PATH } from '../src/lib/shell-config.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pushShellConfig', () => {
  it('posts one patch of preferences to the shell config', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    pushShellConfig({ lang: 'zh', theme: 'dark' })

    expect(SHELL_CONFIG_PATH).toBe('/__shell/config')
    expect(fetchMock).toHaveBeenCalledWith('/__shell/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'zh', theme: 'dark' }),
    })
  })

  it('swallows a refusal: a browser build has no /__shell at all', async () => {
    // Fire-and-forget is the contract: the caller has already applied the
    // change, so a 404 (plain `bun run dev`) or a shutting-down shell must not
    // surface as an unhandled rejection.
    const fetchMock = vi.fn().mockRejectedValue(new Error('404'))
    vi.stubGlobal('fetch', fetchMock)

    expect(() => pushShellConfig({ theme: 'light' })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
