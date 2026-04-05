export function normalizeAiProviderId(value, fallback = 'openai') {
  const provider = String(value || '')
    .trim()
    .toLowerCase()

  return provider || fallback
}

export function getRequiredAiProviders(aiSolver = {}) {
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

export function formatMissingAiProviders(missingProviders = []) {
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

  return uniqueProviders.join(', ')
}

export async function checkAiProviderReadiness({bridge, aiSolver = {}} = {}) {
  const activeProvider = normalizeAiProviderId(aiSolver.provider, 'openai')
  const requiredProviders = getRequiredAiProviders(aiSolver)

  if (!bridge || typeof bridge.hasProviderKey !== 'function') {
    return {
      checked: true,
      checking: false,
      activeProvider,
      requiredProviders,
      missingProviders: requiredProviders.slice(),
      hasKey: requiredProviders.length === 0,
      allReady: requiredProviders.length === 0,
      primaryReady: requiredProviders.length === 0,
      providerStates: {},
      error: 'ai_bridge_unavailable',
    }
  }

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
