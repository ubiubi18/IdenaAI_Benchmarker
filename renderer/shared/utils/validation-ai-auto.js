import {EpochPeriod} from '../types'

function isAnsweredValidationFlip(flip) {
  return Number(flip?.option) > 0
}

function isRenderableAiCandidateFlip(flip) {
  return Boolean(
    flip && flip.decoded && !flip.failed && flip.images && flip.orders
  )
}

export function getValidationAiSessionType({
  state = null,
  submitting = false,
  hasRenderableLongFlips = false,
} = {}) {
  if (!state || typeof state.matches !== 'function' || submitting) {
    return null
  }

  if (
    state.matches('shortSession.solve.answer.normal') &&
    state.matches('shortSession.fetch.done')
  ) {
    return 'short'
  }

  if (
    state.matches('longSession.solve.answer.flips') &&
    (state.matches('longSession.fetch.flips.done') || hasRenderableLongFlips)
  ) {
    return 'long'
  }

  return null
}

export function shouldBlockSessionAutoInDev({
  isDev = false,
  forceAiPreview = false,
  isRehearsalNodeSession = false,
} = {}) {
  return Boolean(isDev && !forceAiPreview && !isRehearsalNodeSession)
}

export function shouldAutoRunSessionForPeriod({
  aiSessionType = null,
  currentPeriod = EpochPeriod.None,
  forceAiPreview = false,
} = {}) {
  if (forceAiPreview) {
    return true
  }

  if (aiSessionType === 'short') {
    return currentPeriod === EpochPeriod.ShortSession
  }

  if (aiSessionType === 'long') {
    return currentPeriod === EpochPeriod.LongSession
  }

  return false
}

export function shouldShowValidationAiUi({
  enabled = false,
  providerReady = false,
} = {}) {
  return Boolean(enabled && providerReady)
}

export function shouldShowValidationLocalAiUi({
  runtimeReady = false,
  checkerAvailable = false,
} = {}) {
  return Boolean(runtimeReady && checkerAvailable)
}

export function getValidationLongAiSolveStatus({
  longFlips = [],
  solvedHashes = [],
} = {}) {
  const solvedHashSet = new Set(
    Array.isArray(solvedHashes) ? solvedHashes.filter(Boolean) : []
  )
  const allFlips = Array.isArray(longFlips) ? longFlips : []
  const renderableDecodedFlips = allFlips.filter(isRenderableAiCandidateFlip)
  const decodedUnansweredFlips = renderableDecodedFlips.filter(
    (flip) => !isAnsweredValidationFlip(flip) && !solvedHashSet.has(flip.hash)
  )
  const loadingFlips = allFlips.filter(
    (flip) => flip && !flip.failed && (!flip.ready || !flip.decoded)
  )

  return {
    renderableDecodedFlips,
    decodedUnansweredFlips,
    loadingFlips,
    decodedUnansweredHashes: decodedUnansweredFlips
      .map(({hash}) => hash)
      .filter(Boolean),
    renderableDecodedFlipCount: renderableDecodedFlips.length,
    decodedUnansweredFlipCount: decodedUnansweredFlips.length,
    loadingFlipCount: loadingFlips.length,
    hasDecodedUnansweredFlips: decodedUnansweredFlips.length > 0,
    hasLoadingFlips: loadingFlips.length > 0,
  }
}

export function shouldFinishLongSessionAiSolve({
  longFlips = [],
  solvedHashes = [],
  longSessionElapsedMs = 0,
  loadingGraceMs = 15 * 60 * 1000,
} = {}) {
  const status = getValidationLongAiSolveStatus({
    longFlips,
    solvedHashes,
  })

  return (
    status.decodedUnansweredFlipCount === 0 &&
    (!status.hasLoadingFlips || longSessionElapsedMs >= loadingGraceMs)
  )
}

function hasLoadedValidationKeywordWords(words = []) {
  return Array.isArray(words) && words.length > 0
}

export function getValidationReportKeywordStatus({
  state = null,
  longFlips = [],
} = {}) {
  const decodedFlips = Array.isArray(longFlips)
    ? longFlips.filter((flip) => flip && flip.decoded)
    : []
  const keywordReadyFlips = decodedFlips.filter((flip) =>
    hasLoadedValidationKeywordWords(flip.words)
  )
  const missingKeywordFlips = decodedFlips.filter(
    (flip) => !hasLoadedValidationKeywordWords(flip.words)
  )
  const keywordsFetching = Boolean(
    state &&
      typeof state.matches === 'function' &&
      (state.matches('longSession.fetch.keywords.fetching') ||
        state.matches('longSession.fetch.keywords.success'))
  )

  return {
    decodedFlips,
    keywordReadyFlips,
    missingKeywordFlips,
    decodedFlipCount: decodedFlips.length,
    keywordReadyFlipCount: keywordReadyFlips.length,
    missingKeywordFlipCount: missingKeywordFlips.length,
    keywordsFetching,
    keywordsPending:
      keywordsFetching &&
      missingKeywordFlips.length > 0 &&
      !keywordReadyFlips.length,
    hasAnyKeywordReadyFlips: keywordReadyFlips.length > 0,
  }
}
