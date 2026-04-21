const LEGACY_LOCAL_AI_RUNTIME_TYPE = 'phi-sidecar'
const LEGACY_LOCAL_AI_RUNTIME_FAMILY = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_MODEL = 'phi-3.5-vision-instruct'
const LEGACY_LOCAL_AI_VISION_MODEL = 'phi-3.5-vision'
const LEGACY_LOCAL_AI_CONTRACT_VERSION = 'phi-sidecar/v1'
const LEGACY_LOCAL_AI_BASE_URL = 'http://127.0.0.1:5000'
const DEFAULT_LOCAL_AI_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_LOCAL_AI_SIDECAR_BASE_URL = LEGACY_LOCAL_AI_BASE_URL
const LOCAL_RUNTIME_SERVICE_BACKEND = 'local-runtime-service'
const MOLMO2_O_RESEARCH_BASE_URL = 'http://127.0.0.1:8080'
const MOLMO2_O_RESEARCH_RUNTIME_FAMILY = 'molmo2-o'
const MOLMO2_O_RESEARCH_RUNTIME_MODEL = 'allenai/Molmo2-O-7B'
const MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL = 'allenai/Molmo2-O-7B'
const MOLMO2_4B_RESEARCH_BASE_URL = 'http://127.0.0.1:8080'
const MOLMO2_4B_RESEARCH_RUNTIME_FAMILY = 'molmo2-4b'
const MOLMO2_4B_RESEARCH_RUNTIME_MODEL = 'allenai/Molmo2-4B'
const MOLMO2_4B_RESEARCH_RUNTIME_VISION_MODEL = 'allenai/Molmo2-4B'
const INTERNVL3_5_1B_RESEARCH_BASE_URL = 'http://127.0.0.1:8080'
const INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY = 'internvl3.5-1b'
const INTERNVL3_5_1B_RESEARCH_RUNTIME_MODEL = 'OpenGVLab/InternVL3_5-1B-HF'
const INTERNVL3_5_1B_RESEARCH_RUNTIME_VISION_MODEL =
  'OpenGVLab/InternVL3_5-1B-HF'
const INTERNVL3_5_8B_RESEARCH_BASE_URL = 'http://127.0.0.1:8080'
const INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY = 'internvl3.5-8b'
const INTERNVL3_5_8B_RESEARCH_RUNTIME_MODEL = 'OpenGVLab/InternVL3_5-8B-HF'
const INTERNVL3_5_8B_RESEARCH_RUNTIME_VISION_MODEL =
  'OpenGVLab/InternVL3_5-8B-HF'
const MANAGED_MOLMO2_RUNTIME_FAMILIES = [
  MOLMO2_O_RESEARCH_RUNTIME_FAMILY,
  MOLMO2_4B_RESEARCH_RUNTIME_FAMILY,
]
const MANAGED_LOCAL_RUNTIME_FAMILIES = MANAGED_MOLMO2_RUNTIME_FAMILIES.concat(
  INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY,
  INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY
)
const MANAGED_LOCAL_RUNTIME_TRUST_VERSION = 1
const DEFAULT_LOCAL_AI_OLLAMA_MODEL = ''
const DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL = ''
const RECOMMENDED_LOCAL_AI_OLLAMA_MODEL = ''
const RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL = ''
const RECOMMENDED_LOCAL_AI_TRAINING_MODEL = ''
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
const MAX_DEVELOPER_LOCAL_BENCHMARK_SIZE = 500
const DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS = [25, 50, 100, 200, 500]
const DEVELOPER_LOCAL_TRAINING_PROFILE_CONFIG = {
  safe: {
    modelPath: FALLBACK_LOCAL_AI_TRAINING_MODEL,
    runtimeModel: MOLMO2_O_RESEARCH_RUNTIME_MODEL,
    runtimeVisionModel: MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL,
    runtimeFallbackModel: '',
    runtimeFallbackVisionModel: '',
  },
  balanced: {
    modelPath: STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
    runtimeModel: MOLMO2_O_RESEARCH_RUNTIME_MODEL,
    runtimeVisionModel: MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL,
    runtimeFallbackModel: '',
    runtimeFallbackVisionModel: '',
  },
  strong: {
    modelPath: RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
    runtimeModel: MOLMO2_O_RESEARCH_RUNTIME_MODEL,
    runtimeVisionModel: MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL,
    runtimeFallbackModel: '',
    runtimeFallbackVisionModel: '',
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
  'Use human-teacher guidance without collapsing into a left-only or right-only bias. Candidate order, first-vs-second position, and display slot are not evidence. Compare candidate identity and the actual visual chronology instead of where a candidate appears. Prefer left or right only when the visible sequence, readable text, reportability cues, or explicit human annotation meaningfully support that side. If the evidence is weak or conflicting, stay cautious and abstain instead of defaulting to the first shown candidate.'
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
  managedRuntimePythonPath: '',
  ollamaCommandPath: '',
  managedRuntimeTrustVersion: 0,
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

function normalizeManagedRuntimeTrustVersion(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function hasManagedLocalAiTrustApproval(source = {}) {
  return (
    normalizeManagedRuntimeTrustVersion(source.managedRuntimeTrustVersion) >=
    MANAGED_LOCAL_RUNTIME_TRUST_VERSION
  )
}

function buildManagedLocalAiTrustApprovalPatch() {
  return {
    managedRuntimeTrustVersion: MANAGED_LOCAL_RUNTIME_TRUST_VERSION,
  }
}

function trimString(value) {
  return String(value || '').trim()
}

function normalizeOptionalCommandPath(value) {
  return trimString(value).slice(0, 4096)
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
    case LOCAL_RUNTIME_SERVICE_BACKEND:
    case 'sidecar':
    case 'sidecar-http':
    case 'local-ai-sidecar':
    case LEGACY_LOCAL_AI_RUNTIME_TYPE:
      return LOCAL_RUNTIME_SERVICE_BACKEND
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
    runtimeBackend === LOCAL_RUNTIME_SERVICE_BACKEND &&
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

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE
  }

  return Math.min(MAX_DEVELOPER_LOCAL_BENCHMARK_SIZE, Math.max(1, parsed))
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
  return MOLMO2_O_RESEARCH_RUNTIME_MODEL
}

function resolveDeveloperLocalTrainingProfileRuntimeVisionModel(_value) {
  return MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL
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
    case LOCAL_RUNTIME_SERVICE_BACKEND:
    default:
      return 'sidecar'
  }
}

function buildLocalAiRuntimePreset(runtimeBackend = 'ollama-direct') {
  const nextRuntimeBackend = normalizeRuntimeBackend({runtimeBackend})

  if (nextRuntimeBackend === LOCAL_RUNTIME_SERVICE_BACKEND) {
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
    model: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
    visionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
  }
}

function buildMolmo2OResearchPreset() {
  return {
    ...buildLocalAiRuntimePreset(LOCAL_RUNTIME_SERVICE_BACKEND),
    baseUrl: MOLMO2_O_RESEARCH_BASE_URL,
    endpoint: MOLMO2_O_RESEARCH_BASE_URL,
    runtimeFamily: MOLMO2_O_RESEARCH_RUNTIME_FAMILY,
    model: MOLMO2_O_RESEARCH_RUNTIME_MODEL,
    visionModel: MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL,
  }
}

function buildMolmo24BCompactPreset() {
  return {
    ...buildLocalAiRuntimePreset(LOCAL_RUNTIME_SERVICE_BACKEND),
    baseUrl: MOLMO2_4B_RESEARCH_BASE_URL,
    endpoint: MOLMO2_4B_RESEARCH_BASE_URL,
    runtimeFamily: MOLMO2_4B_RESEARCH_RUNTIME_FAMILY,
    model: MOLMO2_4B_RESEARCH_RUNTIME_MODEL,
    visionModel: MOLMO2_4B_RESEARCH_RUNTIME_VISION_MODEL,
  }
}

function buildInternVl351BLightPreset() {
  return {
    ...buildLocalAiRuntimePreset(LOCAL_RUNTIME_SERVICE_BACKEND),
    baseUrl: INTERNVL3_5_1B_RESEARCH_BASE_URL,
    endpoint: INTERNVL3_5_1B_RESEARCH_BASE_URL,
    runtimeFamily: INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY,
    model: INTERNVL3_5_1B_RESEARCH_RUNTIME_MODEL,
    visionModel: INTERNVL3_5_1B_RESEARCH_RUNTIME_VISION_MODEL,
  }
}

function buildInternVl358BExperimentalPreset() {
  return {
    ...buildLocalAiRuntimePreset(LOCAL_RUNTIME_SERVICE_BACKEND),
    baseUrl: INTERNVL3_5_8B_RESEARCH_BASE_URL,
    endpoint: INTERNVL3_5_8B_RESEARCH_BASE_URL,
    runtimeFamily: INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY,
    model: INTERNVL3_5_8B_RESEARCH_RUNTIME_MODEL,
    visionModel: INTERNVL3_5_8B_RESEARCH_RUNTIME_VISION_MODEL,
  }
}

function buildManagedLocalRuntimePreset(runtimeFamily = '') {
  switch (
    String(runtimeFamily || '')
      .trim()
      .toLowerCase()
  ) {
    case MOLMO2_4B_RESEARCH_RUNTIME_FAMILY:
      return buildMolmo24BCompactPreset()
    case INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY:
      return buildInternVl351BLightPreset()
    case INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY:
      return buildInternVl358BExperimentalPreset()
    case MOLMO2_O_RESEARCH_RUNTIME_FAMILY:
    default:
      return buildMolmo2OResearchPreset()
  }
}

function resolveManagedLocalRuntimeMemoryReference(runtimeFamily = '') {
  switch (
    String(runtimeFamily || '')
      .trim()
      .toLowerCase()
  ) {
    case MOLMO2_4B_RESEARCH_RUNTIME_FAMILY:
      return 'molmo2-4b'
    case INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY:
      return 'internvl3.5-1b'
    case INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY:
      return 'internvl3.5-8b'
    case MOLMO2_O_RESEARCH_RUNTIME_FAMILY:
      return 'molmo2-o-7b'
    default:
      return ''
  }
}

function buildManagedMolmo2RuntimePreset(runtimeFamily = '') {
  return buildManagedLocalRuntimePreset(runtimeFamily)
}

function buildLocalAiRepairPreset(source = {}, {preferManaged = false} = {}) {
  const runtimeBackend = normalizeRuntimeBackend(source)
  const runtimeFamily = trimString(source.runtimeFamily).toLowerCase()
  const useManaged =
    preferManaged ||
    runtimeBackend === LOCAL_RUNTIME_SERVICE_BACKEND ||
    MANAGED_LOCAL_RUNTIME_FAMILIES.includes(runtimeFamily)

  const preset = useManaged
    ? buildManagedLocalRuntimePreset(runtimeFamily)
    : buildLocalAiRuntimePreset(runtimeBackend)

  return {
    ...preset,
    managedRuntimePythonPath: '',
    ollamaCommandPath: '',
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
    runtimeBackend === LOCAL_RUNTIME_SERVICE_BACKEND ||
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
  const normalizedRuntimeBackend = normalizeRuntimeBackend(source)
  const normalizedModel = trimString(source.model)
  const normalizedVisionModel = trimString(source.visionModel)

  const normalizedSettings = {
    ...DEFAULT_LOCAL_AI_SETTINGS,
    ...source,
    enabled: source.enabled === true,
    runtimeBackend: normalizedRuntimeBackend,
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
    managedRuntimePythonPath: normalizeOptionalCommandPath(
      source.managedRuntimePythonPath
    ),
    ollamaCommandPath: normalizeOptionalCommandPath(source.ollamaCommandPath),
    managedRuntimeTrustVersion: normalizeManagedRuntimeTrustVersion(
      source.managedRuntimeTrustVersion
    ),
    runtimeType: trimString(source.runtimeType),
    runtimeFamily: normalizeLegacyRuntimeFamily(source),
    model:
      normalizedModel ||
      (normalizedRuntimeBackend === 'ollama-direct'
        ? DEFAULT_LOCAL_AI_OLLAMA_MODEL
        : ''),
    visionModel:
      normalizedVisionModel ||
      (normalizedRuntimeBackend === 'ollama-direct'
        ? DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL
        : ''),
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
    trainEnabled:
      source.enabled === true &&
      normalizedRuntimeBackend === 'ollama-direct' &&
      Boolean(normalizedModel || normalizedVisionModel),
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
  MANAGED_LOCAL_RUNTIME_TRUST_VERSION,
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
  MAX_DEVELOPER_LOCAL_BENCHMARK_SIZE,
  DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS,
  DEVELOPER_LOCAL_TRAINING_PROFILE_CONFIG,
  DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_CONFIG,
  DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
  DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID,
  DEFAULT_LOCAL_AI_PUBLIC_VISION_ID,
  DEFAULT_LOCAL_AI_SIDECAR_BASE_URL,
  MOLMO2_O_RESEARCH_BASE_URL,
  MOLMO2_O_RESEARCH_RUNTIME_FAMILY,
  MOLMO2_O_RESEARCH_RUNTIME_MODEL,
  MOLMO2_O_RESEARCH_RUNTIME_VISION_MODEL,
  MOLMO2_4B_RESEARCH_BASE_URL,
  MOLMO2_4B_RESEARCH_RUNTIME_FAMILY,
  MOLMO2_4B_RESEARCH_RUNTIME_MODEL,
  MOLMO2_4B_RESEARCH_RUNTIME_VISION_MODEL,
  INTERNVL3_5_1B_RESEARCH_BASE_URL,
  INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY,
  INTERNVL3_5_1B_RESEARCH_RUNTIME_MODEL,
  INTERNVL3_5_1B_RESEARCH_RUNTIME_VISION_MODEL,
  INTERNVL3_5_8B_RESEARCH_BASE_URL,
  INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY,
  INTERNVL3_5_8B_RESEARCH_RUNTIME_MODEL,
  INTERNVL3_5_8B_RESEARCH_RUNTIME_VISION_MODEL,
  MANAGED_MOLMO2_RUNTIME_FAMILIES,
  MANAGED_LOCAL_RUNTIME_FAMILIES,
  getLocalAiEndpointSafety,
  resolveLocalAiWireRuntimeType,
  buildLocalAiRuntimePreset,
  buildRecommendedLocalAiMacPreset,
  buildMolmo2OResearchPreset,
  buildMolmo24BCompactPreset,
  buildInternVl351BLightPreset,
  buildInternVl358BExperimentalPreset,
  buildManagedLocalRuntimePreset,
  buildManagedMolmo2RuntimePreset,
  resolveManagedLocalRuntimeMemoryReference,
  buildManagedLocalAiTrustApprovalPatch,
  buildLocalAiRepairPreset,
  hasManagedLocalAiTrustApproval,
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
  normalizeManagedRuntimeTrustVersion,
}
