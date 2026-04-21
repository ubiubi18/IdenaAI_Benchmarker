import {useRouter} from 'next/router'
import React from 'react'
import {useInterval} from '../../../shared/hooks/use-interval'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {useIdentity} from '../../../shared/providers/identity-context'
import {useSettingsState} from '../../../shared/providers/settings-context'
import {useChainState} from '../../../shared/providers/chain-context'
import {useNodeState} from '../../../shared/providers/node-context'
import {prepareValidationSession} from '../../../shared/api/validation'
import {EpochPeriod} from '../../../shared/types'
import {getNodeBridge} from '../../../shared/utils/node-bridge'
import {
  buildValidationIdentityScope,
  buildValidationSessionScopeKey,
  buildValidationSessionNodeScope,
  buildValidationStateScope,
  canValidate,
  computeValidationCeremonyReadiness,
  getCurrentValidationSessionId,
  rememberValidationSessionId,
  shouldExpectValidationResults,
  shouldPrepareValidationSession,
  shouldStartValidation,
} from '../utils'

const DISMISSED_VALIDATION_SCREEN_STORAGE_KEY = 'didCloseValidationScreen'
export const REHEARSAL_DEVNET_STATUS_INITIAL = {
  active: false,
  stage: 'idle',
  primaryValidationAssigned: false,
  primaryShortHashCount: null,
  primaryShortHashReadyCount: null,
  primaryLongHashCount: null,
  primaryLongHashReadyCount: null,
}

export function isValidationSessionAutoMode(settings = {}) {
  return (
    settings?.aiSolver?.enabled === true &&
    String(settings?.aiSolver?.mode || '')
      .trim()
      .toLowerCase() === 'session-auto'
  )
}

export function shouldAutoOpenLottery({
  currentPeriod,
  pathname = '',
  isCandidate = false,
  dismissedLottery = null,
  identityAddress = '',
  epochNumber = null,
} = {}) {
  if (
    currentPeriod !== EpochPeriod.FlipLottery ||
    !isCandidate ||
    pathname === '/validation/lottery'
  ) {
    return false
  }

  return !(
    dismissedLottery?.address === identityAddress &&
    dismissedLottery?.epoch === epochNumber
  )
}

export function shouldAutoOpenValidationResults({
  currentPeriod,
  pathname = '',
  sessionAutoMode = false,
  expectValidationResults = false,
} = {}) {
  return (
    sessionAutoMode &&
    currentPeriod === EpochPeriod.AfterLongSession &&
    pathname !== '/validation/after' &&
    expectValidationResults
  )
}

export function shouldRefreshValidationIdentity({
  shouldPrimeValidationIdentity = false,
  isCandidate = false,
  readinessReason = '',
} = {}) {
  return (
    shouldPrimeValidationIdentity &&
    (!isCandidate ||
      readinessReason === 'nonce-stale' ||
      readinessReason === 'account-unavailable')
  )
}

export function rememberDismissedValidationScreen({
  scopeKey = '',
  reason = '',
} = {}) {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null
  }

  const normalizedScopeKey = String(scopeKey || '').trim()
  const normalizedReason = String(reason || '')
    .trim()
    .toLowerCase()

  if (!normalizedScopeKey || !normalizedReason) {
    window.sessionStorage.removeItem(DISMISSED_VALIDATION_SCREEN_STORAGE_KEY)
    return null
  }

  const nextDismissal = {
    scopeKey: normalizedScopeKey,
    reason: normalizedReason,
  }

  window.sessionStorage.setItem(
    DISMISSED_VALIDATION_SCREEN_STORAGE_KEY,
    JSON.stringify(nextDismissal)
  )

  return nextDismissal
}

export function readDismissedValidationScreen() {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null
  }

  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(DISMISSED_VALIDATION_SCREEN_STORAGE_KEY)
    )

    if (
      value &&
      typeof value === 'object' &&
      String(value.scopeKey || '').trim() &&
      String(value.reason || '').trim()
    ) {
      return {
        scopeKey: String(value.scopeKey).trim(),
        reason: String(value.reason).trim().toLowerCase(),
      }
    }
  } catch {
    return null
  }

  return null
}

export function shouldSuppressValidationAutoOpen({
  dismissedValidationScreen = null,
  validationScopeKey = '',
} = {}) {
  return (
    String(validationScopeKey || '').trim() &&
    dismissedValidationScreen?.reason === 'failed-rehearsal' &&
    dismissedValidationScreen?.scopeKey === validationScopeKey
  )
}

export function normalizeRehearsalDevnetStatus(value) {
  if (!value || typeof value !== 'object') {
    return REHEARSAL_DEVNET_STATUS_INITIAL
  }

  return {
    active: Boolean(value.active),
    stage: String(value.stage || 'idle').trim() || 'idle',
    primaryValidationAssigned: value.primaryValidationAssigned === true,
    primaryShortHashCount:
      typeof value.primaryShortHashCount === 'number'
        ? value.primaryShortHashCount
        : null,
    primaryShortHashReadyCount:
      typeof value.primaryShortHashReadyCount === 'number'
        ? value.primaryShortHashReadyCount
        : null,
    primaryLongHashCount:
      typeof value.primaryLongHashCount === 'number'
        ? value.primaryLongHashCount
        : null,
    primaryLongHashReadyCount:
      typeof value.primaryLongHashReadyCount === 'number'
        ? value.primaryLongHashReadyCount
        : null,
  }
}

export function getRehearsalValidationBlockedReason({
  currentPeriod,
  devnetStatus = REHEARSAL_DEVNET_STATUS_INITIAL,
  isRehearsalNodeSession = false,
} = {}) {
  if (!isRehearsalNodeSession) {
    return ''
  }

  if (
    String(devnetStatus?.stage || '')
      .trim()
      .toLowerCase() === 'failed'
  ) {
    return 'failed-rehearsal'
  }

  if (currentPeriod === EpochPeriod.FlipLottery) {
    return 'before-flip-lottery'
  }

  if (currentPeriod === EpochPeriod.ShortSession) {
    if (Number(devnetStatus.primaryShortHashCount || 0) < 1) {
      return 'hashes-not-assigned'
    }

    if (
      typeof devnetStatus.primaryShortHashReadyCount === 'number' &&
      devnetStatus.primaryShortHashReadyCount < 1
    ) {
      return 'keys-not-ready'
    }
  }

  if (currentPeriod === EpochPeriod.LongSession) {
    if (
      Math.max(
        Number(devnetStatus.primaryLongHashCount || 0),
        Number(devnetStatus.primaryShortHashCount || 0)
      ) < 1
    ) {
      return 'hashes-not-assigned'
    }

    if (
      Math.max(
        Number(devnetStatus.primaryLongHashReadyCount || 0),
        Number(devnetStatus.primaryShortHashReadyCount || 0)
      ) < 1
    ) {
      return 'keys-not-ready'
    }
  }

  return ''
}

export function canOpenRehearsalValidation(args = {}) {
  return !getRehearsalValidationBlockedReason(args)
}

export function hasAssignedRehearsalValidationHashes({
  currentPeriod,
  devnetStatus = REHEARSAL_DEVNET_STATUS_INITIAL,
  isRehearsalNodeSession = false,
} = {}) {
  if (!isRehearsalNodeSession) {
    return true
  }

  if (!devnetStatus?.active) {
    return false
  }

  if (currentPeriod === EpochPeriod.LongSession) {
    return (
      devnetStatus.primaryValidationAssigned === true ||
      Number(devnetStatus.primaryLongHashCount || 0) > 0 ||
      Number(devnetStatus.primaryShortHashCount || 0) > 0
    )
  }

  if (currentPeriod === EpochPeriod.ShortSession) {
    return (
      devnetStatus.primaryValidationAssigned === true ||
      Number(devnetStatus.primaryShortHashCount || 0) > 0
    )
  }

  return true
}

export function useValidationCeremonyReadiness() {
  const epoch = useEpochState()
  const [identity] = useIdentity()
  const settings = useSettingsState()
  const {loading, offline, syncing, peersCount} = useChainState()
  const {nodeReady, nodeFailed, nodeSessionKey} = useNodeState()
  const [now, setNow] = React.useState(() => Date.now())
  const [stableSince, setStableSince] = React.useState(null)

  const isInternalNode = settings.runInternalNode && !settings.useExternalNode
  const validationNodeScope = React.useMemo(
    () =>
      buildValidationSessionNodeScope({
        runInternalNode: settings.runInternalNode,
        useExternalNode: settings.useExternalNode,
        url: settings.url,
        internalPort: settings.internalPort,
      }),
    [
      settings.internalPort,
      settings.runInternalNode,
      settings.url,
      settings.useExternalNode,
    ]
  )
  const validationStartMs = React.useMemo(() => {
    const value = epoch?.nextValidation
      ? new Date(epoch.nextValidation).getTime()
      : null

    return Number.isFinite(value) ? value : null
  }, [epoch?.nextValidation])
  const isValidationRunning =
    epoch &&
    [EpochPeriod.ShortSession, EpochPeriod.LongSession].includes(
      epoch.currentPeriod
    )
  const [validationSessionId, setValidationSessionId] = React.useState(() =>
    getCurrentValidationSessionId({
      epoch: epoch?.epoch,
      address: identity?.address,
      nodeScope: validationNodeScope,
      validationStart: validationStartMs,
    })
  )
  const rememberLiveValidationSessionId = React.useCallback(
    (nextSessionId) => {
      const normalizedSessionId = rememberValidationSessionId(
        {
          epoch: epoch?.epoch,
          address: identity?.address,
          nodeScope: validationNodeScope,
          validationStart: validationStartMs,
        },
        nextSessionId
      )

      if (normalizedSessionId) {
        setValidationSessionId(normalizedSessionId)
      }

      return normalizedSessionId
    },
    [epoch?.epoch, identity?.address, validationNodeScope, validationStartMs]
  )

  React.useEffect(() => {
    setValidationSessionId(
      getCurrentValidationSessionId({
        epoch: epoch?.epoch,
        address: identity?.address,
        nodeScope: validationNodeScope,
        validationStart: validationStartMs,
      })
    )
  }, [epoch?.epoch, identity?.address, validationNodeScope, validationStartMs])

  const isBaseHealthy =
    !loading &&
    !offline &&
    !syncing &&
    Number.isFinite(peersCount) &&
    peersCount > 0 &&
    (!isInternalNode || (nodeReady && !nodeFailed))

  React.useEffect(() => {
    if (isBaseHealthy) {
      setStableSince((current) => current || Date.now())
    } else {
      setStableSince(null)
    }
  }, [isBaseHealthy])

  useInterval(
    () => {
      setNow(Date.now())
    },
    isBaseHealthy || isValidationRunning ? 1000 : null
  )

  return React.useMemo(
    () => ({
      ...computeValidationCeremonyReadiness({
        isDev: global.isDev,
        isValidationRunning,
        isInternalNode,
        loading,
        offline,
        syncing,
        peersCount,
        nodeReady,
        nodeFailed,
        stableSince,
        identity,
        now,
      }),
      isInternalNode,
      peersCount,
      rpcReady: !loading && !offline,
      stableSince,
      validationSessionId,
      rememberLiveValidationSessionId,
      validationPrepareScopeKey: `${validationNodeScope}:${nodeSessionKey}`,
    }),
    [
      identity,
      isInternalNode,
      isValidationRunning,
      loading,
      nodeFailed,
      nodeReady,
      nodeSessionKey,
      now,
      offline,
      peersCount,
      stableSince,
      syncing,
      rememberLiveValidationSessionId,
      validationNodeScope,
      validationSessionId,
    ]
  )
}

export function useAutoStartValidation() {
  const router = useRouter()

  const epoch = useEpochState()
  const [identity, {forceUpdate}] = useIdentity()
  const settings = useSettingsState()
  const isRehearsalNodeSession =
    settings.useExternalNode &&
    settings.externalNodeLabel === 'Validation rehearsal node'
  const isSessionAutoMode = React.useMemo(
    () => isValidationSessionAutoMode(settings),
    [settings]
  )
  const [rehearsalDevnetStatus, setRehearsalDevnetStatus] = React.useState(
    REHEARSAL_DEVNET_STATUS_INITIAL
  )
  const validationReadiness = useValidationCeremonyReadiness()
  const {
    rpcReady,
    reason: validationReadinessReason,
    validationSessionId,
    rememberLiveValidationSessionId,
    validationPrepareScopeKey,
  } = validationReadiness
  const preparedSessionRef = React.useRef({
    epoch: null,
    sessionId: null,
    prepareScopeKey: null,
  })
  const lastPrepareAttemptAtRef = React.useRef(0)
  const lastIdentityRefreshAtRef = React.useRef(0)

  const isCandidate = React.useMemo(() => canValidate(identity), [identity])
  const shouldPrimeValidationIdentity =
    (settings.ephemeralExternalNodeConnected || isSessionAutoMode) &&
    rpcReady &&
    [
      EpochPeriod.FlipLottery,
      EpochPeriod.ShortSession,
      EpochPeriod.LongSession,
    ].includes(epoch?.currentPeriod)
  const shouldRefreshValidationIdentityState = React.useMemo(
    () =>
      shouldRefreshValidationIdentity({
        shouldPrimeValidationIdentity,
        isCandidate,
        readinessReason: validationReadinessReason,
      }),
    [isCandidate, shouldPrimeValidationIdentity, validationReadinessReason]
  )
  const validationNodeScope = React.useMemo(
    () =>
      buildValidationSessionNodeScope({
        runInternalNode: settings.runInternalNode,
        useExternalNode: settings.useExternalNode,
        url: settings.url,
        internalPort: settings.internalPort,
      }),
    [
      settings.internalPort,
      settings.runInternalNode,
      settings.url,
      settings.useExternalNode,
    ]
  )
  const validationStateScope = React.useMemo(
    () =>
      buildValidationStateScope({
        epoch: epoch?.epoch,
        address: identity?.address,
        nodeScope: validationNodeScope,
        validationStart: epoch?.nextValidation
          ? new Date(epoch.nextValidation).getTime()
          : null,
      }),
    [
      epoch?.epoch,
      epoch?.nextValidation,
      identity?.address,
      validationNodeScope,
    ]
  )
  const validationScopeKey = React.useMemo(
    () =>
      buildValidationSessionScopeKey({
        epoch: epoch?.epoch,
        address: identity?.address,
        nodeScope: validationNodeScope,
        validationStart: epoch?.nextValidation
          ? new Date(epoch.nextValidation).getTime()
          : null,
      }),
    [
      epoch?.epoch,
      epoch?.nextValidation,
      identity?.address,
      validationNodeScope,
    ]
  )
  const rehearsalValidationOpenable = React.useMemo(
    () =>
      canOpenRehearsalValidation({
        currentPeriod: epoch?.currentPeriod,
        devnetStatus: rehearsalDevnetStatus,
        isRehearsalNodeSession,
      }),
    [epoch?.currentPeriod, isRehearsalNodeSession, rehearsalDevnetStatus]
  )

  React.useEffect(() => {
    if (!isRehearsalNodeSession || getNodeBridge().__idenaFallback) {
      setRehearsalDevnetStatus(REHEARSAL_DEVNET_STATUS_INITIAL)
      return undefined
    }

    const bridge = getNodeBridge()

    bridge.getValidationDevnetStatus()

    return bridge.onEvent((event, data) => {
      if (event === 'validation-devnet-status') {
        setRehearsalDevnetStatus(normalizeRehearsalDevnetStatus(data))
      }
    })
  }, [isRehearsalNodeSession])

  useInterval(
    async () => {
      if (
        shouldRefreshValidationIdentityState &&
        Date.now() - lastIdentityRefreshAtRef.current >= 1500
      ) {
        try {
          lastIdentityRefreshAtRef.current = Date.now()
          await forceUpdate()
        } catch (error) {
          global.logger.error(
            'Unable to refresh validation identity state',
            error && error.message ? error.message : error
          )
        }
      }

      const hasPreparedSessionForScope =
        preparedSessionRef.current.epoch === epoch?.epoch &&
        preparedSessionRef.current.prepareScopeKey ===
          validationPrepareScopeKey &&
        (validationSessionId
          ? preparedSessionRef.current.sessionId === validationSessionId
          : Boolean(preparedSessionRef.current.sessionId))

      if (
        rpcReady &&
        shouldPrepareValidationSession(epoch, identity) &&
        Date.now() - lastPrepareAttemptAtRef.current >= 5000 &&
        !hasPreparedSessionForScope
      ) {
        try {
          lastPrepareAttemptAtRef.current = Date.now()
          const requestedSessionId = String(validationSessionId || '')
          const result = await prepareValidationSession(
            epoch.epoch,
            requestedSessionId
          )
          const activeSessionId =
            (result && result.sessionId) || requestedSessionId

          if (activeSessionId) {
            rememberLiveValidationSessionId(activeSessionId)
          }

          preparedSessionRef.current = {
            epoch: epoch.epoch,
            sessionId: activeSessionId,
            prepareScopeKey: validationPrepareScopeKey,
          }
        } catch (error) {
          global.logger.error(
            'Unable to prepare validation session',
            error && error.message ? error.message : error
          )
        }
      }

      const validationAutoOpenDismissal = readDismissedValidationScreen()

      if (
        // Enter the validation route as soon as the ceremony actually starts.
        // The validation page already handles any remaining node/bootstrap wait.
        shouldStartValidation(epoch, identity, validationStateScope) &&
        rehearsalValidationOpenable &&
        router.pathname !== '/validation' &&
        !shouldSuppressValidationAutoOpen({
          dismissedValidationScreen: validationAutoOpenDismissal,
          validationScopeKey,
        })
      ) {
        router.push('/validation')
      }
    },
    isCandidate || shouldRefreshValidationIdentityState ? 1000 : null
  )

  useInterval(
    () => {
      if (isRehearsalNodeSession && !getNodeBridge().__idenaFallback) {
        getNodeBridge().getValidationDevnetStatus()
      }
    },
    isRehearsalNodeSession &&
      [
        EpochPeriod.FlipLottery,
        EpochPeriod.ShortSession,
        EpochPeriod.LongSession,
      ].includes(epoch?.currentPeriod)
      ? 1000
      : null
  )
}

export function useAutoStartLottery() {
  const router = useRouter()

  const epoch = useEpochState()
  const [identity] = useIdentity()
  const settings = useSettingsState()
  const sessionAutoMode = React.useMemo(
    () => isValidationSessionAutoMode(settings),
    [settings]
  )

  const isCandidate = React.useMemo(() => canValidate(identity), [identity])
  const validationIdentityScope = React.useMemo(
    () =>
      buildValidationIdentityScope({
        address: identity?.address,
        nodeScope: buildValidationSessionNodeScope({
          runInternalNode: settings.runInternalNode,
          useExternalNode: settings.useExternalNode,
          url: settings.url,
          internalPort: settings.internalPort,
        }),
      }),
    [
      identity?.address,
      settings.internalPort,
      settings.runInternalNode,
      settings.url,
      settings.useExternalNode,
    ]
  )

  useInterval(
    () => {
      if (global.isDev && !global.isTest && !sessionAutoMode) {
        return
      }

      if (
        shouldAutoOpenValidationResults({
          currentPeriod: epoch?.currentPeriod,
          pathname: router.pathname,
          sessionAutoMode,
          expectValidationResults: shouldExpectValidationResults(
            epoch?.epoch,
            validationIdentityScope
          ),
        })
      ) {
        router.push('/validation/after')
        return
      }

      let didCloseLotteryScreen = null

      try {
        didCloseLotteryScreen = JSON.parse(
          sessionStorage.getItem('didCloseLotteryScreen')
        )
      } catch (e) {
        console.error(e)
        global.logger.error(e?.message)
      }

      if (
        shouldAutoOpenLottery({
          currentPeriod: epoch?.currentPeriod,
          pathname: router.pathname,
          isCandidate,
          sessionAutoMode,
          dismissedLottery: didCloseLotteryScreen,
          identityAddress: identity?.address,
          epochNumber: epoch?.epoch,
        })
      ) {
        router.push('/validation/lottery')
      }
    },
    isCandidate || sessionAutoMode ? 1000 : null
  )
}
