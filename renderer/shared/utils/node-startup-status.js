export const NODE_STARTUP_PHASE = {
  IDLE: 'idle',
  STARTING: 'starting',
  COMPACTING_DB: 'compacting-db',
  INITIALIZING_SERVICES: 'initializing-services',
  WAITING_FOR_PEERS: 'waiting-for-peers',
  CONNECTING_TO_NETWORK: 'connecting-to-network',
  SYNCHRONIZED: 'synchronized',
}

function toLogLines(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String)
  }

  if (typeof value === 'string' && value.trim()) {
    return [value]
  }

  return []
}

export function reduceNodeStartupPhase(
  logPayload,
  currentPhase = NODE_STARTUP_PHASE.IDLE
) {
  return toLogLines(logPayload).reduce((phase, line) => {
    if (line.includes('Start compacting DB')) {
      return NODE_STARTUP_PHASE.COMPACTING_DB
    }

    if (
      line.includes('DB compacted') ||
      line.includes('Chain initialized') ||
      line.includes('Ipfs initialized') ||
      line.includes('initial HTTP endpoint opened') ||
      line.includes('HTTP endpoint opened')
    ) {
      return NODE_STARTUP_PHASE.INITIALIZING_SERVICES
    }

    if (line.includes('Peers are not found')) {
      return NODE_STARTUP_PHASE.WAITING_FOR_PEERS
    }

    if (line.includes('Peer connected')) {
      return NODE_STARTUP_PHASE.CONNECTING_TO_NETWORK
    }

    if (line.includes('Node is synchronized')) {
      return NODE_STARTUP_PHASE.SYNCHRONIZED
    }

    return phase
  }, currentPhase)
}

export function isNodeStartupInProgress(phase) {
  return (
    phase &&
    ![NODE_STARTUP_PHASE.IDLE, NODE_STARTUP_PHASE.SYNCHRONIZED].includes(phase)
  )
}

export function getNodeStartupPhaseCopy(t, phase) {
  switch (phase) {
    case NODE_STARTUP_PHASE.STARTING:
      return {
        label: t('Starting built-in node'),
        detail: t('Launching the node process and preparing local services.'),
      }
    case NODE_STARTUP_PHASE.COMPACTING_DB:
      return {
        label: t('Compacting node database'),
        detail: t(
          'This maintenance step can take a while before the node becomes usable.'
        ),
      }
    case NODE_STARTUP_PHASE.INITIALIZING_SERVICES:
      return {
        label: t('Initializing chain and IPFS'),
        detail: t(
          'Loading chain state, IPFS, and the local RPC service for the built-in node.'
        ),
      }
    case NODE_STARTUP_PHASE.WAITING_FOR_PEERS:
      return {
        label: t('Waiting for peers'),
        detail: t(
          'The node is up but has not found peers yet, so network sync and validation readiness are still pending.'
        ),
      }
    case NODE_STARTUP_PHASE.CONNECTING_TO_NETWORK:
      return {
        label: t('Connecting to the network'),
        detail: t(
          'Peers are connected. Final synchronization checks are still in progress.'
        ),
      }
    case NODE_STARTUP_PHASE.SYNCHRONIZED:
      return {
        label: t('Node synchronized'),
        detail: t('The built-in node is ready.'),
      }
    default:
      return {
        label: t('Idena Node is starting...'),
        detail: t('Please wait while the built-in node starts.'),
      }
  }
}
