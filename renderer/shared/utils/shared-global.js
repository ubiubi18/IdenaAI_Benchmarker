const {
  version: APP_VERSION_FALLBACK = '0.0.0',
} = require('../../../package.json')

function isFallbackBridgeValue(value) {
  return Boolean(value && value.__idenaFallback)
}

function getBridgeGlobals() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.globals &&
    typeof window.idena.globals === 'object'
  ) {
    return window.idena.globals
  }

  return null
}

function getSharedGlobalSources() {
  const sources = []
  const bridgeGlobals = getBridgeGlobals()

  if (bridgeGlobals) {
    sources.push(bridgeGlobals)
  }

  if (typeof global !== 'undefined') {
    sources.push(global)
  }

  let fallbackGlobal

  if (typeof window !== 'undefined') {
    fallbackGlobal = window
  } else if (typeof global !== 'undefined') {
    fallbackGlobal = global
  }

  if (fallbackGlobal && !sources.includes(fallbackGlobal)) {
    sources.push(fallbackGlobal)
  }

  if (typeof window !== 'undefined' && !sources.includes(window)) {
    sources.push(window)
  }

  return sources
}

export function getSharedGlobal(key, fallbackValue) {
  const sources = getSharedGlobalSources()
  let fallbackBridgeValue

  for (const source of sources) {
    if (source && typeof source[key] !== 'undefined' && source[key] !== null) {
      if (!isFallbackBridgeValue(source[key])) {
        return source[key]
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
      try {
        source[key] = value
      } catch {
        // contextBridge-exposed globals are read-only in the renderer; sync the
        // mutable globals and ignore read-only bridge mirrors.
      }
    }
  })

  return value
}

export {APP_VERSION_FALLBACK}
