// @vitest-environment jsdom
// The thread composer's @ picker is a live view of agenthub's agent registry,
// not a snapshot of the thread's history. These cases pin the wiring: opening
// the picker asks agenthub for `?kind=agent`, every workspace poll keeps it
// current while it stays open, and a failed read never empties the composer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mountWith } from './helpers/vue-utils.js'
import { useWorkbenchStore } from '../src/lib/workbench-store.js'
import { setLang } from '../src/lib/use-copy.js'

vi.mock('../src/lib/api.js')

import {
  listResources, getThread, subscribeThreadEvents, postThreadMessage,
  getWorkspace, listTasks,
} from '../src/lib/api.js'
import ThreadView from '../src/views/ThreadView.vue'

const agent = (id, name, label) => ({ id, name, display_name: label, kind: 'agent' })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  window.localStorage.clear()
  listResources.mockResolvedValue({ resources: [] })
  getThread.mockResolvedValue({ thread: { ID: '1', Title: 't' }, messages: [] })
  subscribeThreadEvents.mockReturnValue({ close: vi.fn() })
  postThreadMessage.mockResolvedValue({
    message: { ID: 'm1', AuthorType: 'user', Body: 'hi' },
    delegated: [],
  })
  getWorkspace.mockResolvedValue({ agents: [] })
  listTasks.mockResolvedValue({ tasks: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ''
  setLang('en')
})

async function openPicker(wrapper, value = 'hey @') {
  await wrapper.find('textarea').setValue(value)
  await flushPromises()
}

const labels = (wrapper) => wrapper.findAll('.mention-item .truncate').map((s) => s.text())

async function sendDraft(wrapper, value) {
  await wrapper.find('textarea').setValue(value)
  await wrapper.findAll('button').find((b) => b.classes('btn-primary')).trigger('click')
  await flushPromises()
}

describe('ThreadView @ picker syncs agenthub agents', () => {
  it('offers a just-registered agent without waiting for the workspace poll', async () => {
    listResources.mockResolvedValue({ resources: [agent('agent-new', 'newcomer', 'Newcomer')] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()
    expect(listResources).not.toHaveBeenCalled()

    await openPicker(wrapper)

    expect(listResources).toHaveBeenCalledWith('agent', { discoverable: true })
    expect(labels(wrapper)).toEqual(['Newcomer'])
    wrapper.unmount()
  })

  it('reads the server-side discoverable view instead of filtering locally', async () => {
    // agenthub already hid the curated record. The picker asks for that view and
    // renders exactly what came back — a local status check would let the client
    // overrule the registry's curation decision.
    listResources.mockResolvedValue({
      resources: [{ id: 'agent-ok', name: 'ok', display_name: 'Approved', kind: 'agent' }],
    })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()
    await openPicker(wrapper)
    expect(listResources).toHaveBeenCalledWith('agent', { discoverable: true })
    expect(labels(wrapper)).toEqual(['Approved'])
    wrapper.unmount()
  })

  it('reads the registry once per opening, not on every keystroke', async () => {
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await openPicker(wrapper, 'hey @')
    await openPicker(wrapper, 'hey @new')
    expect(listResources).toHaveBeenCalledTimes(1)

    // Closing and reopening is a new opening, so it reads again.
    await openPicker(wrapper, 'hey there')
    await openPicker(wrapper, 'hey there @')
    expect(listResources).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('accepts a bare array catalogue as well as the wrapped shape', async () => {
    listResources.mockResolvedValue([agent('agent-bare', 'bare', 'Bare')])
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await openPicker(wrapper)

    expect(labels(wrapper)).toEqual(['Bare'])
    wrapper.unmount()
  })

  it('re-reads the registry when a workspace poll lands while the picker is open', async () => {
    const { wrapper, pinia } = mountWith(ThreadView, { props: { id: '1' } })
    const store = useWorkbenchStore(pinia)
    await flushPromises()
    await openPicker(wrapper)
    const before = listResources.mock.calls.length

    // The poll brings a stale copy; the registry read that follows wins by id.
    listResources.mockResolvedValue({ resources: [agent('agent-2', 'current', 'Current')] })
    store.agents = [agent('agent-2', 'stale', 'Stale')]
    await flushPromises()

    expect(listResources.mock.calls.length).toBe(before + 1)
    expect(labels(wrapper)).toEqual(['Current'])
    wrapper.unmount()
  })

  it('drops an agent agenthub removed once the poll refreshes the catalogue', async () => {
    listResources.mockResolvedValue({ resources: [agent('agent-1', 'scout', 'Scout')] })
    const { wrapper, pinia } = mountWith(ThreadView, { props: { id: '1' } })
    const store = useWorkbenchStore(pinia)
    await flushPromises()
    await openPicker(wrapper)
    expect(labels(wrapper)).toEqual(['Scout'])

    listResources.mockResolvedValue({ resources: [] })
    store.agents = []
    await flushPromises()

    expect(labels(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('ignores a poll while the picker is closed', async () => {
    const { wrapper, pinia } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    useWorkbenchStore(pinia).agents = [agent('agent-1', 'scout', 'Scout')]
    await flushPromises()

    expect(listResources).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows a renamed agent under its new label and keeps the old handle searchable', async () => {
    getThread.mockResolvedValue({
      thread: { ID: '1' },
      messages: [{ ID: 'm0', AuthorType: 'agent', AuthorID: 'agent-1', AuthorName: 'legacy', Body: 'here' }],
    })
    listResources.mockResolvedValue({ resources: [agent('agent-1', 'renamed', 'Renamed')] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await openPicker(wrapper, 'hey @legacy')

    expect(labels(wrapper)).toEqual(['Renamed'])
    wrapper.unmount()
  })

  it('still delegates a draft typed with the handle the agent used before a rename', async () => {
    getThread.mockResolvedValue({
      thread: { ID: '1' },
      messages: [{ ID: 'm0', AuthorType: 'agent', AuthorID: 'agent-1', AuthorName: 'legacy', Body: 'here' }],
    })
    listResources.mockResolvedValue({ resources: [agent('agent-1', 'renamed', 'Renamed')] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()
    await openPicker(wrapper, 'go @legacy')

    await sendDraft(wrapper, 'go @legacy')

    expect(postThreadMessage).toHaveBeenCalledWith('1', 'go @legacy', ['agent-1'])
    wrapper.unmount()
  })

  it('hands an unmentioned message to an agent that only the registry knows about', async () => {
    listResources.mockResolvedValue({ resources: [agent('agent-new', 'newcomer', 'Newcomer')] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()
    await openPicker(wrapper)

    await sendDraft(wrapper, 'go')

    expect(postThreadMessage).toHaveBeenCalledWith('1', 'go', ['agent-new'])
    wrapper.unmount()
  })

  it('keeps the store list addressable when the registry read fails', async () => {
    listResources.mockRejectedValue(new Error('catalogue unavailable'))
    const { wrapper, pinia } = mountWith(ThreadView, { props: { id: '1' } })
    useWorkbenchStore(pinia).agents = [agent('agent-1', 'scout', 'Scout')]
    await flushPromises()

    await openPicker(wrapper)

    expect(wrapper.find('.mention-pop').exists()).toBe(true)
    expect(labels(wrapper)).toEqual(['Scout'])
    wrapper.unmount()
  })

  it('keeps the picker usable when the registry answers without a catalogue', async () => {
    listResources.mockResolvedValue(null)
    const { wrapper, pinia } = mountWith(ThreadView, { props: { id: '1' } })
    useWorkbenchStore(pinia).agents = [agent('agent-1', 'scout', 'Scout')]
    await flushPromises()

    await openPicker(wrapper)

    expect(labels(wrapper)).toEqual(['Scout'])
    wrapper.unmount()
  })

  it('addresses a catalogued participant without a registry name by its id', async () => {
    getThread.mockResolvedValue({ thread: { ID: '1', Participants: ['agent-x'] }, messages: [] })
    listResources.mockResolvedValue({ resources: [{ id: 'agent-x', display_name: 'Nameless', kind: 'agent' }] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await openPicker(wrapper)

    expect(labels(wrapper)).toEqual(['Nameless'])
    await sendDraft(wrapper, 'go @agent-x')
    expect(postThreadMessage).toHaveBeenCalledWith('1', 'go @agent-x', ['agent-x'])
    wrapper.unmount()
  })

  it('does not resurrect a past speaker the catalogue hides', async () => {
    // A draft, pending or ungranted agent can still have spoken here before its
    // status changed. Neither history nor the declared participant list may put
    // it back in the picker or make it the default target: the server would
    // refuse that delegation.
    getThread.mockResolvedValue({
      thread: { ID: '1', Participants: ['ghost'] },
      messages: [
        { ID: 'm0', AuthorType: 'agent', AuthorID: 'ghost', AuthorName: 'ghost', Body: 'old reply' },
      ],
    })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await openPicker(wrapper)
    expect(wrapper.find('.mention-pop').exists()).toBe(true)
    expect(wrapper.findAll('.mention-item')).toHaveLength(0)

    await sendDraft(wrapper, 'hello')
    expect(postThreadMessage).toHaveBeenCalledWith('1', 'hello', [])
    wrapper.unmount()
  })

  it('keeps history names as aliases, never as extra candidates', async () => {
    getThread.mockResolvedValue({
      thread: { ID: '1', Participants: ['ghost'] },
      messages: [
        { ID: 'm0', AuthorType: 'agent', AuthorID: 'ghost', AuthorName: 'ghost', Body: 'old' },
        { ID: 'm1', AuthorType: 'agent', AuthorID: 'agent-1', AuthorName: 'legacy', Body: 'new' },
        { ID: 'm2', AuthorType: 'agent', AuthorID: 'agent-1', AuthorName: 'also-legacy', Body: 'newer' },
      ],
    })
    listResources.mockResolvedValue({ resources: [agent('agent-1', 'renamed', 'Renamed')] })
    const { wrapper } = mountWith(ThreadView, { props: { id: '1' } })
    await flushPromises()

    await openPicker(wrapper)
    expect(labels(wrapper)).toEqual(['Renamed'])

    // A name from a catalogued agent stays searchable after a rename; one from
    // a hidden agent does not open a row at all.
    await openPicker(wrapper, 'hey @legacy')
    expect(labels(wrapper)).toEqual(['Renamed'])
    await openPicker(wrapper, 'hey @ghost')
    expect(wrapper.find('.mention-pop').exists()).toBe(false)

    await sendDraft(wrapper, 'hello')
    expect(postThreadMessage).toHaveBeenCalledWith('1', 'hello', ['agent-1'])

    postThreadMessage.mockClear()
    await sendDraft(wrapper, 'go @ghost')
    expect(postThreadMessage).toHaveBeenCalledWith('1', 'go @ghost', [])
    wrapper.unmount()
  })

  it('keeps the approval gate out of every agent picker', () => {
    // Both surfaces that list agents read the same server-side view. A local
    // status check would quietly create a second catalogue again.
    for (const path of ['../src/views/ThreadView.vue', '../src/views/PersonaEditor.vue']) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
      expect(source).toContain('{ discoverable: true }')
      expect(source).not.toContain("status === 'approved'")
    }
  })
})
