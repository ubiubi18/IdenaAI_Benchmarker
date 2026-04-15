const {
  DEFAULT_LOCAL_AI_SETTINGS,
  getLocalAiEndpointSafety,
  resolveLocalAiWireRuntimeType,
} = require('./local-ai-settings')

const LOCAL_AI_PROVIDER = 'local-ai'
const LOCAL_AI_STATUS_TTL_MS = 3000

let localAiProviderStateCache = {
  key: '',
  expiresAt: 0,
  result: null,
  inFlight: null,
}

function normalizeAiProviderId(value, fallback = 'openai') {
  const provider = String(value || '')
    .trim()
    .toLowerCase()

  return provider || fallback
}

function isLocalAiProvider(value) {
  return normalizeAiProviderId(value, '') === LOCAL_AI_PROVIDER
}

function formatAiProviderLabel(value) {
  const provider = normalizeAiProviderId(value, '')

  switch (provider) {
    case LOCAL_AI_PROVIDER:
      return 'local AI runtime'
    case 'openai-compatible':
      return 'custom OpenAI-compatible'
    case 'xai':
      return 'xAI'
    case 'openrouter':
      return 'OpenRouter'
    default:
      return provider
  }
}

function buildLocalAiRuntimePayload(localAi = {}) {
  const source =
    localAi && typeof localAi === 'object' && !Array.isArray(localAi)
      ? localAi
      : {}
  const baseUrl = String(
    source.endpoint || source.baseUrl || DEFAULT_LOCAL_AI_SETTINGS.endpoint
  ).trim()

  return {
    enabled: Boolean(source.enabled),
    refresh: true,
    mode: source.runtimeMode || DEFAULT_LOCAL_AI_SETTINGS.runtimeMode,
    runtimeType: resolveLocalAiWireRuntimeType(source),
    runtimeBackend:
      source.runtimeBackend || DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
    reasonerBackend:
      source.reasonerBackend || DEFAULT_LOCAL_AI_SETTINGS.reasonerBackend,
    visionBackend:
      source.visionBackend || DEFAULT_LOCAL_AI_SETTINGS.visionBackend,
    publicModelId:
      source.publicModelId || DEFAULT_LOCAL_AI_SETTINGS.publicModelId,
    publicVisionId:
      source.publicVisionId || DEFAULT_LOCAL_AI_SETTINGS.publicVisionId,
    contractVersion:
      source.contractVersion || DEFAULT_LOCAL_AI_SETTINGS.contractVersion,
    baseUrl,
    endpoint: baseUrl,
    model: String(source.model || '').trim(),
    visionModel: String(source.visionModel || '').trim(),
  }
}

async function resolveLocalAiProviderState({localBridge, localAi} = {}) {
  const payload = buildLocalAiRuntimePayload(localAi)
  const cacheKey = JSON.stringify(payload)
  const now = Date.now()
  const endpointSafety = getLocalAiEndpointSafety(payload.baseUrl)

  if (!localBridge || typeof localBridge.status !== 'function') {
    return {
      provider: LOCAL_AI_PROVIDER,
      hasKey: false,
      error: 'local_ai_bridge_unavailable',
    }
  }

  if (!(localAi && localAi.enabled === true)) {
    return {
      provider: LOCAL_AI_PROVIDER,
      hasKey: false,
      error: 'local_ai_disabled',
    }
  }

  if (!endpointSafety.safe) {
    return {
      provider: LOCAL_AI_PROVIDER,
      hasKey: false,
      error: endpointSafety.message,
    }
  }

  if (
    localAiProviderStateCache.key === cacheKey &&
    localAiProviderStateCache.result &&
    localAiProviderStateCache.expiresAt > now
  ) {
    return localAiProviderStateCache.result
  }

  if (
    localAiProviderStateCache.key === cacheKey &&
    localAiProviderStateCache.inFlight
  ) {
    return localAiProviderStateCache.inFlight
  }

  const request = (async () => {
    try {
      const result = await localBridge.status(payload)
      const ready = Boolean(
        result && result.enabled !== false && result.sidecarReachable === true
      )
      const message = String(
        (result && (result.error || result.lastError)) || ''
      ).trim()
      const nextState = {
        provider: LOCAL_AI_PROVIDER,
        hasKey: ready,
        error: ready ? '' : message || 'local_ai_unavailable',
      }

      localAiProviderStateCache = {
        key: cacheKey,
        expiresAt: Date.now() + LOCAL_AI_STATUS_TTL_MS,
        result: nextState,
        inFlight: null,
      }

      return nextState
    } catch (error) {
      const nextState = {
        provider: LOCAL_AI_PROVIDER,
        hasKey: false,
        error: String((error && error.message) || error || '').trim(),
      }

      localAiProviderStateCache = {
        key: cacheKey,
        expiresAt: Date.now() + LOCAL_AI_STATUS_TTL_MS,
        result: nextState,
        inFlight: null,
      }

      return nextState
    }
  })()

  localAiProviderStateCache = {
    ...localAiProviderStateCache,
    key: cacheKey,
    inFlight: request,
  }

  return request
}

function getRequiredAiProviders(aiSolver = {}) {
  const providers = []
  const legacyOnlyMode = Boolean(
    aiSolver.legacyHeuristicEnabled && aiSolver.legacyHeuristicOnly
  )

  if (!legacyOnlyMode) {
    providers.push(normalizeAiProviderId(aiSolver.provider, 'openai'))
  }

  if (aiSolver.ensembleEnabled) {
    if (aiSolver.ensembleProvider2Enabled) {
      providers.push(
        normalizeAiProviderId(aiSolver.ensembleProvider2, 'gemini')
      )
    }
    if (aiSolver.ensembleProvider3Enabled) {
      providers.push(
        normalizeAiProviderId(aiSolver.ensembleProvider3, 'openai')
      )
    }
  }

  return Array.from(new Set(providers.filter(Boolean)))
}

function formatMissingAiProviders(missingProviders = []) {
  const uniqueProviders = Array.from(
    new Set(
      (Array.isArray(missingProviders) ? missingProviders : [])
        .map((item) => normalizeAiProviderId(item, ''))
        .filter(Boolean)
    )
  )

  if (!uniqueProviders.length) {
    return ''
  }

  return uniqueProviders
    .map((provider) => formatAiProviderLabel(provider))
    .join(', ')
}

async function checkAiProviderReadiness({
  bridge,
  localBridge,
  localAi,
  aiSolver = {},
} = {}) {
  const activeProvider = normalizeAiProviderId(aiSolver.provider, 'openai')
  const requiredProviders = getRequiredAiProviders(aiSolver)

  if (!requiredProviders.length) {
    return {
      checked: true,
      checking: false,
      activeProvider,
      requiredProviders: [],
      missingProviders: [],
      hasKey: true,
      allReady: true,
      primaryReady: true,
      providerStates: {},
      error: '',
    }
  }

  const providerStates = {}
  let statusError = ''

  await Promise.all(
    requiredProviders.map(async (provider) => {
      if (isLocalAiProvider(provider)) {
        const state = await resolveLocalAiProviderState({
          localBridge,
          localAi,
        })
        providerStates[provider] = state
        if (!state.hasKey && !statusError) {
          statusError = state.error || 'local_ai_unavailable'
        }
        return
      }

      if (!bridge || typeof bridge.hasProviderKey !== 'function') {
        providerStates[provider] = {
          provider,
          hasKey: false,
          error: 'ai_bridge_unavailable',
        }
        if (!statusError) {
          statusError = 'ai_bridge_unavailable'
        }
        return
      }

      try {
        const state = await bridge.hasProviderKey({provider})
        providerStates[provider] = {
          provider,
          hasKey: Boolean(state && state.hasKey),
          error: '',
        }
      } catch (error) {
        const message = String((error && error.message) || error || '').trim()
        providerStates[provider] = {
          provider,
          hasKey: false,
          error: message,
        }
        if (!statusError) {
          statusError = message
        }
      }
    })
  )

  const missingProviders = requiredProviders.filter(
    (provider) => !providerStates[provider] || !providerStates[provider].hasKey
  )
  const primaryReady = Boolean(
    providerStates[activeProvider] && providerStates[activeProvider].hasKey
  )
  const allReady = missingProviders.length === 0

  return {
    checked: true,
    checking: false,
    activeProvider,
    requiredProviders,
    missingProviders,
    hasKey: allReady,
    allReady,
    primaryReady,
    providerStates,
    error: statusError,
  }
}

module.exports = {
  LOCAL_AI_PROVIDER,
  buildLocalAiRuntimePayload,
  normalizeAiProviderId,
  isLocalAiProvider,
  formatAiProviderLabel,
  resolveLocalAiProviderState,
  getRequiredAiProviders,
  formatMissingAiProviders,
  checkAiProviderReadiness,
}
