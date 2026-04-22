const {
  buildRehearsalNetworkPayload,
  REHEARSAL_NETWORK_FAST_FORWARD_START_LEAD_SECONDS,
  REHEARSAL_NETWORK_LEAD_SECONDS,
} = require('./rehearsal-devnet')

describe('rehearsal devnet payloads', () => {
  it('keeps the regular rehearsal timing by default', () => {
    expect(
      buildRehearsalNetworkPayload({
        connectApp: true,
      })
    ).toMatchObject({
      nodeCount: 9,
      firstCeremonyLeadSeconds: REHEARSAL_NETWORK_LEAD_SECONDS,
      seedFlipCount: 27,
      connectApp: true,
      connectCountdownSeconds: null,
    })
  })

  it('uses the fast-forward timing and strips post-session padding', () => {
    expect(
      buildRehearsalNetworkPayload({
        connectApp: true,
        fastForward: true,
      })
    ).toMatchObject({
      nodeCount: 9,
      firstCeremonyLeadSeconds:
        REHEARSAL_NETWORK_FAST_FORWARD_START_LEAD_SECONDS,
      seedFlipCount: 27,
      afterLongSessionSeconds: 0,
      validationPaddingSeconds: 0,
      connectApp: true,
      connectCountdownSeconds: 90,
    })
  })
})
