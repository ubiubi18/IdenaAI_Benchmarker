const LEGACY_LOCAL_AI_RUNTIME_TYPE = 'phi-sidecar'
const LEGACY_LOCAL_AI_RUNTIME_FAMILY = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_MODEL = 'phi-3.5-vision-instruct'
const LEGACY_LOCAL_AI_VISION_MODEL = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_CONTRACT_VERSION = 'phi-sidecar/v1'
const LEGACY_LOCAL_AI_BASE_URL = 'http://127.0.0.1:5000'
const DEFAULT_LOCAL_AI_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_LOCAL_AI_SIDECAR_BASE_URL = LEGACY_LOCAL_AI_BASE_URL
const DEFAULT_LOCAL_AI_OLLAMA_MODEL = 'qwen3.5:9b'
const DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL = 'qwen3.5:9b'
const RECOMMENDED_LOCAL_AI_OLLAMA_MODEL = 'qwen3.5:9b'
const RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL = 'qwen3.5:9b'
const RECOMMENDED_LOCAL_AI_TRAINING_MODEL = 'mlx-community/Qwen3.5-9B-MLX-4bit'
const STRONG_FALLBACK_LOCAL_AI_OLLAMA_MODEL = RECOMMENDED_LOCAL_AI_OLLAMA_MODEL
const STRONG_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL =
  RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL
const SAFE_FALLBACK_LOCAL_AI_OLLAMA_MODEL = RECOMMENDED_LOCAL_AI_OLLAMA_MODEL
const SAFE_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL =
  RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL
const STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL =
  RECOMMENDED_LOCAL_AI_TRAINING_MODEL
const FALLBACK_LOCAL_AI_TRAINING_MODEL = RECOMMENDED_LOCAL_AI_TRAINING_MODEL
const DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE = 'strong'
const DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE = 'balanced'
const DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE = 'balanced'
const DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE = 100
const DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE = 'manual'
const DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS = 1
const DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE = 1
const DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK = 10
const DEFAULT_DEVELOPER_AI_DRAFT_CONTEXT_WINDOW_TOKENS = 0
const DEFAULT_DEVELOPER_AI_DRAFT_QUESTION_WINDOW_CHARS = 1200
const DEFAULT_DEVELOPER_AI_DRAFT_ANSWER_WINDOW_TOKENS = 768
const DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELD_OPTIONS = [
  'benchmark_review_issue_type',
  'benchmark_review_failure_note',
  'benchmark_review_retraining_hint',
  'benchmark_review_include_for_training',
]
const DEFAULT_DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELDS = [
  'benchmark_review_issue_type',
  'benchmark_review_failure_note',
]
const DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS = [50, 100, 200]
const DEVELOPER_LOCAL_TRAINING_PROFILE_CONFIG = {
  safe: {
    modelPath: FALLBACK_LOCAL_AI_TRAINING_MODEL,
    runtimeModel: SAFE_FALLBACK_LOCAL_AI_OLLAMA_MODEL,
    runtimeVisionModel: SAFE_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL,
    runtimeFallbackModel: '',
    runtimeFallbackVisionModel: '',
  },
  balanced: {
    modelPath: STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
    runtimeModel: STRONG_FALLBACK_LOCAL_AI_OLLAMA_MODEL,
    runtimeVisionModel: STRONG_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL,
    runtimeFallbackModel: SAFE_FALLBACK_LOCAL_AI_OLLAMA_MODEL,
    runtimeFallbackVisionModel: SAFE_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL,
  },
  strong: {
    modelPath: RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
    runtimeModel: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
    runtimeVisionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
    runtimeFallbackModel: STRONG_FALLBACK_LOCAL_AI_OLLAMA_MODEL,
    runtimeFallbackVisionModel: STRONG_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL,
  },
}
const DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG = {
  full_speed: {
    stepCooldownMs: 0,
    epochCooldownMs: 0,
    benchmarkCooldownMs: 0,
  },
  balanced: {
    stepCooldownMs: 250,
    epochCooldownMs: 1500,
    benchmarkCooldownMs: 400,
  },
  cool: {
    stepCooldownMs: 750,
    epochCooldownMs: 4000,
    benchmarkCooldownMs: 1500,
  },
}
const DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT =
  'Use human-teacher guidance without collapsing into a left-only or right-only bias. Prefer left or right only when the visual chronology, readable text, reportability cues, or explicit human annotation meaningfully support that side. If the evidence is weak or conflicting, stay cautious and do not default to one side.'
const LEGACY_LOCAL_AI_PUBLIC_MODEL_ID = 'idena-multimodal-v1'
const LEGACY_LOCAL_AI_PUBLIC_VISION_ID = 'idena-vision-v1'
const DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID = 'Idena-text-v1'
const DEFAULT_LOCAL_AI_PUBLIC_VISION_ID = 'Idena-multimodal-v1'

const DEFAULT_LOCAL_AI_SETTINGS = {
  enabled: false,
  runtimeMode: 'sidecar',
  runtimeBackend: 'ollama-direct',
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
  developerHumanTeacherSystemPrompt: '',
  developerLocalTrainingProfile: DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE,
  developerLocalTrainingThermalMode:
    DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE,
  developerLocalBenchmarkThermalMode:
    DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE,
  developerLocalBenchmarkSize: DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE,
  developerAiDraftTriggerMode: DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE,
  developerLocalTrainingEpochs: DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS,
  developerLocalTrainingBatchSize: DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE,
  developerLocalTrainingLoraRank: DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK,
  developerAiDraftContextWindowTokens:
    DEFAULT_DEVELOPER_AI_DRAFT_CONTEXT_WINDOW_TOKENS,
  developerAiDraftQuestionWindowChars:
    DEFAULT_DEVELOPER_AI_DRAFT_QUESTION_WINDOW_CHARS,
  developerAiDraftAnswerWindowTokens:
    DEFAULT_DEVELOPER_AI_DRAFT_ANSWER_WINDOW_TOKENS,
  developerBenchmarkReviewRequiredFields:
    DEFAULT_DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELDS,
  shareHumanTeacherAnnotationsWithNetwork: false,
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

function normalizeDeveloperHumanTeacherSystemPrompt(value) {
  const nextValue = String(value || '').trim()
  return nextValue.slice(0, 8000)
}

function normalizeDeveloperLocalTrainingProfile(_value) {
  return DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE
}

function normalizeDeveloperLocalTrainingThermalMode(value) {
  const nextValue = trimString(value).toLowerCase()

  return Object.prototype.hasOwnProperty.call(
    DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG,
    nextValue
  )
    ? nextValue
    : DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE
}

function normalizeDeveloperLocalBenchmarkThermalMode(value) {
  const nextValue = trimString(value).toLowerCase()

  return Object.prototype.hasOwnProperty.call(
    DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG,
    nextValue
  )
    ? nextValue
    : DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE
}

function normalizeDeveloperAiDraftTriggerMode(value) {
  return trimString(value).toLowerCase() === 'automatic'
    ? 'automatic'
    : DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE
}

function normalizeDeveloperAiDraftContextWindowTokens(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DEVELOPER_AI_DRAFT_CONTEXT_WINDOW_TOKENS
  }

  return Math.min(32768, Math.max(2048, parsed))
}

function normalizeDeveloperAiDraftQuestionWindowChars(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_AI_DRAFT_QUESTION_WINDOW_CHARS
  }

  return Math.min(4000, Math.max(240, parsed))
}

function normalizeDeveloperAiDraftAnswerWindowTokens(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_AI_DRAFT_ANSWER_WINDOW_TOKENS
  }

  return Math.min(2048, Math.max(128, parsed))
}

function normalizeDeveloperBenchmarkReviewRequiredFields(
  value,
  {fallbackToDefault = true} = {}
) {
  let input = []

  if (Array.isArray(value)) {
    input = value
  } else if (typeof value === 'string') {
    input = String(value)
      .split(',')
      .map((item) => item.trim())
  }

  const normalized = input
    .map((item) => trimString(item))
    .filter(
      (item, index, items) =>
        DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELD_OPTIONS.includes(item) &&
        items.indexOf(item) === index
    )

  if (normalized.length) {
    return normalized
  }

  return fallbackToDefault
    ? [...DEFAULT_DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELDS]
    : []
}

function normalizeDeveloperLocalBenchmarkSize(value) {
  const parsed = Number.parseInt(value, 10)

  return DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS.includes(parsed)
    ? parsed
    : DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE
}

function normalizeDeveloperLocalTrainingEpochs(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS
  }

  return Math.min(6, Math.max(1, parsed))
}

function normalizeDeveloperLocalTrainingBatchSize(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE
  }

  return Math.min(4, Math.max(1, parsed))
}

function normalizeDeveloperLocalTrainingLoraRank(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK
  }

  return Math.min(16, Math.max(4, parsed))
}

function resolveDeveloperLocalTrainingProfileModelPath(_value) {
  return RECOMMENDED_LOCAL_AI_TRAINING_MODEL
}

function resolveDeveloperLocalTrainingProfileRuntimeModel(_value) {
  return RECOMMENDED_LOCAL_AI_OLLAMA_MODEL
}

function resolveDeveloperLocalTrainingProfileRuntimeVisionModel(_value) {
  return RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL
}

function resolveDeveloperLocalTrainingProfileRuntimeFallbackModel(_value) {
  return ''
}

function resolveDeveloperLocalTrainingProfileRuntimeFallbackVisionModel(
  _value
) {
  return ''
}

function resolveDeveloperLocalTrainingThermalModeCooldowns(value) {
  const normalizedMode = normalizeDeveloperLocalTrainingThermalMode(value)
  const config =
    DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG[normalizedMode] ||
    DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG[
      DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE
    ]

  return {
    mode: normalizedMode,
    stepCooldownMs: config.stepCooldownMs,
    epochCooldownMs: config.epochCooldownMs,
    benchmarkCooldownMs: config.benchmarkCooldownMs,
  }
}

function resolveDeveloperLocalBenchmarkThermalModeCooldowns(value) {
  const normalizedMode = normalizeDeveloperLocalBenchmarkThermalMode(value)
  const config =
    DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG[normalizedMode] ||
    DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG[
      DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE
    ]

  return {
    mode: normalizedMode,
    benchmarkCooldownMs: config.benchmarkCooldownMs,
  }
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

function buildLocalAiRuntimePreset(runtimeBackend = 'ollama-direct') {
  const nextRuntimeBackend = normalizeRuntimeBackend({runtimeBackend})

  if (nextRuntimeBackend === 'sidecar-http') {
    return {
      runtimeBackend: nextRuntimeBackend,
      baseUrl: DEFAULT_LOCAL_AI_SIDECAR_BASE_URL,
      endpoint: DEFAULT_LOCAL_AI_SIDECAR_BASE_URL,
      runtimeType: 'sidecar',
      runtimeFamily: '',
      model: '',
      visionModel: '',
    }
  }

  return {
    runtimeBackend: 'ollama-direct',
    baseUrl: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
    endpoint: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
    runtimeType: 'ollama',
    runtimeFamily: '',
    model: DEFAULT_LOCAL_AI_OLLAMA_MODEL,
    visionModel: DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
  }
}

function buildRecommendedLocalAiMacPreset() {
  return {
    ...buildLocalAiRuntimePreset('ollama-direct'),
    trainEnabled: true,
    model: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
    visionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
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
    enabled: source.enabled === true,
    runtimeBackend: normalizeRuntimeBackend(source),
    reasonerBackend:
      trimString(source.reasonerBackend) ||
      DEFAULT_LOCAL_AI_SETTINGS.reasonerBackend,
    visionBackend:
      trimString(source.visionBackend) ||
      DEFAULT_LOCAL_AI_SETTINGS.visionBackend,
    publicModelId: normalizePublicModelId(source.publicModelId),
    publicVisionId: normalizePublicVisionId(source.publicVisionId),
    baseUrl: normalizeBaseUrl(source),
    endpoint: normalizeEndpoint(source),
    runtimeType: trimString(source.runtimeType),
    runtimeFamily: normalizeLegacyRuntimeFamily(source),
    model:
      normalizeRuntimeBackend(source) === 'ollama-direct'
        ? DEFAULT_LOCAL_AI_OLLAMA_MODEL
        : '',
    visionModel:
      normalizeRuntimeBackend(source) === 'ollama-direct'
        ? DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL
        : '',
    adapterStrategy:
      trimString(source.adapterStrategy) ||
      DEFAULT_LOCAL_AI_SETTINGS.adapterStrategy,
    trainingPolicy:
      trimString(source.trainingPolicy) ||
      DEFAULT_LOCAL_AI_SETTINGS.trainingPolicy,
    developerHumanTeacherSystemPrompt:
      normalizeDeveloperHumanTeacherSystemPrompt(
        source.developerHumanTeacherSystemPrompt
      ),
    developerLocalTrainingProfile: normalizeDeveloperLocalTrainingProfile(
      source.developerLocalTrainingProfile
    ),
    developerLocalTrainingThermalMode:
      normalizeDeveloperLocalTrainingThermalMode(
        source.developerLocalTrainingThermalMode
      ),
    developerLocalBenchmarkThermalMode:
      normalizeDeveloperLocalBenchmarkThermalMode(
        source.developerLocalBenchmarkThermalMode
      ),
    developerLocalBenchmarkSize: normalizeDeveloperLocalBenchmarkSize(
      source.developerLocalBenchmarkSize
    ),
    developerAiDraftTriggerMode: normalizeDeveloperAiDraftTriggerMode(
      source.developerAiDraftTriggerMode
    ),
    developerLocalTrainingEpochs: normalizeDeveloperLocalTrainingEpochs(
      source.developerLocalTrainingEpochs
    ),
    developerLocalTrainingBatchSize: normalizeDeveloperLocalTrainingBatchSize(
      source.developerLocalTrainingBatchSize
    ),
    developerLocalTrainingLoraRank: normalizeDeveloperLocalTrainingLoraRank(
      source.developerLocalTrainingLoraRank
    ),
    developerAiDraftContextWindowTokens:
      normalizeDeveloperAiDraftContextWindowTokens(
        source.developerAiDraftContextWindowTokens
      ),
    developerAiDraftQuestionWindowChars:
      normalizeDeveloperAiDraftQuestionWindowChars(
        source.developerAiDraftQuestionWindowChars
      ),
    developerAiDraftAnswerWindowTokens:
      normalizeDeveloperAiDraftAnswerWindowTokens(
        source.developerAiDraftAnswerWindowTokens
      ),
    developerBenchmarkReviewRequiredFields:
      normalizeDeveloperBenchmarkReviewRequiredFields(
        source.developerBenchmarkReviewRequiredFields,
        {
          fallbackToDefault: !Object.prototype.hasOwnProperty.call(
            source,
            'developerBenchmarkReviewRequiredFields'
          ),
        }
      ),
    shareHumanTeacherAnnotationsWithNetwork:
      source.shareHumanTeacherAnnotationsWithNetwork === true,
    contractVersion: normalizeContractVersion(source.contractVersion),
    trainEnabled: source.enabled === true,
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
  DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
  DEFAULT_LOCAL_AI_OLLAMA_MODEL,
  DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
  RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
  RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
  STRONG_FALLBACK_LOCAL_AI_OLLAMA_MODEL,
  STRONG_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL,
  SAFE_FALLBACK_LOCAL_AI_OLLAMA_MODEL,
  SAFE_FALLBACK_LOCAL_AI_OLLAMA_VISION_MODEL,
  RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
  STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
  FALLBACK_LOCAL_AI_TRAINING_MODEL,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE,
  DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE,
  DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE,
  DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK,
  DEFAULT_DEVELOPER_AI_DRAFT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_DEVELOPER_AI_DRAFT_QUESTION_WINDOW_CHARS,
  DEFAULT_DEVELOPER_AI_DRAFT_ANSWER_WINDOW_TOKENS,
  DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELD_OPTIONS,
  DEFAULT_DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELDS,
  DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS,
  DEVELOPER_LOCAL_TRAINING_PROFILE_CONFIG,
  DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG,
  DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
  DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID,
  DEFAULT_LOCAL_AI_PUBLIC_VISION_ID,
  DEFAULT_LOCAL_AI_SIDECAR_BASE_URL,
  getLocalAiEndpointSafety,
  resolveLocalAiWireRuntimeType,
  buildLocalAiRuntimePreset,
  buildRecommendedLocalAiMacPreset,
  normalizeDeveloperLocalTrainingProfile,
  normalizeDeveloperLocalTrainingThermalMode,
  normalizeDeveloperLocalBenchmarkThermalMode,
  normalizeDeveloperLocalBenchmarkSize,
  normalizeDeveloperAiDraftTriggerMode,
  normalizeDeveloperLocalTrainingEpochs,
  normalizeDeveloperLocalTrainingBatchSize,
  normalizeDeveloperLocalTrainingLoraRank,
  normalizeDeveloperAiDraftContextWindowTokens,
  normalizeDeveloperAiDraftQuestionWindowChars,
  normalizeDeveloperAiDraftAnswerWindowTokens,
  normalizeDeveloperBenchmarkReviewRequiredFields,
  resolveDeveloperLocalTrainingProfileModelPath,
  resolveDeveloperLocalTrainingProfileRuntimeModel,
  resolveDeveloperLocalTrainingProfileRuntimeVisionModel,
  resolveDeveloperLocalTrainingProfileRuntimeFallbackModel,
  resolveDeveloperLocalTrainingProfileRuntimeFallbackVisionModel,
  resolveDeveloperLocalTrainingThermalModeCooldowns,
  resolveDeveloperLocalBenchmarkThermalModeCooldowns,
  buildLocalAiSettings,
  mergeLocalAiSettings,
}
