const {EpochPeriod} = require('../types')
const {
  getValidationAiSessionType,
  getValidationLongAiSolveStatus,
  getValidationReportKeywordStatus,
  shouldFinishLongSessionAiSolve,
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

  it('offers long-session AI solve once any renderable long flips exist', () => {
    const activeStates = new Set([
      'longSession.solve.answer.flips',
      'longSession.fetch.keywords.success',
    ])

    expect(
      getValidationAiSessionType({
        state: {
          matches: (value) => activeStates.has(value),
        },
        hasRenderableLongFlips: true,
      })
    ).toBe('long')
  })

  it('does not offer long-session AI solve before long flips finish fetching when none are renderable yet', () => {
    const activeStates = new Set([
      'longSession.solve.answer.flips',
      'longSession.fetch.keywords.success',
    ])

    expect(
      getValidationAiSessionType({
        state: {
          matches: (value) => activeStates.has(value),
        },
        hasRenderableLongFlips: false,
      })
    ).toBe(null)
  })

  it('tracks decoded unanswered long-session flips separately from still-loading flips', () => {
    const result = getValidationLongAiSolveStatus({
      longFlips: [
        {
          hash: '0x1',
          ready: true,
          decoded: true,
          failed: false,
          option: 0,
          images: ['a'],
          orders: [[0], [0]],
        },
        {
          hash: '0x2',
          ready: true,
          decoded: true,
          failed: false,
          option: 1,
          images: ['b'],
          orders: [[0], [0]],
        },
        {
          hash: '0x3',
          ready: false,
          decoded: false,
          failed: false,
        },
      ],
    })

    expect(result.decodedUnansweredHashes).toEqual(['0x1'])
    expect(result.decodedUnansweredFlipCount).toBe(1)
    expect(result.loadingFlipCount).toBe(1)
  })

  it('finishes long-session AI only after the loading grace window expires', () => {
    const longFlips = [
      {
        hash: '0x1',
        ready: true,
        decoded: true,
        failed: false,
        option: 1,
        images: ['a'],
        orders: [[0], [0]],
      },
      {
        hash: '0x2',
        ready: false,
        decoded: false,
        failed: false,
      },
    ]

    expect(
      shouldFinishLongSessionAiSolve({
        longFlips,
        solvedHashes: [],
        longSessionElapsedMs: 10 * 60 * 1000,
        loadingGraceMs: 15 * 60 * 1000,
      })
    ).toBe(false)

    expect(
      shouldFinishLongSessionAiSolve({
        longFlips,
        solvedHashes: [],
        longSessionElapsedMs: 15 * 60 * 1000,
        loadingGraceMs: 15 * 60 * 1000,
      })
    ).toBe(true)
  })

  it('treats missing long-session keywords as pending while keyword fetch is still active', () => {
    const activeStates = new Set(['longSession.fetch.keywords.success'])
    const result = getValidationReportKeywordStatus({
      state: {
        matches: (value) => activeStates.has(value),
      },
      longFlips: [
        {hash: '0x1', decoded: true, words: []},
        {hash: '0x2', decoded: true, words: null},
      ],
    })

    expect(result.keywordReadyFlipCount).toBe(0)
    expect(result.missingKeywordFlipCount).toBe(2)
    expect(result.keywordsPending).toBe(true)
  })

  it('reviews the keyword-ready subset even when some long-session flips still miss keywords', () => {
    const activeStates = new Set(['longSession.fetch.keywords.fetching'])
    const result = getValidationReportKeywordStatus({
      state: {
        matches: (value) => activeStates.has(value),
      },
      longFlips: [
        {hash: '0x1', decoded: true, words: [{name: 'apple'}]},
        {hash: '0x2', decoded: true, words: []},
      ],
    })

    expect(result.hasAnyKeywordReadyFlips).toBe(true)
    expect(result.keywordReadyFlipCount).toBe(1)
    expect(result.missingKeywordFlipCount).toBe(1)
    expect(result.keywordsPending).toBe(false)
  })

  it('allows real session auto mode in dev builds', () => {
    expect(
      shouldBlockSessionAutoInDev({
        isDev: true,
        forceAiPreview: false,
        isRehearsalNodeSession: false,
      })
    ).toBe(false)
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
