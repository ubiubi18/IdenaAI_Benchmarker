const {
  version: APP_VERSION_FALLBACK = '0.0.0',
} = require('../../../package.json')

const IDENA_CONTEXT_BRIDGE_KEY = '__idenaBridge'

function isFallbackBridgeValue(value) {
  return Boolean(value && value.__idenaFallback)
}

function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}

function mergeBridgeValue(value, fallbackValue) {
  if (!isPlainObject(value) || !isPlainObject(fallbackValue)) {
    return value
  }

  const mergedValue = {...fallbackValue}

  Object.entries(value).forEach(([key, nextValue]) => {
    const fallbackEntry = fallbackValue[key]

    if (typeof fallbackEntry === 'function') {
      if (typeof nextValue === 'function') {
        mergedValue[key] = nextValue
      }
      return
    }

    if (isPlainObject(nextValue) && isPlainObject(fallbackEntry)) {
      mergedValue[key] = mergeBridgeValue(nextValue, fallbackEntry)
      return
    }

    if (typeof nextValue !== 'undefined') {
      mergedValue[key] = nextValue
    }
  })

  return mergedValue
}

function getContextBridgeContainer() {
  if (
    typeof window !== 'undefined' &&
    window[IDENA_CONTEXT_BRIDGE_KEY] &&
    typeof window[IDENA_CONTEXT_BRIDGE_KEY] === 'object'
  ) {
    return window[IDENA_CONTEXT_BRIDGE_KEY]
  }

  return null
}

function getElectronModule() {
  if (typeof window === 'undefined' || typeof window.require !== 'function') {
    return null
  }

  try {
    return window.require('electron')
  } catch {
    return null
  }
}

function getRuntimeBridgeValue(key) {
  const contextBridge = getContextBridgeContainer()

  if (
    contextBridge &&
    typeof contextBridge[key] !== 'undefined' &&
    contextBridge[key] !== null &&
    !isFallbackBridgeValue(contextBridge[key])
  ) {
    return contextBridge[key]
  }

  const electron = getElectronModule()

  if (!electron) {
    return undefined
  }

  if (key === 'ipcRenderer' && electron.ipcRenderer) {
    return electron.ipcRenderer
  }

  if (key === 'openExternal' && electron.shell) {
    return electron.shell.openExternal
  }

  return undefined
}

function getSharedGlobalSources() {
  const sources = []

  if (typeof global !== 'undefined') {
    sources.push(global)
  }

  if (typeof window !== 'undefined' && !sources.includes(window)) {
    sources.push(window)
  }

  return sources
}

export function getSharedGlobal(key, fallbackValue) {
  const runtimeBridgeValue = getRuntimeBridgeValue(key)
  if (
    typeof runtimeBridgeValue !== 'undefined' &&
    runtimeBridgeValue !== null &&
    !isFallbackBridgeValue(runtimeBridgeValue)
  ) {
    return mergeBridgeValue(runtimeBridgeValue, fallbackValue)
  }

  const sources = getSharedGlobalSources()
  let fallbackBridgeValue

  for (const source of sources) {
    if (source && typeof source[key] !== 'undefined' && source[key] !== null) {
      if (!isFallbackBridgeValue(source[key])) {
        return mergeBridgeValue(source[key], fallbackValue)
      }

      if (typeof fallbackBridgeValue === 'undefined') {
        fallbackBridgeValue = source[key]
      }
    }
  }

  if (typeof fallbackValue !== 'undefined') {
    return fallbackValue
  }

  if (typeof fallbackBridgeValue !== 'undefined') {
    return fallbackBridgeValue
  }

  return fallbackValue
}

export function syncSharedGlobal(key, fallbackValue) {
  const value = getSharedGlobal(key, fallbackValue)

  getSharedGlobalSources().forEach((source) => {
    if (source) {
      source[key] = value
    }
  })

  return value
}

export function addSharedGlobalReadyListener(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return () => {}
  }

  window.addEventListener('idena-preload-ready', handler)

  return () => {
    window.removeEventListener('idena-preload-ready', handler)
  }
}

export {APP_VERSION_FALLBACK}
