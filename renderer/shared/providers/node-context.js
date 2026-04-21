import React, {useCallback, useEffect, useMemo} from 'react'
import {useSettingsState} from './settings-context'
import useLogger from '../hooks/use-logger'
import {getNodeBridge} from '../utils/node-bridge'
import {
  NODE_STARTUP_PHASE,
  reduceNodeStartupPhase,
} from '../utils/node-startup-status'

const NODE_READY = 'NODE_READY'
const NODE_FAILED = 'NODE_FAILED'
const NODE_START = 'NODE_START'
const NODE_STOP = 'NODE_STOP'
const NODE_REINIT = 'NODE_REINIT'
const NODE_LOG = 'NODE_LOG'
const UNSUPPORTED_MACOS_VERSION = 'UNSUPPORTED_MACOS_VERSION'

const TROUBLESHOOTING_RESTART_NODE = 'TROUBLESHOOTING_RESTART_NODE'
const TROUBLESHOOTING_UPDATE_NODE = 'TROUBLESHOOTING_UPDATE_NODE'
const TROUBLESHOOTING_RESET_NODE = 'TROUBLESHOOTING_RESET_NODE'

const initialState = {
  nodeStarted: false,
  nodeReady: false,
  nodeFailed: false,
  runningTroubleshooter: false,
  logs: [],
  nodeSessionKey: 0,
  nodeStartupPhase: NODE_STARTUP_PHASE.IDLE,
}

function nodeReducer(state, action) {
  switch (action.type) {
    case NODE_FAILED: {
      return {
        ...state,
        nodeFailed: true,
        nodeReady: false,
        nodeStarted: false,
      }
    }
    case NODE_READY: {
      return {
        ...state,
        nodeReady: true,
      }
    }
    case NODE_START: {
      return {
        ...state,
        nodeStarted: true,
        runningTroubleshooter: false,
        nodeSessionKey: state.nodeSessionKey + 1,
        nodeStartupPhase: NODE_STARTUP_PHASE.STARTING,
      }
    }
    case NODE_STOP: {
      return {
        ...state,
        nodeStarted: false,
        nodeStartupPhase: NODE_STARTUP_PHASE.IDLE,
      }
    }
    case NODE_REINIT: {
      return {
        ...state,
        nodeReady: false,
        nodeFailed: false,
        nodeStartupPhase: NODE_STARTUP_PHASE.IDLE,
      }
    }
    case NODE_LOG: {
      return {
        ...state,
        nodeStartupPhase: reduceNodeStartupPhase(
          action.data,
          state.nodeStartupPhase
        ),
      }
    }
    case UNSUPPORTED_MACOS_VERSION: {
      return {
        ...state,
        unsupportedMacosVersion: true,
      }
    }
    case TROUBLESHOOTING_RESTART_NODE:
    case TROUBLESHOOTING_UPDATE_NODE:
    case TROUBLESHOOTING_RESET_NODE: {
      return {
        ...state,
        nodeFailed: false,
        runningTroubleshooter: true,
      }
    }

    default:
      throw new Error(`Unknown action ${action.type}`)
  }
}

const NodeStateContext = React.createContext()
const NodeDispatchContext = React.createContext()

function hasNodeBridge() {
  return !getNodeBridge().__idenaFallback
}

// eslint-disable-next-line react/prop-types
export function NodeProvider({children}) {
  const settings = useSettingsState()

  const [state, dispatch] = useLogger(
    React.useReducer(nodeReducer, initialState)
  )

  useEffect(() => {
    if (!hasNodeBridge()) {
      return undefined
    }

    const onEvent = (event, data) => {
      switch (event) {
        case 'node-failed':
          dispatch({type: NODE_FAILED})
          break
        case 'node-started':
          dispatch({type: NODE_START})
          break
        case 'node-stopped':
          dispatch({type: NODE_STOP})
          break
        case 'node-ready':
          dispatch({type: NODE_READY, data})
          break
        case 'node-log':
          dispatch({type: NODE_LOG, data})
          break
        case 'restart-node':
        case 'state-cleaned':
          dispatch({type: NODE_REINIT, data})
          break
        case 'unsupported-macos-version':
          dispatch({type: UNSUPPORTED_MACOS_VERSION})
          break

        case 'troubleshooting-restart-node': {
          dispatch({type: TROUBLESHOOTING_RESTART_NODE})
          return getNodeBridge().startLocalNode({
            rpcPort: settings.internalPort,
            tcpPort: settings.tcpPort,
            ipfsPort: settings.ipfsPort,
            autoActivateMining: settings.autoActivateMining,
          })
        }
        case 'troubleshooting-update-node': {
          return dispatch({type: TROUBLESHOOTING_UPDATE_NODE})
        }
        case 'troubleshooting-reset-node': {
          dispatch({type: TROUBLESHOOTING_RESET_NODE})
          return getNodeBridge().initLocalNode()
        }

        default:
          break
      }
    }

    return getNodeBridge().onEvent(onEvent)
  }, [
    dispatch,
    settings.autoActivateMining,
    settings.internalPort,
    settings.ipfsPort,
    settings.tcpPort,
  ])

  useEffect(() => {
    dispatch({type: NODE_REINIT})
  }, [settings.runInternalNode, dispatch])

  useEffect(() => {
    if (!hasNodeBridge()) {
      return
    }

    if (
      state.nodeReady &&
      !state.nodeFailed &&
      !state.nodeStarted &&
      settings.runInternalNode
    ) {
      getNodeBridge().startLocalNode({
        rpcPort: settings.internalPort,
        tcpPort: settings.tcpPort,
        ipfsPort: settings.ipfsPort,
        autoActivateMining: settings.autoActivateMining,
      })
    }
  }, [
    settings.internalPort,
    state.nodeReady,
    state.nodeStarted,
    settings.runInternalNode,
    settings.tcpPort,
    settings.ipfsPort,
    state.nodeFailed,
    settings.autoActivateMining,
  ])

  useEffect(() => {
    if (!hasNodeBridge()) {
      return
    }

    if (state.nodeReady || state.nodeFailed || state.runningTroubleshooter) {
      return
    }
    if (settings.runInternalNode) {
      if (!state.nodeStarted) {
        getNodeBridge().initLocalNode()
      }
    } else if (state.nodeStarted) {
      getNodeBridge().stopLocalNode()
    }
  }, [
    settings.runInternalNode,
    state.nodeStarted,
    state.nodeReady,
    state.nodeFailed,
    state.runningTroubleshooter,
  ])

  const tryRestartNode = useCallback(() => {
    dispatch({type: NODE_REINIT})
  }, [dispatch])

  const importNodeKey = (shouldResetNode) => {
    if (!hasNodeBridge()) {
      return
    }

    if (shouldResetNode) {
      getNodeBridge().cleanState()
    } else {
      getNodeBridge().restartNode()
    }
  }

  return (
    <NodeStateContext.Provider value={state}>
      <NodeDispatchContext.Provider
        value={useMemo(
          () => ({tryRestartNode, importNodeKey}),
          [tryRestartNode]
        )}
      >
        {children}
      </NodeDispatchContext.Provider>
    </NodeStateContext.Provider>
  )
}

export function useNodeState() {
  const context = React.useContext(NodeStateContext)
  if (context === undefined) {
    throw new Error('useNodeState must be used within a NodeStateProvider')
  }
  return context
}

export function useNodeDispatch() {
  const context = React.useContext(NodeDispatchContext)
  if (context === undefined) {
    throw new Error('useNodeState must be used within a NodeDispatchProvider')
  }
  return context
}

export function useNode() {
  return [useNodeState(), useNodeDispatch()]
}
