const {STRICT_PROFILE} = require('./constants')
const {sanitizeBenchmarkProfile} = require('./profile')

describe('sanitizeBenchmarkProfile', () => {
  it('returns strict defaults when benchmarkProfile is not custom', () => {
    expect(sanitizeBenchmarkProfile()).toStrictEqual(STRICT_PROFILE)
    expect(
      sanitizeBenchmarkProfile({benchmarkProfile: 'strict'})
    ).toStrictEqual(STRICT_PROFILE)
  })

  it('clamps custom values to allowed limits', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        deadlineMs: 999999,
        requestTimeoutMs: 5,
        maxConcurrency: 99,
        maxRetries: -1,
        maxOutputTokens: 1,
      })
    ).toStrictEqual({
      benchmarkProfile: 'custom',
      deadlineMs: 180000,
      requestTimeoutMs: 1000,
      maxConcurrency: 6,
      maxRetries: 0,
      maxOutputTokens: 16,
    })
  })
})
