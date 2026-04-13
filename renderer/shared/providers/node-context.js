import React, {useCallback, useEffect, useMemo} from 'react'
import {useSettingsState} from './settings-context'
import useLogger from '../hooks/use-logger'
import {
  addSharedGlobalReadyListener,
  getSharedGlobal,
} from '../utils/shared-global'

const NODE_READY = 'NODE_READY'
const NODE_FAILED = 'NODE_FAILED'
const NODE_START = 'NODE_START'
const NODE_STOP = 'NODE_STOP'
const NODE_REINIT = 'NODE_REINIT'
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
      }
    }
    case NODE_STOP: {
      return {
        ...state,
        nodeStarted: false,
      }
    }
    case NODE_REINIT: {
      return {
        ...state,
        nodeReady: false,
        nodeFailed: false,
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

function getNodeBridge() {
  const bridge = getSharedGlobal('node')

  return {
    onEvent: typeof bridge?.onEvent === 'function' ? bridge.onEvent : () => {},
    offEvent:
      typeof bridge?.offEvent === 'function' ? bridge.offEvent : () => {},
    sendCommand:
      typeof bridge?.sendCommand === 'function' ? bridge.sendCommand : () => {},
  }
}

function hasNodeBridge() {
  const node = getSharedGlobal('node')
  return (
    node &&
    typeof node.onEvent === 'function' &&
    typeof node.offEvent === 'function' &&
    typeof node.sendCommand === 'function'
  )
}

// eslint-disable-next-line react/prop-types
export function NodeProvider({children}) {
  const settings = useSettingsState()
  const initRequestedRef = React.useRef(false)
  const startRequestedRef = React.useRef(false)

  const [state, dispatch] = useLogger(
    React.useReducer(nodeReducer, initialState)
  )

  useEffect(() => {
    const onEvent = (_sender, event, data) => {
      switch (event) {
        case 'node-failed':
          initRequestedRef.current = false
          startRequestedRef.current = false
          dispatch({type: NODE_FAILED})
          break
        case 'node-started':
          startRequestedRef.current = false
          dispatch({type: NODE_START})
          break
        case 'node-stopped':
          initRequestedRef.current = false
          startRequestedRef.current = false
          dispatch({type: NODE_STOP})
          break
        case 'node-ready':
          initRequestedRef.current = false
          dispatch({type: NODE_READY, data})
          break
        case 'restart-node':
        case 'state-cleaned':
          initRequestedRef.current = false
          startRequestedRef.current = false
          dispatch({type: NODE_REINIT, data})
          break
        case 'unsupported-macos-version':
          dispatch({type: UNSUPPORTED_MACOS_VERSION})
          break

        case 'troubleshooting-restart-node': {
          dispatch({type: TROUBLESHOOTING_RESTART_NODE})
          return getNodeBridge().sendCommand('start-local-node', {
            rpcPort: settings.internalPort,
            tcpPort: settings.tcpPort,
            ipfsPort: settings.ipfsPort,
            apiKey: settings.internalApiKey,
            autoActivateMining: settings.autoActivateMining,
          })
        }
        case 'troubleshooting-update-node': {
          return dispatch({type: TROUBLESHOOTING_UPDATE_NODE})
        }
        case 'troubleshooting-reset-node': {
          dispatch({type: TROUBLESHOOTING_RESET_NODE})
          return getNodeBridge().sendCommand('init-local-node')
        }

        default:
          break
      }
    }

    let removeReadyListener = () => {}
    let cleanup = () => {}

    const bindNodeEvents = () => {
      if (!hasNodeBridge()) {
        return false
      }

      const node = getNodeBridge()
      cleanup()
      node.onEvent(onEvent)
      cleanup = () => node.offEvent(onEvent)
      return true
    }

    if (!bindNodeEvents()) {
      removeReadyListener = addSharedGlobalReadyListener(bindNodeEvents)
    }

    return () => {
      removeReadyListener()
      cleanup()
    }
  }, [
    dispatch,
    settings.autoActivateMining,
    settings.internalApiKey,
    settings.internalPort,
    settings.ipfsPort,
    settings.tcpPort,
  ])

  useEffect(() => {
    initRequestedRef.current = false
    startRequestedRef.current = false
    dispatch({type: NODE_REINIT})
  }, [settings.runInternalNode, dispatch])

  useEffect(() => {
    if (
      state.nodeReady &&
      !state.nodeFailed &&
      !state.nodeStarted &&
      settings.runInternalNode &&
      settings.internalApiKey &&
      !startRequestedRef.current
    ) {
      if (!hasNodeBridge()) {
        return
      }
      startRequestedRef.current = true
      getNodeBridge().sendCommand('start-local-node', {
        rpcPort: settings.internalPort,
        tcpPort: settings.tcpPort,
        ipfsPort: settings.ipfsPort,
        apiKey: settings.internalApiKey,
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
    settings.internalApiKey,
    settings.autoActivateMining,
  ])

  useEffect(() => {
    if (state.nodeReady || state.nodeFailed || state.runningTroubleshooter) {
      return
    }

    if (!hasNodeBridge()) {
      return
    }

    const node = getNodeBridge()
    if (settings.runInternalNode) {
      if (!state.nodeStarted && !initRequestedRef.current) {
        initRequestedRef.current = true
        node.sendCommand('init-local-node')
      }
    } else if (state.nodeStarted) {
      initRequestedRef.current = false
      startRequestedRef.current = false
      node.sendCommand('stop-local-node')
    }
  }, [
    settings.runInternalNode,
    state.nodeStarted,
    state.nodeReady,
    state.nodeFailed,
    state.runningTroubleshooter,
  ])

  const tryRestartNode = useCallback(() => {
    initRequestedRef.current = false
    startRequestedRef.current = false
    dispatch({type: NODE_REINIT})
  }, [dispatch])

  const importNodeKey = useCallback((shouldResetNode) => {
    if (!hasNodeBridge()) {
      return
    }

    initRequestedRef.current = false
    startRequestedRef.current = false
    getNodeBridge().sendCommand(
      shouldResetNode ? 'clean-state' : 'restart-node'
    )
  }, [])

  return (
    <NodeStateContext.Provider value={state}>
      <NodeDispatchContext.Provider
        value={useMemo(
          () => ({tryRestartNode, importNodeKey}),
          [importNodeKey, tryRestartNode]
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
