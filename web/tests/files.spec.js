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
import { errorMessage } from '../src/lib/errors.js'
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

  it('treats a file the server cannot see as already gone', async () => {
    // The delete answers 404 for an id nobody holds, so the reload is the whole
    // point: the row goes away and no refusal is raised in front of it.
    const { wrapper } = mountWith(FilesView)
    await flushPromises()
    listFiles.mockClear()
    listFiles.mockResolvedValue({ files: [], maxBytes: 1024 * 1024, backend: 'local' })

    deleteFile.mockRejectedValue({ code: 'file_not_found' })
    await wrapper.findAll('button').find((b) => b.text().includes('Delete')).trigger('click')
    const confirm = wrapper.findAll('button').filter((b) => b.text().includes('Delete'))
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('No files yet')
    expect(wrapper.text()).not.toContain('brief.pdf')
    expect(wrapper.text()).not.toContain(errorMessage('file_not_found'))
  })

  it('keeps the row when the delete is refused for another reason', async () => {
    // A store that failed is not a file that vanished: the row must survive so
    // the operator can read the reason and try again.
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    deleteFile.mockRejectedValue({ code: 'file_store_error' })
    await wrapper.findAll('button').find((b) => b.text().includes('Delete')).trigger('click')
    const confirm = wrapper.findAll('button').filter((b) => b.text().includes('Delete'))
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(errorMessage('file_store_error'))
    expect(wrapper.text()).toContain('brief.pdf')
  })

  it('reads an answer that carries neither files nor a cap as empty and unlimited', async () => {
    // A server built before the cap was reported answers `{ files: ... }` only;
    // anything at all must degrade to an empty table rather than "undefined".
    listFiles.mockResolvedValueOnce({})
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    expect(wrapper.text()).toContain('No files yet')
    // No cap means no promise to make: the line is simply absent.
    expect(wrapper.text()).not.toContain('per file')
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('prints a size it cannot parse as zero rather than NaN', async () => {
    listFiles.mockResolvedValue({
      files: [{ id: 'file_3', name: 'broken.bin', size: 'not a number', mime: 'text/plain' }],
      maxBytes: 1024,
      backend: 'local',
    })
    const { wrapper } = mountWith(FilesView)
    await flushPromises()
    expect(wrapper.find('[data-col="size"]').text()).toBe('0 B')
  })

  it('reports a delete that failed without a code', async () => {
    // A transport failure rejects with a bare Error: the row stays and the
    // message is all the screen has to explain itself with.
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    deleteFile.mockRejectedValueOnce(new Error('connection reset'))
    await wrapper.findAll('button').find((b) => b.text().includes('Delete')).trigger('click')
    const confirm = wrapper.findAll('button').filter((b) => b.text().includes('Delete'))
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('connection reset')
    expect(wrapper.text()).toContain('brief.pdf')
  })

  it('dashes the columns an older upload never filled in', async () => {
    // A row written before MIME sniffing or before createdAt was recorded still
    // has to render as a row, not as "undefined".
    listFiles.mockResolvedValue({
      files: [{ id: 'file_2', name: 'notes.txt', size: 12, mime: '', createdAt: '' }],
      maxBytes: 1024,
      backend: 'local',
    })
    const { wrapper } = mountWith(FilesView)
    await flushPromises()

    const row = wrapper.find('tbody tr')
    expect(row.text()).toContain('notes.txt')
    expect(row.text()).not.toContain('undefined')
    expect(row.find('[data-col="name"]').text()).toContain('—')
    expect(row.find('[data-col="at"]').text()).toBe('—')
  })

  it('shows the exception message when the failure has no code at all', async () => {
    // A dropped connection rejects without a machine code (no response to read
    // one from). The screen then has only `e.message` to show.
    listFiles.mockRejectedValueOnce(new Error('Upstream refused'))
    const { wrapper } = mountWith(FilesView)
    await flushPromises()
    expect(wrapper.text()).toContain('Upstream refused')

    uploadFile.mockRejectedValueOnce(new Error('Upload refused'))
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'a.txt')],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('Upload refused')
  })
})
