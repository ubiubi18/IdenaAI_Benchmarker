import {EpochPeriod} from '../types'

export function getValidationAiSessionType({
  state = null,
  submitting = false,
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
    state.matches('longSession.fetch.flips.done')
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
