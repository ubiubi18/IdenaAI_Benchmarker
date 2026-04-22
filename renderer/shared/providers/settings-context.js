import React, {useCallback, useEffect, useMemo} from 'react'
import semver from 'semver'
import {usePersistence} from '../hooks/use-persistent-state'
import {loadPersistentState} from '../utils/persist'
import {BASE_API_URL, BASE_INTERNAL_API_PORT} from '../api/api-client'
import useLogger from '../hooks/use-logger'
import {AVAILABLE_LANGS} from '../../i18n'
import {emitRpcConnectionChanged} from '../utils/rpc-connection-events'
import {
  DEFAULT_LOCAL_AI_OLLAMA_MODEL,
  buildLocalAiSettings,
  mergeLocalAiSettings,
} from '../utils/local-ai-settings'

const SETTINGS_INITIALIZE = 'SETTINGS_INITIALIZE'
const TOGGLE_USE_EXTERNAL_NODE = 'TOGGLE_USE_EXTERNAL_NODE'
const TOGGLE_RUN_INTERNAL_NODE = 'TOGGLE_RUN_INTERNL_NODE'
const UPDATE_UI_VERSION = 'UPDATE_UI_VERSION'
const SET_INTERNAL_KEY = 'SET_INTERNAL_KEY'
const SET_CONNECTION_DETAILS = 'SET_CONNECTION_DETAILS'
const TOGGLE_AUTO_ACTIVATE_MINING = 'TOGGLE_AUTO_ACTIVATE_MINING'
const UPDATE_AI_SOLVER_SETTINGS = 'UPDATE_AI_SOLVER_SETTINGS'
const UPDATE_LOCAL_AI_SETTINGS = 'UPDATE_LOCAL_AI_SETTINGS'
const EPHEMERAL_EXTERNAL_NODE_STORAGE_KEY =
  'idena-ephemeral-external-node-connection'

const randomKey = () =>
  Math.random().toString(36).substring(2, 13) +
  Math.random().toString(36).substring(2, 13) +
  Math.random().toString(36).substring(2, 15)

const CHANGE_LANGUAGE = 'CHANGE_LANGUAGE'

const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-5.4',
  shortSessionOpenAiFastEnabled: false,
  shortSessionOpenAiFastModel: 'gpt-5.4-mini',
  memoryBudgetGiB: 32,
  systemReserveGiB: 6,
  localAiMemoryReference: 'molmo2-o-7b',
  mode: 'manual',
  autoReportEnabled: false,
  autoReportDelayMinutes: 10,
  benchmarkProfile: 'strict',
  deadlineMs: 60 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 1,
  maxRetries: 1,
  maxOutputTokens: 0,
  interFlipDelayMs: 650,
  temperature: 0,
  forceDecision: true,
  uncertaintyRepromptEnabled: true,
  uncertaintyConfidenceThreshold: 0.45,
  uncertaintyRepromptMinRemainingMs: 3500,
  uncertaintyRepromptInstruction: '',
  promptTemplateOverride: '',
  flipVisionMode: 'composite',
  ensembleEnabled: false,
  ensemblePrimaryWeight: 1,
  legacyHeuristicEnabled: false,
  legacyHeuristicWeight: 1,
  legacyHeuristicOnly: false,
  ensembleProvider2Enabled: false,
  ensembleProvider2: 'gemini',
  ensembleModel2: 'gemini-2.0-flash',
  ensembleProvider2Weight: 1,
  ensembleProvider3Enabled: false,
  ensembleProvider3: 'openai',
  ensembleModel3: 'gpt-4.1-mini',
  ensembleProvider3Weight: 1,
  customProviderName: 'Custom OpenAI-compatible',
  customProviderBaseUrl: 'https://api.openai.com/v1',
  customProviderChatPath: '/chat/completions',
}

const OPENAI_SHORT_SESSION_FAST_MODELS = ['gpt-5.4-mini', 'gpt-5.4']

function normalizeEphemeralExternalNode(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const url = String(value.url || '').trim()
  const apiKey = String(value.apiKey || '').trim()
  const label = String(value.label || '').trim()

  if (!url || !apiKey) {
    return null
  }

  return {
    url,
    apiKey,
    label: label || 'Validation rehearsal node',
  }
}

function loadEphemeralExternalNode() {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null
  }

  try {
    return normalizeEphemeralExternalNode(
      JSON.parse(
        window.sessionStorage.getItem(EPHEMERAL_EXTERNAL_NODE_STORAGE_KEY) ||
          'null'
      )
    )
  } catch {
    return null
  }
}

function persistEphemeralExternalNode(value) {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return
  }

  try {
    const normalized = normalizeEphemeralExternalNode(value)

    if (!normalized) {
      window.sessionStorage.removeItem(EPHEMERAL_EXTERNAL_NODE_STORAGE_KEY)
      return
    }

    window.sessionStorage.setItem(
      EPHEMERAL_EXTERNAL_NODE_STORAGE_KEY,
      JSON.stringify(normalized)
    )
  } catch {
    // ignore session-only persistence failures
  }
}

export function isValidationRehearsalNodeSettings(settings = {}) {
  return Boolean(
    settings &&
      settings.useExternalNode &&
      (settings.ephemeralExternalNodeConnected === true ||
        settings.externalNodeLabel === 'Validation rehearsal node')
  )
}

export function buildEffectiveSettingsState(
  state,
  ephemeralExternalNode = null
) {
  const ephemeralConnection = normalizeEphemeralExternalNode(
    ephemeralExternalNode
  )

  if (!ephemeralConnection) {
    return {
      ...state,
      externalNodeMode: state.useExternalNode ? 'persistent' : 'internal',
      ephemeralExternalNodeConnected: false,
    }
  }

  return {
    ...state,
    useExternalNode: true,
    url: ephemeralConnection.url,
    externalApiKey: ephemeralConnection.apiKey,
    externalNodeLabel: ephemeralConnection.label,
    externalNodeMode: 'ephemeral',
    ephemeralExternalNodeConnected: true,
  }
}

function buildAiSolverSettings(settings = {}) {
  const nextSettings = {
    ...DEFAULT_AI_SOLVER_SETTINGS,
    ...(settings || {}),
  }

  nextSettings.shortSessionOpenAiFastEnabled = Boolean(
    nextSettings.shortSessionOpenAiFastEnabled
  )
  const normalizedShortSessionOpenAiFastModel = String(
    nextSettings.shortSessionOpenAiFastModel || ''
  ).trim()
  nextSettings.shortSessionOpenAiFastModel =
    OPENAI_SHORT_SESSION_FAST_MODELS.includes(
      normalizedShortSessionOpenAiFastModel
    )
      ? normalizedShortSessionOpenAiFastModel
      : DEFAULT_AI_SOLVER_SETTINGS.shortSessionOpenAiFastModel

  const normalizedMemoryBudgetGiB = Number.parseInt(
    nextSettings.memoryBudgetGiB,
    10
  )
  nextSettings.memoryBudgetGiB =
    Number.isFinite(normalizedMemoryBudgetGiB) && normalizedMemoryBudgetGiB > 0
      ? normalizedMemoryBudgetGiB
      : DEFAULT_AI_SOLVER_SETTINGS.memoryBudgetGiB
  const normalizedSystemReserveGiB = Number.parseInt(
    nextSettings.systemReserveGiB,
    10
  )
  nextSettings.systemReserveGiB =
    Number.isFinite(normalizedSystemReserveGiB) &&
    normalizedSystemReserveGiB >= 0
      ? Math.min(64, normalizedSystemReserveGiB)
      : DEFAULT_AI_SOLVER_SETTINGS.systemReserveGiB
  nextSettings.localAiMemoryReference =
    String(nextSettings.localAiMemoryReference || '').trim() ||
    DEFAULT_AI_SOLVER_SETTINGS.localAiMemoryReference

  if (nextSettings.provider === 'local-ai') {
    nextSettings.model = DEFAULT_LOCAL_AI_OLLAMA_MODEL
  }

  if (
    nextSettings.provider === 'openai' &&
    nextSettings.model === 'gpt-4o-mini'
  ) {
    nextSettings.model = 'gpt-5.4'
  }

  return nextSettings
}

const initialState = {
  url: BASE_API_URL,
  internalPort: BASE_INTERNAL_API_PORT,
  tcpPort: 50505,
  ipfsPort: 50506,
  uiVersion: global.appVersion,
  useExternalNode: false,
  runInternalNode: true,
  internalApiKey: randomKey(),
  externalApiKey: '',
  lng: AVAILABLE_LANGS[0],
  autoActivateMining: true,
  aiSolver: buildAiSolverSettings(),
  localAi: buildLocalAiSettings(),
}

if (global.env && global.env.NODE_ENV === 'e2e') {
  initialState.url = global.env.NODE_MOCK
  initialState.runInternalNode = false
  initialState.useExternalNode = true
}

function settingsReducer(state, action) {
  switch (action.type) {
    case TOGGLE_USE_EXTERNAL_NODE: {
      return {...state, useExternalNode: action.data}
    }
    case TOGGLE_RUN_INTERNAL_NODE: {
      const newState = {...state, runInternalNode: action.data}
      if (newState.runInternalNode) {
        newState.useExternalNode = false
      }
      return newState
    }
    case SETTINGS_INITIALIZE:
      return {
        ...initialState,
        ...state,
        aiSolver: buildAiSolverSettings(state.aiSolver),
        localAi: buildLocalAiSettings(state.localAi),
        initialized: true,
      }
    case UPDATE_UI_VERSION: {
      return {
        ...state,
        uiVersion: action.data,
      }
    }
    case SET_INTERNAL_KEY: {
      return {
        ...state,
        internalApiKey: action.data,
      }
    }
    case SET_CONNECTION_DETAILS: {
      const {url, apiKey} = action
      return {
        ...state,
        url,
        externalApiKey: apiKey,
      }
    }
    case CHANGE_LANGUAGE: {
      return {
        ...state,
        lng: action.lng,
      }
    }
    case TOGGLE_AUTO_ACTIVATE_MINING: {
      return {
        ...state,
        autoActivateMining: !state.autoActivateMining,
      }
    }
    case UPDATE_AI_SOLVER_SETTINGS: {
      return {
        ...state,
        aiSolver: buildAiSolverSettings({
          ...(state.aiSolver || {}),
          ...action.data,
        }),
      }
    }
    case UPDATE_LOCAL_AI_SETTINGS: {
      return {
        ...state,
        localAi: mergeLocalAiSettings(state.localAi, action.data),
      }
    }
    default:
      return state
  }
}

const SettingsStateContext = React.createContext()
const SettingsDispatchContext = React.createContext()

// eslint-disable-next-line react/prop-types
export function SettingsProvider({children}) {
  const persistedSettings = loadPersistentState('settings') || {}
  const [ephemeralExternalNode, setEphemeralExternalNode] = React.useState(() =>
    loadEphemeralExternalNode()
  )

  const [state, dispatch] = usePersistence(
    useLogger(
      React.useReducer(settingsReducer, {
        ...initialState,
        ...persistedSettings,
        aiSolver: buildAiSolverSettings(persistedSettings.aiSolver),
        localAi: buildLocalAiSettings(persistedSettings.localAi),
      })
    ),
    'settings'
  )

  useEffect(() => {
    persistEphemeralExternalNode(ephemeralExternalNode)
  }, [ephemeralExternalNode])

  useEffect(() => {
    if (!state.initialized) {
      dispatch({
        type: SETTINGS_INITIALIZE,
      })
    }
  }, [dispatch, state.initialized])

  useEffect(() => {
    if (!state.internalApiKey) {
      dispatch({type: SET_INTERNAL_KEY, data: randomKey()})
    }
  })

  useEffect(() => {
    if (
      state.uiVersion &&
      global.appVersion &&
      semver.lt(state.uiVersion, global.appVersion)
    ) {
      dispatch({type: UPDATE_UI_VERSION, data: global.appVersion})
    }
  })

  const toggleUseExternalNode = useCallback(
    (enable) => {
      setEphemeralExternalNode(null)
      dispatch({type: TOGGLE_USE_EXTERNAL_NODE, data: enable})
    },
    [dispatch]
  )

  const toggleRunInternalNode = useCallback(
    (run) => {
      setEphemeralExternalNode(null)
      dispatch({type: TOGGLE_RUN_INTERNAL_NODE, data: run})
    },
    [dispatch]
  )

  const changeLanguage = useCallback(
    (lng) => dispatch({type: CHANGE_LANGUAGE, lng}),
    [dispatch]
  )

  const toggleAutoActivateMining = useCallback(() => {
    dispatch({type: TOGGLE_AUTO_ACTIVATE_MINING})
  }, [dispatch])

  const setConnectionDetails = useCallback(
    ({url, apiKey}) => {
      setEphemeralExternalNode(null)
      dispatch({type: SET_CONNECTION_DETAILS, url, apiKey})
    },
    [dispatch]
  )

  const connectEphemeralExternalNode = useCallback((payload) => {
    setEphemeralExternalNode(normalizeEphemeralExternalNode(payload))
  }, [])

  const clearEphemeralExternalNode = useCallback(() => {
    setEphemeralExternalNode(null)
  }, [])

  const effectiveState = useMemo(
    () => buildEffectiveSettingsState(state, ephemeralExternalNode),
    [ephemeralExternalNode, state]
  )
  const rpcConnectionKey = useMemo(
    () =>
      effectiveState.useExternalNode
        ? `external:${effectiveState.url || ''}:${
            effectiveState.externalApiKey || ''
          }`
        : `internal:${effectiveState.internalPort || ''}:${
            effectiveState.internalApiKey || ''
          }`,
    [
      effectiveState.externalApiKey,
      effectiveState.internalApiKey,
      effectiveState.internalPort,
      effectiveState.url,
      effectiveState.useExternalNode,
    ]
  )
  const lastRpcConnectionKeyRef = React.useRef(null)

  useEffect(() => {
    if (!rpcConnectionKey) {
      return
    }

    if (lastRpcConnectionKeyRef.current === rpcConnectionKey) {
      return
    }

    lastRpcConnectionKeyRef.current = rpcConnectionKey

    emitRpcConnectionChanged({
      rpcConnectionKey,
      mode: effectiveState.useExternalNode ? 'external' : 'internal',
      url: effectiveState.useExternalNode ? effectiveState.url : '',
      transient: effectiveState.ephemeralExternalNodeConnected === true,
    })
  }, [
    effectiveState.ephemeralExternalNodeConnected,
    effectiveState.url,
    effectiveState.useExternalNode,
    rpcConnectionKey,
  ])

  const updateAiSolverSettings = useCallback(
    (data) => {
      dispatch({type: UPDATE_AI_SOLVER_SETTINGS, data})
    },
    [dispatch]
  )

  const updateLocalAiSettings = useCallback(
    (data) => {
      dispatch({type: UPDATE_LOCAL_AI_SETTINGS, data})
    },
    [dispatch]
  )

  return (
    <SettingsStateContext.Provider value={effectiveState}>
      <SettingsDispatchContext.Provider
        value={useMemo(
          () => ({
            toggleUseExternalNode,
            toggleRunInternalNode,
            changeLanguage,
            setConnectionDetails,
            connectEphemeralExternalNode,
            clearEphemeralExternalNode,
            toggleAutoActivateMining,
            updateAiSolverSettings,
            updateLocalAiSettings,
          }),
          [
            changeLanguage,
            clearEphemeralExternalNode,
            connectEphemeralExternalNode,
            setConnectionDetails,
            toggleAutoActivateMining,
            toggleRunInternalNode,
            toggleUseExternalNode,
            updateAiSolverSettings,
            updateLocalAiSettings,
          ]
        )}
      >
        {children}
      </SettingsDispatchContext.Provider>
    </SettingsStateContext.Provider>
  )
}

export {buildAiSolverSettings}

export function useSettingsState() {
  const context = React.useContext(SettingsStateContext)
  if (context === undefined) {
    throw new Error(
      'useSettingsState must be used within a SettingsStateProvider'
    )
  }
  return context
}

export function useSettingsDispatch() {
  const context = React.useContext(SettingsDispatchContext)
  if (context === undefined) {
    throw new Error(
      'useSettingsDispatch must be used within a SettingsDispatchContext'
    )
  }
  return context
}

export function useSettings() {
  return [useSettingsState(), useSettingsDispatch()]
}
