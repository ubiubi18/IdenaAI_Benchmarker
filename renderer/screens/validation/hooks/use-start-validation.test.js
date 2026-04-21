const {EpochPeriod} = require('../../../shared/types')
const {
  isValidationSessionAutoMode,
  shouldSuppressValidationAutoOpen,
  shouldAutoOpenLottery,
  shouldAutoOpenValidationResults,
  shouldRefreshValidationIdentity,
  hasAssignedRehearsalValidationHashes,
  getRehearsalValidationBlockedReason,
  hasMissedRehearsalReadyWindow,
  canOpenRehearsalValidation,
  getRehearsalValidationEntryPath,
} = require('./use-start-validation')

describe('validation auto-flow helpers', () => {
  it('detects session-auto mode only when enabled', () => {
    expect(
      isValidationSessionAutoMode({
        aiSolver: {enabled: true, mode: 'session-auto'},
      })
    ).toBe(true)

    expect(
      isValidationSessionAutoMode({
        aiSolver: {enabled: true, mode: 'manual'},
      })
    ).toBe(false)

    expect(
      isValidationSessionAutoMode({
        aiSolver: {enabled: false, mode: 'session-auto'},
      })
    ).toBe(false)
  })

  it('respects an explicit lottery dismissal even in session-auto mode', () => {
    expect(
      shouldAutoOpenLottery({
        currentPeriod: EpochPeriod.FlipLottery,
        pathname: '/home',
        isCandidate: true,
        sessionAutoMode: true,
        dismissedLottery: {
          address: '0xabc',
          epoch: 42,
        },
        identityAddress: '0xabc',
        epochNumber: 42,
        msUntilValidation: 30 * 1000,
      })
    ).toBe(false)
  })

  it('forces the lottery window back open near short-session start in session-auto mode', () => {
    expect(
      shouldAutoOpenLottery({
        currentPeriod: EpochPeriod.FlipLottery,
        pathname: '/home',
        isCandidate: true,
        sessionAutoMode: true,
        dismissedLottery: {
          address: '0xabc',
          epoch: 42,
        },
        identityAddress: '0xabc',
        epochNumber: 42,
        msUntilValidation: 4 * 1000,
      })
    ).toBe(true)
  })

  it('respects a dismissed lottery screen outside session-auto mode', () => {
    expect(
      shouldAutoOpenLottery({
        currentPeriod: EpochPeriod.FlipLottery,
        pathname: '/home',
        isCandidate: true,
        sessionAutoMode: false,
        dismissedLottery: {
          address: '0xabc',
          epoch: 42,
        },
        identityAddress: '0xabc',
        epochNumber: 42,
      })
    ).toBe(false)
  })

  it('opens after-validation status automatically only when results are expected', () => {
    expect(
      shouldAutoOpenValidationResults({
        currentPeriod: EpochPeriod.AfterLongSession,
        pathname: '/home',
        sessionAutoMode: true,
        expectValidationResults: true,
      })
    ).toBe(true)

    expect(
      shouldAutoOpenValidationResults({
        currentPeriod: EpochPeriod.AfterLongSession,
        pathname: '/home',
        sessionAutoMode: true,
        expectValidationResults: false,
      })
    ).toBe(false)
  })

  it('refreshes validation identity automatically while nonce state is stale', () => {
    expect(
      shouldRefreshValidationIdentity({
        shouldPrimeValidationIdentity: true,
        isCandidate: true,
        readinessReason: 'nonce-stale',
      })
    ).toBe(true)
  })

  it('does not keep forcing refresh once validation identity is healthy', () => {
    expect(
      shouldRefreshValidationIdentity({
        shouldPrimeValidationIdentity: true,
        isCandidate: true,
        readinessReason: 'ready',
      })
    ).toBe(false)
  })

  it('suppresses validation auto-open after the user leaves a failed rehearsal run', () => {
    expect(
      shouldSuppressValidationAutoOpen({
        dismissedValidationScreen: {
          scopeKey: '196:0xabc:external:http://127.0.0.1:22301:1760000000000',
          reason: 'failed-rehearsal',
        },
        validationScopeKey:
          '196:0xabc:external:http://127.0.0.1:22301:1760000000000',
      })
    ).toBe(true)
  })

  it('does not suppress validation auto-open for a different validation scope', () => {
    expect(
      shouldSuppressValidationAutoOpen({
        dismissedValidationScreen: {
          scopeKey: '196:0xabc:external:http://127.0.0.1:22301:1760000000000',
          reason: 'failed-rehearsal',
        },
        validationScopeKey:
          '196:0xabc:external:http://127.0.0.1:22301:1760000480000',
      })
    ).toBe(false)
  })

  it('does not auto-open rehearsal validation before short-session hashes are assigned', () => {
    expect(
      hasAssignedRehearsalValidationHashes({
        currentPeriod: EpochPeriod.ShortSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          primaryValidationAssigned: false,
          primaryShortHashCount: 0,
        },
      })
    ).toBe(false)
  })

  it('allows rehearsal validation once short-session hashes are assigned', () => {
    expect(
      hasAssignedRehearsalValidationHashes({
        currentPeriod: EpochPeriod.ShortSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          primaryValidationAssigned: true,
          primaryShortHashCount: 6,
        },
      })
    ).toBe(true)
  })

  it('keeps rehearsal in the countdown state before FlipLottery begins', () => {
    expect(
      getRehearsalValidationBlockedReason({
        currentPeriod: EpochPeriod.None,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          countdownSeconds: 240,
        },
      })
    ).toBe('before-flip-lottery')
  })

  it('treats FlipLottery as a countdown-only rehearsal state', () => {
    expect(
      getRehearsalValidationBlockedReason({
        currentPeriod: EpochPeriod.FlipLottery,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          countdownSeconds: 120,
        },
      })
    ).toBe('flip-lottery')
  })

  it('blocks rehearsal validation while short-session decryption keys are not ready yet', () => {
    expect(
      getRehearsalValidationBlockedReason({
        currentPeriod: EpochPeriod.ShortSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          primaryValidationAssigned: true,
          primaryShortHashCount: 6,
          primaryShortHashReadyCount: 0,
        },
        now: new Date('2026-04-21T12:00:21.000Z').getTime(),
      })
    ).toBe('keys-not-ready')
  })

  it('marks the rehearsal as failed once short session stays at zero ready flips past the grace window', () => {
    expect(
      hasMissedRehearsalReadyWindow({
        currentPeriod: EpochPeriod.ShortSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          firstCeremonyAt: '2026-04-21T12:00:00.000Z',
          primaryShortHashCount: 8,
          primaryShortHashReadyCount: 0,
        },
        now: new Date('2026-04-21T12:00:46.000Z').getTime(),
      })
    ).toBe(true)

    expect(
      getRehearsalValidationBlockedReason({
        currentPeriod: EpochPeriod.ShortSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          firstCeremonyAt: '2026-04-21T12:00:00.000Z',
          primaryShortHashCount: 8,
          primaryShortHashReadyCount: 0,
        },
        now: new Date('2026-04-21T12:00:46.000Z').getTime(),
      })
    ).toBe('failed-rehearsal')
  })

  it('keeps long-session rehearsal in a waiting state until the ready-flip grace window expires', () => {
    expect(
      getRehearsalValidationBlockedReason({
        currentPeriod: EpochPeriod.LongSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          firstCeremonyAt: '2026-04-21T12:00:00.000Z',
          primaryShortHashCount: 8,
          primaryLongHashCount: 16,
          primaryShortHashReadyCount: 0,
          primaryLongHashReadyCount: 0,
        },
        now: new Date('2026-04-21T12:00:30.000Z').getTime(),
      })
    ).toBe('keys-not-ready')
  })

  it('opens rehearsal validation only after at least one short-session flip is ready', () => {
    expect(
      canOpenRehearsalValidation({
        currentPeriod: EpochPeriod.ShortSession,
        isRehearsalNodeSession: true,
        devnetStatus: {
          active: true,
          primaryValidationAssigned: true,
          primaryShortHashCount: 6,
          primaryShortHashReadyCount: 1,
        },
      })
    ).toBe(true)
  })

  it('routes blocked rehearsal entry to the waiting-room lottery page', () => {
    expect(
      getRehearsalValidationEntryPath({
        blockedReason: 'keys-not-ready',
        canOpenValidation: false,
      })
    ).toBe('/validation/lottery')
  })

  it('routes failed rehearsal entry back to node settings', () => {
    expect(
      getRehearsalValidationEntryPath({
        blockedReason: 'failed-rehearsal',
        canOpenValidation: false,
      })
    ).toBe('/settings/node')
  })
})
