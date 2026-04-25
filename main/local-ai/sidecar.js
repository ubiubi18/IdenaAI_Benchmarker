const {LOCAL_AI_RUNTIME, LOCAL_AI_RUNTIME_BACKEND} = require('./constants')
const httpClientDefault = require('../utils/fetch-client')
const {extractRawImages, runAppleVisionOcr} = require('./apple-ocr')
const {
  LOCAL_AI_OLLAMA_DEFAULT_BASE_URL,
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  resolveLocalAiRuntimeAdapter,
  validateLocalAiBaseUrl,
} = require('./runtime-adapter')

const DEFAULT_BASE_URL = 'http://localhost:5000'
const DEFAULT_MODEL = ''
const DEFAULT_RUNTIME = LOCAL_AI_RUNTIME
const DEFAULT_RUNTIME_TYPE = 'sidecar'
const DEFAULT_OLLAMA_ENDPOINT = LOCAL_AI_OLLAMA_DEFAULT_BASE_URL
const DEFAULT_VISION_MODEL = ''
const DEFAULT_TIMEOUT_MS = 5000
const MAX_FLIP_IMAGES = 8
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 90 * 1000
const MAX_MODEL_NAME_LENGTH = 160
const MAX_CHAT_MESSAGES = 24
const MAX_CHAT_MESSAGE_CHARS = 10 * 1000
const MAX_TOTAL_CHAT_CHARS = 80 * 1000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TRAIN_STRING_CHARS = 8000
const MAX_TRAIN_PATH_CHARS = 4096
const MAX_TRAIN_OBJECT_DEPTH = 4
const MAX_TRAIN_ARRAY_ITEMS = 24
const MAX_TRAIN_OBJECT_KEYS = 48
const ALLOWED_CHAT_ROLES = new Set(['system', 'user', 'assistant'])
const CHECKER_CLASSIFICATIONS = new Set([
  'consistent',
  'ambiguous',
  'inconsistent',
])
const CHECKER_CONFIDENCES = new Set(['low', 'medium', 'high'])
const ALLOWED_RESPONSE_FORMATS = new Set(['json'])
const ALLOWED_TRAINING_THERMAL_MODES = new Set([
  'full_speed',
  'balanced',
  'cool',
])
const ALLOWED_TRAINING_PROFILES = new Set(['safe', 'balanced', 'strong'])
const ALLOWED_EVALUATION_FLIPS = new Set([50, 100, 200])
const OCR_FIRST_CHAT_PATTERN =
  /\b(text|read|ocr|screenshot|transcribe|quote|what does it say|what should i answer)\b/i

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeBaseUrl(value, fallback = DEFAULT_BASE_URL) {
  const baseUrl = trimTrailingSlash(String(value || fallback).trim())
  return baseUrl || fallback
}

function normalizePath(value) {
  const nextPath = String(value || '').trim()
  if (!nextPath) {
    return '/'
  }
  return nextPath.startsWith('/') ? nextPath : `/${nextPath}`
}

function buildEndpoint(baseUrl, endpointPath) {
  return `${normalizeBaseUrl(baseUrl)}${normalizePath(endpointPath)}`
}

function buildLocalRuntimeHeaders(runtimeAuthToken) {
  const token = String(runtimeAuthToken || '').trim()

  if (!token) {
    return undefined
  }

  return {
    'X-IdenaAI-Local-Token': token,
  }
}

function resolveRuntimeAdapter(source, fallbackRuntimeBackend) {
  const nextSource =
    source && typeof source === 'object' && !Array.isArray(source) ? source : {}

  return resolveLocalAiRuntimeAdapter(nextSource, {
    runtimeBackend: fallbackRuntimeBackend,
  })
}

function createErrorMessage(
  error,
  fallback = 'Local AI sidecar request failed'
) {
  const status = error && error.response && error.response.status
  const data = error && error.response && error.response.data
  const remoteMessage = String(
    (data && data.error && data.error.message) ||
      (data && data.message) ||
      (error && error.message) ||
      fallback
  ).trim()

  return status ? `${remoteMessage} (HTTP ${status})` : remoteMessage
}

function looksLikeMissingOllamaModel(message = '') {
  const text = String(message || '')
    .trim()
    .toLowerCase()

  return (
    text.includes('model') &&
    (text.includes('not found') ||
      text.includes('pull') ||
      text.includes('manifest unknown') ||
      text.includes('file does not exist'))
  )
}

function withOllamaInstallHint(message, model) {
  const nextMessage = String(message || '').trim()
  const nextModel = String(model || '').trim()

  if (!nextMessage || !nextModel || !looksLikeMissingOllamaModel(nextMessage)) {
    return nextMessage
  }

  if (nextMessage.includes(`ollama pull ${nextModel}`)) {
    return nextMessage
  }

  return `${nextMessage}. Install it locally with: ollama pull ${nextModel}`
}

function normalizeModelList(data) {
  let items = []

  if (Array.isArray(data && data.data)) {
    items = data.data
  } else if (Array.isArray(data && data.models)) {
    items = data.models
  }

  return items
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim()
      }

      if (item && typeof item === 'object') {
        return String(item.id || item.model || item.name || '').trim()
      }

      return ''
    })
    .filter(Boolean)
}

function normalizeTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const timeoutMs = Number.parseInt(value, 10)

  if (!Number.isFinite(timeoutMs)) {
    return fallback
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs))
}

function normalizeResponseFormat(value) {
  if (typeof value === 'string') {
    const format = String(value || '')
      .trim()
      .toLowerCase()

    if (!format) {
      return null
    }

    return ALLOWED_RESPONSE_FORMATS.has(format) ? format : null
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const normalized = sanitizeCloneableTrainValue(value)

  if (
    normalized &&
    typeof normalized === 'object' &&
    !Array.isArray(normalized) &&
    Object.keys(normalized).length > 0
  ) {
    return normalized
  }

  return null
}

function normalizeGenerationOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const options = {}
  const temperature = Number.parseFloat(input.temperature)
  const numCtx = Number.parseInt(input.num_ctx ?? input.numCtx, 10)
  const numPredict = Number.parseInt(input.num_predict ?? input.numPredict, 10)

  if (Number.isFinite(temperature)) {
    options.temperature = Math.min(1, Math.max(0, temperature))
  }

  if (Number.isFinite(numCtx) && numCtx > 0) {
    options.num_ctx = Math.min(32768, Math.max(2048, numCtx))
  }

  if (Number.isFinite(numPredict)) {
    options.num_predict = Math.min(2048, Math.max(1, numPredict))
  }

  return Object.keys(options).length > 0 ? options : null
}

function sanitizeTrainString(value, maxLength = MAX_TRAIN_STRING_CHARS) {
  const text = String(value || '').trim()
  return text ? text.slice(0, maxLength) : ''
}

function sanitizeTrainInteger(value, fallback = null, min = 0, max = Infinity) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

function sanitizeCloneableTrainValue(value, depth = 0) {
  if (depth > MAX_TRAIN_OBJECT_DEPTH) {
    return null
  }

  if (value === null || typeof value === 'undefined') {
    return value
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_TRAIN_STRING_CHARS)
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TRAIN_ARRAY_ITEMS)
      .map((entry) => sanitizeCloneableTrainValue(entry, depth + 1))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .slice(0, MAX_TRAIN_OBJECT_KEYS)
      .reduce((result, [key, entryValue]) => {
        if (typeof key !== 'string') {
          return result
        }

        const sanitized = sanitizeCloneableTrainValue(entryValue, depth + 1)

        if (typeof sanitized !== 'undefined') {
          result[key] = sanitized
        }

        return result
      }, {})
  }

  return undefined
}

function sanitizeTrainingProfile(value) {
  const profile = sanitizeTrainString(value, 32).toLowerCase()
  return ALLOWED_TRAINING_PROFILES.has(profile) ? profile : 'strong'
}

function sanitizeTrainingThermalMode(value) {
  const thermalMode = sanitizeTrainString(value, 32).toLowerCase()
  return ALLOWED_TRAINING_THERMAL_MODES.has(thermalMode)
    ? thermalMode
    : 'balanced'
}

function sanitizeTrainingEvaluationFlips(value) {
  const parsed = sanitizeTrainInteger(value, 100, 50, 200)
  return ALLOWED_EVALUATION_FLIPS.has(parsed) ? parsed : 100
}

function sanitizeTrainingTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const source = value
  const result = {}
  const isDeveloperHumanTeacher = source.developerHumanTeacher === true
  const hasExplicitTrainingProfile =
    typeof source.localTrainingProfile !== 'undefined'
  const hasExplicitThermalMode =
    typeof source.localTrainingThermalMode !== 'undefined'
  const hasExplicitEpochs = typeof source.localTrainingEpochs !== 'undefined'
  const hasExplicitTrainingBatchSize =
    typeof source.localTrainingBatchSize !== 'undefined'
  const hasExplicitLoraRank =
    typeof source.localTrainingLoraRank !== 'undefined'
  const hasExplicitEvaluationFlips =
    typeof source.evaluationFlips !== 'undefined'
  const sampleName = sanitizeTrainString(source.sampleName, 128)
  const currentPeriod = sanitizeTrainString(source.currentPeriod, 64)
  const trainingModelPath =
    sanitizeTrainString(source.trainingModelPath || source.modelPath, 256) || ''
  const annotatedAnnotationsPath = sanitizeTrainString(
    source.annotatedAnnotationsPath,
    MAX_TRAIN_PATH_CHARS
  )
  const pendingAnnotationsPath = sanitizeTrainString(
    source.pendingAnnotationsPath,
    MAX_TRAIN_PATH_CHARS
  )
  const trainedAnnotationsPath = sanitizeTrainString(
    source.trainedAnnotationsPath,
    MAX_TRAIN_PATH_CHARS
  )
  const developerStatePath = sanitizeTrainString(
    source.developerStatePath,
    MAX_TRAIN_PATH_CHARS
  )
  const comparisonPath = sanitizeTrainString(
    source.comparisonPath,
    MAX_TRAIN_PATH_CHARS
  )
  const normalizedAnnotationsPath = sanitizeTrainString(
    source.normalizedAnnotationsPath,
    MAX_TRAIN_PATH_CHARS
  )

  if (isDeveloperHumanTeacher) {
    result.developerHumanTeacher = true
  }

  if (sampleName) {
    result.sampleName = sampleName
  }

  if (currentPeriod) {
    result.currentPeriod = currentPeriod
  }

  if (trainingModelPath) {
    result.trainingModelPath = trainingModelPath
    result.modelPath = trainingModelPath
  }

  if (annotatedAnnotationsPath) {
    result.annotatedAnnotationsPath = annotatedAnnotationsPath
  }

  if (pendingAnnotationsPath) {
    result.pendingAnnotationsPath = pendingAnnotationsPath
  }

  if (trainedAnnotationsPath) {
    result.trainedAnnotationsPath = trainedAnnotationsPath
  }

  if (developerStatePath) {
    result.developerStatePath = developerStatePath
  }

  if (comparisonPath) {
    result.comparisonPath = comparisonPath
  }

  if (normalizedAnnotationsPath) {
    result.normalizedAnnotationsPath = normalizedAnnotationsPath
  }

  if (isDeveloperHumanTeacher || hasExplicitTrainingProfile) {
    result.localTrainingProfile = sanitizeTrainingProfile(
      source.localTrainingProfile
    )
  }

  if (isDeveloperHumanTeacher || hasExplicitThermalMode) {
    result.localTrainingThermalMode = sanitizeTrainingThermalMode(
      source.localTrainingThermalMode
    )
  }

  if (isDeveloperHumanTeacher || hasExplicitEpochs) {
    result.localTrainingEpochs = sanitizeTrainInteger(
      source.localTrainingEpochs,
      1,
      1,
      6
    )
  }

  if (isDeveloperHumanTeacher || hasExplicitTrainingBatchSize) {
    result.localTrainingBatchSize = sanitizeTrainInteger(
      source.localTrainingBatchSize,
      1,
      1,
      4
    )
  }

  if (isDeveloperHumanTeacher || hasExplicitLoraRank) {
    result.localTrainingLoraRank = sanitizeTrainInteger(
      source.localTrainingLoraRank,
      10,
      4,
      16
    )
  }

  if (isDeveloperHumanTeacher || hasExplicitEvaluationFlips) {
    result.evaluationFlips = sanitizeTrainingEvaluationFlips(
      source.evaluationFlips
    )
  }

  if (typeof source.compareOnly === 'boolean') {
    result.compareOnly = source.compareOnly
  }

  if (typeof source.comparisonOnly === 'boolean') {
    result.comparisonOnly = source.comparisonOnly
  }

  if (typeof source.trainNow === 'boolean') {
    result.trainNow = source.trainNow
  }

  if (typeof source.advance === 'boolean') {
    result.advance = source.advance
  }

  const epoch = sanitizeTrainInteger(source.epoch, null, 0, 1_000_000)
  const currentEpoch = sanitizeTrainInteger(
    source.currentEpoch,
    null,
    0,
    1_000_000
  )
  const offset = sanitizeTrainInteger(source.offset, null, 0, 1_000_000)
  const batchSize = sanitizeTrainInteger(source.batchSize, null, 1, 50)

  if (epoch !== null) {
    result.epoch = epoch
  }

  if (currentEpoch !== null) {
    result.currentEpoch = currentEpoch
  }

  if (offset !== null) {
    result.offset = offset
  }

  if (batchSize !== null) {
    result.batchSize = batchSize
  }

  return result
}

function sanitizeTrainEndpointPayload(payload = {}) {
  const source =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}
  const runtime = {}
  const runtimeBackend = sanitizeTrainString(source.runtimeBackend, 64)
  const runtimeType = sanitizeTrainString(source.runtimeType, 64)
  const reasonerBackend = sanitizeTrainString(source.reasonerBackend, 64)
  const visionBackend = sanitizeTrainString(source.visionBackend, 64)
  const contractVersion = sanitizeTrainString(source.contractVersion, 64)
  const adapterStrategy = sanitizeTrainString(source.adapterStrategy, 64)
  const trainingPolicy = sanitizeTrainString(source.trainingPolicy, 64)
  const publicModelId = sanitizeTrainString(source.publicModelId, 256)
  const publicVisionId = sanitizeTrainString(source.publicVisionId, 256)
  const model = sanitizeTrainString(source.model, 256)
  const visionModel = sanitizeTrainString(source.visionModel, 256)
  const developerPrompt = sanitizeTrainString(
    source.developerHumanTeacherSystemPrompt,
    8000
  )
  const rankingPolicy = sanitizeCloneableTrainValue(source.rankingPolicy)
  const topLevelTraining = sanitizeTrainingTarget(source)
  const nestedInput = sanitizeTrainingTarget(source.input)
  const nestedPayload = sanitizeTrainingTarget(source.payload)

  if (runtimeBackend) {
    runtime.runtimeBackend = runtimeBackend
  }

  if (runtimeType) {
    runtime.runtimeType = runtimeType
  }

  if (reasonerBackend) {
    runtime.reasonerBackend = reasonerBackend
  }

  if (visionBackend) {
    runtime.visionBackend = visionBackend
  }

  if (contractVersion) {
    runtime.contractVersion = contractVersion
  }

  if (adapterStrategy) {
    runtime.adapterStrategy = adapterStrategy
  }

  if (trainingPolicy) {
    runtime.trainingPolicy = trainingPolicy
  }

  if (publicModelId) {
    runtime.publicModelId = publicModelId
  }

  if (publicVisionId) {
    runtime.publicVisionId = publicVisionId
  }

  if (model) {
    runtime.model = model
  }

  if (visionModel) {
    runtime.visionModel = visionModel
  }

  if (developerPrompt) {
    runtime.developerHumanTeacherSystemPrompt = developerPrompt
  }

  if (rankingPolicy && typeof rankingPolicy === 'object') {
    runtime.rankingPolicy = rankingPolicy
  }

  if (topLevelTraining) {
    Object.assign(runtime, topLevelTraining)
  }

  if (nestedInput) {
    runtime.input = nestedInput
  }

  if (nestedPayload) {
    runtime.payload = nestedPayload
  }

  return runtime
}

function supportsOllamaThinkingToggle(model) {
  const nextModel = String(model || '')
    .trim()
    .toLowerCase()

  if (!nextModel) {
    return false
  }

  return (
    nextModel.startsWith('deepseek-r1') || nextModel.includes('/deepseek-r1')
  )
}

function buildVisionModelCandidates(
  model,
  includesImages,
  fallbackModels = []
) {
  const primary = String(model || '').trim()
  const fallbacks = Array.isArray(fallbackModels)
    ? fallbackModels.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  if (!includesImages) {
    return primary ? [primary] : []
  }

  return [...new Set([primary || DEFAULT_VISION_MODEL, ...fallbacks])]
}

function estimateBase64Bytes(value) {
  const normalized = String(value || '')
    .replace(/\s+/g, '')
    .replace(/=+$/, '')

  return Math.max(0, Math.floor((normalized.length * 3) / 4))
}

function validateModelName(value, fallbackMessage) {
  const model = String(value || '').trim()

  if (!model) {
    return {
      ok: false,
      reason: 'model_required',
      message: fallbackMessage,
    }
  }

  if (model.length > MAX_MODEL_NAME_LENGTH) {
    return {
      ok: false,
      reason: 'model_invalid',
      message: 'Local AI model identifier is too long.',
    }
  }

  if (!/^[A-Za-z0-9._:/-]+$/.test(model)) {
    return {
      ok: false,
      reason: 'model_invalid',
      message: 'Local AI model identifier contains unsupported characters.',
    }
  }

  return {
    ok: true,
    model,
  }
}

function buildValidationError({
  runtimeBackend,
  runtimeType,
  model = '',
  baseUrl = null,
  endpoint = null,
  error,
  lastError,
}) {
  return {
    ok: false,
    status: 'validation_error',
    provider: 'local-ai',
    runtimeBackend,
    runtimeType,
    model,
    baseUrl,
    endpoint,
    text: null,
    error,
    lastError,
  }
}

function isNotFoundError(error) {
  return Number(error && error.response && error.response.status) === 404
}

function normalizeChatMessage(item) {
  if (typeof item === 'string') {
    const stringContent = item.trim()

    return stringContent ? {role: 'user', content: stringContent} : null
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  const role =
    String(item.role || 'user')
      .trim()
      .toLowerCase() || 'user'
  let textContent = ''

  if (typeof item.content === 'string') {
    textContent = item.content.trim()
  } else if (typeof item.message === 'string') {
    textContent = item.message.trim()
  } else if (typeof item.text === 'string') {
    textContent = item.text.trim()
  }

  const images = normalizeFlipImages(item.images || item.attachments)

  if (!textContent && images.length === 0) {
    return null
  }

  const normalized = {
    role: ALLOWED_CHAT_ROLES.has(role) ? role : 'user',
    content: (textContent || 'Describe the attached images.').slice(
      0,
      MAX_CHAT_MESSAGE_CHARS
    ),
  }

  if (images.length > 0) {
    normalized.images = images
  }

  return normalized
}

function normalizeChatMessages({messages, message, prompt, input} = {}) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.map(normalizeChatMessage).filter(Boolean)
    : []

  if (normalizedMessages.length > 0) {
    return normalizedMessages
  }

  const singleInput = [message, prompt, input].find(
    (value) => typeof value === 'string' && value.trim()
  )

  return singleInput ? [{role: 'user', content: singleInput.trim()}] : []
}

function buildOcrRetryMessages(messages = [], ocrText = '') {
  const textOnlyMessages = Array.isArray(messages)
    ? messages.map(({role, content}) => ({role, content}))
    : []

  return [
    {
      role: 'system',
      content:
        'The user attached one or more images. Use the following OCR transcript as the primary source of truth for visible text in those images.',
    },
    {
      role: 'system',
      content: `OCR transcript from attached images:\n${ocrText}`,
    },
    ...textOnlyMessages,
  ]
}

function shouldPreferOcrFirst(messages = []) {
  const reversed = Array.isArray(messages) ? [...messages].reverse() : []
  const latestUserMessage = reversed.find(
    (item) => item && item.role === 'user' && String(item.content || '').trim()
  )

  return Boolean(
    latestUserMessage &&
      OCR_FIRST_CHAT_PATTERN.test(
        String(latestUserMessage.content || '').trim()
      )
  )
}

function normalizeAssistantTextCandidate(value) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeAssistantTextCandidate(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const directKeys = ['text', 'content', 'response', 'output_text', 'result']

  for (const key of directKeys) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim()
    }
  }

  const nestedCandidates = [value.message, value.delta, value.content]

  for (const candidate of nestedCandidates) {
    const normalized = normalizeAssistantTextCandidate(candidate)

    if (normalized) {
      return normalized
    }
  }

  return ''
}

function normalizeOllamaContent(data) {
  if (!data || typeof data !== 'object') {
    return null
  }

  const directContentCandidates = [
    normalizeAssistantTextCandidate(data.message),
    normalizeAssistantTextCandidate(data.message && data.message.content),
    normalizeAssistantTextCandidate(data.response),
    normalizeAssistantTextCandidate(data.content),
    normalizeAssistantTextCandidate(data.output_text),
    normalizeAssistantTextCandidate(data.generated_text),
    normalizeAssistantTextCandidate(data.result),
    normalizeAssistantTextCandidate(
      Array.isArray(data.choices) ? data.choices[0] : null
    ),
    normalizeAssistantTextCandidate(
      Array.isArray(data.choices) && data.choices[0]
        ? data.choices[0].message
        : null
    ),
    normalizeAssistantTextCandidate(
      Array.isArray(data.choices) && data.choices[0]
        ? data.choices[0].delta
        : null
    ),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  if (directContentCandidates.length > 0) {
    return directContentCandidates[0]
  }

  return null
}

function asOpenAiCompatibleImageUrl(value) {
  const imageBase64 =
    toBase64Image(value) ||
    (typeof value === 'string' && isLikelyBase64(value)
      ? value.replace(/\s+/g, '')
      : null)

  if (!imageBase64) {
    return null
  }

  return `data:image/png;base64,${imageBase64}`
}

function normalizeOpenAiCompatibleMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = String(message && message.role ? message.role : 'user').trim()
    const content = String(message && message.content ? message.content : '')
    const imageUrls = Array.isArray(message && message.images)
      ? message.images
          .map((image) => asOpenAiCompatibleImageUrl(image))
          .filter(Boolean)
      : []

    if (imageUrls.length === 0) {
      return {
        role,
        content,
      }
    }

    return {
      role,
      content: [
        {
          type: 'text',
          text: content,
        },
      ].concat(
        imageUrls.map((url) => ({
          type: 'image_url',
          image_url: {
            url,
          },
        }))
      ),
    }
  })
}

function normalizeOpenAiCompatibleGenerationOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }

  const options = {}
  const temperature = Number.parseFloat(input.temperature)
  const maxTokens = Number.parseInt(input.num_predict ?? input.numPredict, 10)

  if (Number.isFinite(temperature)) {
    options.temperature = Math.min(1, Math.max(0, temperature))
  }

  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    options.max_tokens = Math.min(2048, Math.max(1, maxTokens))
  }

  return options
}

function normalizeVisionModel(value, fallback = DEFAULT_VISION_MODEL) {
  if (typeof value === 'undefined' || value === null) {
    return String(fallback || '').trim()
  }

  return String(value || '').trim()
}

function isLikelyBase64(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(value)
}

function toBase64Image(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString('base64')
  }

  const nextValue = String(value || '').trim()

  if (!nextValue) {
    return null
  }

  const dataUrlMatch = nextValue.match(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/
  )

  if (dataUrlMatch && dataUrlMatch[1]) {
    return dataUrlMatch[1].trim()
  }

  if (isLikelyBase64(nextValue) && nextValue.length > 64) {
    return nextValue.replace(/\s+/g, '')
  }

  return null
}

function normalizeFlipImageItem(item) {
  if (!item) {
    return null
  }

  if (typeof item === 'string' || Buffer.isBuffer(item)) {
    return toBase64Image(item)
  }

  if (typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  return toBase64Image(
    item.imageDataUrl || item.image || item.src || item.base64
  )
}

function normalizeFlipImages(input) {
  let source = []

  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    source = [input]
  } else if (Array.isArray(input)) {
    source = input
  } else if (input && typeof input === 'object') {
    if (Array.isArray(input.images)) {
      source = input.images
    } else if (Array.isArray(input.panels)) {
      source = input.panels
    } else if (input.imageDataUrl || input.image || input.src) {
      source = [input]
    } else {
      source = [input.leftImage, input.rightImage].filter(Boolean)
    }
  }

  return source
    .map((item) => normalizeFlipImageItem(item))
    .filter(Boolean)
    .slice(0, MAX_FLIP_IMAGES)
}

function validateChatMessages(messages) {
  const nextMessages = Array.isArray(messages) ? messages : []

  if (nextMessages.length === 0) {
    return {
      ok: false,
      error: 'message_required',
      lastError: 'Local AI text input is required',
    }
  }

  if (nextMessages.length > MAX_CHAT_MESSAGES) {
    return {
      ok: false,
      error: 'too_many_messages',
      lastError: `Local AI chat accepts at most ${MAX_CHAT_MESSAGES} messages per request.`,
    }
  }

  let totalChars = 0
  let totalImageBytes = 0

  for (const message of nextMessages) {
    const content = String(message && message.content ? message.content : '')

    if (!content.trim()) {
      return {
        ok: false,
        error: 'message_required',
        lastError: 'Local AI text input is required',
      }
    }

    if (content.length > MAX_CHAT_MESSAGE_CHARS) {
      return {
        ok: false,
        error: 'message_too_large',
        lastError: `Local AI chat accepts at most ${MAX_CHAT_MESSAGE_CHARS} characters per message.`,
      }
    }

    totalChars += content.length

    if (Array.isArray(message && message.images)) {
      for (const image of message.images) {
        const imageBytes = estimateBase64Bytes(image)

        if (imageBytes > MAX_IMAGE_BYTES) {
          return {
            ok: false,
            error: 'image_too_large',
            lastError: 'One Local AI image attachment is too large.',
          }
        }

        totalImageBytes += imageBytes
      }
    }
  }

  if (totalChars > MAX_TOTAL_CHAT_CHARS) {
    return {
      ok: false,
      error: 'conversation_too_large',
      lastError: `Local AI chat accepts at most ${MAX_TOTAL_CHAT_CHARS} characters per request.`,
    }
  }

  if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'images_too_large',
      lastError: 'Local AI image attachments are too large for one request.',
    }
  }

  return {
    ok: true,
  }
}

function buildPanelCaptionMessages(image, index) {
  return [
    {
      role: 'system',
      content:
        'You are a local vision helper for one flip panel. Return one concise plain-text caption. Describe only visible content. Do not perform OCR or invent hidden text.',
    },
    {
      role: 'user',
      content: `Describe panel ${
        index + 1
      } in one concise plain-text sentence.`,
      images: [image],
    },
  ]
}

function buildOrderedCaptionText(captions) {
  return captions
    .map(({index, caption}) => `Panel ${index + 1}: ${caption}`)
    .join('\n')
}

function buildSequenceReductionMessages(captions) {
  return [
    {
      role: 'system',
      content:
        'You are a local sequence reducer for ordered flip panel captions. Return one concise plain-text sentence. Preserve order. Focus on visible change across panels. Do not perform OCR or infer hidden content.',
    },
    {
      role: 'user',
      content: `Summarize this ordered panel sequence in one concise plain-text sentence:\n${buildOrderedCaptionText(
        captions
      )}`,
    },
  ]
}

function buildFlipSequenceCheckerMessages({captions, sequenceText}) {
  return [
    {
      role: 'system',
      content:
        'You are a local advisory checker for ordered flip sequences. Return JSON only with keys classification, confidence, and reason. classification must be one of: consistent, ambiguous, inconsistent. confidence must be one of: low, medium, high. reason must be one short sentence. Do not perform OCR or infer hidden content.',
    },
    {
      role: 'user',
      content: `Evaluate whether this ordered flip sequence looks coherent.\n\nSequence summary:\n${sequenceText}\n\nOrdered panel captions:\n${buildOrderedCaptionText(
        captions
      )}`,
    },
  ]
}

function stripMarkdownCodeFence(value) {
  const text = String(value || '').trim()

  if (!text.startsWith('```')) {
    return text
  }

  return text
    .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim()
}

function parseFlipSequenceCheckerText(value) {
  const text = stripMarkdownCodeFence(value)
  const parsed = JSON.parse(text)
  const classification = String(
    parsed && parsed.classification ? parsed.classification : ''
  )
    .trim()
    .toLowerCase()
  const confidence = String(
    parsed && parsed.confidence ? parsed.confidence : ''
  )
    .trim()
    .toLowerCase()
  const reason = String(parsed && parsed.reason ? parsed.reason : '').trim()

  if (!CHECKER_CLASSIFICATIONS.has(classification)) {
    throw new Error(
      'Local AI checker response included an unsupported classification'
    )
  }

  if (!CHECKER_CONFIDENCES.has(confidence)) {
    throw new Error(
      'Local AI checker response included an unsupported confidence'
    )
  }

  if (!reason) {
    throw new Error('Local AI checker response did not include a reason')
  }

  return {
    classification,
    confidence,
    reason: reason.slice(0, 280),
  }
}

function buildFlipPipelineConfigError({
  baseUrl,
  runtimeBackend,
  runtimeType,
  visionModel,
  model,
  error,
  lastError,
}) {
  return {
    ok: false,
    status: 'config_error',
    provider: 'local-ai',
    runtimeBackend,
    runtimeType,
    visionModel,
    model,
    baseUrl: String(baseUrl || '').trim() || null,
    endpoint: null,
    text: null,
    error,
    lastError,
  }
}

function buildUnsafeEndpointError({
  baseUrl,
  runtimeBackend,
  runtimeType,
  visionModel = '',
  model = '',
  validation,
}) {
  return buildFlipPipelineConfigError({
    baseUrl:
      (validation && validation.normalizedBaseUrl) ||
      String(baseUrl || '').trim() ||
      null,
    runtimeBackend,
    runtimeType,
    visionModel,
    model,
    error: (validation && validation.reason) || 'unsafe_endpoint',
    lastError:
      (validation && validation.message) ||
      'Local AI endpoint must stay on this machine.',
  })
}

async function requestWithFallback(candidates, request) {
  let lastError = null

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await request(candidate)
    } catch (error) {
      lastError = error
      if (!isNotFoundError(error)) {
        throw error
      }
    }
  }

  throw lastError || new Error('No sidecar endpoint candidates succeeded')
}

function createLocalAiSidecar({
  httpClient = httpClientDefault,
  logger,
  isDev = false,
} = {}) {
  async function captionFlipPanels({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    visionModel,
    input,
    timeoutMs,
  }) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextVisionModel = normalizeVisionModel(visionModel)
    const images = normalizeFlipImages(input)

    if (!nextVisionModel) {
      return buildFlipPipelineConfigError({
        baseUrl: runtimeAdapter.baseUrl,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        visionModel: '',
        model: '',
        error: 'vision_model_required',
        lastError:
          'Local AI vision model is required for Ollama panel captioning',
      })
    }

    if (images.length === 0) {
      return {
        ok: false,
        status: 'validation_error',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        visionModel: nextVisionModel,
        model: '',
        baseUrl: runtimeAdapter.baseUrl || null,
        endpoint: null,
        text: null,
        error: 'image_required',
        lastError: 'flipToText requires one or more panel images',
      }
    }

    const captions = []

    for (const [index, image] of images.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const result = await requestRuntimeChat({
        baseUrl: runtimeAdapter.baseUrl,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        runtimeAuthToken,
        model: nextVisionModel,
        messages: buildPanelCaptionMessages(image, index),
        timeoutMs,
      })

      if (!result.ok) {
        return {
          ...result,
          visionModel: nextVisionModel,
          panelIndex: index,
        }
      }

      captions.push({
        index,
        caption: result.text,
      })
    }

    return {
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeBackend: nextRuntimeBackend,
      runtimeType: nextRuntimeType,
      visionModel: nextVisionModel,
      captions,
      baseUrl: runtimeAdapter.baseUrl,
      lastError: null,
    }
  }

  async function reduceFlipSequence({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    visionModel,
    model,
    captions,
    timeoutMs,
  }) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextVisionModel = normalizeVisionModel(visionModel)
    const nextModel = String(model || '').trim()

    if (!nextModel) {
      return buildFlipPipelineConfigError({
        baseUrl: runtimeAdapter.baseUrl,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        visionModel: nextVisionModel,
        model: '',
        error: 'model_required',
        lastError:
          'Local AI text model is required for flip sequence reduction',
      })
    }

    return requestRuntimeChat({
      baseUrl: runtimeAdapter.baseUrl,
      runtimeBackend: nextRuntimeBackend,
      runtimeType: nextRuntimeType,
      runtimeAuthToken,
      model: nextModel,
      messages: buildSequenceReductionMessages(captions),
      timeoutMs,
    })
  }

  async function runFlipSequencePipeline({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    visionModel,
    model,
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextVisionModel = normalizeVisionModel(visionModel)
    const nextModel = String(model || '').trim()
    const captioning = await captionFlipPanels({
      baseUrl: runtimeAdapter.baseUrl,
      runtimeBackend: nextRuntimeBackend,
      runtimeType: nextRuntimeType,
      runtimeAuthToken,
      visionModel: nextVisionModel,
      input,
      timeoutMs,
    })

    if (!captioning.ok) {
      return {
        ...captioning,
        visionModel: nextVisionModel,
        model: nextModel,
      }
    }

    const reduced = await reduceFlipSequence({
      baseUrl: runtimeAdapter.baseUrl,
      runtimeBackend: nextRuntimeBackend,
      runtimeType: nextRuntimeType,
      runtimeAuthToken,
      visionModel: nextVisionModel,
      model: nextModel,
      captions: captioning.captions,
      timeoutMs,
    })

    if (!reduced.ok) {
      return {
        ...reduced,
        visionModel: nextVisionModel,
        captions: captioning.captions,
      }
    }

    return {
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeBackend: nextRuntimeBackend,
      runtimeType: nextRuntimeType,
      visionModel: nextVisionModel,
      model: reduced.model,
      baseUrl: reduced.baseUrl,
      endpoint: reduced.endpoint,
      captions: captioning.captions,
      sequenceText: reduced.text,
      lastError: null,
    }
  }

  async function requestOllamaChat({
    baseUrl,
    runtimeBackend,
    runtimeType,
    model = '',
    visionModel = '',
    messages = [],
    timeoutMs = 15 * 1000,
    responseFormat = null,
    generationOptions = null,
  } = {}) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextBaseUrl = runtimeAdapter.baseUrl
    const nextModel = String(model || '').trim()
    const nextVisionModel = normalizeVisionModel(visionModel, '')
    const nextMessages = Array.isArray(messages) ? messages : []
    const includesImages = nextMessages.some(
      (item) => Array.isArray(item && item.images) && item.images.length > 0
    )
    const selectedModel =
      includesImages && nextVisionModel ? nextVisionModel : nextModel
    const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs, 15 * 1000)
    const normalizedResponseFormat = normalizeResponseFormat(responseFormat)
    const normalizedGenerationOptions =
      normalizeGenerationOptions(generationOptions)
    const baseUrlValidation = validateLocalAiBaseUrl(nextBaseUrl)

    if (nextRuntimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
      return {
        ok: false,
        status: 'config_error',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: selectedModel,
        baseUrl: nextBaseUrl || null,
        endpoint: null,
        text: null,
        error: 'unsupported_runtime_type',
        lastError: `Unsupported Local AI runtime backend: ${nextRuntimeBackend}`,
      }
    }

    if (!nextBaseUrl) {
      return {
        ok: false,
        status: 'config_error',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: nextModel,
        baseUrl: null,
        endpoint: null,
        text: null,
        error: 'endpoint_required',
        lastError: 'Local AI endpoint is required for Ollama requests',
      }
    }

    if (!baseUrlValidation.ok) {
      return buildUnsafeEndpointError({
        baseUrl: nextBaseUrl,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        visionModel: nextVisionModel,
        model: selectedModel,
        validation: baseUrlValidation,
      })
    }

    const modelValidation = validateModelName(
      selectedModel,
      includesImages
        ? 'No local vision base model is configured. IdenaAI is back in embryo stage until a better audited base layer is chosen.'
        : 'No local base model is configured. IdenaAI is back in embryo stage until a better audited base layer is chosen.'
    )

    if (!modelValidation.ok) {
      return {
        ok: false,
        status: 'config_error',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: '',
        baseUrl: nextBaseUrl,
        endpoint: null,
        text: null,
        error: modelValidation.reason,
        lastError: modelValidation.message,
      }
    }

    const messageValidation = validateChatMessages(nextMessages)

    if (!messageValidation.ok) {
      return buildValidationError({
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: modelValidation.model,
        baseUrl: nextBaseUrl,
        endpoint: null,
        error: messageValidation.error,
        lastError: messageValidation.lastError,
      })
    }

    const endpoint = buildEndpoint(nextBaseUrl, '/api/chat')

    try {
      const response = await httpClient.post(
        endpoint,
        {
          model: selectedModel,
          messages: nextMessages,
          stream: false,
          ...(supportsOllamaThinkingToggle(modelValidation.model)
            ? {think: false}
            : {}),
          ...(normalizedResponseFormat
            ? {format: normalizedResponseFormat}
            : {}),
          ...(normalizedGenerationOptions
            ? {options: normalizedGenerationOptions}
            : {}),
        },
        {
          timeout: normalizedTimeoutMs,
        }
      )
      const data =
        response && response.data && typeof response.data === 'object'
          ? response.data
          : null
      const text = normalizeOllamaContent(data)

      if (!text) {
        return {
          ok: false,
          status: 'parse_error',
          provider: 'local-ai',
          runtimeBackend: nextRuntimeBackend,
          runtimeType: nextRuntimeType,
          model: selectedModel,
          baseUrl: nextBaseUrl,
          endpoint,
          text: null,
          error: 'invalid_response',
          lastError: 'Local AI Ollama response did not include assistant text',
        }
      }

      return {
        ok: true,
        status: 'ok',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model:
          String(
            data && data.model ? data.model : modelValidation.model
          ).trim() || modelValidation.model,
        baseUrl: nextBaseUrl,
        endpoint: response && response.config && response.config.url,
        text,
        lastError: null,
      }
    } catch (error) {
      const lastError = withOllamaInstallHint(
        createErrorMessage(error, 'Local AI Ollama request failed'),
        modelValidation.model
      )

      return {
        ok: false,
        status: 'unavailable',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: modelValidation.model,
        baseUrl: nextBaseUrl,
        endpoint,
        text: null,
        error: 'unavailable',
        lastError,
      }
    }
  }

  async function requestLocalHttpChat({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    model = '',
    visionModel = '',
    messages = [],
    timeoutMs = 15 * 1000,
    responseFormat = null,
    generationOptions = null,
  } = {}) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextBaseUrl = runtimeAdapter.baseUrl
    const nextModel = String(model || '').trim()
    const nextVisionModel = normalizeVisionModel(visionModel, '')
    const nextMessages = Array.isArray(messages) ? messages : []
    const includesImages = nextMessages.some(
      (item) => Array.isArray(item && item.images) && item.images.length > 0
    )
    const selectedModel =
      includesImages && nextVisionModel ? nextVisionModel : nextModel
    const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs, 15 * 1000)
    const normalizedGenerationOptions =
      normalizeOpenAiCompatibleGenerationOptions(generationOptions)
    const normalizedMessages = normalizeOpenAiCompatibleMessages(nextMessages)
    const baseUrlValidation = validateLocalAiBaseUrl(nextBaseUrl)

    if (nextRuntimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
      return buildValidationError({
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: selectedModel,
        baseUrl: nextBaseUrl,
        endpoint: null,
        error: 'unsupported_runtime_type',
        lastError: 'Ollama requests must use the Ollama chat transport.',
      })
    }

    if (!baseUrlValidation.ok) {
      return buildUnsafeEndpointError({
        baseUrl: nextBaseUrl,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        visionModel: nextVisionModel,
        model: selectedModel,
        validation: baseUrlValidation,
      })
    }

    const modelValidation = validateModelName(
      selectedModel,
      includesImages
        ? 'No local vision research model is configured for the current local runtime service.'
        : 'No local research model is configured for the current local runtime service.'
    )

    if (!modelValidation.ok) {
      return buildValidationError({
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: '',
        baseUrl: nextBaseUrl,
        endpoint: null,
        error: modelValidation.reason,
        lastError: modelValidation.message,
      })
    }

    const messageValidation = validateChatMessages(nextMessages)

    if (!messageValidation.ok) {
      return buildValidationError({
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: modelValidation.model,
        baseUrl: nextBaseUrl,
        endpoint: null,
        error: messageValidation.error,
        lastError: messageValidation.lastError,
      })
    }

    const endpointCandidates = [
      '/v1/chat/completions',
      '/chat/completions',
    ].map((candidate) => buildEndpoint(nextBaseUrl, candidate))

    const payload = {
      model: modelValidation.model,
      messages: normalizedMessages,
      stream: false,
      ...normalizedGenerationOptions,
    }

    if (responseFormat === 'json') {
      payload.response_format = {type: 'json_object'}
    }

    try {
      const response = await requestWithFallback(
        endpointCandidates,
        (endpoint) =>
          httpClient.post(endpoint, payload, {
            headers: buildLocalRuntimeHeaders(runtimeAuthToken),
            timeout: normalizedTimeoutMs,
          })
      )
      const data =
        response && response.data && typeof response.data === 'object'
          ? response.data
          : null
      const text = normalizeOllamaContent(data)

      if (!text) {
        return {
          ok: false,
          status: 'parse_error',
          provider: 'local-ai',
          runtimeBackend: nextRuntimeBackend,
          runtimeType: nextRuntimeType,
          model: modelValidation.model,
          baseUrl: nextBaseUrl,
          endpoint: response && response.config && response.config.url,
          text: null,
          error: 'invalid_response',
          lastError:
            'Local AI HTTP runtime response did not include assistant text',
        }
      }

      return {
        ok: true,
        status: 'ok',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model:
          String(
            data && data.model ? data.model : modelValidation.model
          ).trim() || modelValidation.model,
        baseUrl: nextBaseUrl,
        endpoint: response && response.config && response.config.url,
        text,
        lastError: null,
      }
    } catch (error) {
      return {
        ok: false,
        status: 'unavailable',
        provider: 'local-ai',
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        model: modelValidation.model,
        baseUrl: nextBaseUrl,
        endpoint: null,
        text: null,
        error: 'unavailable',
        lastError: createErrorMessage(
          error,
          'Local AI HTTP runtime request failed'
        ),
      }
    }
  }

  async function requestRuntimeChat(payload = {}) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {
        baseUrl: payload.baseUrl,
        runtimeBackend: payload.runtimeBackend,
        runtimeType: payload.runtimeType,
      },
      LOCAL_AI_RUNTIME_BACKEND
    )

    if (runtimeAdapter.runtimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
      return requestOllamaChat(payload)
    }

    return requestLocalHttpChat(payload)
  }

  async function getHealth({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextBaseUrl = runtimeAdapter.baseUrl
    const normalizedTimeoutMs = normalizeTimeoutMs(
      timeoutMs,
      DEFAULT_TIMEOUT_MS
    )
    const baseUrlValidation = validateLocalAiBaseUrl(nextBaseUrl)

    if (!baseUrlValidation.ok) {
      return {
        ok: false,
        status: 'config_error',
        reachable: false,
        runtime: runtimeAdapter.runtime,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        baseUrl: baseUrlValidation.normalizedBaseUrl || nextBaseUrl || null,
        endpoint: null,
        data: null,
        error: baseUrlValidation.reason,
        lastError: baseUrlValidation.message,
      }
    }

    const endpoint = buildEndpoint(
      nextBaseUrl,
      nextRuntimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND
        ? '/api/version'
        : '/health'
    )

    try {
      const response = await httpClient.get(endpoint, {
        headers: buildLocalRuntimeHeaders(runtimeAuthToken),
        timeout: normalizedTimeoutMs,
      })

      return {
        ok: true,
        status: 'ok',
        reachable: true,
        runtime: runtimeAdapter.runtime,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        baseUrl: nextBaseUrl,
        endpoint,
        data:
          response && response.data && typeof response.data === 'object'
            ? response.data
            : {},
        lastError: null,
      }
    } catch (error) {
      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Local AI sidecar health check failed', {
          endpoint,
          error: createErrorMessage(error),
        })
      }

      return {
        ok: false,
        status: 'error',
        reachable: false,
        runtime: runtimeAdapter.runtime,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        baseUrl: nextBaseUrl,
        endpoint,
        data: null,
        lastError: createErrorMessage(error, 'Local AI sidecar is unreachable'),
      }
    }
  }

  async function listModels({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    const runtimeAdapter = resolveRuntimeAdapter(
      {baseUrl, runtimeBackend, runtimeType},
      LOCAL_AI_RUNTIME_BACKEND
    )
    const nextRuntimeBackend = runtimeAdapter.runtimeBackend
    const nextRuntimeType = runtimeAdapter.runtimeType
    const nextBaseUrl = runtimeAdapter.baseUrl
    const normalizedTimeoutMs = normalizeTimeoutMs(
      timeoutMs,
      DEFAULT_TIMEOUT_MS
    )
    const baseUrlValidation = validateLocalAiBaseUrl(nextBaseUrl)

    if (!baseUrlValidation.ok) {
      return {
        ok: false,
        reachable: false,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        baseUrl: baseUrlValidation.normalizedBaseUrl || nextBaseUrl || null,
        endpoint: null,
        models: [],
        total: 0,
        error: baseUrlValidation.reason,
        lastError: baseUrlValidation.message,
      }
    }

    try {
      const response =
        nextRuntimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND
          ? await httpClient.get(buildEndpoint(nextBaseUrl, '/api/tags'), {
              timeout: normalizedTimeoutMs,
            })
          : await requestWithFallback(
              ['/v1/models', '/models'].map((candidate) =>
                buildEndpoint(nextBaseUrl, candidate)
              ),
              (endpoint) =>
                httpClient.get(endpoint, {
                  headers: buildLocalRuntimeHeaders(runtimeAuthToken),
                  timeout: normalizedTimeoutMs,
                })
            )
      const models = normalizeModelList(response && response.data)

      return {
        ok: true,
        reachable: true,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        baseUrl: nextBaseUrl,
        endpoint: response && response.config && response.config.url,
        models,
        total: models.length,
        lastError: null,
      }
    } catch (error) {
      return {
        ok: false,
        reachable: false,
        runtimeBackend: nextRuntimeBackend,
        runtimeType: nextRuntimeType,
        baseUrl: nextBaseUrl,
        endpoint: null,
        models: [],
        total: 0,
        lastError: createErrorMessage(
          error,
          'Unable to load Local AI sidecar models'
        ),
      }
    }
  }

  async function chat({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    model = '',
    visionModel = '',
    messages = [],
    message,
    prompt,
    input,
    timeoutMs = 15 * 1000,
    responseFormat = null,
    generationOptions = null,
    modelFallbacks = [],
    visionModelFallbacks = [],
  } = {}) {
    const rawMessages = Array.isArray(messages) ? messages : []
    const nextMessages = normalizeChatMessages({
      messages,
      message,
      prompt,
      input,
    })
    const includesImages = nextMessages.some(
      (item) => Array.isArray(item && item.images) && item.images.length > 0
    )
    const visionModelCandidates = buildVisionModelCandidates(
      visionModel,
      includesImages,
      visionModelFallbacks
    )
    const rawImages = includesImages ? extractRawImages(rawMessages) : []
    let result = null

    async function runOcrTextRetry() {
      const ocrResult = await runAppleVisionOcr(rawImages)

      if (!ocrResult.ok || !String(ocrResult.text || '').trim()) {
        return null
      }

      return requestRuntimeChat({
        baseUrl,
        runtimeBackend,
        runtimeType,
        runtimeAuthToken,
        model,
        visionModel: '',
        messages: buildOcrRetryMessages(nextMessages, ocrResult.text),
        timeoutMs,
        generationOptions,
      })
    }

    if (
      includesImages &&
      rawImages.length > 0 &&
      shouldPreferOcrFirst(nextMessages)
    ) {
      result = await runOcrTextRetry()
      if (result && result.ok && String(result.text || '').trim()) {
        return {
          ...result,
          content: result.text,
        }
      }
    }

    const textModelCandidates = includesImages
      ? ['']
      : [
          ...new Set(
            [model]
              .concat(Array.isArray(modelFallbacks) ? modelFallbacks : [])
              .map((item) => String(item || '').trim())
              .filter(Boolean)
          ),
        ]
    const modelAttempts = []
    const activeRequestedModel = includesImages
      ? String(visionModel || '').trim() || DEFAULT_VISION_MODEL
      : String(model || '').trim()
    let selectedCandidateModel = ''
    let activeModelCandidates = ['']

    if (includesImages) {
      activeModelCandidates = visionModelCandidates.length
        ? visionModelCandidates
        : ['']
    } else if (textModelCandidates.length) {
      activeModelCandidates = textModelCandidates
    }

    for (const candidateVisionModel of activeModelCandidates) {
      const candidateModel = includesImages
        ? candidateVisionModel
        : String(candidateVisionModel || '').trim()
      // eslint-disable-next-line no-await-in-loop
      result = await requestRuntimeChat({
        baseUrl,
        runtimeBackend,
        runtimeType,
        runtimeAuthToken,
        model: includesImages ? model : candidateModel,
        visionModel: includesImages ? candidateVisionModel : '',
        messages: nextMessages,
        timeoutMs,
        responseFormat,
        generationOptions,
      })
      modelAttempts.push({
        model: candidateModel,
        ok: Boolean(result && result.ok),
        lastError: String(result && result.lastError ? result.lastError : ''),
      })

      if (result.ok && String(result.text || '').trim()) {
        selectedCandidateModel =
          String(result.model || candidateModel || '').trim() || candidateModel
        break
      }
    }

    if (
      includesImages &&
      rawImages.length > 0 &&
      (!result || !result.ok || !String(result.text || '').trim())
    ) {
      const ocrRetryResult = await runOcrTextRetry()
      if (
        ocrRetryResult &&
        ocrRetryResult.ok &&
        String(ocrRetryResult.text || '').trim()
      ) {
        result = ocrRetryResult
      }
    }

    const activeModel = String(
      result && result.model ? result.model : selectedCandidateModel
    ).trim()
    const fallbackUsed = Boolean(
      result &&
        result.ok &&
        activeRequestedModel &&
        activeModel &&
        activeModel !== activeRequestedModel
    )
    const fallbackAttempt = fallbackUsed
      ? modelAttempts.find((attempt) => attempt.model === activeRequestedModel)
      : null
    const fallbackReason = fallbackUsed
      ? String(fallbackAttempt && fallbackAttempt.lastError).trim() ||
        `Requested runtime model ${activeRequestedModel} was unavailable or did not return a usable response.`
      : ''

    return {
      ...result,
      requestedModel: activeRequestedModel || null,
      activeModel: activeModel || null,
      fallbackUsed,
      fallbackReason: fallbackReason || null,
      modelAttempts,
      content: result.ok ? result.text : null,
    }
  }

  async function flipToText({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    visionModel,
    model = '',
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const result = await runFlipSequencePipeline({
      baseUrl,
      runtimeBackend,
      runtimeType,
      runtimeAuthToken,
      visionModel,
      model,
      input,
      timeoutMs,
    })

    return {
      ...result,
      text: result.ok ? result.sequenceText : null,
    }
  }

  async function checkFlipSequence({
    baseUrl,
    runtimeBackend,
    runtimeType,
    runtimeAuthToken,
    visionModel,
    model = '',
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const pipeline = await runFlipSequencePipeline({
      baseUrl,
      runtimeBackend,
      runtimeType,
      runtimeAuthToken,
      visionModel,
      model,
      input,
      timeoutMs,
    })

    if (!pipeline.ok) {
      return {
        ...pipeline,
        classification: null,
        confidence: null,
        reason: null,
      }
    }

    const checkerResult = await requestRuntimeChat({
      baseUrl,
      runtimeBackend,
      runtimeType,
      runtimeAuthToken,
      model: pipeline.model,
      messages: buildFlipSequenceCheckerMessages({
        captions: pipeline.captions,
        sequenceText: pipeline.sequenceText,
      }),
      timeoutMs,
    })

    if (!checkerResult.ok) {
      return {
        ...checkerResult,
        visionModel: pipeline.visionModel,
        sequenceText: pipeline.sequenceText,
        classification: null,
        confidence: null,
        reason: null,
      }
    }

    try {
      const parsed = parseFlipSequenceCheckerText(checkerResult.text)

      return {
        ok: true,
        status: 'ok',
        provider: 'local-ai',
        runtimeBackend: pipeline.runtimeBackend,
        runtimeType: pipeline.runtimeType,
        visionModel: pipeline.visionModel,
        model: pipeline.model,
        baseUrl: pipeline.baseUrl,
        endpoint: checkerResult.endpoint,
        classification: parsed.classification,
        confidence: parsed.confidence,
        reason: parsed.reason,
        sequenceText: pipeline.sequenceText,
        lastError: null,
      }
    } catch (error) {
      return {
        ok: false,
        status: 'parse_error',
        provider: 'local-ai',
        runtimeBackend: pipeline.runtimeBackend,
        runtimeType: pipeline.runtimeType,
        visionModel: pipeline.visionModel,
        model: pipeline.model,
        baseUrl: pipeline.baseUrl,
        endpoint: checkerResult.endpoint,
        classification: null,
        confidence: null,
        reason: null,
        sequenceText: pipeline.sequenceText,
        error: 'invalid_checker_response',
        lastError: createErrorMessage(
          error,
          'Local AI checker response could not be parsed'
        ),
      }
    }
  }

  async function callLocalEndpoint({
    baseUrl,
    runtimeAuthToken,
    endpointPath,
    payload,
    timeoutMs = 20 * 1000,
    action = 'Local AI sidecar request',
  } = {}) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
    const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs, 20 * 1000)
    const baseUrlValidation = validateLocalAiBaseUrl(normalizedBaseUrl)

    if (!baseUrlValidation.ok) {
      return {
        ok: false,
        status: 'config_error',
        baseUrl:
          baseUrlValidation.normalizedBaseUrl || normalizedBaseUrl || null,
        endpoint: null,
        data: null,
        error: baseUrlValidation.reason,
        lastError: baseUrlValidation.message,
      }
    }

    const endpoint = buildEndpoint(normalizedBaseUrl, endpointPath)

    try {
      const response = await httpClient.post(
        endpoint,
        payload && typeof payload === 'object' ? payload : {},
        {
          headers: buildLocalRuntimeHeaders(runtimeAuthToken),
          timeout: normalizedTimeoutMs,
        }
      )
      const responseData =
        response && response.data && typeof response.data === 'object'
          ? response.data
          : {}
      const normalizedStatus =
        String(responseData.status || 'ok').trim() || 'ok'
      const responseOk =
        responseData.ok !== false &&
        !['error', 'failed', 'not_implemented'].includes(normalizedStatus)

      if (!responseOk) {
        return {
          ok: false,
          status: normalizedStatus,
          baseUrl: normalizedBaseUrl,
          endpoint,
          data: responseData,
          lastError:
            String(
              responseData.lastError ||
                responseData.message ||
                responseData.detail ||
                ''
            ).trim() ||
            (normalizedStatus === 'not_implemented'
              ? `${action} is not implemented by this Local AI sidecar`
              : `${action} failed`),
        }
      }

      return {
        ok: true,
        status: 'ok',
        baseUrl: normalizedBaseUrl,
        endpoint,
        data: responseData,
        lastError: null,
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          ok: false,
          status: 'not_implemented',
          baseUrl: normalizedBaseUrl,
          endpoint,
          data: null,
          lastError: `${action} is not implemented by this Local AI sidecar`,
        }
      }

      return {
        ok: false,
        status: 'error',
        baseUrl: normalizedBaseUrl,
        endpoint,
        data: null,
        lastError: createErrorMessage(error, `${action} failed`),
      }
    }
  }

  return {
    chat,
    checkFlipSequence,
    flipToText,
    getHealth,
    listModels,
    captionFlip: (payload = {}) =>
      callLocalEndpoint({
        baseUrl: payload.baseUrl,
        runtimeAuthToken: payload.runtimeAuthToken,
        endpointPath: '/caption',
        payload,
        action: 'Local AI caption request',
      }),
    ocrImage: (payload = {}) =>
      callLocalEndpoint({
        baseUrl: payload.baseUrl,
        runtimeAuthToken: payload.runtimeAuthToken,
        endpointPath: '/ocr',
        payload,
        action: 'Local AI OCR request',
      }),
    trainEpoch: (payload = {}) =>
      callLocalEndpoint({
        baseUrl: payload.baseUrl,
        runtimeAuthToken: payload.runtimeAuthToken,
        endpointPath: '/train',
        payload: sanitizeTrainEndpointPayload(payload),
        timeoutMs: payload.timeoutMs,
        action: 'Local AI training request',
      }),
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_RUNTIME,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_RUNTIME_TYPE,
  createLocalAiSidecar,
}
