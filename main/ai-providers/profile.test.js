const {STRICT_PROFILE} = require('./constants')
const {sanitizeBenchmarkProfile} = require('./profile')

describe('sanitizeBenchmarkProfile', () => {
  it('returns strict defaults when benchmarkProfile is not custom', () => {
    expect(sanitizeBenchmarkProfile()).toStrictEqual(STRICT_PROFILE)
    expect(
      sanitizeBenchmarkProfile({benchmarkProfile: 'strict'})
    ).toStrictEqual(STRICT_PROFILE)
  })

  it('allows vision mode override while keeping strict defaults', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'strict',
        flipVisionMode: 'frames_single_pass',
      })
    ).toStrictEqual({
      ...STRICT_PROFILE,
      flipVisionMode: 'frames_single_pass',
    })
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
      maxOutputTokens: 1,
      interFlipDelayMs: 0,
      temperature: 0,
      forceDecision: true,
      uncertaintyRepromptEnabled: true,
      uncertaintyConfidenceThreshold: 0.45,
      uncertaintyRepromptMinRemainingMs: 3500,
      uncertaintyRepromptInstruction: '',
      promptTemplateOverride: '',
      flipVisionMode: 'composite',
    })
  })

  it('preserves 0 maxOutputTokens as auto mode', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        maxOutputTokens: 0,
      }).maxOutputTokens
    ).toBe(0)
  })

  it('normalizes custom flip vision mode values', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        flipVisionMode: 'frames_two_pass',
      }).flipVisionMode
    ).toBe('frames_two_pass')

    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        flipVisionMode: 'unknown-mode',
      }).flipVisionMode
    ).toBe('composite')
  })
})
