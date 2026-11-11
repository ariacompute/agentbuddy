// Locators derived from the workbench's own copy tables. A test never hardcodes
// a natural-language label: switching the UI to any of the 13 languages (or to
// `ar`, which flips direction) leaves the same selectors valid.
import { shellCopy } from '../../../web/src/lib/copy/shell-copy.js'
import { workspaceCopy } from '../../../web/src/lib/copy/workspace-copy.js'
import { threadCopy } from '../../../web/src/lib/copy/thread-copy.js'
import { taskCopy } from '../../../web/src/lib/copy/task-copy.js'
import { orgCopy } from '../../../web/src/lib/copy/org-copy.js'
import { channelCopy } from '../../../web/src/lib/copy/channel-copy.js'
import { connectorCopy } from '../../../web/src/lib/copy/connector-copy.js'
import { settingsCopy } from '../../../web/src/lib/copy/settings-copy.js'
import { upgradeCopy } from '../../../web/src/lib/copy/upgrade-copy.js'
import { withCopy } from '../../../web/src/lib/copy/scheduler-copy.js'
import { hubCopy } from '../../../web/src/lib/copy/hub-copy.js'
import { opsCopy } from '../../../web/src/lib/copy/ops-copy.js'
import { filesCopy } from '../../../web/src/lib/copy/files-copy.js'
import { errorsCopy } from '../../../web/src/lib/copy/errors-copy.js'
import { enumsCopy } from '../../../web/src/lib/copy/enums-copy.js'

const COPIES = {
  shell: shellCopy,
  workspace: workspaceCopy,
  thread: threadCopy,
  task: taskCopy,
  org: orgCopy,
  channel: channelCopy,
  connector: connectorCopy,
  settings: withCopy(settingsCopy, upgradeCopy),
  errors: errorsCopy,
  hub: hubCopy,
  ops: opsCopy,
  files: filesCopy,
}

/** Same shallow-merge + English fallback as web/src/lib/use-copy.js. */
export function resolve(table, lang = 'en') {
  return { ...(table?.en || {}), ...(table?.[lang] || {}) }
}

export function t(namespace, key, lang = 'en') {
  return resolve(COPIES[namespace], lang)[key]
}

export function te(namespace, key, lang = 'en') {
  const value = t(namespace, key, lang)
  return typeof value === 'string' && value.length > 0
}

export function enumLabel(group, value, lang = 'en') {
  return resolve(enumsCopy[group] || {}, lang)[value] || value
}

/** The error codes our journeys assert on; maps a machine code to a copy key. */
const ERROR_KEYS = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  invalid_credentials: 'invalidCredentials',
  email_taken: 'emailTaken',
  weak_password: 'weakPassword',
  not_found: 'notFound',
  method_not_allowed: 'methodNotAllowed',
  feature_unavailable: 'featureUnavailable',
  service_unavailable: 'serviceUnavailable',
  internal_error: 'internalError',
  thread_not_found: 'threadNotFound',
  task_not_found: 'taskNotFound',
  channel_not_found: 'channelNotFound',
  delivery_failed: 'deliveryFailed',
  delivery_not_retryable: 'deliveryNotRetryable',
  connector_approval_closed: 'connectorApprovalClosed',
  files_disabled: 'filesDisabled',
  file_too_large: 'fileTooLarge',
  file_not_found: 'fileNotFound',
  file_store_error: 'fileStoreError',
  audio_too_large: 'audioTooLarge',
  computer_not_found: 'computerNotFound',
  schedule_not_found: 'scheduleNotFound',
  router_policy_invalid: 'routerPolicyInvalid',
  sandbox_lease_lost: 'sandboxLeaseLost',
}

export function errorMessage(code, lang = 'en') {
  const key = ERROR_KEYS[String(code)] || String(code)
  return resolve(errorsCopy, lang)[key] || String(code)
}

/** XPath string literal that survives quotes and apostrophes in translations. */
export function xpathLiteral(text) {
  const value = String(text)
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  const parts = value.split("'").map((part) => `'${part}'`)
  return `concat(${parts.join(`, "'", `)})`
}

/** Exact visible-text locator. `tag` defaults to any element. */
export function textXPath(text, tag = '*') {
  return `//${tag}[normalize-space(.)=${xpathLiteral(text)}]`
}

/** Loose visible-text locator, for labels with a `{count}` placeholder. */
export function containsTextXPath(text, tag = '*') {
  return `//${tag}[contains(normalize-space(.),${xpathLiteral(text)})]`
}

export function cssAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function ariaSelector(label) {
  return `[aria-label="${cssAttr(label)}"]`
}

/** Convenience: a CSS selector for a button whose aria-label is a copy key. */
export function byLabel(namespace, key, lang = 'en', root = 'button') {
  return `${root}${ariaSelector(t(namespace, key, lang))}`
}

/** The navigation route each menu item points at, keyed by its copy key. */
export const NAV = [
  ['shell', 'navWorkspace', '/'],
  ['shell', 'navThreads', '/threads'],
  ['shell', 'navTasks', '/tasks'],
  ['shell', 'navOrg', '/org'],
  ['shell', 'navChannels', '/channels'],
  ['shell', 'navConnectors', '/connectors'],
  ['shell', 'navSettings', '/settings'],
  ['hub', 'navComputers', '/computers'],
  ['hub', 'navSchedules', '/schedules'],
  ['ops', 'navPersona', '/persona'],
  ['ops', 'navKnowledge', '/knowledge'],
  ['ops', 'navFiles', '/files'],
]
