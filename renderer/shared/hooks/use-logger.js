import React from 'react'

const EXPLICIT_REDACTIONS = ['SET_EXTERNAL_KEY', 'SET_INTERNAL_KEY']

export default function useLogger([state, dispatch]) {
  const actionRef = React.useRef()

  const newDispatchRef = React.useRef((action) => {
    actionRef.current = action
    dispatch(action)
  })

  React.useEffect(() => {
    const action = actionRef.current

    if (action && !EXPLICIT_REDACTIONS.includes(action.type)) {
      const plainAction = typeof action === 'string' ? action : {...action}
      const plainState = {...state}
      const logger =
        typeof global !== 'undefined' &&
        global.logger &&
        typeof global.logger.debug === 'function'
          ? global.logger
          : null

      if (logger) {
        logger.debug('--- START DISPATCH ---')
        logger.debug('Action', plainAction)
        logger.debug('State', plainState)
        logger.debug('--- END DISPATCH ---')
      }
    }
  }, [state])

  return [state, newDispatchRef.current]
}
