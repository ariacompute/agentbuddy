// @vitest-environment jsdom
// Two screens' worth of wiring, driven through the real workbench store:
//   * F4.5 — the Tasks list can be cleared. agenthub deletes the finished
//     records (DELETE /api/tasks, cascading to artifacts, trace and event
//     frames) and keeps the runs that are still live, answering how many of
//     each it saw; the screen re-reads the list instead of assuming it is empty.
//   * F4.6 — one task's trace carries a way back to the Tasks list, in every
//     language, even while the task is loading or has failed to load.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mountWith } from './helpers/vue-utils.js'
import { setLang, useCopy } from '../src/lib/use-copy.js'
import { LANG_CODES } from '../src/lib/languages.js'
import { taskCopy } from '../src/lib/copy/task-copy.js'

vi.mock('../src/lib/api.js')

import { listTasks, clearTasks, getTask, subscribeTaskEvents } from '../src/lib/api.js'
import TaskListView from '../src/views/TaskListView.vue'
import TaskTraceView from '../src/views/TaskTraceView.vue'
import TaskCard from '../src/components/TaskCard.vue'

const TASKS = [
  { id: 't1', resourceId: 'A', status: { state: 'completed' } },
  { id: 't2', resourceId: 'B', status: { state: 'working' } },
]
const rows = () => TASKS.map((task) => ({ ...task }))

// BaseDialog teleports into document.body; a wrapper left mounted while the next
// test clears the body makes Vue patch a detached tree.
const mounted = []
function mountView(component, options) {
  const result = mountWith(component, options)
  mounted.push(result.wrapper)
  return result
}

function dialogButton(text) {
  return Array.from(document.querySelectorAll('.dialog-foot button'))
    .find((b) => (b.textContent || '').trim().includes(text))
}

async function clickDialogButton(text) {
  await nextTick()
  const btn = dialogButton(text)
  expect(btn, `dialog button ${text}`).toBeTruthy()
  btn.click()
  await flushPromises()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.localStorage.clear()
  setLang('en')
  listTasks.mockResolvedValue({ tasks: rows() })
  clearTasks.mockResolvedValue({ deleted: 2, kept: 0 })
  getTask.mockResolvedValue({ id: 't1', status: { state: 'working' }, artifacts: [], spans: [] })
  subscribeTaskEvents.mockReturnValue({ close: vi.fn() })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  // setLang pushes the preference to the shell, so keep the fetch stub until
  // after the language is reset.
  setLang('en')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('TaskListView — clearing the task records', () => {
  it('offers no clear action before anything has run', async () => {
    listTasks.mockResolvedValue({ tasks: [] })
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    expect(wrapper.find('.task-clear').exists()).toBe(false)
    expect(wrapper.text()).toContain('No tasks yet.')
  })

  it('deletes on the server after one confirmation and shows what is left', async () => {
    listTasks.mockResolvedValueOnce({ tasks: rows() }) // the mount
    listTasks.mockResolvedValue({ tasks: [] }) // the re-read after the clear
    const { wrapper } = mountView(TaskListView)
    await flushPromises()
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(2)

    await wrapper.find('.task-clear').trigger('click')
    // A destructive action asks first, and nothing is deleted until it is answered.
    expect(document.body.textContent).toContain('Clear finished tasks?')
    expect(clearTasks).not.toHaveBeenCalled()

    await clickDialogButton('Clear all')

    expect(clearTasks).toHaveBeenCalledTimes(1)
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(0)
    expect(wrapper.text()).toContain('No tasks yet.')
    expect(wrapper.find('.task-clear').exists()).toBe(false)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    // Nothing is claimed: the empty screen comes from the re-read list.
    expect(wrapper.find('.banner').exists()).toBe(false)
  })

  it('says which runs the server kept because they are still live', async () => {
    listTasks.mockResolvedValueOnce({ tasks: rows() })
    listTasks.mockResolvedValue({ tasks: [TASKS[1]] })
    clearTasks.mockResolvedValue({ deleted: 1, kept: 1 })
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    await wrapper.find('.task-clear').trigger('click')
    await clickDialogButton('Clear all')

    const cards = wrapper.findAllComponents(TaskCard)
    expect(cards).toHaveLength(1)
    expect(cards[0].props('task').id).toBe('t2')
    expect(wrapper.find('.banner').text()).toContain('1 still running')
  })

  it('backs out of the confirmation without asking the server', async () => {
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    await wrapper.find('.task-clear').trigger('click')
    await clickDialogButton('Cancel')
    expect(clearTasks).not.toHaveBeenCalled()
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(2)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()

    // Closing through the dialog's own X goes through the same v-model.
    await wrapper.find('.task-clear').trigger('click')
    await nextTick()
    document.querySelector('.dialog-close').click()
    await flushPromises()
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    expect(clearTasks).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with a localised reason when the server refuses', async () => {
    clearTasks.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'forbidden' }))
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    await wrapper.find('.task-clear').trigger('click')
    await clickDialogButton('Clear all')

    // BaseDialog teleports into document.body, so the reason is read from there.
    expect(document.querySelector('[data-test="clear-error"]').textContent)
      .toBe('You do not have permission to do that.')
    expect(document.querySelector('.dialog-backdrop')).not.toBeNull()
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(2)

    // The same dialog is the retry: a second click asks again and succeeds.
    await clickDialogButton('Clear all')
    expect(clearTasks).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
  })

  it('sends one request per confirmation, however often the button is pressed', async () => {
    listTasks.mockResolvedValueOnce({ tasks: rows() })
    listTasks.mockResolvedValue({ tasks: [] })
    let release
    clearTasks.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    await wrapper.find('.task-clear').trigger('click')
    await nextTick()
    dialogButton('Clear all').click()
    await nextTick()

    // The footer is disabled while the request is in flight, so the guard is
    // reached by calling the handler the way a second click would.
    expect(dialogButton('Clear all').disabled).toBe(true)
    await wrapper.vm.confirmClear()
    expect(clearTasks).toHaveBeenCalledTimes(1)

    release({ deleted: 2, kept: 0 })
    await flushPromises()
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(0)
  })

  it('resets a filtered view after the clear', async () => {
    listTasks.mockResolvedValueOnce({ tasks: rows() })
    listTasks.mockResolvedValue({ tasks: [] })
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'Finished').trigger('click')
    await nextTick()
    expect(wrapper.findAllComponents(TaskCard)).toHaveLength(1)

    await wrapper.find('.task-clear').trigger('click')
    await clickDialogButton('Clear all')

    expect(wrapper.vm.filter).toBe('all')
    expect(wrapper.text()).toContain('No tasks yet.')
  })
})

describe('TaskTraceView — back to Tasks', () => {
  it('returns to the list with a localised label in all 13 languages', async () => {
    const { wrapper, router } = mountView(TaskTraceView, { props: { id: 't1' } })
    await flushPromises()
    await router.isReady()
    await router.push('/tasks/t1')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks/t1')

    const link = wrapper.find('.task-back')
    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toContain('/tasks')

    for (const lang of LANG_CODES) {
      setLang(lang)
      await nextTick()
      const label = useCopy('task').t('backToTasks')
      expect(label, `${lang}.backToTasks missing`).toBeTruthy()
      expect(wrapper.find('.task-back').text()).toContain(label)
      expect(document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr')
      if (lang !== 'en') {
        expect(label, `${lang}.backToTasks equals English`).not.toBe('Back to Tasks')
      }
    }

    setLang('zh')
    await nextTick()
    expect(wrapper.find('.task-back').text()).toContain('返回任务')
    await wrapper.find('.task-back').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks')
  })

  it('stays available while the task is still loading', async () => {
    getTask.mockReturnValue(new Promise(() => {}))
    const { wrapper, router } = mountView(TaskTraceView, { props: { id: 't1' } })
    await flushPromises()
    await router.isReady()
    await router.push('/tasks/t1')
    await flushPromises()

    const link = wrapper.find('.task-back')
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks')
  })

  it('stays available when the task does not exist', async () => {
    getTask.mockRejectedValue(Object.assign(new Error('nope'), { code: 'not_found' }))
    const { wrapper } = mountView(TaskTraceView, { props: { id: 'gone' } })
    await flushPromises()

    expect(wrapper.text()).toContain('That task does not exist, or you cannot see it.')
    expect(wrapper.find('.task-back').exists()).toBe(true)
  })
})

describe('task copy — clearing and going back in 13 languages', () => {
  const KEYS = ['backToTasks', 'clearAll', 'clearAllTitle', 'clearAllBody', 'clearAllKept']

  it('translates every clear and back key', () => {
    for (const lang of LANG_CODES) {
      setLang(lang)
      const { t } = useCopy('task')
      for (const key of KEYS) {
        expect(t(key), `${lang}.${key} missing`).toBeTruthy()
        if (lang !== 'en') {
          expect(t(key), `${lang}.${key} equals English`).not.toBe(taskCopy.en[key])
        }
      }
    }
  })

  it('renders the trigger, the confirmation and the kept note in Chinese', async () => {
    setLang('zh')
    listTasks.mockResolvedValueOnce({ tasks: rows() })
    listTasks.mockResolvedValue({ tasks: [TASKS[1]] })
    clearTasks.mockResolvedValue({ deleted: 1, kept: 1 })
    const { wrapper } = mountView(TaskListView)
    await flushPromises()

    await wrapper.find('.task-clear').trigger('click')
    expect(document.body.textContent).toContain('清理已结束的任务？')
    expect(document.body.textContent).toContain('已结束的运行会连同产物与追踪一起从服务端删除')

    await clickDialogButton('清理全部')
    expect(wrapper.find('.banner').text()).toContain('1 个任务仍在进行，记录已保留。')
  })
})
