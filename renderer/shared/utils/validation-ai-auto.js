import {EpochPeriod} from '../types'

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
