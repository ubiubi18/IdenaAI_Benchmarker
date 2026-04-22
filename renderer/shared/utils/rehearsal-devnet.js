export const REHEARSAL_NETWORK_NODE_COUNT = 9
export const REHEARSAL_NETWORK_LEAD_SECONDS = 8 * 60
export const REHEARSAL_NETWORK_SEED_FLIP_COUNT = 27

export function buildRehearsalNetworkPayload({connectApp = false} = {}) {
  return {
    nodeCount: REHEARSAL_NETWORK_NODE_COUNT,
    firstCeremonyLeadSeconds: REHEARSAL_NETWORK_LEAD_SECONDS,
    seedFlipCount: REHEARSAL_NETWORK_SEED_FLIP_COUNT,
    connectApp,
    connectCountdownSeconds: null,
  }
}
