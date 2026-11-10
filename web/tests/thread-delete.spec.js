// @vitest-environment jsdom
// The Threads list owns one deletion flow for both cases: one checked card is a
// single delete, several checked cards (or Select all) are a batch delete. These
// cases drive the screen with the real workbench store and a mocked API, so they
// prove the checkbox → confirmation → endpoint → reload wiring, not just a
// helper in isolation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mountWith } from './helpers/vue-utils.js'
import { setLang, useCopy } from '../src/lib/use-copy.js'
import { LANG_CODES } from '../src/lib/languages.js'
import { errorMessage } from '../src/lib/errors.js'
import { threadCopy } from '../src/lib/copy/thread-copy.js'

vi.mock('../src/lib/api.js')

import {
  listThreads, createThread, deleteThread, clearThreadMessages, getThread, listTasks,
  subscribeThreadEvents,
} from '../src/lib/api.js'
import ThreadListView from '../src/views/ThreadListView.vue'
import ThreadView from '../src/views/ThreadView.vue'

const THREADS = [
  { ID: 'th-1', Title: 'Alpha', Participants: ['a1'] },
  { ID: 'th-2', Title: 'Beta', Participants: [] },
  { ID: 'th-3', Title: 'Gamma', Participants: [] },
]
const rows = () => THREADS.map((t) => ({ ...t }))

// BaseDialog teleports into document.body. Leaving a mounted view behind while
// the next test clears the body makes Vue patch a detached tree.
const mounted = []
function mountView() {
  const result = mountWith(ThreadListView)
  mounted.push(result.wrapper)
  return result
}

function mountThreadView() {
  const result = mountWith(ThreadView, { props: { id: '1' } })
  mounted.push(result.wrapper)
  return result
}

function findButton(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))
}

async function clickDialogButton(text) {
  await nextTick()
  const btn = Array.from(document.querySelectorAll('.dialog-foot button'))
    .find((b) => (b.textContent || '').trim().includes(text))
  expect(btn, `dialog button ${text}`).toBeTruthy()
  btn.click()
  await flushPromises()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  window.localStorage.clear()
  setLang('en')
  listThreads.mockResolvedValue({ threads: rows() })
  createThread.mockResolvedValue({ ID: 'new' })
  deleteThread.mockResolvedValue(null)
  clearThreadMessages.mockResolvedValue(null)
  getThread.mockResolvedValue({ thread: { ID: '1', Title: 't' }, messages: [] })
  listTasks.mockResolvedValue({ tasks: [] })
  subscribeThreadEvents.mockReturnValue({ close: vi.fn() })
})

afterEach(() => {
  // Unmount before touching the DOM or the language: a live teleported dialog
  // would otherwise be patched against a detached tree.
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  // setLang pushes the preference to the shell, so keep the fetch stub in place
  // until after the reset.
  setLang('en')
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('ThreadListView — selection', () => {
  it('offers a checkbox per card and a select-all control', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    expect(wrapper.findAll('.thread-check')).toHaveLength(3)
    expect(wrapper.find('.thread-checkall input').exists()).toBe(true)
    expect(wrapper.find('.thread-checkall').text()).toContain('Select all')
    // Nothing is checked, so no destructive action is offered yet.
    expect(findButton(wrapper, 'Delete selected')).toBeUndefined()
  })

  it('opens a thread from the card, but not from its checkbox or delete button', async () => {
    const { wrapper, router } = mountView()
    await flushPromises()

    await wrapper.find('.thread-check-label').trigger('click')
    await wrapper.find('.thread-delete').trigger('click')
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(deleteThread).not.toHaveBeenCalled()

    await wrapper.find('.thread-card').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/threads/th-1')
  })

  it('selects all, shows the count and clears the selection again', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-checkall input').setValue(true)
    expect(wrapper.vm.selected).toEqual(['th-1', 'th-2', 'th-3'])
    expect(wrapper.text()).toContain('3 selected')
    expect(findButton(wrapper, 'Delete selected').text()).toContain('(3)')
    expect(wrapper.find('.thread-checkall input').element.checked).toBe(true)

    await findButton(wrapper, 'Clear selection').trigger('click')
    expect(wrapper.vm.selected).toEqual([])
    expect(findButton(wrapper, 'Delete selected')).toBeUndefined()
  })

  it('deselects all through the same select-all control', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-checkall input').setValue(true)
    await wrapper.find('.thread-checkall input').setValue(false)
    expect(wrapper.vm.selected).toEqual([])
    expect(wrapper.text()).toContain('0 selected')
  })

  it('keeps the selection in step with a list the server has changed', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.findAll('.thread-check')[0].setValue(true)
    // A background refresh drops the selected thread without any click.
    listThreads.mockResolvedValueOnce({ threads: rows().slice(1) })
    await wrapper.vm.workbench.refreshThreads()
    await nextTick()

    expect(wrapper.vm.selectedIds).toEqual([])
    expect(findButton(wrapper, 'Delete selected')).toBeUndefined()
  })

  it('renders no selection toolbar for an empty list', async () => {
    listThreads.mockResolvedValue({ threads: [] })
    const { wrapper } = mountView()
    await flushPromises()

    expect(wrapper.find('.thread-toolbar').exists()).toBe(false)
    expect(wrapper.text()).toContain('No threads yet.')
  })

  it('falls back to the id when a thread has no title', async () => {
    listThreads.mockResolvedValue({ threads: [{ ID: 'th-untitled' }] })
    const { wrapper } = mountView()
    await flushPromises()

    expect(wrapper.find('.thread-card').text()).toContain('th-untitled')
  })
})

describe('ThreadListView — deleting', () => {
  it('deletes one thread after a singular confirmation', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-delete').trigger('click')
    expect(deleteThread).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Delete this thread?')

    listThreads.mockResolvedValueOnce({ threads: rows().slice(1) })
    await clickDialogButton('Delete')

    expect(deleteThread).toHaveBeenCalledTimes(1)
    expect(deleteThread).toHaveBeenCalledWith('th-1')
    expect(listThreads).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
  })

  it('deletes every selected thread with a plural confirmation', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-checkall input').setValue(true)
    await findButton(wrapper, 'Delete selected').trigger('click')
    expect(document.body.textContent).toContain('Delete 3 selected threads?')

    listThreads.mockResolvedValueOnce({ threads: [] })
    await clickDialogButton('Delete')

    expect(deleteThread.mock.calls.map(([id]) => id)).toEqual(['th-1', 'th-2', 'th-3'])
    expect(wrapper.vm.selected).toEqual([])
    expect(wrapper.text()).toContain('No threads yet.')
  })

  it('backs out of the confirmation without deleting anything', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-delete').trigger('click')
    await clickDialogButton('Cancel')

    expect(deleteThread).not.toHaveBeenCalled()
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
  })

  it('lets the dialog close itself through its own v-model', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-delete').trigger('click')
    await nextTick()
    document.querySelector('.dialog-close').click()
    await flushPromises()

    expect(wrapper.vm.showConfirm).toBe(false)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    expect(deleteThread).not.toHaveBeenCalled()
  })

  it('keeps the surviving selection and shows the refusal', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    deleteThread.mockReset()
      .mockRejectedValueOnce({ code: 'forbidden' })
      .mockResolvedValueOnce(null)
    await wrapper.findAll('.thread-check')[0].setValue(true)
    await wrapper.findAll('.thread-check')[2].setValue(true)
    await findButton(wrapper, 'Delete selected').trigger('click')
    await clickDialogButton('Delete')

    expect(wrapper.find('.banner-error').text()).toContain(errorMessage('forbidden'))
    // The dialog stays open and the selection survives for a retry.
    expect(document.querySelector('.dialog-backdrop')).not.toBeNull()
    expect(wrapper.vm.selected).toEqual(['th-1', 'th-3'])
  })

  it('explains a server that has no delete endpoint instead of doing nothing', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    deleteThread.mockRejectedValue({ code: '405', status: 405 })
    await wrapper.findAll('.thread-check')[0].setValue(true)
    await findButton(wrapper, 'Delete selected').trigger('click')
    await clickDialogButton('Delete')

    expect(wrapper.find('.banner-error').text()).toContain(errorMessage('method_not_allowed'))
    expect(wrapper.vm.selected).toEqual(['th-1'])
  })

  it('treats a thread the server cannot see as already gone', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    deleteThread.mockRejectedValue({ code: 'not_found' })
    listThreads.mockResolvedValueOnce({ threads: rows().slice(1) })
    await wrapper.findAll('.thread-check')[0].setValue(true)
    await findButton(wrapper, 'Delete selected').trigger('click')
    await clickDialogButton('Delete')

    expect(wrapper.find('.banner-error').exists()).toBe(false)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    expect(wrapper.vm.selected).toEqual([])
  })

  it('does not send the same batch twice while a delete is in flight', async () => {
    const { wrapper } = mountView()
    await flushPromises()

    let release
    deleteThread.mockReturnValue(new Promise((resolve) => { release = resolve }))
    await wrapper.findAll('.thread-check')[0].setValue(true)
    await findButton(wrapper, 'Delete selected').trigger('click')
    await nextTick()

    const first = wrapper.vm.confirmDelete()
    await wrapper.vm.confirmDelete()
    expect(deleteThread).toHaveBeenCalledTimes(1)

    release(null)
    await first
    await flushPromises()
    expect(deleteThread).toHaveBeenCalledTimes(1)
  })
})

describe('ThreadListView — all 13 languages', () => {
  it('translates every selection and deletion key', () => {
    for (const lang of LANG_CODES) {
      setLang(lang)
      const { t } = useCopy('thread')
      for (const key of ['deleteTitle', 'deleteSelected', 'selectAll', 'selectThread', 'selectedCount', 'clearSelection']) {
        expect(t(key), `${lang}.${key} missing`).toBeTruthy()
      }
      expect(t('deleteSelectedConfirm')).toContain('{count}')
      if (lang !== 'en') {
        expect(t('deleteSelected'), `${lang}.deleteSelected equals English`).not.toBe('Delete selected')
        expect(t('selectAll'), `${lang}.selectAll equals English`).not.toBe('Select all')
      }
    }
  })

  it('renders the controls in the chosen language', async () => {
    setLang('zh')
    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.find('.thread-checkall input').setValue(true)
    expect(findButton(wrapper, '删除所选').text()).toContain('(3)')
    expect(wrapper.find('.thread-checkall').text()).toContain('全选')
    expect(wrapper.text()).toContain('已选 3 个')

    await findButton(wrapper, '删除所选').trigger('click')
    expect(document.body.textContent).toContain('删除选中的 3 个会话？')
    expect(document.body.textContent).toContain('删除会话')
  })
})

describe('ThreadView — back to Threads', () => {
  it('returns to the list with a localised label in all 13 languages', async () => {
    const { wrapper, router } = mountThreadView()
    await flushPromises()
    await router.isReady()
    await router.push('/threads/1')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/threads/1')

    const link = wrapper.find('.thread-back')
    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toContain('/threads')

    for (const lang of LANG_CODES) {
      setLang(lang)
      await nextTick()
      const label = useCopy('thread').t('backToThreads')
      expect(label, `${lang}.backToThreads missing`).toBeTruthy()
      expect(wrapper.find('.thread-back').text()).toContain(label)
      expect(document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr')
      if (lang !== 'en') {
        expect(label, `${lang}.backToThreads equals English`).not.toBe('Back to Threads')
      }
    }

    setLang('zh')
    await nextTick()
    expect(wrapper.find('.thread-back').text()).toContain('返回会话')
    await wrapper.find('.thread-back').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/threads')
  })

  it('stays available before the thread has loaded', async () => {
    getThread.mockReturnValue(new Promise(() => {}))
    const { wrapper, router } = mountThreadView()
    await flushPromises()
    await router.isReady()
    await router.push('/threads/1')
    await flushPromises()

    expect(wrapper.find('.thread').exists()).toBe(false)
    const link = wrapper.find('.thread-back')
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/threads')
  })
})

function withMessages() {
  getThread.mockResolvedValue({
    thread: { ID: '1', Title: 't' },
    messages: [
      { ID: 'm1', AuthorType: 'user', AuthorName: 'me', Body: 'hello' },
      { ID: 'm2', AuthorType: 'agent', AuthorName: 'bot', Body: 'hi there' },
    ],
  })
}

describe('ThreadView — clearing the conversation', () => {
  it('offers no clear action for a conversation that is already empty', async () => {
    const { wrapper } = mountThreadView()
    await flushPromises()

    expect(findButton(wrapper, 'Clear messages')).toBeUndefined()
    expect(wrapper.text()).toContain('No messages yet.')
  })

  it('clears every row after confirmation and rebuilds the stream', async () => {
    withMessages()
    const firstClose = vi.fn()
    subscribeThreadEvents
      .mockReturnValueOnce({ close: firstClose })
      .mockReturnValueOnce({ close: vi.fn() })
    const { wrapper } = mountThreadView()
    await flushPromises()

    expect(wrapper.findAll('.msg')).toHaveLength(2)
    const clearButton = findButton(wrapper, 'Clear messages')
    expect(clearButton).toBeTruthy()
    await clearButton.trigger('click')
    expect(document.body.textContent).toContain('Clear conversation')
    expect(clearThreadMessages).not.toHaveBeenCalled()

    await clickDialogButton('Delete')

    expect(clearThreadMessages).toHaveBeenCalledWith('1')
    expect(wrapper.findAll('.msg')).toHaveLength(0)
    expect(wrapper.text()).toContain('No messages yet.')
    expect(findButton(wrapper, 'Clear messages')).toBeUndefined()
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    // The fresh stream replays the now-empty history; the old one must be closed.
    expect(firstClose).toHaveBeenCalledTimes(1)
    expect(subscribeThreadEvents).toHaveBeenCalledTimes(2)
  })

  it('backs out of the confirmation without deleting anything', async () => {
    withMessages()
    const { wrapper } = mountThreadView()
    await flushPromises()

    await findButton(wrapper, 'Clear messages').trigger('click')
    await clickDialogButton('Cancel')
    expect(clearThreadMessages).not.toHaveBeenCalled()
    expect(wrapper.findAll('.msg')).toHaveLength(2)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()

    // Closing the dialog through its own X goes through the same v-model.
    await findButton(wrapper, 'Clear messages').trigger('click')
    await nextTick()
    document.querySelector('.dialog-close').click()
    await flushPromises()
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    expect(clearThreadMessages).not.toHaveBeenCalled()
  })

  it('keeps the rows and localises the reason when the server refuses', async () => {
    setLang('zh')
    withMessages()
    clearThreadMessages.mockRejectedValueOnce({ code: 'forbidden' })
    const { wrapper } = mountThreadView()
    await flushPromises()

    await findButton(wrapper, '清空消息').trigger('click')
    await clickDialogButton('删除')

    expect(wrapper.findAll('.msg')).toHaveLength(2)
    expect(document.body.textContent).toContain('清空会话')
    expect(document.body.textContent).toContain(errorMessage('forbidden'))
    expect(clearThreadMessages).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.dialog-foot .btn-danger').disabled).toBe(false)
  })

  it('does not send the same clear twice while one is in flight', async () => {
    withMessages()
    let release
    clearThreadMessages.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const { wrapper } = mountThreadView()
    await flushPromises()

    await findButton(wrapper, 'Clear messages').trigger('click')
    const first = wrapper.vm.confirmClear()
    await wrapper.vm.confirmClear()
    expect(clearThreadMessages).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.dialog-foot .btn-danger').disabled).toBe(true)
    expect(findButton(wrapper, 'Clear messages').element.disabled).toBe(true)

    release(null)
    await first
    await flushPromises()
    expect(clearThreadMessages).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.msg')).toHaveLength(0)
  })
})

describe('ThreadView — clear conversation in all 13 languages', () => {
  const KEYS = ['clearMessages', 'clearMessagesTitle', 'clearMessagesConfirm', 'messagesEmpty']

  it('translates every clear key', () => {
    for (const lang of LANG_CODES) {
      setLang(lang)
      const { t } = useCopy('thread')
      for (const key of KEYS) {
        expect(t(key), `${lang}.${key} missing`).toBeTruthy()
        if (lang !== 'en') {
          expect(t(key), `${lang}.${key} equals English`).not.toBe(threadCopy.en[key])
        }
      }
    }
  })

  it('renders the trigger, dialog and empty state in Chinese', async () => {
    setLang('zh')
    withMessages()
    const { wrapper } = mountThreadView()
    await flushPromises()

    expect(findButton(wrapper, '清空消息')).toBeTruthy()
    await findButton(wrapper, '清空消息').trigger('click')
    expect(document.body.textContent).toContain('清空会话')
    expect(document.body.textContent).toContain('删除此会话中的全部消息？')

    await clickDialogButton('删除')
    expect(wrapper.text()).toContain('暂无消息。')
  })
})
