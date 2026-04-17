const LEGACY_LOCAL_AI_RUNTIME_TYPE = 'phi-sidecar'
const LEGACY_LOCAL_AI_RUNTIME_FAMILY = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_MODEL = 'phi-3.5-vision-instruct'
const LEGACY_LOCAL_AI_VISION_MODEL = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_CONTRACT_VERSION = 'phi-sidecar/v1'
const LEGACY_LOCAL_AI_BASE_URL = 'http://127.0.0.1:5000'
const DEFAULT_LOCAL_AI_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_LOCAL_AI_SIDECAR_BASE_URL = LEGACY_LOCAL_AI_BASE_URL
const FIXED_LOCAL_AI_RUNTIME_BACKEND = 'ollama-direct'
const DEFAULT_LOCAL_AI_OLLAMA_MODEL = 'qwen3.5:9b'
const DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL = 'qwen3.5:9b'
const LEGACY_LOCAL_AI_PUBLIC_MODEL_ID = 'idena-multimodal-v1'
const LEGACY_LOCAL_AI_PUBLIC_VISION_ID = 'idena-vision-v1'
const DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID = 'Idena-text-v1'
const DEFAULT_LOCAL_AI_PUBLIC_VISION_ID = 'Idena-multimodal-v1'

const DEFAULT_LOCAL_AI_SETTINGS = {
  enabled: false,
  runtimeMode: 'sidecar',
  runtimeBackend: FIXED_LOCAL_AI_RUNTIME_BACKEND,
  reasonerBackend: 'local-reasoner',
  visionBackend: 'local-vision',
  publicModelId: DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID,
  publicVisionId: DEFAULT_LOCAL_AI_PUBLIC_VISION_ID,
  baseUrl: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
  endpoint: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
  runtimeType: '',
  runtimeFamily: '',
  model: DEFAULT_LOCAL_AI_OLLAMA_MODEL,
  visionModel: DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
  adapterStrategy: 'lora-first',
  trainingPolicy: 'approved-post-consensus-only',
  contractVersion: 'idena-local/v1',
  captureEnabled: false,
  trainEnabled: false,
  federated: {
    enabled: false,
    relays: [],
    minExamples: 5,
    clipNorm: 1.0,
    dpNoise: 0.01,
  },
  eligibilityGate: {
    requireValidatedIdentity: true,
    requireLocalNode: true,
  },
  rankingPolicy: {
    sourcePriority: 'local-node-first',
    allowPublicIndexerFallback: true,
    extraFlipBaseline: 3,
    excludeBadAuthors: false,
    excludeRepeatReportOffenders: false,
    maxRepeatReportOffenses: 1,
  },
}

function trimString(value) {
  return String(value || '').trim()
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function parseLocalAiUrl(value) {
  const text = trimString(value)

  if (!text) {
    return null
  }

  try {
    return new URL(text)
  } catch {
    return null
  }
}

function isLoopbackHostname(value) {
  const hostname = trimString(value).toLowerCase()

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

function getLocalAiEndpointSafety(value) {
  const text = trimString(value)

  if (!text) {
    return {
      safe: false,
      reason: 'endpoint_required',
      message: 'Local AI endpoint is required.',
      normalizedBaseUrl: '',
    }
  }

  const url = parseLocalAiUrl(text)

  if (!url || !/^https?:$/i.test(url.protocol)) {
    return {
      safe: false,
      reason: 'invalid_url',
      message: 'Local AI endpoint must be a valid http(s) URL.',
      normalizedBaseUrl: text,
    }
  }

  if (url.username || url.password) {
    return {
      safe: false,
      reason: 'credentials_not_allowed',
      message: 'Local AI endpoint must not include embedded credentials.',
      normalizedBaseUrl: trimTrailingSlash(url.toString()),
    }
  }

  if (url.search || url.hash) {
    return {
      safe: false,
      reason: 'query_not_allowed',
      message:
        'Local AI endpoint must not include query parameters or URL fragments.',
      normalizedBaseUrl: trimTrailingSlash(url.toString()),
    }
  }

  if (!isLoopbackHostname(url.hostname)) {
    return {
      safe: false,
      reason: 'loopback_only',
      message:
        'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
      normalizedBaseUrl: trimTrailingSlash(url.toString()),
    }
  }

  return {
    safe: true,
    reason: '',
    message: '',
    normalizedBaseUrl: trimTrailingSlash(url.toString()),
  }
}

function normalizeRuntimeBackend(source = {}) {
  const explicit = trimString(source.runtimeBackend).toLowerCase()
  switch (explicit) {
    case 'ollama':
    case 'ollama-http':
    case 'ollama-direct':
      return 'ollama-direct'
    case 'sidecar':
    case 'sidecar-http':
    case 'local-ai-sidecar':
    case LEGACY_LOCAL_AI_RUNTIME_TYPE:
      return 'sidecar-http'
    default:
      if (explicit) {
        return explicit
      }
  }

  const legacyRuntimeType = trimString(source.runtimeType).toLowerCase()
  if (legacyRuntimeType === 'ollama') {
    return 'ollama-direct'
  }

  return DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend
}

function defaultBaseUrlForRuntimeBackend(runtimeBackend) {
  return runtimeBackend === 'ollama-direct'
    ? DEFAULT_LOCAL_AI_OLLAMA_BASE_URL
    : DEFAULT_LOCAL_AI_SIDECAR_BASE_URL
}

function normalizeContractVersion(value) {
  const nextValue = trimString(value)

  if (
    !nextValue ||
    nextValue.toLowerCase() === LEGACY_LOCAL_AI_CONTRACT_VERSION.toLowerCase()
  ) {
    return DEFAULT_LOCAL_AI_SETTINGS.contractVersion
  }

  return nextValue
}

function normalizeBaseUrl(source = {}) {
  const runtimeBackend = normalizeRuntimeBackend(source)
  const defaultBaseUrl = defaultBaseUrlForRuntimeBackend(runtimeBackend)
  const explicit = trimString(source.baseUrl) || trimString(source.endpoint)

  if (!explicit) {
    return defaultBaseUrl
  }

  if (
    runtimeBackend === 'ollama-direct' &&
    explicit === DEFAULT_LOCAL_AI_SIDECAR_BASE_URL
  ) {
    return defaultBaseUrl
  }

  if (
    runtimeBackend === 'sidecar-http' &&
    explicit === DEFAULT_LOCAL_AI_OLLAMA_BASE_URL
  ) {
    return defaultBaseUrl
  }

  return explicit
}

function normalizeEndpoint(source = {}) {
  return normalizeBaseUrl(source)
}

function _normalizeLegacyRuntimeFamily(source = {}) {
  const explicit = trimString(source.runtimeFamily)
  if (explicit) {
    return explicit
  }

  if (trimString(source.reasonerBackend)) {
    return trimString(source.reasonerBackend)
  }

  return DEFAULT_LOCAL_AI_SETTINGS.runtimeFamily
}

function normalizePublicModelId(value) {
  const nextValue = trimString(value)

  if (
    !nextValue ||
    nextValue.toLowerCase() === LEGACY_LOCAL_AI_PUBLIC_MODEL_ID.toLowerCase()
  ) {
    return DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID
  }

  return nextValue
}

function normalizePublicVisionId(value) {
  const nextValue = trimString(value)

  if (
    !nextValue ||
    nextValue.toLowerCase() === LEGACY_LOCAL_AI_PUBLIC_VISION_ID.toLowerCase()
  ) {
    return DEFAULT_LOCAL_AI_PUBLIC_VISION_ID
  }

  return nextValue
}

function resolveLocalAiWireRuntimeType(settings = {}) {
  const explicit = trimString(settings.runtimeType)
  if (explicit) {
    return explicit
  }

  switch (trimString(settings.runtimeBackend).toLowerCase()) {
    case 'ollama':
    case 'ollama-http':
    case 'ollama-direct':
      return 'ollama'
    case 'sidecar-http':
    default:
      return 'sidecar'
  }
}

function buildLocalAiRuntimePreset() {
  return {
    runtimeBackend: FIXED_LOCAL_AI_RUNTIME_BACKEND,
    baseUrl: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
    endpoint: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
    runtimeType: 'ollama',
    runtimeFamily: '',
    model: DEFAULT_LOCAL_AI_OLLAMA_MODEL,
    visionModel: DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
  }
}

function isLegacySidecarDefaultConfig(source = {}) {
  const runtimeBackend = trimString(source.runtimeBackend).toLowerCase()
  const runtimeType = trimString(source.runtimeType).toLowerCase()
  const runtimeFamily = trimString(source.runtimeFamily).toLowerCase()
  const baseUrl = trimString(source.baseUrl || source.endpoint)
  const model = trimString(source.model)
  const visionModel = trimString(source.visionModel)
  const contractVersion = trimString(source.contractVersion).toLowerCase()
  const usesLegacyRuntimeBackend =
    !runtimeBackend ||
    runtimeBackend === 'sidecar' ||
    runtimeBackend === 'sidecar-http' ||
    runtimeBackend === 'local-ai-sidecar'
  const usesLegacyRuntimeType =
    !runtimeType ||
    runtimeType === 'sidecar' ||
    runtimeType === LEGACY_LOCAL_AI_RUNTIME_TYPE

  if (!usesLegacyRuntimeBackend && !usesLegacyRuntimeType) {
    return false
  }

  return (
    (!baseUrl || baseUrl === LEGACY_LOCAL_AI_BASE_URL) &&
    usesLegacyRuntimeType &&
    (!runtimeFamily || runtimeFamily === LEGACY_LOCAL_AI_RUNTIME_FAMILY) &&
    (!model || model === LEGACY_LOCAL_AI_MODEL) &&
    (!visionModel || visionModel === LEGACY_LOCAL_AI_VISION_MODEL) &&
    (!contractVersion ||
      contractVersion === LEGACY_LOCAL_AI_CONTRACT_VERSION ||
      contractVersion === DEFAULT_LOCAL_AI_SETTINGS.contractVersion)
  )
}

function buildLocalAiSettings(settings = {}) {
  const rawSource =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {}
  const source = isLegacySidecarDefaultConfig(rawSource)
    ? {
        ...rawSource,
        ...buildLocalAiRuntimePreset('ollama-direct'),
      }
    : rawSource

  const normalizedSettings = {
    ...DEFAULT_LOCAL_AI_SETTINGS,
    ...source,
    runtimeBackend: FIXED_LOCAL_AI_RUNTIME_BACKEND,
    reasonerBackend:
      trimString(source.reasonerBackend) ||
      DEFAULT_LOCAL_AI_SETTINGS.reasonerBackend,
    visionBackend:
      trimString(source.visionBackend) ||
      DEFAULT_LOCAL_AI_SETTINGS.visionBackend,
    publicModelId: normalizePublicModelId(source.publicModelId),
    publicVisionId: normalizePublicVisionId(source.publicVisionId),
    baseUrl: normalizeBaseUrl({
      ...source,
      runtimeBackend: FIXED_LOCAL_AI_RUNTIME_BACKEND,
    }),
    endpoint: normalizeEndpoint({
      ...source,
      runtimeBackend: FIXED_LOCAL_AI_RUNTIME_BACKEND,
    }),
    runtimeType: 'ollama',
    runtimeFamily: '',
    model: DEFAULT_LOCAL_AI_OLLAMA_MODEL,
    visionModel: DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
    adapterStrategy:
      trimString(source.adapterStrategy) ||
      DEFAULT_LOCAL_AI_SETTINGS.adapterStrategy,
    trainingPolicy:
      trimString(source.trainingPolicy) ||
      DEFAULT_LOCAL_AI_SETTINGS.trainingPolicy,
    contractVersion: normalizeContractVersion(source.contractVersion),
    federated: {
      ...DEFAULT_LOCAL_AI_SETTINGS.federated,
      ...((source && source.federated) || {}),
    },
    eligibilityGate: {
      ...DEFAULT_LOCAL_AI_SETTINGS.eligibilityGate,
      ...((source && source.eligibilityGate) || {}),
    },
    rankingPolicy: {
      ...DEFAULT_LOCAL_AI_SETTINGS.rankingPolicy,
      ...((source && source.rankingPolicy) || {}),
    },
  }

  return normalizedSettings
}

function mergeLocalAiSettings(current = {}, next = {}) {
  return buildLocalAiSettings({
    ...(current || {}),
    ...(next || {}),
    federated: {
      ...((current && current.federated) || {}),
      ...((next && next.federated) || {}),
    },
    eligibilityGate: {
      ...((current && current.eligibilityGate) || {}),
      ...((next && next.eligibilityGate) || {}),
    },
    rankingPolicy: {
      ...((current && current.rankingPolicy) || {}),
      ...((next && next.rankingPolicy) || {}),
    },
  })
}

module.exports = {
  LEGACY_LOCAL_AI_RUNTIME_TYPE,
  LEGACY_LOCAL_AI_RUNTIME_FAMILY,
  LEGACY_LOCAL_AI_MODEL,
  LEGACY_LOCAL_AI_VISION_MODEL,
  LEGACY_LOCAL_AI_CONTRACT_VERSION,
  DEFAULT_LOCAL_AI_SETTINGS,
  FIXED_LOCAL_AI_RUNTIME_BACKEND,
  DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
  DEFAULT_LOCAL_AI_OLLAMA_MODEL,
  DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
  DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID,
  DEFAULT_LOCAL_AI_PUBLIC_VISION_ID,
  DEFAULT_LOCAL_AI_SIDECAR_BASE_URL,
  getLocalAiEndpointSafety,
  resolveLocalAiWireRuntimeType,
  buildLocalAiRuntimePreset,
  buildLocalAiSettings,
  mergeLocalAiSettings,
}
