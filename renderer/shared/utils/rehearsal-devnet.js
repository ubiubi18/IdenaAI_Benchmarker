export const REHEARSAL_NETWORK_NODE_COUNT = 9
export const REHEARSAL_NETWORK_LEAD_SECONDS = 8 * 60
export const REHEARSAL_NETWORK_FAST_FORWARD_START_LEAD_SECONDS = 50
export const REHEARSAL_NETWORK_FAST_FORWARD_CONNECT_SECONDS = 90
export const REHEARSAL_NETWORK_SEED_FLIP_COUNT = 27
export const REHEARSAL_NETWORK_FAST_FORWARD_AFTER_LONG_SESSION_SECONDS = 0
export const REHEARSAL_NETWORK_FAST_FORWARD_VALIDATION_PADDING_SECONDS = 0

export function buildRehearsalNetworkPayload({
  connectApp = false,
  fastForward = false,
} = {}) {
  return {
    nodeCount: REHEARSAL_NETWORK_NODE_COUNT,
    firstCeremonyLeadSeconds: fastForward
      ? REHEARSAL_NETWORK_FAST_FORWARD_START_LEAD_SECONDS
      : REHEARSAL_NETWORK_LEAD_SECONDS,
    seedFlipCount: REHEARSAL_NETWORK_SEED_FLIP_COUNT,
    afterLongSessionSeconds: fastForward
      ? REHEARSAL_NETWORK_FAST_FORWARD_AFTER_LONG_SESSION_SECONDS
      : undefined,
    validationPaddingSeconds: fastForward
      ? REHEARSAL_NETWORK_FAST_FORWARD_VALIDATION_PADDING_SECONDS
      : undefined,
    connectApp,
    connectCountdownSeconds:
      connectApp && fastForward
        ? REHEARSAL_NETWORK_FAST_FORWARD_CONNECT_SECONDS
        : null,
  }
}
