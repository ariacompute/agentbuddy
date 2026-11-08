// @vitest-environment jsdom
// The connector screen's approval queue: what a person still has to decide, and
// the two decisions they can make.
//
// The queue is derived from parked A2A tasks on the server, so what matters here
// is that the screen reads it, shows enough to decide with (connector, action,
// arguments), and re-reads it after a decision instead of assuming the answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWith } from './helpers/vue-utils.js'
import { setLang } from '../src/lib/use-copy.js'

vi.mock('../src/lib/api.js')

import {
  approveConnectorAction, getConnectorActions, listConnectorApprovals, listConnectors,
  listTasks, rejectConnectorAction,
} from '../src/lib/api.js'
import ConnectorsView from '../src/views/ConnectorsView.vue'

const PARKED = {
  taskId: 'task-9',
  resourceId: 'res-mcp',
  connectorId: 'res-mcp',
  connectorName: 'jira',
  action: 'create_issue',
  args: { project: 'OPS', summary: 'disk full' },
  requestedBy: 'alice',
  asked: 'approve to run create_issue',
  createdAt: '2026-05-04T03:02:01Z',
}

beforeEach(() => {
  setLang('en')
  listConnectors.mockResolvedValue({ connectors: [] })
  listTasks.mockResolvedValue({ tasks: [] })
  getConnectorActions.mockResolvedValue({ actions: [] })
  listConnectorApprovals.mockResolvedValue([PARKED])
  approveConnectorAction.mockResolvedValue({ id: 'task-9' })
  rejectConnectorAction.mockResolvedValue({ id: 'task-9' })
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('ConnectorsView approvals', () => {
  it('shows the connector, the action and the arguments a person is agreeing to', async () => {
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    expect(listConnectorApprovals).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('jira')
    expect(text).toContain('create_issue')
    // The arguments are the whole point of asking: they must be on the row.
    expect(text).toContain('"project":"OPS"')
    expect(text).toContain('2026-05-04T03:02:01Z')
  })

  it('says nothing is pending rather than showing an empty box', async () => {
    listConnectorApprovals.mockResolvedValue([])
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Nothing is waiting for you.')
    expect(wrapper.find('.trigger-list').exists()).toBe(false)
  })

  it('approves one request and re-reads the queue', async () => {
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()
    expect(listConnectorApprovals).toHaveBeenCalledTimes(1)

    // The queue empties after the decision, which is what the second read sees.
    listConnectorApprovals.mockResolvedValue([])
    const approve = wrapper.findAll('button').find((b) => b.text().includes('Approve'))
    await approve.trigger('click')
    await flushPromises()

    expect(approveConnectorAction).toHaveBeenCalledWith('task-9')
    expect(listConnectorApprovals).toHaveBeenCalledTimes(2)
    // The task list on the other screens changed state as well.
    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Nothing is waiting for you.')
  })

  it('rejects one request without running it', async () => {
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    listConnectorApprovals.mockResolvedValue([])
    const reject = wrapper.findAll('button').find((b) => b.text().includes('Reject'))
    await reject.trigger('click')
    await flushPromises()

    expect(rejectConnectorAction).toHaveBeenCalledWith('task-9')
    expect(approveConnectorAction).not.toHaveBeenCalled()
    expect(listConnectorApprovals).toHaveBeenCalledTimes(2)
  })

  it('keeps the row and explains a refusal', async () => {
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    approveConnectorAction.mockRejectedValue({ code: 'connector_approval_closed' })
    const approve = wrapper.findAll('button').find((b) => b.text().includes('Approve'))
    await approve.trigger('click')
    await flushPromises()

    expect(wrapper.find('.banner-error').text()).toContain('Somebody already decided that request.')
    // The decision failed, so the request is still listed.
    expect(wrapper.text()).toContain('create_issue')
    // A failed decision does not pretend the queue was refreshed.
    expect(listConnectorApprovals).toHaveBeenCalledTimes(1)
  })

  it('still renders a row whose arguments cannot be serialised', async () => {
    // A parked task is decoded from JSON, so this only happens if the server ever
    // sends something JSON.parse cannot round-trip. The row must survive it.
    listConnectorApprovals.mockResolvedValue([{ ...PARKED, args: { big: 1n } }])
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    expect(wrapper.text()).toContain('create_issue')
    expect(wrapper.text()).not.toContain('"big"')
  })

  it('reports a queue it could not read, and retries it', async () => {
    listConnectorApprovals.mockRejectedValueOnce({ code: 'service_unavailable' })
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    expect(wrapper.find('.banner-error').exists()).toBe(true)

    listConnectorApprovals.mockResolvedValue([PARKED])
    const retry = wrapper.findAll('button').find((b) => b.text().includes('Try again'))
    await retry.trigger('click')
    await flushPromises()

    expect(listConnectorApprovals).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('create_issue')
  })

  it('reports a queue and a decision that failed without a machine code', async () => {
    listConnectorApprovals.mockRejectedValueOnce(new Error('socket hang up'))
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()
    expect(wrapper.text()).toContain('socket hang up')

    listConnectorApprovals.mockResolvedValue([PARKED])
    await wrapper.findAll('button').find((b) => b.text().includes('Try again')).trigger('click')
    await flushPromises()

    approveConnectorAction.mockRejectedValueOnce(new Error('approval lost'))
    await wrapper.findAll('button').find((b) => b.text().includes('Approve')).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('approval lost')
    // The row is still there: nothing was deleted optimistically.
    expect(wrapper.text()).toContain('create_issue')
  })

  it('falls back to the connector id, then to a dash, when the name is missing', async () => {
    // The queue is derived from a parked task; a resource deleted between parking
    // and reading leaves the name empty. The row still has to be identifiable.
    listConnectorApprovals.mockResolvedValue([
      { ...PARKED, taskId: 't-1', connectorName: '', connectorId: 'mcp_7' },
      { ...PARKED, taskId: 't-2', connectorName: '', connectorId: '', args: undefined },
    ])
    const { wrapper } = mountWith(ConnectorsView)
    await flushPromises()

    const rows = wrapper.findAll('li.trigger-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('mcp_7')
    expect(rows[1].text()).toContain('—')
    // No arguments means the spacer stands in, not an empty pair of braces.
    expect(rows[1].find('.spacer').exists()).toBe(true)
    expect(rows[1].text()).not.toContain('{}')
  })
})
