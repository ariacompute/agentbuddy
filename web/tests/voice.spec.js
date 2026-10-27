import { describe, it, expect, vi } from 'vitest'
import {
  VoiceState,
  nextState,
  canRecord,
  isBusy,
  createRecorder,
} from '../src/lib/voice.js'

describe('voice nextState', () => {
  it('transitions idle -> recording on start', () => {
    expect(nextState(VoiceState.Idle, 'start')).toBe(VoiceState.Recording)
  })
  it('transitions recording -> transcribing on stop', () => {
    expect(nextState(VoiceState.Recording, 'stop')).toBe(VoiceState.Transcribing)
  })
  it('transitions transcribing -> idle on done', () => {
    expect(nextState(VoiceState.Transcribing, 'done')).toBe(VoiceState.Idle)
  })
  it('handles errors and unavailable detours', () => {
    expect(nextState(VoiceState.Recording, 'fail')).toBe(VoiceState.Error)
    expect(nextState(VoiceState.Idle, 'unavailable')).toBe(VoiceState.Unavailable)
  })
  it('ignores unknown events and stays put', () => {
    expect(nextState(VoiceState.Idle, 'nope')).toBe(VoiceState.Idle)
  })
})

describe('voice guards', () => {
  it('canRecord only from idle', () => {
    expect(canRecord(VoiceState.Idle)).toBe(true)
    expect(canRecord(VoiceState.Recording)).toBe(false)
  })
  it('isBusy while recording or transcribing', () => {
    expect(isBusy(VoiceState.Recording)).toBe(true)
    expect(isBusy(VoiceState.Transcribing)).toBe(true)
    expect(isBusy(VoiceState.Idle)).toBe(false)
  })
})

function makeMocks() {
  const stream = { getTracks: () => [{ stop: vi.fn() }] }
  const recorder = {
    mimeType: 'audio/webm',
    start: vi.fn(),
    stop: vi.fn(function () {
      if (recorder.onstop) recorder.onstop()
    }),
  }
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  const MediaRecorderImpl = function () { return recorder }
  const upload = vi.fn().mockResolvedValue(undefined)
  const onState = vi.fn()
  return { stream, recorder, getUserMedia, MediaRecorderImpl, upload, onState }
}

function flush() {
  return new Promise((r) => setTimeout(r, 10))
}

describe('createRecorder', () => {
  it('records, uploads, and returns to idle', async () => {
    const m = makeMocks()
    const rec = createRecorder(m)
    expect(rec.supported).toBe(true)
    rec.start()
    await flush()
    expect(m.getUserMedia).toHaveBeenCalled()
    expect(m.recorder.start).toHaveBeenCalled()
    expect(rec.state).toBe(VoiceState.Recording)
    rec.stop()
    await flush()
    expect(m.upload).toHaveBeenCalled()
    expect(rec.state).toBe(VoiceState.Idle)
    expect(m.onState).toHaveBeenLastCalledWith(VoiceState.Idle, expect.objectContaining({ ok: true }))
  })

  it('reports unavailable when the browser APIs are missing', () => {
    const rec = createRecorder({})
    expect(rec.supported).toBe(false)
    expect(rec.state).toBe(VoiceState.Unavailable)
  })

  it('goes to error if upload fails', async () => {
    const m = makeMocks()
    m.upload = vi.fn().mockRejectedValue(new Error('nope'))
    const rec = createRecorder(m)
    rec.start()
    await flush()
    rec.stop()
    await flush()
    expect(rec.state).toBe(VoiceState.Error)
  })
})
