// Voice recorder state machine. The browser glue (getUserMedia / MediaRecorder)
// is injected so the machine stays a pure, testable object with no DOM.
//
// States: idle -> recording -> transcribing -> idle, with error and unavailable
// as terminal-ish detours. The UI reads the state to decide which controls to
// show and what to disable; it never drives the machine directly.

export const VoiceState = {
  Idle: 'idle',
  Recording: 'recording',
  Transcribing: 'transcribing',
  Error: 'error',
  Unavailable: 'unavailable',
}

/** Pure transition table — the only place state changes are defined. */
export function nextState(state, event) {
  const t = {
    idle: { start: VoiceState.Recording, unavailable: VoiceState.Unavailable },
    recording: { stop: VoiceState.Transcribing, fail: VoiceState.Error, unavailable: VoiceState.Unavailable },
    transcribing: { done: VoiceState.Idle, fail: VoiceState.Error },
    error: { reset: VoiceState.Idle },
    unavailable: { reset: VoiceState.Idle },
  }
  return (t[state] && t[state][event]) || state
}

export function canRecord(state) {
  return state === VoiceState.Idle
}

export function isBusy(state) {
  return state === VoiceState.Recording || state === VoiceState.Transcribing
}

/**
 * Builds a recorder controller.
 * @param {object} deps
 * @param {() => Promise<MediaStream>} deps.getUserMedia
 * @param {typeof MediaRecorder} deps.MediaRecorderImpl
 * @param {(blob: Blob) => Promise<void>} deps.upload  sends the clip to the server
 * @param {(state: string, detail?: any) => void} deps.onState
 */
export function createRecorder({ getUserMedia, MediaRecorderImpl, upload, onState }) {
  let state = VoiceState.Idle
  let stream = null
  let recorder = null
  let chunks = []
  const supported = typeof getUserMedia === 'function' && !!MediaRecorderImpl

  if (!supported) {
    state = VoiceState.Unavailable
  }

  const setState = (next, detail) => {
    state = next
    if (onState) onState(state, detail)
  }

  function start() {
    if (!supported) {
      setState(VoiceState.Unavailable)
      return
    }
    if (state !== VoiceState.Idle) return
    getUserMedia().then((s) => {
      stream = s
      chunks = []
      recorder = new MediaRecorderImpl(stream)
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        stopStream()
        setState(VoiceState.Transcribing)
        Promise.resolve(upload(blob))
          .then(() => setState(VoiceState.Idle, { ok: true }))
          .catch((err) => { console.error('agentbuddy: voice upload failed', err); setState(VoiceState.Error, { ok: false }) })
      }
      recorder.start()
      setState(VoiceState.Recording)
    }).catch((err) => {
      console.error('agentbuddy: microphone denied', err)
      setState(VoiceState.Unavailable, { ok: false })
    })
  }

  function stopStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
  }

  function stop() {
    if (state === VoiceState.Recording && recorder) recorder.stop()
  }

  function reset() {
    stopStream()
    setState(VoiceState.Idle)
  }

  return {
    get state() { return state },
    get supported() { return supported },
    start,
    stop,
    reset,
  }
}
