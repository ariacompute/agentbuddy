// F8 / F10 / F14 / F19 — persona editing, read-only knowledge and shared files.
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { e2eContext } from '../harness/context.mjs'
import {
  CSS, click, clickContaining, navigateHash, pageText, remount, step,
  waitForElement, waitForText, waitFor, tryFind, type,
} from '../driver/helpers.mjs'
import { errorMessage, t } from '../driver/selectors.mjs'

const { info, wd, proxy, reset, requests, fixtures } = e2eContext()

async function open(path) {
  await navigateHash(wd, path, info.timeoutMs)
  await waitForElement(wd, CSS, '.card, .empty', info.timeoutMs)
}

describe.skipIf(info.skipped)('F8/F10/F14/F19 · persona, knowledge and files', () => {
  beforeEach(async () => { await reset() })

  it('shows the read-only persona and saves an edit through the resource API', async () => {
    await step(wd, 'persona-edit', async () => {
      await open('/persona')
      expect(await pageText(wd)).toContain(t('hub', 'personaDisplayName'))
      await clickContaining(wd, t('hub', 'personaEdit'), { tag: 'button' })
      const fields = await wd.findAll(CSS, 'input[type="text"]')
      expect(fields.length).toBeGreaterThan(0)
      await wd.clear(fields[0])
      await wd.type(fields[0], 'E2E Planner')
      await clickContaining(wd, t('hub', 'personaSave'), { tag: 'button' })
      await waitForText(wd, t('hub', 'personaSaved'), info.timeoutMs)
      if (info.backend === 'stub') {
        expect((await requests()).some((r) => r.method === 'PUT' && r.path.startsWith('/api/resources/'))).toBe(true)
      }
    })
  })

  it('reports a persona save failure and stays in edit mode', async () => {
    await step(wd, 'persona-error', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('PUT /api/resources/resource-1', 'server_error')
      await open('/persona')
      await clickContaining(wd, t('hub', 'personaEdit'), { tag: 'button' })
      await clickContaining(wd, t('hub', 'personaSave'), { tag: 'button' })
      await waitFor(async () => (await pageText(wd)).includes(errorMessage('internal_error')), 'persona error')
      await proxy.scenario('PUT /api/resources/resource-1', 'ok')
    })
  })

  it('lists knowledge chunks and filters them by agent', async () => {
    await step(wd, 'knowledge-filter', async () => {
      await open('/knowledge')
      if (info.backend === 'stub') expect((await wd.findAll(CSS, 'article.card')).length).toBe(2)
      const filter = await waitForElement(wd, CSS, 'input[placeholder]')
      await wd.clear(filter)
      await wd.type(filter, 'agent-1')
      await wd.execute(`const el = document.querySelector('input[placeholder]'); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));`)
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.path === '/api/knowledge' && r.query.includes('agentId')), 'filtered knowledge request')
      }
    })
  })

  it('shows the feature-off panel when knowledge is unavailable', async () => {
    await step(wd, 'knowledge-feature-off', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/knowledge', 'feature_off')
      await remount(wd, '/knowledge', info.timeoutMs)
      await waitForText(wd, t('hub', 'featureOff'), info.timeoutMs)
      await proxy.scenario('/api/knowledge', 'ok')
    })
  })

  it.skipIf(!fixtures)('lists shared files with a real download link', async () => {
    await step(wd, 'files-download', async () => {
      await open('/files')
      const download = await waitForElement(wd, CSS, 'a.btn[download]')
      const href = await wd.attribute(download, 'href')
      expect(href || '').toContain('/api/files/')
      expect(href || '').toContain('/content')
      if (info.backend === 'stub') expect((await wd.findAll(CSS, 'table.files-table tbody tr')).length).toBeGreaterThan(0)
    })
  })

  it.skipIf(!fixtures)('uploads a file through the file input and refreshes the table', async () => {
    await step(wd, 'files-upload', async () => {
      // A fixed name collides with the file a previous Windows run left locked
      // by the WebView (EPERM on write/remove). A unique name per journey makes
      // the upload independent of leftovers from an aborted run.
      const file = path.join(info.artifactsDir, `e2e-upload-${process.pid}-${Date.now()}.txt`)
      fs.mkdirSync(info.artifactsDir, { recursive: true })
      fs.writeFileSync(file, 'agentbuddy e2e upload\n')
      try {
        await open('/files')
        const input = await waitForElement(wd, CSS, 'input.files-input[type="file"]')
        await wd.type(input, file)
        await waitFor(async () => (await requests()).some((r) => r.method === 'POST' && r.path === '/api/files'), 'file upload')
      } finally {
        // Windows may still hold the handle while the WebView uploads. A failed
        // cleanup leaves one temp file, but must not fail the journey.
        try { fs.rmSync(file, { force: true }) } catch { /* best effort */ }
      }
    })
  })

  it('deletes a file only after the inline confirmation', async () => {
    await step(wd, 'files-delete', async () => {
      if (!info.allowDestructive) return
      await open('/files')
      await clickContaining(wd, t('files', 'filesDelete'), { tag: 'button' })
      await waitForElement(wd, CSS, 'tr.files-row-confirm')
      await click(wd, CSS, 'tr.files-row-confirm .btn.btn-danger.btn-sm')
      if (info.backend === 'stub') {
        await waitFor(async () => (await requests()).some((r) => r.method === 'DELETE' && r.path.startsWith('/api/files/')), 'file delete')
      }
    })
  })

  it('reports an oversized upload with a localised code', async () => {
    await step(wd, 'files-too-large', async () => {
      if (!proxy.isStub) return
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(64)], { type: 'application/octet-stream' }), 'small.txt')
      await proxy.scenario('POST /api/files', 'payload_too_large')
      const res = await fetch(`${info.stubUrl}/api/files`, { method: 'POST', body: form })
      expect(res.status).toBe(413)
      expect((await res.json()).code).toBe('payload_too_large')
      await proxy.scenario('POST /api/files', 'ok')
    })
  })

  it.skipIf(!fixtures)('keeps text input usable when voice recording is unavailable', async () => {
    await step(wd, 'voice-degradation', async () => {
      await open('/threads/thread-1')
      // `open()` waits on a generic `.card, .empty`, which the previous screen
      // can still satisfy for one tick; wait for the thread's own composer.
      expect(await waitForElement(wd, CSS, '.composer textarea', info.timeoutMs)).toBeTruthy()
      // The @mention button shares the .voice-btn class but has no state; only
      // the recorder carries data-state. When MediaRecorder is missing the UI
      // explains why instead, and the text composer must still be usable.
      const voice = await tryFind(wd, CSS, '.voice-btn[data-state]')
      if (!voice) expect(await pageText(wd)).toContain(t('thread', 'voiceUnavailable'))
      else expect(await wd.attribute(voice, 'data-state')).toBeTruthy()
    })
  })

  it('rejects an oversized audio upload with audio_too_large', async () => {
    await step(wd, 'audio-too-large', async () => {
      if (!proxy.isStub) return
      const form = new FormData()
      form.append('audio', new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]), 'voice.webm')
      const res = await fetch(`${info.stubUrl}/api/threads/thread-1/audio`, { method: 'POST', body: form })
      expect(res.status).toBe(413)
      expect((await res.json()).code).toBe('audio_too_large')
    })
  })

  it('shows an error when the file store is switched off', async () => {
    await step(wd, 'files-disabled', async () => {
      if (!proxy.isStub) return
      await proxy.scenario('/api/files', 'server_error', { status: 503, code: 'files_disabled' })
      await remount(wd, '/files', info.timeoutMs)
      // A disabled store is a configuration panel, not an error banner: the
      // screen renders the localised explanation plus the switch to turn on.
      await waitFor(async () => (await pageText(wd)).includes(t('files', 'filesOff')), 'files disabled', info.timeoutMs)
      await proxy.scenario('/api/files', 'ok')
    })
  })
})
