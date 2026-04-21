/* eslint-disable react/prop-types */
import React, {useCallback, useMemo} from 'react'
import deepEqual from 'dequal'
import {useInterval} from '../hooks/use-interval'
import {fetchIdentity, killIdentity} from '../api/dna'
import {fetchBalance} from '../api/wallet'
import {useChainState} from './chain-context'
import {IdentityStatus} from '../types'
import {getIdentityPublishedFlipsCount} from '../utils/identity'
import {RPC_CONNECTION_CHANGED_EVENT} from '../utils/rpc-connection-events'

export function mapToFriendlyStatus(status) {
  switch (status) {
    case IdentityStatus.Undefined:
      return 'Not validated'
    default:
      return status
  }
}

const IdentityStateContext = React.createContext()
const IdentityDispatchContext = React.createContext()

export function IdentityProvider({children}) {
  const [identity, setIdentity] = React.useState(null)
  const [balanceResult, setBalanceResult] = React.useState(null)
  const [fetchingIdentity, setFetchingIdentity] = React.useState(false)
  const {loading, offline, syncing} = useChainState()
  const isRpcUsable = !loading && !offline && !syncing
  let identityPollingDelay = null
  if (isRpcUsable) {
    identityPollingDelay = identity ? 1000 * 5 : 1000 * 10
  }

  const refreshIdentitySnapshot = useCallback(
    async ({preserveTerminatingState = false, canApply = () => true} = {}) => {
      const nextIdentity = await fetchIdentity()

      if (canApply()) {
        setIdentity((currentIdentity) => {
          const keepTerminatingState =
            preserveTerminatingState &&
            Boolean(currentIdentity) &&
            currentIdentity.state === IdentityStatus.Terminating &&
            Boolean(nextIdentity) &&
            nextIdentity.state !== IdentityStatus.Undefined

          const state = keepTerminatingState
            ? currentIdentity.state
            : nextIdentity?.state
          const mergedIdentity =
            nextIdentity && state ? {...nextIdentity, state} : nextIdentity

          return deepEqual(currentIdentity, mergedIdentity)
            ? currentIdentity
            : mergedIdentity
        })
      }

      const balanceAddress =
        nextIdentity && nextIdentity.address ? nextIdentity.address : null

      if (!balanceAddress) {
        if (canApply()) {
          setBalanceResult(null)
        }
        return nextIdentity
      }

      try {
        const nextBalance = await fetchBalance(balanceAddress)
        if (canApply()) {
          setBalanceResult((currentBalance) =>
            deepEqual(currentBalance, nextBalance)
              ? currentBalance
              : nextBalance
          )
        }
      } catch (error) {
        global.logger.error(
          'An error occured while fetching identity balance',
          error.message
        )
      }

      return nextIdentity
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
        if (!ignore) {
          setFetchingIdentity(true)
        }
        await refreshIdentitySnapshot({canApply: () => !ignore})
      } catch (error) {
        global.logger.error(
          'An error occured while fetching identity',
          error.message
        )
      } finally {
        if (!ignore) {
          setFetchingIdentity(false)
        }
      }
    }

    fetchData()

    return () => {
      ignore = true
    }
  }, [isRpcUsable, refreshIdentitySnapshot])

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    let ignore = false

    const handleRpcConnectionChanged = async () => {
      setIdentity(null)
      setBalanceResult(null)
      setFetchingIdentity(true)

      try {
        await refreshIdentitySnapshot({canApply: () => !ignore})
      } catch (error) {
        if (!ignore) {
          setIdentity(null)
          setBalanceResult(null)
        }
        global.logger.error(
          'An error occured while refreshing identity after rpc switch',
          error.message
        )
      } finally {
        if (!ignore) {
          setFetchingIdentity(false)
        }
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
  }, [refreshIdentitySnapshot])

  useInterval(async () => {
    try {
      setFetchingIdentity(true)
      await refreshIdentitySnapshot({preserveTerminatingState: true})
    } catch (error) {
      global.logger.error(
        'An error occured while fetching identity',
        error.message
      )
    } finally {
      setFetchingIdentity(false)
    }
  }, identityPollingDelay)

  const canActivateInvite =
    identity &&
    [IdentityStatus.Undefined, IdentityStatus.Invite].includes(identity.state)

  const canSubmitFlip =
    identity &&
    [
      IdentityStatus.Newbie,
      IdentityStatus.Verified,
      IdentityStatus.Human,
    ].includes(identity.state) &&
    identity.requiredFlips > 0 &&
    getIdentityPublishedFlipsCount(identity) < identity.availableFlips

  const canTerminate =
    identity &&
    [
      IdentityStatus.Verified,
      IdentityStatus.Suspended,
      IdentityStatus.Zombie,
      IdentityStatus.Human,
    ].includes(identity.state)

  const canMine =
    identity &&
    ([
      IdentityStatus.Newbie,
      IdentityStatus.Verified,
      IdentityStatus.Human,
    ].includes(identity.state) ||
      identity.isPool)

  const killMe = useCallback(
    async ({to}) => {
      const resp = await killIdentity(identity.address, to)
      const {result} = resp

      if (result) {
        setIdentity({...identity, state: IdentityStatus.Terminating})
        return result
      }
      return resp
    },
    [identity]
  )

  const forceUpdate = React.useCallback(async () => {
    setFetchingIdentity(true)

    try {
      await refreshIdentitySnapshot({preserveTerminatingState: true})
    } finally {
      setFetchingIdentity(false)
    }
  }, [refreshIdentitySnapshot])

  return (
    <IdentityStateContext.Provider
      value={useMemo(
        () => ({
          ...identity,
          ...balanceResult,
          canActivateInvite,
          canSubmitFlip,
          canMine,
          canTerminate,
          fetchingIdentity,
          isValidated: [
            IdentityStatus.Newbie,
            IdentityStatus.Verified,
            IdentityStatus.Human,
          ].includes(identity?.state),
          canInvite: identity?.invites > 0,
        }),
        [
          balanceResult,
          canActivateInvite,
          canMine,
          canSubmitFlip,
          canTerminate,
          fetchingIdentity,
          identity,
        ]
      )}
    >
      <IdentityDispatchContext.Provider
        value={useMemo(() => ({killMe, forceUpdate}), [forceUpdate, killMe])}
      >
        {children}
      </IdentityDispatchContext.Provider>
    </IdentityStateContext.Provider>
  )
}

export function useIdentityState() {
  const context = React.useContext(IdentityStateContext)
  if (context === undefined) {
    throw new Error('useIdentityState must be used within a IdentityProvider')
  }
  return context
}

export function useIdentityDispatch() {
  const context = React.useContext(IdentityDispatchContext)
  if (context === undefined) {
    throw new Error(
      'useIdentityDispatch must be used within a IdentityProvider'
    )
  }
  return context
}

export function useIdentity() {
  return [useIdentityState(), useIdentityDispatch()]
}
