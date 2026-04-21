import React from 'react'
import deepEqual from 'dequal'
import {useInterval} from '../hooks/use-interval'
import {fetchEpoch} from '../api/dna'
import {useChainState} from './chain-context'
import {useIdentityState} from './identity-context'
import {useSettingsState} from './settings-context'
import {
  buildValidationIdentityScope,
  buildValidationSessionNodeScope,
  didValidate,
} from '../../screens/validation/utils'
import {
  didArchiveFlips,
  markFlipsArchived,
  archiveFlips,
  handleOutdatedFlips,
} from '../../screens/flips/utils'
import {RPC_CONNECTION_CHANGED_EVENT} from '../utils/rpc-connection-events'

export const EpochPeriod = {
  FlipLottery: 'FlipLottery',
  ShortSession: 'ShortSession',
  LongSession: 'LongSession',
  AfterLongSession: 'AfterLongSession',
  None: 'None',
}

const EpochStateContext = React.createContext()
const EpochDispatchContext = React.createContext()

function logError(...args) {
  const logger = global.logger || console
  logger.error(...args)
}

// eslint-disable-next-line react/prop-types
export function EpochProvider({children}) {
  const [epoch, setEpoch] = React.useState(null)
  const [interval, setInterval] = React.useState(1000 * 3)
  const {loading, offline, syncing} = useChainState()
  const isRpcUsable = !loading && !offline && !syncing
  const refreshEpoch = React.useCallback(
    async ({canApply = () => true} = {}) => {
      const nextEpoch = await fetchEpoch()

      if (canApply()) {
        setEpoch((currentEpoch) =>
          deepEqual(currentEpoch, nextEpoch) ? currentEpoch : nextEpoch
        )
      }

      return nextEpoch
    },
    []
  )

  React.useEffect(() => {
    if (!isRpcUsable) {
      return undefined
    }

    let ignore = false

    async function fetchData() {
      try {
        await refreshEpoch({canApply: () => !ignore})
      } catch (error) {
        setInterval(1000 * 5)
        logError('An error occured while fetching epoch', error.message)
      }
    }

    fetchData()

    return () => {
      ignore = true
    }
  }, [isRpcUsable, refreshEpoch])

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    let ignore = false

    const handleRpcConnectionChanged = async () => {
      try {
        setInterval(1000 * 3)
        await refreshEpoch({canApply: () => !ignore})
      } catch (error) {
        logError(
          'An error occured while refreshing epoch after rpc switch',
          error.message
        )
      }
    }

    window.addEventListener(
      RPC_CONNECTION_CHANGED_EVENT,
      handleRpcConnectionChanged
    )

    return () => {
      ignore = true
      window.removeEventListener(
        RPC_CONNECTION_CHANGED_EVENT,
        handleRpcConnectionChanged
      )
    }
  }, [refreshEpoch])

  useInterval(
    async () => {
      try {
        await refreshEpoch()
      } catch (error) {
        logError('An error occured while fetching epoch', error.message)
      }
    },
    isRpcUsable ? interval : null
  )

  return (
    <EpochStateContext.Provider value={epoch || null}>
      <EpochDispatchContext.Provider value={null}>
        {children}
      </EpochDispatchContext.Provider>
    </EpochStateContext.Provider>
  )
}

export function useEpochState() {
  const context = React.useContext(EpochStateContext)
  if (context === undefined) {
    throw new Error('EpochState must be used within a EpochProvider')
  }
  return context
}

export function useEpochDispatch() {
  const context = React.useContext(EpochDispatchContext)
  if (context === undefined) {
    throw new Error('EpochDispatch must be used within a EpochProvider')
  }
  return context
}

export function EpochValidationArchiveEffects() {
  const epoch = useEpochState()
  const identity = useIdentityState()
  const settings = useSettingsState()

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

  React.useEffect(() => {
    if (
      epoch &&
      didValidate(epoch.epoch, validationIdentityScope) &&
      !didArchiveFlips(epoch.epoch, validationIdentityScope)
    ) {
      archiveFlips()
      handleOutdatedFlips()
      markFlipsArchived(epoch.epoch, validationIdentityScope)
    }
  }, [epoch, validationIdentityScope])

  return null
}
