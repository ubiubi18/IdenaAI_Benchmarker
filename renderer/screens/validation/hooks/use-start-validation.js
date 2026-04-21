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
import {
  buildValidationSessionNodeScope,
  buildValidationStateScope,
  canValidate,
  computeValidationCeremonyReadiness,
  getCurrentValidationSessionId,
  rememberValidationSessionId,
  shouldPrepareValidationSession,
  shouldStartValidation,
} from '../utils'

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
    })
  )
  const rememberLiveValidationSessionId = React.useCallback(
    (nextSessionId) => {
      const normalizedSessionId = rememberValidationSessionId(
        {
          epoch: epoch?.epoch,
          address: identity?.address,
          nodeScope: validationNodeScope,
        },
        nextSessionId
      )

      if (normalizedSessionId) {
        setValidationSessionId(normalizedSessionId)
      }

      return normalizedSessionId
    },
    [epoch?.epoch, identity?.address, validationNodeScope]
  )

  React.useEffect(() => {
    setValidationSessionId(
      getCurrentValidationSessionId({
        epoch: epoch?.epoch,
        address: identity?.address,
        nodeScope: validationNodeScope,
      })
    )
  }, [epoch?.epoch, identity?.address, validationNodeScope])

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
  const [identity] = useIdentity()
  const settings = useSettingsState()
  const {
    rpcReady,
    validationSessionId,
    rememberLiveValidationSessionId,
    validationPrepareScopeKey,
  } = useValidationCeremonyReadiness()
  const preparedSessionRef = React.useRef({
    epoch: null,
    sessionId: null,
    prepareScopeKey: null,
  })
  const lastPrepareAttemptAtRef = React.useRef(0)

  const isCandidate = React.useMemo(() => canValidate(identity), [identity])
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

  useInterval(
    async () => {
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

      if (
        // Enter the validation route as soon as the ceremony actually starts.
        // The validation page already handles any remaining node/bootstrap wait.
        shouldStartValidation(epoch, identity, validationStateScope) &&
        router.pathname !== '/validation'
      ) {
        router.push('/validation')
      }
    },
    isCandidate ? 1000 : null
  )
}

export function useAutoStartLottery() {
  const router = useRouter()

  const epoch = useEpochState()
  const [identity] = useIdentity()

  const isCandidate = React.useMemo(() => canValidate(identity), [identity])

  useInterval(
    () => {
      if (global.isDev && !global.isTest) {
        return
      }

      if (epoch?.currentPeriod === EpochPeriod.FlipLottery) {
        try {
          const didCloseLotteryScreen = JSON.parse(
            sessionStorage.getItem('didCloseLotteryScreen')
          )

          const isSameIdentityEpoch =
            didCloseLotteryScreen?.address === identity?.address &&
            didCloseLotteryScreen?.epoch === epoch?.epoch

          if (!isSameIdentityEpoch) router.push('/validation/lottery')
        } catch (e) {
          console.error(e)
          global.logger.error(e?.message)

          router.push('/validation/lottery')
        }
      }
    },
    isCandidate ? 1000 : null
  )
}
