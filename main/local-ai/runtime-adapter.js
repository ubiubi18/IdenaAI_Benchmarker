const {LOCAL_AI_RUNTIME, LOCAL_AI_RUNTIME_BACKEND} = require('./constants')

const LOCAL_AI_OLLAMA_RUNTIME_BACKEND = 'ollama-direct'
const LOCAL_AI_LOCAL_RUNTIME_SERVICE_BACKEND = 'local-runtime-service'
const LOCAL_AI_SIDECAR_RUNTIME_BACKEND = LOCAL_AI_LOCAL_RUNTIME_SERVICE_BACKEND
const LOCAL_AI_OLLAMA_RUNTIME_TYPE = 'ollama'
const LOCAL_AI_SIDECAR_RUNTIME_TYPE = 'sidecar'
const LOCAL_AI_OLLAMA_RUNTIME = 'ollama'
const LOCAL_AI_OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const LOCAL_AI_SIDECAR_DEFAULT_BASE_URL = 'http://127.0.0.1:5000'

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

function validateLocalAiBaseUrl(value) {
  const text = trimString(value)

  if (!text) {
    return {
      ok: false,
      reason: 'endpoint_required',
      message: 'Local AI endpoint is required.',
      normalizedBaseUrl: '',
    }
  }

  const url = parseLocalAiUrl(text)

  if (!url || !/^https?:$/i.test(url.protocol)) {
    return {
      ok: false,
      reason: 'invalid_url',
      message: 'Local AI endpoint must be a valid http(s) URL.',
      normalizedBaseUrl: text,
    }
  }

  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'credentials_not_allowed',
      message: 'Local AI endpoint must not include embedded credentials.',
      normalizedBaseUrl: trimTrailingSlash(url.toString()),
    }
  }

  if (url.search || url.hash) {
    return {
      ok: false,
      reason: 'query_not_allowed',
      message:
        'Local AI endpoint must not include query parameters or URL fragments.',
      normalizedBaseUrl: trimTrailingSlash(url.toString()),
    }
  }

  if (!isLoopbackHostname(url.hostname)) {
    return {
      ok: false,
      reason: 'loopback_only',
      message:
        'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
      normalizedBaseUrl: trimTrailingSlash(url.toString()),
    }
  }

  return {
    ok: true,
    reason: '',
    message: '',
    normalizedBaseUrl: trimTrailingSlash(url.toString()),
  }
}

function normalizeLocalAiRuntimeBackend(value) {
  const runtimeBackend = trimString(value).toLowerCase()

  switch (runtimeBackend) {
    case 'ollama':
    case 'ollama-http':
    case LOCAL_AI_OLLAMA_RUNTIME_BACKEND:
      return LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    case LOCAL_AI_LOCAL_RUNTIME_SERVICE_BACKEND:
    case 'sidecar':
    case 'sidecar-http':
    case 'local-ai-sidecar':
    case 'phi-sidecar':
    case LOCAL_AI_RUNTIME.toLowerCase():
      return LOCAL_AI_SIDECAR_RUNTIME_BACKEND
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
    : LOCAL_AI_SIDECAR_DEFAULT_BASE_URL
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
    return LOCAL_AI_SIDECAR_RUNTIME_BACKEND
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

  if (fallbackRuntimeType === LOCAL_AI_SIDECAR_RUNTIME_TYPE) {
    return LOCAL_AI_SIDECAR_RUNTIME_BACKEND
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
  LOCAL_AI_LOCAL_RUNTIME_SERVICE_BACKEND,
  LOCAL_AI_SIDECAR_DEFAULT_BASE_URL,
  LOCAL_AI_SIDECAR_RUNTIME_BACKEND,
  LOCAL_AI_SIDECAR_RUNTIME_TYPE,
  defaultBaseUrlForRuntimeBackend,
  normalizeLocalAiRuntimeBackend,
  resolveLocalAiRuntimeAdapter,
  resolveLocalAiRuntimeBackend,
  runtimeNameForBackend,
  runtimeTypeForBackend,
  validateLocalAiBaseUrl,
}
