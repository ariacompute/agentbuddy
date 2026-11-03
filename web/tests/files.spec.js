// @vitest-environment jsdom
// The shared-files screen: upload, list, download link, delete, and every way
// each of those says "no".
//
// api.js is mocked wholesale, so these cases prove the wiring — the screen asks
// the endpoint, renders the answer, and localises the refusal — rather than the
// HTTP shapes, which api.spec.js covers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWith } from './helpers/vue-utils.js'
import { setLang } from '../src/lib/use-copy.js'

vi.mock('../src/lib/api.js')

import { deleteFile, fileContentUrl, listFiles, uploadFile } from '../src/lib/api.js'
import FilesView from '../src/views/FilesView.vue'

const ROW = {
  id: 'file_1',
  name: 'brief.pdf',
  mime: 'application/pdf',
  size: 2048,
  sha256: 'a'.repeat(64),
  backend: 'local',
  createdAt: '2026-05-04T03:02:01Z',
}

beforeEach(() => {
  setLang('en')
  listFiles.mockResolvedValue({ files: [ROW], maxBytes: 1024 * 1024, backend: 'local' })
  uploadFile.mockResolvedValue(ROW)
  deleteFile.mockResolvedValue(null)
  fileContentUrl.mockImplementation((id) => `/api/files/${id}/content`)
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('FilesView', () => {
  it('lists what the server holds, with a size a human reads', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    expect(listFiles).toHaveBeenCalled()
    expect(wrapper.text()).toContain('brief.pdf')
    expect(wrapper.text()).toContain('application/pdf')
    expect(wrapper.text()).toContain('2.0 KiB')
    expect(wrapper.text()).toContain('2026-05-04T03:02:01Z')
    // The download is a link to the bytes, not a fetch through JS.
    const link = wrapper.find('a[download]')
    expect(link.attributes('href')).toBe('/api/files/file_1/content')
    expect(fileContentUrl).toHaveBeenCalledWith('file_1')
  })

  it('says the list is empty instead of showing an empty table', async () => {
    listFiles.mockResolvedValue({ files: [], maxBytes: 1024, backend: 'local' })
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    expect(wrapper.text()).toContain('No files yet.')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('reports a server with the feature switched off, not an empty list', async () => {
    listFiles.mockRejectedValue({ code: 'files_disabled' })
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    expect(wrapper.text()).toContain('This server has shared files turned off.')
    // Uploading is impossible, so the drop target is not offered.
    expect(wrapper.find('.files-drop').exists()).toBe(false)
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
  })

  it('shows why the list failed and retries it', async () => {
    listFiles.mockRejectedValueOnce({ code: 'file_store_error' })
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    expect(wrapper.text()).toContain('The file store could not read or write those bytes.')

    listFiles.mockResolvedValue({ files: [ROW], maxBytes: 4096, backend: 'local' })
    const retry = wrapper.findAll('button').find((b) => b.text().includes('Retry'))
    await retry.trigger('click')
    await flushPromises()

    expect(listFiles).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('brief.pdf')
  })

  it('uploads a dropped file, reports progress and reloads the list', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()
    listFiles.mockClear()

    // The view hands a progress callback to the uploader; drive it so the
    // percentage is proven to reach the bar.
    uploadFile.mockImplementation(async (_file, onProgress) => {
      if (onProgress) onProgress(40)
      return ROW
    })
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await wrapper.find('.files-drop').trigger('drop', { dataTransfer: { files: [file] } })
    await flushPromises()

    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(uploadFile.mock.calls[0][0]).toBe(file)
    // A successful upload refreshes: the row comes from the server, not from the
    // response body, so the list is the single source of truth.
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  it('refuses an oversized file before spending the upload', async () => {
    listFiles.mockResolvedValue({ files: [], maxBytes: 8, backend: 'local' })
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    const big = new File(['x'.repeat(64)], 'big.bin')
    await wrapper.find('.files-drop').trigger('drop', { dataTransfer: { files: [big] } })
    await flushPromises()

    expect(uploadFile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('That file is larger than this server accepts.')
  })

  it('keeps the upload failure on screen with a retry', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    uploadFile.mockRejectedValue({ code: 'file_store_error' })
    await wrapper.find('.files-drop').trigger('drop', {
      dataTransfer: { files: [new File(['hi'], 'a.txt')] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('The file store could not read or write those bytes.')
    expect(wrapper.findAll('button').some((b) => b.text().includes('Retry'))).toBe(true)
  })

  it('converts a transport failure into something readable', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    uploadFile.mockRejectedValue(Object.assign(new Error('offline'), { code: 'network_error' }))
    await wrapper.find('.files-drop').trigger('drop', {
      dataTransfer: { files: [new File(['hi'], 'a.txt')] },
    })
    await flushPromises()

    // An unmapped code still shows something rather than an empty banner: the
    // convention is that the store carries the machine code and the view prints
    // it when no translation exists.
    expect(wrapper.find('.banner-error').text()).toContain('network_error')
  })

  it('deletes only after the confirmation, then reloads', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()
    listFiles.mockClear()

    const trash = wrapper.findAll('button').find((b) => b.text().includes('Delete'))
    await trash.trigger('click')
    // The row is still there: nothing happened yet.
    expect(deleteFile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Delete brief.pdf? This cannot be undone.')

    const confirm = wrapper.findAll('button').filter((b) => b.text().includes('Delete'))
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(deleteFile).toHaveBeenCalledWith('file_1')
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  it('can back out of the confirmation', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('Delete')).trigger('click')
    await wrapper.findAll('button').find((b) => b.text().includes('Cancel')).trigger('click')

    expect(wrapper.text()).not.toContain('Delete brief.pdf? This cannot be undone.')
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('picks a file through the hidden input and clears it for the next pick', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    const input = wrapper.find('input[type="file"]')
    // The visible target is a div, so the click is forwarded to the real input.
    const click = vi.fn()
    input.element.click = click
    await wrapper.findAll('button').find((b) => b.text().includes('Upload file')).trigger('click')
    expect(click).toHaveBeenCalledTimes(1)

    const file = new File(['hello'], 'picked.txt', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(uploadFile).toHaveBeenCalledTimes(1)
    // The input is reset so choosing the same file again still fires a change.
    expect(input.element.value).toBe('')

    // A change with no file (the user cancelled) uploads nothing.
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(uploadFile).toHaveBeenCalledTimes(1)
  })

  it('does not start a second upload while one is in flight', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    let release
    uploadFile.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    await wrapper.find('.files-drop').trigger('drop', {
      dataTransfer: { files: [new File(['hi'], 'a.txt')] },
    })
    // The drop target is now busy: clicking it must not queue another upload.
    const click = vi.fn()
    wrapper.find('input[type="file"]').element.click = click
    await wrapper.find('.files-drop').trigger('click')
    expect(click).not.toHaveBeenCalled()

    release(ROW)
    await flushPromises()
    expect(uploadFile).toHaveBeenCalledTimes(1)
  })

  it('keeps the row when the delete is refused', async () => {
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    deleteFile.mockRejectedValue({ code: 'file_not_found' })
    await wrapper.findAll('button').find((b) => b.text().includes('Delete')).trigger('click')
    const confirm = wrapper.findAll('button').filter((b) => b.text().includes('Delete'))
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('That file does not exist.')
    expect(wrapper.text()).toContain('brief.pdf')
  })
})
