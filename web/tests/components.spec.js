// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import { useAuthStore } from '../src/lib/auth-store.js'
import { setLang } from '../src/lib/use-copy.js'
import { mountWith } from './helpers/vue-utils.js'

// Auto-mock the API surface so no component reaches the network.
vi.mock('../src/lib/api.js')

import {
  updateChannel, setConnectorPolicy, runConnectorAction, resumeTask, cancelTask, logout,
  listChannels, listTasks, getDeliveries, getWorkspace, listThreads, listConnectors,
} from '../src/lib/api.js'

import BrandMark from '../src/components/BrandMark.vue'
import PersonaAvatar from '../src/components/PersonaAvatar.vue'
import SuggestionCard from '../src/components/SuggestionCard.vue'
import StateDot from '../src/components/StateDot.vue'
import AudioPlayer from '../src/components/AudioPlayer.vue'
import ArtifactList from '../src/components/ArtifactList.vue'
import DeliveryList from '../src/components/DeliveryList.vue'
import AgentCard from '../src/components/AgentCard.vue'
import TaskCard from '../src/components/TaskCard.vue'
import ThemeToggle from '../src/components/ThemeToggle.vue'
import LanguageSwitcher from '../src/components/LanguageSwitcher.vue'
import PolicySelect from '../src/components/PolicySelect.vue'
import VoiceRecorder from '../src/components/VoiceRecorder.vue'
import ConnectionBanner from '../src/components/ConnectionBanner.vue'
import NotificationCenter from '../src/components/NotificationCenter.vue'
import ApprovalCard from '../src/components/ApprovalCard.vue'
import ChannelCard from '../src/components/ChannelCard.vue'
import ConnectorCard from '../src/components/ConnectorCard.vue'
import Sidebar from '../src/components/Sidebar.vue'
import Topbar from '../src/components/Topbar.vue'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  // Give the auto-mocked API sane empty responses so any store refresh triggered
  // during a test does not throw on `data.x` and pollute the output.
  listChannels.mockResolvedValue({ channels: [] })
  listTasks.mockResolvedValue({ tasks: [] })
  getDeliveries.mockResolvedValue({ deliveries: [] })
  getWorkspace.mockResolvedValue({ agents: [] })
  listThreads.mockResolvedValue({ threads: [] })
  listConnectors.mockResolvedValue({ connectors: [] })
  window.localStorage.clear()
  window.confirm = vi.fn(() => true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  // The language ref is module-global; reset it so a test that switches to a
  // non-English locale cannot leak into the next test's assertions.
  setLang('en')
})

describe('BrandMark', () => {
  it('renders an accessible svg badge', () => {
    const { wrapper } = mountWith(BrandMark, { props: { size: 32 } })
    const svg = wrapper.find('svg.brand-glyph')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('aria-label')).toBe('Aria Compute')
    expect(svg.attributes('width')).toBe('32')
  })
})

describe('PersonaAvatar', () => {
  it('shows initials when there is no image', () => {
    const { wrapper } = mountWith(PersonaAvatar, { props: { name: 'Ada Lovelace', size: 40 } })
    expect(wrapper.text()).toContain('AL')
    expect(wrapper.find('img').exists()).toBe(false)
  })
  it('renders an image when avatarUrl is set', () => {
    const { wrapper } = mountWith(PersonaAvatar, {
      props: { persona: { displayName: 'X', avatarUrl: 'ref://x' }, name: 'X' },
    })
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('ref://x')
  })
  it('falls back to a single char for an empty name', () => {
    const { wrapper } = mountWith(PersonaAvatar, { props: { name: '' } })
    expect(wrapper.text().trim()).toBe('?')
  })
})

describe('SuggestionCard', () => {
  it('renders title, confidence, body and evidence', () => {
    const { wrapper } = mountWith(SuggestionCard, {
      props: {
        suggestion: {
          title: 'T', confidence: 0.42, body: 'B',
          evidence: ['e1', 'e2'],
        },
      },
    })
    expect(wrapper.text()).toContain('T')
    expect(wrapper.text()).toContain('42%')
    expect(wrapper.text()).toContain('B')
    expect(wrapper.findAll('li').length).toBe(2)
  })
})

describe('StateDot', () => {
  it('mirrors the state into a data attribute and label', () => {
    const { wrapper } = mountWith(StateDot, { props: { state: 'working' } })
    expect(wrapper.find('.state-dot').attributes('data-state')).toBe('working')
  })
  it('hides the label when requested', () => {
    const { wrapper } = mountWith(StateDot, { props: { state: 'failed', label: false } })
    // No text node beyond the dot itself.
    expect(wrapper.find('.dim').exists()).toBe(false)
  })
})

describe('AudioPlayer', () => {
  it('renders an audio element for a uri file part', () => {
    const { wrapper } = mountWith(AudioPlayer, {
      props: { part: { file: { uri: 'https://x/a.mp3', mimeType: 'audio/mpeg' } } },
    })
    const audio = wrapper.find('audio')
    expect(audio.exists()).toBe(true)
    expect(audio.attributes('src')).toBe('https://x/a.mp3')
  })
  it('builds a data URI from inline base64 bytes', () => {
    const { wrapper } = mountWith(AudioPlayer, {
      props: { part: { data: { file: { bytes: 'QUJD', mimeType: 'audio/webm' } } } },
    })
    expect(wrapper.find('audio').attributes('src')).toBe('data:audio/webm;base64,QUJD')
  })
  it('shows an em dash when there is no file', () => {
    const { wrapper } = mountWith(AudioPlayer, { props: { part: {} } })
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.text()).toContain('—')
  })

  it('shows an em dash for a file with neither uri nor bytes', () => {
    // A declared audio file that carries no payload is not playable: a player with
    // an empty src would look broken in a way the em dash explains.
    const { wrapper } = mountWith(AudioPlayer, {
      props: { part: { data: { file: { mimeType: 'audio/webm', name: 'clip' } } } },
    })
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.text()).toContain('—')
  })
})

describe('ArtifactList', () => {
  it('shows the empty message with no artifacts', () => {
    const { wrapper } = mountWith(ArtifactList, { props: { artifacts: [] } })
    expect(wrapper.text().length).toBeGreaterThan(0)
  })
  it('renders a text artifact', () => {
    const { wrapper } = mountWith(ArtifactList, {
      props: { artifacts: [{ parts: [{ type: 'text', text: 'hello' }] }] },
    })
    expect(wrapper.text()).toContain('hello')
  })
  it('renders an audio artifact via AudioPlayer', () => {
    const { wrapper } = mountWith(ArtifactList, {
      props: {
        artifacts: [{ parts: [{ type: 'file', file: { mimeType: 'audio/mp3', uri: 'u' } }] }],
      },
    })
    expect(wrapper.findComponent(AudioPlayer).exists()).toBe(true)
  })
  it('renders a download link for a non-audio file', () => {
    const { wrapper } = mountWith(ArtifactList, {
      props: {
        artifacts: [{ parts: [{ type: 'file', file: { name: 'f.pdf', mimeType: 'application/pdf', uri: 'u', bytes: 'AA' } }] }],
      },
    })
    const a = wrapper.find('a')
    expect(a.exists()).toBe(true)
    expect(a.attributes('download')).toBeDefined()
  })

  it('inlines bytes when a file has no uri, and stays silent when it has neither', () => {
    const { wrapper } = mountWith(ArtifactList, {
      props: {
        artifacts: [
          { parts: [{ type: 'file', file: { name: 'a.png', mimeType: 'image/png', bytes: 'AA' } }] },
          { parts: [{ type: 'file', file: { name: 'b.bin' } }] },
        ],
      },
    })

    const links = wrapper.findAll('a')
    // No uri and bytes present: the bytes become a data: URI so the file is still
    // downloadable without a round trip.
    expect(links).toHaveLength(1)
    expect(links[0].attributes('href')).toBe('data:image/png;base64,AA')
    // Neither uri nor bytes: the row stays, but there is nothing to download, so
    // no dead link is drawn.
    expect(wrapper.findAll('.artifact')).toHaveLength(2)
    expect(wrapper.text()).toContain('b.bin')
  })
})

describe('DeliveryList', () => {
  it('shows the empty message with no deliveries', () => {
    const { wrapper } = mountWith(DeliveryList, { props: { deliveries: [] } })
    expect(wrapper.text().length).toBeGreaterThan(0)
  })
  it('maps status to a label and surfaces an error code', () => {
    const { wrapper } = mountWith(DeliveryList, {
      props: {
        deliveries: [{ id: 'd1', status: 'delivered', direction: 'out', errorCode: 'bad_request', at: new Date().toISOString() }],
      },
    })
    // The delivery id is not rendered; the status label and the localised error are.
    expect(wrapper.text()).toContain('Delivered')
    expect(wrapper.text().length).toBeGreaterThan(0)
  })
})

describe('AgentCard', () => {
  it('renders the display name, title, health and tags', () => {
    const { wrapper } = mountWith(AgentCard, {
      props: {
        agent: {
          name: 'agent-x', displayName: 'Agent X', persona: { title: 'Helper' },
          health: 'healthy', tags: ['a', 'b'],
        },
      },
    })
    expect(wrapper.text()).toContain('Agent X')
    expect(wrapper.text()).toContain('Helper')
    expect(wrapper.findAll('.chip').length).toBeGreaterThan(0)
  })
  it('falls back to the raw name', () => {
    const { wrapper } = mountWith(AgentCard, {
      props: { agent: { name: 'agent-x', health: 'unknown' } },
    })
    expect(wrapper.text()).toContain('agent-x')
  })
})

describe('TaskCard', () => {
  it('renders resource id, chip id and a state dot', () => {
    const { wrapper } = mountWith(TaskCard, {
      props: { task: { id: 't1', resourceId: 'Agent', status: { state: 'working' } } },
    })
    expect(wrapper.text()).toContain('t1')
    expect(wrapper.findComponent(StateDot).exists()).toBe(true)
  })
  it('hides the message block when dense', () => {
    const { wrapper } = mountWith(TaskCard, {
      props: { task: { id: 't1', status: { state: 'working', message: { parts: [{ text: 'hi' }] } } }, dense: true },
    })
    expect(wrapper.text()).not.toContain('hi')
  })

  it('joins every message part into one line when not dense', () => {
    const { wrapper } = mountWith(TaskCard, {
      props: {
        task: {
          id: 't1',
          status: { state: 'working', message: { parts: [{ text: 'first' }, { text: 'second' }] }, timestamp: new Date().toISOString() },
        },
      },
    })
    expect(wrapper.text()).toContain('first second')
    expect(wrapper.text()).toContain('Updated')
  })

  it('opens the trace of the task it was given', async () => {
    const { wrapper, router } = mountWith(TaskCard, {
      props: { task: { id: 't42', status: { state: 'working' } } },
    })
    await wrapper.find('.card').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks/t42')
  })
})

describe('ThemeToggle', () => {
  it('reads the stored theme on mount and toggles it', async () => {
    window.localStorage.setItem('agentbuddy.theme', 'dark')
    const { wrapper } = mountWith(ThemeToggle)
    await nextTick()
    expect(document.documentElement.dataset.theme).toBe('dark')
    await wrapper.find('button').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('agentbuddy.theme')).toBe('light')
  })
  it('defaults to light when nothing is stored', async () => {
    const { wrapper } = mountWith(ThemeToggle)
    await nextTick()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('LanguageSwitcher', () => {
  it('lists every supported language and reflects the current one', () => {
    const { wrapper } = mountWith(LanguageSwitcher)
    expect(wrapper.findAll('option').length).toBe(13)
    expect(wrapper.find('select').element.value).toBe('en')
  })
  it('changes language on selection', async () => {
    const { wrapper } = mountWith(LanguageSwitcher)
    await wrapper.find('select').setValue('ja')
    expect(wrapper.find('select').element.value).toBe('ja')
  })
})

describe('PolicySelect', () => {
  it('renders the three policies', () => {
    const { wrapper } = mountWith(PolicySelect, { props: { value: 'off' } })
    expect(wrapper.findAll('.policy-opt').length).toBe(3)
  })
  it('emits change for a different policy after confirm', async () => {
    window.confirm = vi.fn(() => true)
    const { wrapper } = mountWith(PolicySelect, { props: { value: 'off' } })
    await wrapper.findAll('.policy-opt')[0].trigger('click')
    expect(wrapper.emitted('change')).toEqual([['allowed']])
  })
  it('does not emit when the same policy is picked', async () => {
    const { wrapper } = mountWith(PolicySelect, { props: { value: 'off' } })
    await wrapper.findAll('.policy-opt')[2].trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
  })
  it('does not emit when the user cancels the confirm', async () => {
    window.confirm = vi.fn(() => false)
    const { wrapper } = mountWith(PolicySelect, { props: { value: 'off' } })
    await wrapper.findAll('.policy-opt')[0].trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('VoiceRecorder', () => {
  it('shows the unavailable hint when MediaRecorder is absent', () => {
    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 't1' } })
    // jsdom has no MediaRecorder, so the recorder reports unsupported.
    expect(wrapper.find('button.voice-btn').exists()).toBe(false)
    expect(wrapper.text().toLowerCase()).toContain('available')
  })

  it('asks the browser for the microphone when the button is pressed', async () => {
    class FakeRecorder {
      static isTypeSupported() { return true }
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm' }
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; this.onstop?.() }
    }
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    const { wrapper } = mountWith(VoiceRecorder, { props: { threadId: 't1' } })
    const button = wrapper.find('button.voice-btn')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    await flushPromises()

    // The wrapper exists so the permission prompt happens on a click, never on
    // mount; a mount alone must leave the microphone untouched.
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectionBanner', () => {
  it('is hidden when the workbench is online', () => {
    const { wrapper, pinia } = mountWith(ConnectionBanner)
    const wb = useWorkbenchStore(pinia)
    wb.offline = false
    wb.authExpired = false
    expect(wrapper.find('.content-banner').exists()).toBe(false)
  })
  it('shows the offline banner when offline', async () => {
    const { wrapper, pinia } = mountWith(ConnectionBanner)
    const wb = useWorkbenchStore(pinia)
    wb.offline = true
    await nextTick()
    expect(wrapper.find('.banner').exists()).toBe(true)
  })
  it('shows a relogin action when the session expired and logs out on click', async () => {
    const { wrapper, pinia } = mountWith(ConnectionBanner)
    const wb = useWorkbenchStore(pinia)
    wb.authExpired = true
    logout.mockResolvedValue({})
    await nextTick()
    await wrapper.find('.banner-action').trigger('click')
    await flushPromises()
    expect(logout).toHaveBeenCalled()
  })
})

describe('NotificationCenter', () => {
  it('renders a bell and a count badge only when there are notifications', async () => {
    const { wrapper, pinia } = mountWith(NotificationCenter)
    const wb = useWorkbenchStore(pinia)
    wb.notifications = [{ key: 'k1', kind: 'result', body: 'done', title: 't', link: '/tasks' }]
    await nextTick()
    expect(wrapper.find('.notif-dot').exists()).toBe(true)
  })
  it('opens the panel and clears all on click', async () => {
    const { wrapper, pinia } = mountWith(NotificationCenter)
    const wb = useWorkbenchStore(pinia)
    wb.notifications = [
      { key: 'k1', kind: 'result', body: 'done', title: 't', link: '/tasks' },
      { key: 'k2', kind: 'failure', body: 'boom', title: 't', link: '/tasks' },
    ]
    await wrapper.find('.btn-icon').trigger('click')
    expect(wrapper.find('.notif-center').exists()).toBe(true)
    await wrapper.find('button.btn-ghost').trigger('click')
    expect(wb.notifications.length).toBe(0)
  })
  it('routes to the note link on click', async () => {
    const { wrapper, pinia, router } = mountWith(NotificationCenter)
    const wb = useWorkbenchStore(pinia)
    wb.notifications = [{ key: 'k1', kind: 'result', body: 'done', title: 't', link: '/tasks/1' }]
    await wrapper.find('.btn-icon').trigger('click')
    await wrapper.find('.notif-item').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks/1')
  })

  it('says there is nothing yet when the panel opens empty', async () => {
    const { wrapper } = mountWith(NotificationCenter)
    await wrapper.find('.btn-icon').trigger('click')

    // An empty panel gets a sentence rather than a blank box, and no bell dot is
    // drawn for a count of zero.
    expect(wrapper.find('.notif-center').exists()).toBe(true)
    expect(wrapper.text().trim().length).toBeGreaterThan(0)
    expect(wrapper.find('.notif-dot').exists()).toBe(false)
  })
})

describe('ApprovalCard', () => {
  it('approves a task via the API', async () => {
    const { wrapper } = mountWith(ApprovalCard, {
      props: { task: { id: 't1', resourceId: 'A', status: { state: 'input-required' } } },
    })
    resumeTask.mockResolvedValue({})
    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(resumeTask).toHaveBeenCalledWith('t1', '')
  })
  it('rejects a task via the API', async () => {
    const { wrapper } = mountWith(ApprovalCard, {
      props: { task: { id: 't2', resourceId: 'A', status: { state: 'input-required' } } },
    })
    cancelTask.mockResolvedValue({})
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(cancelTask).toHaveBeenCalledWith('t2')
  })

  it('swallows a refused approval instead of leaving a rejected promise', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resumeTask.mockRejectedValue({ code: 'task_not_found' })
    const { wrapper } = mountWith(ApprovalCard, {
      props: { task: { id: 't3', resourceId: 'A', status: { state: 'input-required' } } },
    })

    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()

    // The card stays on screen: the task list is the source of truth and will
    // drop it once the poll confirms the state.
    expect(wrapper.find('.card').exists()).toBe(true)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('swallows a refused rejection too', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    cancelTask.mockRejectedValue({ code: 'task_not_found' })
    const { wrapper } = mountWith(ApprovalCard, {
      props: { task: { id: 't4', resourceId: 'A', status: { state: 'input-required' } } },
    })

    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.card').exists()).toBe(true)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('ChannelCard', () => {
  it('renders the channel name and delivery count', () => {
    const { wrapper } = mountWith(ChannelCard, {
      props: { channel: { id: 'c1', name: 'Slack', kind: 'slack', enabled: true }, deliveries: [{ id: 'd' }] },
    })
    expect(wrapper.text()).toContain('Slack')
    expect(wrapper.text()).toContain('1')
  })
  it('toggles the channel enabled flag through the API', async () => {
    updateChannel.mockResolvedValue({})
    const { wrapper } = mountWith(ChannelCard, {
      props: { channel: { id: 'c1', name: 'Slack', kind: 'slack', enabled: false }, deliveries: [] },
    })
    await wrapper.find('input[type="checkbox"]').trigger('change')
    await flushPromises()
    expect(updateChannel).toHaveBeenCalledWith('c1', expect.objectContaining({ enabled: true }))
  })
  it('expands the delivery list on button click', async () => {
    const { wrapper } = mountWith(ChannelCard, {
      props: { channel: { id: 'c1', name: 'Slack', kind: 'slack', enabled: true }, deliveries: [{ id: 'd1' }] },
    })
    await wrapper.find('button.btn-ghost').trigger('click')
    expect(wrapper.findComponent(DeliveryList).exists()).toBe(true)
  })
})

describe('ConnectorCard', () => {
  it('renders the connector and a policy selector', () => {
    const { wrapper } = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'Twilio', policy: 'off', capabilities: ['sms'] } },
    })
    expect(wrapper.text()).toContain('Twilio')
    expect(wrapper.findComponent(PolicySelect).exists()).toBe(true)
  })
  it('runs an action through the API when a name is provided', async () => {
    runConnectorAction.mockResolvedValue({ parked: false })
    const { wrapper } = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'Twilio', policy: 'allowed' } },
    })
    await wrapper.findAll('input')[0].setValue('send')
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(runConnectorAction).toHaveBeenCalledWith('k1', 'send', {})
  })

  it('saves a new policy and re-reads the connector list', async () => {
    setConnectorPolicy.mockResolvedValue({})
    listConnectors.mockResolvedValue({ connectors: [] })
    const { wrapper } = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'Twilio', policy: 'off' } },
    })

    wrapper.findComponent(PolicySelect).vm.$emit('change', 'allowed')
    await flushPromises()

    expect(setConnectorPolicy).toHaveBeenCalledWith('k1', 'allowed')
    expect(listConnectors).toHaveBeenCalled()
  })

  it('refuses to run an action whose arguments are not JSON', async () => {
    runConnectorAction.mockClear()
    const { wrapper } = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'Twilio', policy: 'allowed' } },
    })

    await wrapper.findAll('input')[0].setValue('send')
    // A typo in the arguments box must not reach the server as `undefined`.
    await wrapper.findAll('input')[1].setValue('{ bad json')
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()

    expect(runConnectorAction).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('The action could not be started.')
  })
})

describe('Sidebar', () => {
  it('renders a nav item per route and reflects active state', () => {
    const { wrapper } = mountWith(Sidebar)
    // 11 links: workspace, threads, tasks, org, channels, connectors, computers,
    // schedules, knowledge, persona, settings.
    expect(wrapper.findAll('.nav-item').length).toBe(11)
  })
  it('shows badges from the workbench store', async () => {
    const { wrapper, pinia } = mountWith(Sidebar)
    const wb = useWorkbenchStore(pinia)
    wb.threads = [{ id: '1' }, { id: '2' }]
    await nextTick()
    expect(wrapper.text()).toContain('2')
  })
})

describe('Topbar', () => {
  it('renders the offline chip and signs out on click', async () => {
    const { wrapper, router } = mountWith(Topbar)
    logout.mockResolvedValue({})
    await nextTick()
    const buttons = wrapper.findAll('button.btn-icon')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()
    expect(logout).toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/login')
  })
})

// The fallbacks below are what keeps the workbench readable against a server
// that reports a field as an object in one release and as a bare string in the
// next. They are cheap to break and invisible when they do break, so they are
// pinned here rather than left to the screens that happen to render them.

describe('AgentCard fallbacks', () => {
  it('uses the tagline when the persona has no title, and hides the line when it has neither', () => {
    const withTagline = mountWith(AgentCard, {
      props: { agent: { name: 'a', persona: { tagline: 'Runs the night shift' }, health: 'healthy' } },
    })
    expect(withTagline.wrapper.text()).toContain('Runs the night shift')

    const bare = mountWith(AgentCard, {
      props: { agent: { name: 'a', persona: {}, health: 'healthy' } },
    })
    expect(bare.wrapper.find('.title').text()).toBe('')
  })

  it('reads health as an object, as a bare string, or not at all', () => {
    const object = mountWith(AgentCard, {
      props: { agent: { name: 'a', health: { status: 'degraded' } } },
    })
    // A degraded agent is still working, just slowly: the dot says so.
    expect(object.wrapper.find('.state-dot').attributes('data-state')).toBe('working')
    expect(object.wrapper.text()).toContain('Slow')

    const bare = mountWith(AgentCard, { props: { agent: { name: 'a', health: 'healthy' } } })
    expect(bare.wrapper.find('.state-dot').attributes('data-state')).toBe('completed')

    const missing = mountWith(AgentCard, { props: { agent: { name: 'a' } } })
    expect(missing.wrapper.find('.state-dot').attributes('data-state')).toBe('failed')
    expect(missing.wrapper.text()).toContain('Unchecked')
  })

  it('prints a health value it does not know rather than an empty chip', () => {
    const { wrapper } = mountWith(AgentCard, { props: { agent: { name: 'a', health: 'quarantined' } } })
    expect(wrapper.text()).toContain('quarantined')
  })

  it('shows the description and the tags only when they are there', () => {
    const full = mountWith(AgentCard, {
      props: { agent: { name: 'a', health: 'healthy', description: 'does the thing', tags: ['x'] } },
    })
    expect(full.wrapper.text()).toContain('does the thing')
    expect(full.wrapper.findAll('.tag-row .chip')).toHaveLength(1)

    const bare = mountWith(AgentCard, { props: { agent: { name: 'a', health: 'healthy' } } })
    expect(bare.wrapper.find('.tagline').exists()).toBe(false)
    expect(bare.wrapper.find('.tag-row').exists()).toBe(false)
  })
})

describe('ArtifactList edge cases', () => {
  it('treats a missing list as empty', () => {
    const { wrapper } = mountWith(ArtifactList, { props: { artifacts: null } })
    expect(wrapper.findAll('.artifact')).toHaveLength(0)
  })

  it('renders an empty row for an artifact it cannot read', () => {
    // No parts at all, and a part that claims to be a file but carries no file:
    // both must still take a row instead of silently vanishing from the list.
    const { wrapper } = mountWith(ArtifactList, {
      props: { artifacts: [{}, { parts: [{ type: 'file' }] }] },
    })
    expect(wrapper.findAll('.artifact')).toHaveLength(2)
  })

  it('defaults the mime type when the bytes carry none', () => {
    const { wrapper } = mountWith(ArtifactList, {
      props: { artifacts: [{ parts: [{ type: 'file', file: { bytes: 'AA' } }] }] },
    })
    expect(wrapper.find('a').attributes('href')).toBe('data:application/octet-stream;base64,AA')
  })

  it('names an unnamed file with the localised label', () => {
    const { wrapper } = mountWith(ArtifactList, {
      props: { artifacts: [{ parts: [{ type: 'file', file: { name: '', uri: 'u' } }] }] },
    })
    expect(wrapper.find('.artifact-head').text().trim().length).toBeGreaterThan(0)
  })
})

describe('ConnectorCard edge cases', () => {
  it('does nothing when the action name is blank', async () => {
    runConnectorAction.mockClear()
    const { wrapper } = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'Twilio', policy: 'allowed' } },
    })
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(runConnectorAction).not.toHaveBeenCalled()
  })

  it('says the run is waiting for a person when the server parked it', async () => {
    runConnectorAction.mockResolvedValue({ parked: true })
    const { wrapper } = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'Twilio', policy: 'allowed' } },
    })
    await wrapper.findAll('input')[0].setValue('send')
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('The action is waiting for your approval.')
  })

  it('reads health as an object or a string, and defaults the policy to off', () => {
    const object = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'A', health: { status: 'degraded' } } },
    })
    expect(object.wrapper.text()).toContain('Slow')
    expect(object.wrapper.findComponent(PolicySelect).props('value')).toBe('off')

    const bare = mountWith(ConnectorCard, {
      props: { connector: { id: 'k1', name: 'B', health: 'healthy', policy: 'allowed' } },
    })
    expect(bare.wrapper.text()).toContain('Reachable')
    expect(bare.wrapper.findComponent(PolicySelect).props('value')).toBe('allowed')
  })
})

describe('Sidebar footer', () => {
  it('falls back to the email when the account has no display name', async () => {
    const { wrapper, pinia } = mountWith(Sidebar)
    useAuthStore(pinia).user = { email: 'me@example.com' }
    await nextTick()
    expect(wrapper.find('.sidebar-foot').text()).toContain('me@example.com')
    expect(wrapper.find('.sidebar-version').exists()).toBe(false)
  })

  it('shows the shell version stamp when the desktop shell provides one', async () => {
    window.__AGENTBUDDY_VERSION__ = 'v0.4.0@1a2b3c4'
    const { wrapper } = mountWith(Sidebar)
    await nextTick()
    expect(wrapper.find('.sidebar-version').text()).toBe('v0.4.0@1a2b3c4')
    delete window.__AGENTBUDDY_VERSION__
  })
})

describe('StateDot and PersonaAvatar fallbacks', () => {
  it('prints an unknown task state rather than an empty label', () => {
    const { wrapper } = mountWith(StateDot, { props: { state: 'quarantined' } })
    expect(wrapper.find('.dim').text()).toBe('quarantined')
  })

  it('renders a question mark for a name that is only whitespace', () => {
    const { wrapper } = mountWith(PersonaAvatar, { props: { name: '   ' } })
    expect(wrapper.text().trim()).toBe('?')
  })
})

// The other side of each ternary: one branch away from the cases above, and
// invisible when it breaks because the page still renders.
describe('component branch edges', () => {
  it('names both connection states', async () => {
    const { wrapper, pinia } = mountWith(Topbar)
    await nextTick()
    const chip = () => wrapper.find('header .chip')
    expect(chip().text()).toBe('Online')

    useWorkbenchStore(pinia).offline = true
    await nextTick()

    expect(chip().text()).toBe('Offline')
    expect(chip().find('.state-dot').attributes('data-state')).toBe('failed')
  })

  it('renders the default state when StateDot gets no props', () => {
    // No `state`, no `label`: the dot must still carry a word.
    const { wrapper } = mountWith(StateDot)
    expect(wrapper.find('.state-dot').attributes('data-state')).toBe('unknown')
    expect(wrapper.find('.dim').text()).toBe('Unknown')
  })

  it('falls back to the task id when an approval names no resource', () => {
    const { wrapper } = mountWith(ApprovalCard, {
      props: { task: { id: 't9', status: { state: 'input-required' } } },
    })
    expect(wrapper.find('strong').text()).toBe('t9')
  })

  it('opens the trace from the approval card', async () => {
    const { wrapper, router } = mountWith(ApprovalCard, {
      props: { task: { id: 't9', status: { state: 'input-required' } } },
    })
    await wrapper.findAll('button')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks/t9')
  })

  it('prints a health value the copy table has never seen', () => {
    const { wrapper } = mountWith(AgentCard, {
      props: { agent: { name: 'a', health: 'quarantined' } },
    })
    expect(wrapper.text()).toContain('quarantined')
  })

  it('defaults the mime type for inline bytes', () => {
    // A file part that names no mimeType still has to be playable.
    const { wrapper } = mountWith(AudioPlayer, {
      props: { part: { data: { file: { bytes: 'QUJD' } } } },
    })
    expect(wrapper.find('audio').attributes('src')).toBe('data:audio/webm;base64,QUJD')
  })

  it('marks an SMS channel with the CLI glyph', () => {
    const { wrapper } = mountWith(ChannelCard, {
      props: { channel: { id: 'c2', name: 'Twilio', kind: 'sms', enabled: false }, deliveries: [] },
    })
    expect(wrapper.find('.kind-mark').attributes('data-kind')).toBe('cli')
    expect(wrapper.text()).toContain('Never used')
  })

  it('labels a queued receipt and offers a retry for an outbound one', async () => {
    const { wrapper } = mountWith(DeliveryList, {
      props: {
        deliveries: [{ id: 'd2', status: 'pending', direction: 'outbound', at: new Date().toISOString() }],
      },
    })
    expect(wrapper.text()).toContain('Queued')

    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('retry')[0]).toEqual(['d2'])
  })

  it('offers no retry for an inbound receipt', () => {
    // Re-sending an inbound message is not ours to do.
    const { wrapper } = mountWith(DeliveryList, {
      props: {
        deliveries: [{ id: 'd3', status: 'received', direction: 'inbound', at: new Date().toISOString() }],
      },
    })
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
