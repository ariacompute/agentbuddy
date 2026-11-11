// Deterministic agenthub-shaped data. Response shapes are aligned with the
// mocks in web/tests/*.spec.js, so the real Vue views render against the stub
// exactly as they do in the unit suite.
export const ISO = '2026-11-11T09:00:00.000Z'
export const LATER = '2026-11-11T09:05:00.000Z'

const task = (id, state, extra = {}) => ({
  id,
  contextId: 'thread-1',
  resourceId: 'agent-1',
  status: {
    state,
    message: { parts: [{ text: `${id} ${state}` }] },
    timestamp: ISO,
    durationMs: 1200,
  },
  artifacts: [],
  spans: [{ name: 'plan', status: 'completed', durationMs: 40 }, { name: 'invoke', status: 'running', durationMs: 12 }],
  lastSeq: 3,
  ...extra,
})

export function makeFixtures() {
  return {
    user: { id: 'user-e2e', name: 'E2E Operator', displayName: 'E2E Operator', isOwner: true, permissions: [] },
    authConfig: {
      oauth: [{ id: 'github', name: 'GitHub', url: 'https://example.invalid/oauth/github' }],
      registrationOpen: true,
    },
    healthz: { status: 'ok', auth: 'session', database: 'up', version: 'e2e-stub-1.0', commit: 'abc1234' },
    agents: [
      { id: 'agent-1', name: 'Planner', display_name: 'Planner', health: 'healthy', persona: { mbti: 'INTJ' }, tags: ['core'], description: 'Plans work' },
      { id: 'agent-2', name: 'Scout', display_name: 'Scout', health: 'degraded', persona: { mbti: 'ENTP' }, tags: ['research'], description: 'Searches' },
    ],
    activity: [
      { id: 'task-3', status: { state: 'completed' }, resourceId: 'agent-1' },
      { id: 'task-4', status: { state: 'failed' }, resourceId: 'agent-2' },
    ],
    threads: [
      { ID: 'thread-1', Title: 'Refund triage', Channel: 'desktop', Status: 'open', Participants: ['agent-1'] },
      { ID: 'thread-2', Title: 'Nightly digest', Channel: 'desktop', Status: 'open', Participants: [] },
    ],
    messages: {
      'thread-1': [
        { ID: 'm-1', AuthorType: 'user', AuthorID: 'user-e2e', AuthorName: 'E2E Operator', ResourceID: '', Body: 'Please triage the refund queue', CreatedAt: ISO, TaskID: '', Origin: '', Failed: false },
        { ID: 'm-2', AuthorType: 'agent', AuthorID: 'agent-1', AuthorName: 'Planner', ResourceID: 'agent-1', Body: 'On it.', CreatedAt: LATER, TaskID: 'task-1', Origin: '', Failed: false },
      ],
      'thread-2': [],
    },
    tasks: [
      task('task-1', 'working'),
      task('task-2', 'input-required'),
      task('task-3', 'completed', {
        artifacts: [{ parts: [{ type: 'text', text: 'summary' }, { type: 'file', file: { name: 'report.txt', mimeType: 'text/plain', bytes: 'aGVsbG8=', uri: '' } }] }],
      }),
      task('task-4', 'failed'),
    ],
    channels: [
      { id: 'channel-1', name: 'Ops Slack', kind: 'slack', enabled: true, threadId: 'thread-1', signingKeyEnv: 'SLACK_SIGNING', destination: '', participants: ['agent-1'] },
      { id: 'channel-2', name: 'SMS pager', kind: 'sms', enabled: false, threadId: 'thread-2', signingKeyEnv: '', destination: '+100000000', participants: [] },
    ],
    deliveries: {
      'channel-1': [
        { id: 'delivery-1', direction: 'outbound', status: 'failed', at: ISO, createdAt: ISO, errorCode: 'delivery_failed', error: 'delivery_failed', body: 'retry me' },
        { id: 'delivery-2', direction: 'outbound', status: 'delivered', at: LATER, createdAt: LATER },
        { id: 'delivery-3', direction: 'inbound', status: 'received', at: ISO, createdAt: ISO },
      ],
      'channel-2': [],
    },
    connectors: [
      { id: 'connector-1', name: 'Jira MCP', endpoint: 'https://example.invalid/mcp', policy: 'ask', capabilities: ['create_issue'], health: 'healthy' },
      { id: 'connector-2', name: 'Files MCP', endpoint: 'https://example.invalid/files', policy: 'off', capabilities: ['read_file'], health: 'degraded' },
    ],
    connectorActions: {
      'connector-1': { id: 'connector-1', policy: 'ask', actions: [{ name: 'create_issue', description: 'Open an issue' }, { name: 'list_issues', description: 'List issues' }] },
      'connector-2': { id: 'connector-2', policy: 'off', actions: [{ name: 'read_file', description: 'Read a file' }] },
    },
    approvals: [
      { taskId: 'approval-1', resourceId: 'connector-1', connectorId: 'connector-1', connectorName: 'Jira MCP', action: 'create_issue', args: { project: 'OPS' }, requestedBy: 'user-e2e', asked: 'Approve create_issue', createdAt: ISO },
    ],
    resources: [
      { id: 'resource-1', name: 'planner', kind: 'agent', display_name: 'Planner', health: 'healthy', capabilities: ['plan'], persona: { displayName: 'Planner', jobTitle: 'Planner', role: 'Coordinator', mbti: 'INTJ', instruction: 'Be concise', avatar: '' } },
      { id: 'resource-2', name: 'refund-skill', kind: 'skill', display_name: 'Refund skill', health: 'healthy', capabilities: ['refund'] },
      { id: 'connector-1', name: 'Jira MCP', kind: 'mcp', display_name: 'Jira MCP', health: 'healthy', capabilities: ['create_issue'] },
    ],
    computers: [
      { id: 'computer-1', kind: 'shell', status: 'idle', agentId: 'agent-1', lastAction: 'attached' },
    ],
    sandboxStats: { activeLeases: 1, pendingJobs: 0, onlineNodes: 1, recentExecs: 4, lastSweepAt: ISO },
    sandboxes: {
      leases: [{ id: 'sandbox-1', provider: 'docker', state: 'ready', resourceId: 'agent-1', scope: 'task', nodeId: 'node-1', ref: 'c0ffee', execs: 1, expiresAt: LATER }],
      default: { provider: 'docker' },
    },
    sandboxExecs: {
      'sandbox-1': [{ id: 'exec-1', command: 'git', exitCode: 0, durationMs: 5, at: ISO, dryRun: false }],
    },
    sandboxProviders: {
      groups: [{ layer: 'container', providers: [{ name: 'docker', available: true, default: true, isolation: 'container', reason: '', requires: [] }, { name: 'podman', available: false, default: false, isolation: 'container', reason: 'podman is not installed', requires: ['podman'] }] }],
      default: 'docker',
    },
    sandboxNodes: { nodes: [{ id: 'node-1', name: 'E2E laptop', status: 'online', lastSeenAt: ISO }] },
    schedules: [{ id: 'schedule-1', goal: 'Refund triage', trigger: 'cron', cronExpr: '0 * * * *', enabled: true, nextRun: LATER, lastStatus: 'completed' }],
    router: {
      stats: { pending: 1, runningTickets: 1, waiting: 0, batchSize: 2, passes: 7 },
      triggers: [{ id: 'trigger-1', source: 'slack', sourceId: 'ch-1', disposition: 'routed', at: ISO, body: 'please refund order 42', ticketId: 'ticket-1' }],
      tickets: [{ id: 'ticket-1', originTriggerId: 'trigger-1', state: 'working', createdAt: ISO, updatedAt: LATER, attempts: 1, lastError: '', taskId: 'task-1' }],
      policies: [{ source: 'slack', mode: 'off', allow: ['@ops'], keywords: ['refund'], resource: 'agent-1' }],
    },
    knowledge: [
      { id: 'knowledge-1', agentId: 'agent-1', chunkText: 'The refund window is 30 days.', sourceRef: 'policy.md', createdAt: ISO },
      { id: 'knowledge-2', agentId: 'agent-2', chunkText: 'Escalate anything over 500.', sourceRef: 'runbook.md', createdAt: LATER },
    ],
    files: [
      { id: 'file-1', name: 'brief.txt', mime: 'text/plain', size: 12, sha256: 'a'.repeat(64), backend: 'local', createdAt: ISO },
    ],
    fileBytes: { 'file-1': Buffer.from('hello e2e!\n') },
    filesMeta: { maxBytes: 32 * 1024 * 1024, backend: 'local' },
  }
}

/** Empty-state shapes keyed by the route that returns them. */
export const EMPTY_SHAPES = {
  '/api/workspace': { agents: [], activity: [] },
  '/api/threads': { threads: [] },
  '/api/tasks': { tasks: [] },
  '/api/channels': { channels: [] },
  '/api/connectors': { connectors: [] },
  '/api/connectors/approvals': [],
  '/api/resources': { resources: [] },
  '/api/computers': { computers: [] },
  '/api/schedules': { schedules: [] },
  '/api/router/triggers': { triggers: [] },
  '/api/router/tickets': { tickets: [] },
  '/api/router/policies': { policies: [] },
  '/api/knowledge': [],
  '/api/files': { files: [], maxBytes: 32 * 1024 * 1024, backend: 'local' },
  '/api/sandboxes': { leases: [], default: {} },
  '/api/sandbox-providers': { groups: [], default: '' },
  '/api/sandbox-nodes': { nodes: [] },
}
