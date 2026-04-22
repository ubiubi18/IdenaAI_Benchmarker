import {useMachine} from '@xstate/react'
import React from 'react'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {useIdentity} from '../../../shared/providers/identity-context'
import {useSettingsState} from '../../../shared/providers/settings-context'
import {
  buildValidationIdentityScope,
  buildValidationSessionNodeScope,
} from '../utils'
import {usePersistedValidationState} from '../hooks/use-persisted-state'
import {computeRehearsalBenchmarkSummary} from '../rehearsal-benchmark'
import {validationReportMachine} from './machines'

export function useTotalValidationScore() {
  const [{totalShortFlipPoints, totalQualifiedFlips}] = useIdentity()
  const points = Number(totalShortFlipPoints)
  const qualifiedFlips = Number(totalQualifiedFlips)

  return Number.isFinite(points) &&
    Number.isFinite(qualifiedFlips) &&
    qualifiedFlips > 0
    ? Math.min(points / qualifiedFlips, 1)
    : null
}

export function useValidationReportSummary() {
  const settings = useSettingsState()
  const [identity] = useIdentity()

  const epoch = useEpochState()

  const totalScore = useTotalValidationScore()
  const previousEpoch = Number.isFinite(Number(epoch?.epoch))
    ? Number(epoch.epoch) - 1
    : null

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
  const {data: validationState} = usePersistedValidationState({
    scope: validationIdentityScope,
  })
  const rehearsalBenchmarkSummary = React.useMemo(() => {
    if (Number(validationState?.context?.epoch) !== previousEpoch) {
      return computeRehearsalBenchmarkSummary()
    }

    return computeRehearsalBenchmarkSummary(validationState)
  }, [previousEpoch, validationState])

  const [current, send] = useMachine(validationReportMachine)

  React.useEffect(() => {
    if (epoch && identity?.address)
      send('FETCH', {
        epochNumber: epoch.epoch - 1,
        identity,
      })
  }, [epoch, identity, send])

  return {
    ...current.context,
    totalScore,
    rehearsalBenchmarkSummary,
    isLoading: current.matches('fetching'),
  }
}
