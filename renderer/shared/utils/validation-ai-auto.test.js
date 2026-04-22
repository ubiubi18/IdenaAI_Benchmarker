const {EpochPeriod} = require('../types')
const {
  getValidationAiSessionType,
  shouldBlockSessionAutoInDev,
  shouldAutoRunSessionForPeriod,
  shouldShowValidationAiUi,
  shouldShowValidationLocalAiUi,
} = require('./validation-ai-auto')

describe('validation ai auto gating', () => {
  it('detects a short-session AI solve window only in the short answer state', () => {
    const activeStates = new Set([
      'shortSession.solve.answer.normal',
      'shortSession.fetch.done',
    ])

    expect(
      getValidationAiSessionType({
        state: {
          matches: (value) => activeStates.has(value),
        },
      })
    ).toBe('short')
  })

  it('detects a long-session AI solve window when long flips are fetched', () => {
    const activeStates = new Set([
      'longSession.solve.answer.flips',
      'longSession.fetch.flips.done',
    ])

    expect(
      getValidationAiSessionType({
        state: {
          matches: (value) => activeStates.has(value),
        },
      })
    ).toBe('long')
  })

  it('does not offer long-session AI solve before long flips finish fetching', () => {
    const activeStates = new Set([
      'longSession.solve.answer.flips',
      'longSession.fetch.keywords.success',
    ])

    expect(
      getValidationAiSessionType({
        state: {
          matches: (value) => activeStates.has(value),
        },
      })
    ).toBe(null)
  })

  it('blocks real session auto mode in dev builds', () => {
    expect(
      shouldBlockSessionAutoInDev({
        isDev: true,
        forceAiPreview: false,
        isRehearsalNodeSession: false,
      })
    ).toBe(true)
  })

  it('allows rehearsal session auto mode in dev builds', () => {
    expect(
      shouldBlockSessionAutoInDev({
        isDev: true,
        forceAiPreview: false,
        isRehearsalNodeSession: true,
      })
    ).toBe(false)
  })

  it('allows off-chain preview mode in dev builds', () => {
    expect(
      shouldBlockSessionAutoInDev({
        isDev: true,
        forceAiPreview: true,
        isRehearsalNodeSession: false,
      })
    ).toBe(false)
  })

  it('only auto-runs short session during the short period', () => {
    expect(
      shouldAutoRunSessionForPeriod({
        aiSessionType: 'short',
        currentPeriod: EpochPeriod.ShortSession,
      })
    ).toBe(true)

    expect(
      shouldAutoRunSessionForPeriod({
        aiSessionType: 'short',
        currentPeriod: EpochPeriod.LongSession,
      })
    ).toBe(false)
  })

  it('only auto-runs long session during the long period', () => {
    expect(
      shouldAutoRunSessionForPeriod({
        aiSessionType: 'long',
        currentPeriod: EpochPeriod.LongSession,
      })
    ).toBe(true)

    expect(
      shouldAutoRunSessionForPeriod({
        aiSessionType: 'long',
        currentPeriod: EpochPeriod.ShortSession,
      })
    ).toBe(false)
  })

  it('allows preview auto-run regardless of the current period', () => {
    expect(
      shouldAutoRunSessionForPeriod({
        aiSessionType: 'long',
        currentPeriod: EpochPeriod.ShortSession,
        forceAiPreview: true,
      })
    ).toBe(true)
  })

  it('shows validation AI UI only when the provider is ready', () => {
    expect(
      shouldShowValidationAiUi({
        enabled: true,
        providerReady: true,
      })
    ).toBe(true)

    expect(
      shouldShowValidationAiUi({
        enabled: true,
        providerReady: false,
      })
    ).toBe(false)
  })

  it('shows local validation AI UI only when the local runtime is ready', () => {
    expect(
      shouldShowValidationLocalAiUi({
        runtimeReady: true,
        checkerAvailable: true,
      })
    ).toBe(true)

    expect(
      shouldShowValidationLocalAiUi({
        runtimeReady: false,
        checkerAvailable: true,
      })
    ).toBe(false)
  })
})
