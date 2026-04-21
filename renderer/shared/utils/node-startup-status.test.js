import {
  NODE_STARTUP_PHASE,
  getNodeStartupPhaseCopy,
  isNodeStartupInProgress,
  reduceNodeStartupPhase,
} from './node-startup-status'

describe('node startup status', () => {
  it('detects database compaction from node logs', () => {
    expect(
      reduceNodeStartupPhase(
        'INFO [04-21|06:30:38.662] Start compacting DB ',
        NODE_STARTUP_PHASE.STARTING
      )
    ).toBe(NODE_STARTUP_PHASE.COMPACTING_DB)
  })

  it('advances to waiting for peers when startup logs report no peers', () => {
    expect(
      reduceNodeStartupPhase(
        'INFO [04-21|06:30:45.460] Peers are not found. Assume node is synchronized component=downloader',
        NODE_STARTUP_PHASE.INITIALIZING_SERVICES
      )
    ).toBe(NODE_STARTUP_PHASE.WAITING_FOR_PEERS)
  })

  it('advances to synchronized when node sync completes', () => {
    expect(
      reduceNodeStartupPhase(
        'INFO [04-20|15:32:12.073] Node is synchronized                     component=downloader',
        NODE_STARTUP_PHASE.CONNECTING_TO_NETWORK
      )
    ).toBe(NODE_STARTUP_PHASE.SYNCHRONIZED)
  })

  it('treats compacting database as startup in progress', () => {
    expect(isNodeStartupInProgress(NODE_STARTUP_PHASE.COMPACTING_DB)).toBe(true)
    expect(isNodeStartupInProgress(NODE_STARTUP_PHASE.SYNCHRONIZED)).toBe(false)
  })

  it('returns readable copy for compacting database', () => {
    const t = (value) => value

    expect(
      getNodeStartupPhaseCopy(t, NODE_STARTUP_PHASE.COMPACTING_DB)
    ).toEqual({
      label: 'Compacting node database',
      detail:
        'This maintenance step can take a while before the node becomes usable.',
    })
  })
})
