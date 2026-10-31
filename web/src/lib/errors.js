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
  connector_not_found: 'connectorNotFound',
  connector_action_denied: 'connectorActionDenied',
  connector_policy_off: 'connectorPolicyOff',
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
}

/** Returns the localised message for a machine readable code. */
export function errorMessage(code) {
  if (!code) return ''
  const { t } = useCopy('errors')
  const key = CODE_KEYS[code]
  const message = key ? t(key) : ''
  return message || code
}
