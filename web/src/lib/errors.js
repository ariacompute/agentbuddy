// Machine readable codes from the server -> a copy key. The server never sends
// prose: every message a user reads starts here and is localised in copy/.
import { useCopy } from './use-copy.js'

export const CODE_KEYS = {
  bad_request: 'badRequest',
  unauthorized: 'unauthorized',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  not_found: 'notFound',
  method_not_allowed: 'methodNotAllowed',
  invalid_credentials: 'invalidCredentials',
  email_taken: 'emailTaken',
  weak_password: 'weakPassword',
  registration_closed: 'registrationClosed',
  payload_too_large: 'payloadTooLarge',
  rate_limited: 'rateLimited',
  csrf_origin_mismatch: 'csrfOriginMismatch',
  internal_error: 'internalError',
  service_unavailable: 'serviceUnavailable',
  database_down: 'databaseDown',

  resource_not_found: 'resourceNotFound',
  resource_exists: 'resourceExists',
  invalid_kind: 'invalidKind',
  invalid_health: 'invalidHealth',
  invalid_endpoint: 'invalidEndpoint',
  resource_not_discoverable: 'resourceNotDiscoverable',

  task_not_found: 'taskNotFound',
  task_not_cancelable: 'taskNotCancelable',
  task_not_resumable: 'taskNotResumable',
  invalid_state_transition: 'invalidStateTransition',
  push_notification_not_supported: 'pushNotificationNotSupported',

  thread_not_found: 'threadNotFound',
  empty_message: 'emptyMessage',
  threads_unavailable: 'threadsUnavailable',

  // Channels, connectors and speech — added for agentbuddy.
  channel_disabled: 'channelDisabled',
  channel_not_found: 'channelNotFound',
  channel_signature_missing: 'channelSignatureMissing',
  channel_signature_invalid: 'channelSignatureInvalid',
  channel_timestamp_expired: 'channelTimestampExpired',
  channel_payload_invalid: 'channelPayloadInvalid',
  delivery_failed: 'deliveryFailed',
  // A retry only means something for one outbound receipt that never left.
  delivery_not_found: 'deliveryNotFound',
  delivery_not_retryable: 'deliveryNotRetryable',
  connector_not_found: 'connectorNotFound',
  connector_action_denied: 'connectorActionDenied',
  connector_policy_off: 'connectorPolicyOff',
  // The approval queue: "gone" and "already decided" are different answers.
  connector_approval_not_found: 'connectorApprovalNotFound',
  connector_approval_closed: 'connectorApprovalClosed',

  // Shared files. files_disabled is a configuration, not a fault; the rest
  // describe what went wrong once a backend is configured.
  files_disabled: 'filesDisabled',
  file_not_found: 'fileNotFound',
  file_too_large: 'fileTooLarge',
  file_unsupported: 'fileUnsupported',
  file_store_error: 'fileStoreError',
  audio_too_large: 'audioTooLarge',
  audio_unsupported: 'audioUnsupported',
  audio_transcribe_failed: 'audioTranscribeFailed',
  speech_disabled: 'speechDisabled',

  // Computers, schedules and knowledge — agent capabilities (F10-F16).
  computer_not_found: 'computerNotFound',
  schedule_not_found: 'scheduleNotFound',
  schedule_invalid: 'scheduleInvalid',
  skill_distill_disabled: 'skillDistillDisabled',
  // Single sentinel for any agent-capability endpoint whose backend store is not
  // wired in (computers / schedules / knowledge). Replaces computer_disabled and
  // knowledge_unavailable, which were split by feature.
  feature_unavailable: 'featureUnavailable',

  // Scheduler. Each code names the guardrail that refused the command, so the
  // console can explain rather than apologise.
  router_ticket_not_found: 'routerTicketNotFound',
  router_trigger_not_found: 'routerTriggerNotFound',
  router_thread_not_found: 'routerThreadNotFound',
  router_ticket_closed: 'routerTicketClosed',
  router_handback_exhausted: 'routerHandbackExhausted',
  router_policy_invalid: 'routerPolicyInvalid',
  router_resource_unset: 'routerResourceUnset',

  // Execution environments. sandbox_unsupported is deliberately distinct from
  // sandbox_disabled: the first is "this host cannot run the backend" (install
  // it), the second is "nobody switched the feature on here" (configure it).
  sandbox_disabled: 'sandboxDisabled',
  sandbox_unsupported: 'sandboxUnsupported',
  sandbox_unknown_provider: 'sandboxUnknownProvider',
  sandbox_policy_denied: 'sandboxPolicyDenied',
  sandbox_timeout: 'sandboxTimeout',
  sandbox_node_offline: 'sandboxNodeOffline',
  sandbox_lease_lost: 'sandboxLeaseLost',
  sandbox_limit_reached: 'sandboxLimitReached',
  // The backend was chosen but cannot do what the profile asked for (a network
  // mode it never claimed to support); the request is refused, not downgraded.
  sandbox_capability_unavailable: 'sandboxCapabilityUnavailable',
}

/** Returns the localised message for a machine readable code. */
export function errorMessage(code) {
  if (!code) return ''
  const { t } = useCopy('errors')
  const key = CODE_KEYS[code]
  const message = key ? t(key) : ''
  return message || code
}
