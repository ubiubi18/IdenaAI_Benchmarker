/* eslint-disable no-unused-expressions */
/* eslint-disable no-use-before-define */
import {Button, useToast} from '@chakra-ui/react'
import {useMachine} from '@xstate/react'
import {useRouter} from 'next/router'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {createMachine} from 'xstate'
import {assign, choose} from 'xstate/lib/actions'
import {useCloseToast} from '../../../shared/hooks/use-toast'
import {useInterval} from '../../../shared/hooks/use-interval'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {useSettingsState} from '../../../shared/providers/settings-context'
import {EpochPeriod} from '../../../shared/types'
import {getNodeBridge} from '../../../shared/utils/node-bridge'
import {ValidatonStatusToast} from '../components/toast'
import {
  canOpenRehearsalValidation,
  getRehearsalValidationEntryPath,
  getRehearsalValidationBlockedReason,
  normalizeRehearsalDevnetStatus,
  openValidationLottery,
  REHEARSAL_DEVNET_STATUS_INITIAL,
} from './use-start-validation'

export function useValidationToast() {
  const {t} = useTranslation()

  const router = useRouter()
  const epoch = useEpochState()
  const settings = useSettingsState()

  const toast = useToast()

  const closeValidationToasts = useCloseValidationToast()

  const closeToast = useCloseToast()
  const currentPeriod = epoch?.currentPeriod
  const isRehearsalNodeSession =
    settings.useExternalNode &&
    settings.externalNodeLabel === 'Validation rehearsal node'
  const [rehearsalDevnetStatus, setRehearsalDevnetStatus] = React.useState(
    REHEARSAL_DEVNET_STATUS_INITIAL
  )
  const rehearsalBlockedReason = React.useMemo(
    () =>
      getRehearsalValidationBlockedReason({
        currentPeriod,
        devnetStatus: rehearsalDevnetStatus,
        isRehearsalNodeSession,
      }),
    [currentPeriod, isRehearsalNodeSession, rehearsalDevnetStatus]
  )
  const rehearsalValidationOpenable = React.useMemo(
    () =>
      canOpenRehearsalValidation({
        currentPeriod,
        devnetStatus: rehearsalDevnetStatus,
        isRehearsalNodeSession,
      }),
    [currentPeriod, isRehearsalNodeSession, rehearsalDevnetStatus]
  )
  const blockedRehearsalButtonLabel = React.useMemo(() => {
    if (rehearsalBlockedReason === 'failed-rehearsal') {
      return 'Open node settings'
    }

    if (rehearsalBlockedReason) {
      return 'Open session status'
    }

    return 'Open validation'
  }, [rehearsalBlockedReason])

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
      ].includes(currentPeriod)
      ? 1000
      : null
  )

  const routeToRehearsalEntry = React.useCallback(() => {
    const nextPath = getRehearsalValidationEntryPath({
      blockedReason: rehearsalBlockedReason,
      canOpenValidation: rehearsalValidationOpenable,
    })

    if (nextPath === '/validation/lottery') {
      openValidationLottery(router, {isRehearsalNodeSession})
      return
    }

    router.push(nextPath)
  }, [
    isRehearsalNodeSession,
    rehearsalBlockedReason,
    rehearsalValidationOpenable,
    router,
  ])

  useTrackEpochPeriod({
    onChangeCurrentPeriod: (nextPeriod) => {
      for (const toastId of [
        EpochPeriod.FlipLottery,
        EpochPeriod.ShortSession,
        EpochPeriod.LongSession,
        EpochPeriod.AfterLongSession,
      ]) {
        if (toastId !== nextPeriod) {
          closeToast(toastId)
        }
      }
    },
    onFlipLottery: () => {
      if (toast.isActive(EpochPeriod.FlipLottery)) return

      toast({
        id: EpochPeriod.FlipLottery,
        duration: null,
        // eslint-disable-next-line react/display-name
        render: () => (
          <ValidatonStatusToast
            title={t('Idena validation will start soon')}
            colorScheme="red"
          >
            <Button
              variant="unstyled"
              onClick={() => {
                openValidationLottery(router, {isRehearsalNodeSession})
              }}
            >
              {t('Show countdown')}
            </Button>
          </ValidatonStatusToast>
        ),
      })
    },
    onShortSession: () => {
      if (toast.isActive(EpochPeriod.ShortSession)) return

      toast({
        id: EpochPeriod.ShortSession,
        duration: null,
        // eslint-disable-next-line react/display-name
        render: () => (
          <ValidatonStatusToast
            title={
              isRehearsalNodeSession && rehearsalBlockedReason
                ? t('Rehearsal short session is not ready yet')
                : t('Idena short session has started')
            }
            colorScheme="green"
          >
            <Button
              variant="unstyled"
              onClick={() => {
                routeToRehearsalEntry()
              }}
            >
              {t(
                isRehearsalNodeSession && rehearsalBlockedReason
                  ? blockedRehearsalButtonLabel
                  : 'Open validation'
              )}
            </Button>
          </ValidatonStatusToast>
        ),
      })
    },
    onLongSession: () => {
      if (toast.isActive(EpochPeriod.LongSession)) return

      toast({
        id: EpochPeriod.LongSession,
        duration: null,
        // eslint-disable-next-line react/display-name
        render: () => (
          <ValidatonStatusToast
            title={
              isRehearsalNodeSession &&
              (!rehearsalValidationOpenable || rehearsalBlockedReason)
                ? t('Rehearsal long session is not ready yet')
                : t('Idena long session has started')
            }
            colorScheme="green"
          >
            <Button
              variant="unstyled"
              onClick={() => {
                routeToRehearsalEntry()
              }}
            >
              {t(
                isRehearsalNodeSession &&
                  (!rehearsalValidationOpenable || rehearsalBlockedReason)
                  ? blockedRehearsalButtonLabel
                  : 'Open validation'
              )}
            </Button>
          </ValidatonStatusToast>
        ),
      })
    },
    onAfterLongSession: () => {
      if (toast.isActive(EpochPeriod.AfterLongSession)) return

      toast({
        id: EpochPeriod.AfterLongSession,
        duration: null,
        // eslint-disable-next-line react/display-name
        render: () => (
          <ValidatonStatusToast
            title={t('Waiting for the Idena validation results')}
            colorScheme="green"
          >
            <Button
              variant="unstyled"
              onClick={() => {
                router.push('/validation/after')
              }}
            >
              {t('Show status')}
            </Button>
          </ValidatonStatusToast>
        ),
      })
    },
    onNone: closeValidationToasts,
  })
}

export function useTrackEpochPeriod({
  onNone,
  onFlipLottery,
  onShortSession,
  onLongSession,
  onAfterLongSession,
  onChangeCurrentPeriod,
  onValidation,
  onValidationCeremony,
}) {
  const epoch = useEpochState()
  const currentPeriod = epoch?.currentPeriod

  const [, send] = useMachine(trackEpochPeriodMachine, {
    actions: {
      // eslint-disable-next-line no-shadow
      onChangeCurrentPeriod: ({currentPeriod}) => {
        onChangeCurrentPeriod?.(currentPeriod)

        const isValidation = [
          EpochPeriod.FlipLottery,
          EpochPeriod.ShortSession,
          EpochPeriod.LongSession,
          EpochPeriod.AfterLongSession,
        ].includes(currentPeriod)

        if (isValidation) {
          onValidation?.(currentPeriod)
        }

        const isValidationCeremony = [
          EpochPeriod.ShortSession,
          EpochPeriod.LongSession,
        ].includes(currentPeriod)

        if (isValidationCeremony) {
          onValidationCeremony?.()
        }

        switch (currentPeriod) {
          case EpochPeriod.None:
            onNone?.()
            break
          case EpochPeriod.FlipLottery:
            onFlipLottery?.()
            break
          case EpochPeriod.ShortSession:
            onShortSession?.()
            break
          case EpochPeriod.LongSession:
            onLongSession?.()
            break
          case EpochPeriod.AfterLongSession:
            onAfterLongSession?.()
            break

          default:
            break
        }
      },
    },
  })

  React.useEffect(() => {
    send({type: 'CHANGE', currentPeriod})
  }, [currentPeriod, send])
}

const trackEpochPeriodMachine = createMachine(
  {
    predictableActionArguments: true,
    initial: 'idle',
    states: {
      idle: {
        on: {
          CHANGE: [
            {
              target: 'tracking',
              actions: ['assignCurrentPeriod', 'onChangeCurrentPeriod'],
              cond: 'isKnownCurrentPeriod',
            },
          ],
        },
      },
      tracking: {
        on: {
          CHANGE: [
            {
              actions: [
                choose([
                  {
                    actions: ['assignCurrentPeriod', 'onChangeCurrentPeriod'],
                    cond: 'didChangeCurrentPeriod',
                  },
                ]),
              ],
            },
          ],
        },
      },
    },
  },
  {
    actions: {
      assignCurrentPeriod: assign({
        currentPeriod: (_, {currentPeriod}) => currentPeriod,
      }),
    },
    guards: {
      isKnownCurrentPeriod: (_, {currentPeriod}) =>
        [
          EpochPeriod.None,
          EpochPeriod.FlipLottery,
          EpochPeriod.ShortSession,
          EpochPeriod.LongSession,
          EpochPeriod.AfterLongSession,
        ].includes(currentPeriod),
      didChangeCurrentPeriod: (context, {currentPeriod}) =>
        context.currentPeriod !== currentPeriod,
    },
  }
)

export function useCloseValidationToast() {
  const closeToast = useCloseToast()

  return React.useCallback(() => {
    ;[
      EpochPeriod.FlipLottery,
      EpochPeriod.ShortSession,
      EpochPeriod.LongSession,
      EpochPeriod.AfterLongSession,
    ].forEach(closeToast)
  }, [closeToast])
}

export function useAutoCloseValidationToast() {
  const closeToast = useCloseValidationToast()

  React.useEffect(() => {
    closeToast()
  }, [closeToast])

  return closeToast
}
