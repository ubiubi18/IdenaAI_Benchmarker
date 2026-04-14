const {
  LOCAL_AI_RUNTIME,
  LOCAL_AI_RUNTIME_BACKEND,
  LOCAL_AI_DEFAULT_BASE_URL,
} = require('./constants')

const LOCAL_AI_OLLAMA_RUNTIME_BACKEND = 'ollama-direct'
const LOCAL_AI_OLLAMA_RUNTIME_TYPE = 'ollama'
const LOCAL_AI_SIDECAR_RUNTIME_TYPE = 'sidecar'
const LOCAL_AI_OLLAMA_RUNTIME = 'ollama'
const LOCAL_AI_OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'

function trimString(value) {
  return String(value || '').trim()
}

function normalizeLocalAiRuntimeBackend(value) {
  const runtimeBackend = trimString(value).toLowerCase()

  switch (runtimeBackend) {
    case 'ollama':
    case 'ollama-http':
    case LOCAL_AI_OLLAMA_RUNTIME_BACKEND:
      return LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    case 'sidecar':
    case 'sidecar-http':
    case 'local-ai-sidecar':
    case 'phi-sidecar':
    case LOCAL_AI_RUNTIME.toLowerCase():
      return LOCAL_AI_RUNTIME_BACKEND
    default:
      return runtimeBackend
  }
}

function normalizeLegacyRuntimeType(value) {
  const runtimeType = trimString(value).toLowerCase()

  switch (runtimeType) {
    case LOCAL_AI_OLLAMA_RUNTIME_TYPE:
      return LOCAL_AI_OLLAMA_RUNTIME_TYPE
    case '':
      return ''
    default:
      return LOCAL_AI_SIDECAR_RUNTIME_TYPE
  }
}

function runtimeTypeForBackend(runtimeBackend) {
  return runtimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    ? LOCAL_AI_OLLAMA_RUNTIME_TYPE
    : LOCAL_AI_SIDECAR_RUNTIME_TYPE
}

function runtimeNameForBackend(runtimeBackend) {
  return runtimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    ? LOCAL_AI_OLLAMA_RUNTIME
    : LOCAL_AI_RUNTIME
}

function defaultBaseUrlForRuntimeBackend(runtimeBackend) {
  return runtimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    ? LOCAL_AI_OLLAMA_DEFAULT_BASE_URL
    : LOCAL_AI_DEFAULT_BASE_URL
}

function resolveLocalAiRuntimeBackend(source = {}, fallback = {}) {
  const explicitRuntimeBackend = normalizeLocalAiRuntimeBackend(
    source.runtimeBackend || source.runtime
  )

  if (explicitRuntimeBackend) {
    return explicitRuntimeBackend
  }

  const explicitRuntimeType = normalizeLegacyRuntimeType(source.runtimeType)

  if (explicitRuntimeType === LOCAL_AI_OLLAMA_RUNTIME_TYPE) {
    return LOCAL_AI_OLLAMA_RUNTIME_BACKEND
  }

  if (explicitRuntimeType === LOCAL_AI_SIDECAR_RUNTIME_TYPE) {
    return LOCAL_AI_RUNTIME_BACKEND
  }

  const fallbackRuntimeBackend = normalizeLocalAiRuntimeBackend(
    fallback.runtimeBackend || fallback.runtime
  )

  if (fallbackRuntimeBackend) {
    return fallbackRuntimeBackend
  }

  const fallbackRuntimeType = normalizeLegacyRuntimeType(fallback.runtimeType)

  if (fallbackRuntimeType === LOCAL_AI_OLLAMA_RUNTIME_TYPE) {
    return LOCAL_AI_OLLAMA_RUNTIME_BACKEND
  }

  return LOCAL_AI_RUNTIME_BACKEND
}

function resolveLocalAiRuntimeAdapter(source = {}, fallback = {}) {
  const runtimeBackend = resolveLocalAiRuntimeBackend(source, fallback)
  const runtimeType = runtimeTypeForBackend(runtimeBackend)
  const runtime = runtimeNameForBackend(runtimeBackend)
  const defaultBaseUrl = defaultBaseUrlForRuntimeBackend(runtimeBackend)
  const baseUrl =
    trimString(source.baseUrl || source.endpoint) ||
    trimString(fallback.baseUrl || fallback.endpoint) ||
    defaultBaseUrl

  return {
    runtime,
    runtimeBackend,
    runtimeType,
    defaultBaseUrl,
    baseUrl,
  }
}

module.exports = {
  LOCAL_AI_OLLAMA_DEFAULT_BASE_URL,
  LOCAL_AI_OLLAMA_RUNTIME,
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  LOCAL_AI_OLLAMA_RUNTIME_TYPE,
  LOCAL_AI_SIDECAR_RUNTIME_TYPE,
  defaultBaseUrlForRuntimeBackend,
  normalizeLocalAiRuntimeBackend,
  resolveLocalAiRuntimeAdapter,
  resolveLocalAiRuntimeBackend,
  runtimeNameForBackend,
  runtimeTypeForBackend,
}
