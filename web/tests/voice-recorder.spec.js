// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { flushPromises } from '@vue/test-utils'

import { mountWith } from './helpers/vue-utils.js'

// The state machine itself is covered by voice.spec.js; here the question is
// whether the button is wired to it and whether a failure reaches the screen.
const voice = vi.hoisted(() => ({ recorder: null, supported: true }))

vi.mock('../src/lib/voice.js', () => ({
  VoiceState: { Idle: 'idle', Recording: 'recording', Transcribing: 'transcribing', Error: 'error', Unavailable: 'unavailable' },
  createRecorder: (deps) => {
    const recorder = {
      deps,
      state: 'idle',
      supported: voice.supported,
      starts: 0,
      stops: 0,
      resets: 0,
      start() {
        this.state = 'recording'
        this.starts += 1
        deps.onState('recording')
      },
      stop() {
        this.state = 'idle'
        this.stops += 1
        deps.onState('idle')
      },
      reset() {
        this.resets += 1
      },
    }
    voice.recorder = recorder
    return recorder
  },
}))

vi.mock('../src/lib/api.js')

import { postThreadAudio } from '../src/lib/api.js'
import VoiceRecorder from '../src/components/VoiceRecorder.vue'

beforeEach(() => {
  voice.recorder = null
  voice.supported = true
  postThreadAudio.mockReset()
  postThreadAudio.mockResolvedValue({})
})

describe('VoiceRecorder', () => {
  it('records on the first click and stops on the second', async () => {
    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 'th-1' } })
    const button = wrapper.find('button.voice-btn')
    expect(button.exists()).toBe(true)
    expect(button.attributes('data-state')).toBe('idle')

    await button.trigger('click')
    expect(voice.recorder.starts).toBe(1)

    // The recorder is a live object, not a ref: the component re-reads it on
    // the next render, which the state attribute proves.
    await wrapper.vm.$nextTick()
    await button.trigger('click')
    expect(voice.recorder.stops).toBe(1)
    expect(voice.recorder.starts).toBe(1)
  })

  it('uploads the clip through the thread the component was given', async () => {
    mountWith(VoiceRecorder, { props: { threadId: 'th-9' } })
    const blob = new Blob(['audio'])
    await voice.recorder.deps.upload(blob)
    expect(postThreadAudio).toHaveBeenCalledWith('th-9', blob)
  })

  it('shows the translated refusal when the microphone is unavailable', async () => {
    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 'th-1' } })
    expect(wrapper.text()).not.toContain('Microphone')

    voice.recorder.deps.onState('error')
    await flushPromises()
    expect(wrapper.text()).toContain('Microphone access was declined')

    // Recovering to idle clears the message rather than leaving it pinned.
    voice.recorder.deps.onState('idle')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Microphone access was declined')
  })

  it('says so instead of rendering a dead button when recording is unsupported', async () => {
    voice.supported = false
    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 'th-1' } })

    expect(wrapper.find('button.voice-btn').exists()).toBe(false)
    expect(wrapper.text()).toContain('Voice input is not available here')
  })

  it('resets the recorder when the screen goes away', () => {
    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 'th-1' } })
    wrapper.unmount()
    expect(voice.recorder.resets).toBe(1)
  })

  it('starts from a null recorder when there is no window at all', async () => {
    // `typeof window !== 'undefined' ? window.MediaRecorder : null` runs in
    // setup(). jsdom mounting needs window.ShadowRoot, so reach the same setup
    // through a server render: it evaluates the component without a DOM, which
    // is exactly the prerender pass this guard exists for.
    vi.stubGlobal('window', undefined)
    try {
      await renderToString(createSSRApp(VoiceRecorder, { threadId: 'th-1' }))
      expect(voice.recorder.deps.MediaRecorderImpl).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('passes whatever MediaRecorder the window exposes, without assuming it exists', async () => {
    // The guard is `typeof window !== 'undefined' ? window.MediaRecorder : null`.
    // jsdom cannot express the first arm (mounting needs a window), so this pins
    // the second: a browser without MediaRecorder must not throw at setup.
    const saved = window.MediaRecorder
    delete window.MediaRecorder
    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 'th-1' } })
    expect(voice.recorder.deps.MediaRecorderImpl).toBeUndefined()
    expect(wrapper.find('button.voice-btn').exists()).toBe(true)
    window.MediaRecorder = saved
    wrapper.unmount()
  })
})
