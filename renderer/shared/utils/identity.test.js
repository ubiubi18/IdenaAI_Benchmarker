const {getIdentityPublishedFlipsCount} = require('./identity')

describe('getIdentityPublishedFlipsCount', () => {
  it('prefers the explicit flips array when present', () => {
    expect(
      getIdentityPublishedFlipsCount({
        flips: [{id: 1}, {id: 2}],
        madeFlips: 1,
      })
    ).toBe(2)
  })

  it('falls back to madeFlips when rehearsal identities expose null flips', () => {
    expect(
      getIdentityPublishedFlipsCount({
        flips: null,
        flipsWithPair: null,
        madeFlips: 3,
      })
    ).toBe(3)
  })

  it('returns zero for empty or malformed identities', () => {
    expect(getIdentityPublishedFlipsCount(null)).toBe(0)
    expect(getIdentityPublishedFlipsCount({flips: null, madeFlips: null})).toBe(
      0
    )
  })
})
