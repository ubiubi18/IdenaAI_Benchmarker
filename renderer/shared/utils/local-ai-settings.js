const LEGACY_LOCAL_AI_RUNTIME_TYPE = 'phi-sidecar'
const LEGACY_LOCAL_AI_RUNTIME_FAMILY = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_MODEL = 'phi-3.5-vision-instruct'
const LEGACY_LOCAL_AI_VISION_MODEL = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_CONTRACT_VERSION = 'phi-sidecar/v1'
const DEFAULT_LOCAL_AI_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

const DEFAULT_LOCAL_AI_SETTINGS = {
  enabled: false,
  runtimeMode: 'sidecar',
  runtimeBackend: 'sidecar-http',
  reasonerBackend: 'local-reasoner',
  visionBackend: 'local-vision',
  publicModelId: 'idena-core-v1',
  publicVisionId: 'idena-vision-v1',
  baseUrl: 'http://127.0.0.1:5000',
  endpoint: 'http://127.0.0.1:5000',
  runtimeType: '',
  runtimeFamily: '',
  model: '',
  visionModel: '',
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
}

function trimString(value) {
  return String(value || '').trim()
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
      return DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend
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
    : DEFAULT_LOCAL_AI_SETTINGS.baseUrl
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
    explicit === DEFAULT_LOCAL_AI_SETTINGS.baseUrl
  ) {
    return defaultBaseUrl
  }

  if (
    runtimeBackend === DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend &&
    explicit === DEFAULT_LOCAL_AI_OLLAMA_BASE_URL
  ) {
    return defaultBaseUrl
  }

  return explicit
}

function normalizeEndpoint(source = {}) {
  return normalizeBaseUrl(source)
}

function normalizeLegacyRuntimeFamily(source = {}) {
  const explicit = trimString(source.runtimeFamily)
  if (explicit) {
    return explicit
  }

  if (trimString(source.reasonerBackend)) {
    return trimString(source.reasonerBackend)
  }

  return DEFAULT_LOCAL_AI_SETTINGS.runtimeFamily
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

function buildLocalAiSettings(settings = {}) {
  const source =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {}

  const normalizedSettings = {
    ...DEFAULT_LOCAL_AI_SETTINGS,
    ...source,
    runtimeBackend: normalizeRuntimeBackend(source),
    reasonerBackend:
      trimString(source.reasonerBackend) ||
      DEFAULT_LOCAL_AI_SETTINGS.reasonerBackend,
    visionBackend:
      trimString(source.visionBackend) ||
      DEFAULT_LOCAL_AI_SETTINGS.visionBackend,
    publicModelId:
      trimString(source.publicModelId) ||
      DEFAULT_LOCAL_AI_SETTINGS.publicModelId,
    publicVisionId:
      trimString(source.publicVisionId) ||
      DEFAULT_LOCAL_AI_SETTINGS.publicVisionId,
    baseUrl: normalizeBaseUrl(source),
    endpoint: normalizeEndpoint(source),
    runtimeType: trimString(source.runtimeType),
    runtimeFamily: normalizeLegacyRuntimeFamily(source),
    model: trimString(source.model),
    visionModel: trimString(source.visionModel),
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
  })
}

module.exports = {
  LEGACY_LOCAL_AI_RUNTIME_TYPE,
  LEGACY_LOCAL_AI_RUNTIME_FAMILY,
  LEGACY_LOCAL_AI_MODEL,
  LEGACY_LOCAL_AI_VISION_MODEL,
  LEGACY_LOCAL_AI_CONTRACT_VERSION,
  DEFAULT_LOCAL_AI_SETTINGS,
  resolveLocalAiWireRuntimeType,
  buildLocalAiSettings,
  mergeLocalAiSettings,
}
