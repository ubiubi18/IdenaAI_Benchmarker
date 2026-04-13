const {version: APP_VERSION_FALLBACK = '0.0.0'} = require('../../../package.json')

function isFallbackBridgeValue(value) {
  return Boolean(value && value.__idenaFallback)
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

  if (typeof globalThis !== 'undefined' && !sources.includes(globalThis)) {
    sources.push(globalThis)
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
    return runtimeBridgeValue
  }

  const sources = getSharedGlobalSources()
  let fallbackBridgeValue

  for (const source of sources) {
    if (!source || typeof source[key] === 'undefined' || source[key] === null) {
      continue
    }

    if (!isFallbackBridgeValue(source[key])) {
      return source[key]
    }

    if (typeof fallbackBridgeValue === 'undefined') {
      fallbackBridgeValue = source[key]
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

export {APP_VERSION_FALLBACK}
