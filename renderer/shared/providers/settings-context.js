import React, {useCallback, useEffect, useMemo} from 'react'
import semver from 'semver'
import {usePersistence} from '../hooks/use-persistent-state'
import {loadPersistentState} from '../utils/persist'
import {BASE_API_URL, BASE_INTERNAL_API_PORT} from '../api/api-client'
import useLogger from '../hooks/use-logger'
import {AVAILABLE_LANGS} from '../../i18n'

const SETTINGS_INITIALIZE = 'SETTINGS_INITIALIZE'
const TOGGLE_USE_EXTERNAL_NODE = 'TOGGLE_USE_EXTERNAL_NODE'
const TOGGLE_RUN_INTERNAL_NODE = 'TOGGLE_RUN_INTERNL_NODE'
const UPDATE_UI_VERSION = 'UPDATE_UI_VERSION'
const SET_INTERNAL_KEY = 'SET_INTERNAL_KEY'
const SET_CONNECTION_DETAILS = 'SET_CONNECTION_DETAILS'
const TOGGLE_AUTO_ACTIVATE_MINING = 'TOGGLE_AUTO_ACTIVATE_MINING'
const UPDATE_AI_SOLVER_SETTINGS = 'UPDATE_AI_SOLVER_SETTINGS'

const randomKey = () =>
  Math.random().toString(36).substring(2, 13) +
  Math.random().toString(36).substring(2, 13) +
  Math.random().toString(36).substring(2, 15)

const CHANGE_LANGUAGE = 'CHANGE_LANGUAGE'

const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'manual',
  benchmarkProfile: 'strict',
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 2,
  maxRetries: 1,
  maxOutputTokens: 120,
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
  aiSolver: DEFAULT_AI_SOLVER_SETTINGS,
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
        aiSolver: {
          ...DEFAULT_AI_SOLVER_SETTINGS,
          ...(state.aiSolver || {}),
        },
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
        aiSolver: {
          ...DEFAULT_AI_SOLVER_SETTINGS,
          ...(state.aiSolver || {}),
          ...action.data,
        },
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
  const [state, dispatch] = usePersistence(
    useLogger(
      React.useReducer(settingsReducer, {
        autoActivateMining: initialState.autoActivateMining,
        aiSolver: DEFAULT_AI_SOLVER_SETTINGS,
        ...(loadPersistentState('settings') || initialState),
      })
    ),
    'settings'
  )

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
      dispatch({type: TOGGLE_USE_EXTERNAL_NODE, data: enable})
    },
    [dispatch]
  )

  const toggleRunInternalNode = useCallback(
    (run) => {
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
      dispatch({type: SET_CONNECTION_DETAILS, url, apiKey})
    },
    [dispatch]
  )

  const updateAiSolverSettings = useCallback(
    (data) => {
      dispatch({type: UPDATE_AI_SOLVER_SETTINGS, data})
    },
    [dispatch]
  )

  return (
    <SettingsStateContext.Provider value={state}>
      <SettingsDispatchContext.Provider
        value={useMemo(
          () => ({
            toggleUseExternalNode,
            toggleRunInternalNode,
            changeLanguage,
            setConnectionDetails,
            toggleAutoActivateMining,
            updateAiSolverSettings,
          }),
          [
            changeLanguage,
            setConnectionDetails,
            toggleAutoActivateMining,
            toggleRunInternalNode,
            toggleUseExternalNode,
            updateAiSolverSettings,
          ]
        )}
      >
        {children}
      </SettingsDispatchContext.Provider>
    </SettingsStateContext.Provider>
  )
}

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
