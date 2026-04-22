const {
  buildRehearsalNetworkPayload,
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
})
