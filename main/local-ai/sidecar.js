const axios = require('axios')

const DEFAULT_BASE_URL = 'http://localhost:5000'
const DEFAULT_MODEL = 'local-stub-chat'
const DEFAULT_TIMEOUT_MS = 5000

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

function createErrorMessage(error, fallback = 'Local AI sidecar request failed') {
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

function normalizeModelList(data) {
  const items = Array.isArray(data && data.data)
    ? data.data
    : Array.isArray(data && data.models)
    ? data.models
    : []

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

function isNotFoundError(error) {
  return Number(error && error.response && error.response.status) === 404
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

function createLocalAiSidecar({httpClient = axios, logger, isDev = false} = {}) {
  async function getHealth({baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
    const endpoint = buildEndpoint(baseUrl, '/health')

    try {
      const response = await httpClient.get(endpoint, {
        timeout: timeoutMs,
      })

      return {
        ok: true,
        reachable: true,
        baseUrl: normalizeBaseUrl(baseUrl),
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
        reachable: false,
        baseUrl: normalizeBaseUrl(baseUrl),
        endpoint,
        data: null,
        lastError: createErrorMessage(error, 'Local AI sidecar is unreachable'),
      }
    }
  }

  async function listModels({baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
    try {
      const response = await requestWithFallback(
        ['/v1/models', '/models'].map((candidate) =>
          buildEndpoint(baseUrl, candidate)
        ),
        (endpoint) =>
          httpClient.get(endpoint, {
            timeout: timeoutMs,
          })
      )
      const models = normalizeModelList(response && response.data)

      return {
        ok: true,
        reachable: true,
        baseUrl: normalizeBaseUrl(baseUrl),
        endpoint: response && response.config && response.config.url,
        models,
        total: models.length,
        lastError: null,
      }
    } catch (error) {
      return {
        ok: false,
        reachable: false,
        baseUrl: normalizeBaseUrl(baseUrl),
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
    model = DEFAULT_MODEL,
    messages = [],
    timeoutMs = 15 * 1000,
  } = {}) {
    try {
      const response = await requestWithFallback(
        ['/v1/chat/completions', '/chat/completions'].map((candidate) =>
          buildEndpoint(baseUrl, candidate)
        ),
        (endpoint) =>
          httpClient.post(
            endpoint,
            {
              model: String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
              messages: Array.isArray(messages) ? messages : [],
            },
            {
              timeout: timeoutMs,
            }
          )
      )

      return {
        ok: true,
        baseUrl: normalizeBaseUrl(baseUrl),
        endpoint: response && response.config && response.config.url,
        data:
          response && response.data && typeof response.data === 'object'
            ? response.data
            : {},
        lastError: null,
      }
    } catch (error) {
      return {
        ok: false,
        baseUrl: normalizeBaseUrl(baseUrl),
        endpoint: null,
        data: null,
        lastError: createErrorMessage(
          error,
          'Local AI sidecar chat request failed'
        ),
      }
    }
  }

  async function callLocalEndpoint({
    baseUrl,
    endpointPath,
    payload,
    timeoutMs = 20 * 1000,
    action = 'Local AI sidecar request',
  } = {}) {
    const endpoint = buildEndpoint(baseUrl, endpointPath)

    try {
      const response = await httpClient.post(
        endpoint,
        payload && typeof payload === 'object' ? payload : {},
        {
          timeout: timeoutMs,
        }
      )

      return {
        ok: true,
        status: 'ok',
        baseUrl: normalizeBaseUrl(baseUrl),
        endpoint,
        data:
          response && response.data && typeof response.data === 'object'
            ? response.data
            : {},
        lastError: null,
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          ok: false,
          status: 'not_implemented',
          baseUrl: normalizeBaseUrl(baseUrl),
          endpoint,
          data: null,
          lastError: `${action} is not implemented by this Local AI sidecar`,
        }
      }

      return {
        ok: false,
        status: 'error',
        baseUrl: normalizeBaseUrl(baseUrl),
        endpoint,
        data: null,
        lastError: createErrorMessage(error, `${action} failed`),
      }
    }
  }

  return {
    chat,
    getHealth,
    listModels,
    captionFlip: (payload = {}) =>
      callLocalEndpoint({
        baseUrl: payload.baseUrl,
        endpointPath: '/caption',
        payload,
        action: 'Local AI caption request',
      }),
    ocrImage: (payload = {}) =>
      callLocalEndpoint({
        baseUrl: payload.baseUrl,
        endpointPath: '/ocr',
        payload,
        action: 'Local AI OCR request',
      }),
    trainEpoch: (payload = {}) =>
      callLocalEndpoint({
        baseUrl: payload.baseUrl,
        endpointPath: '/train',
        payload,
        action: 'Local AI training request',
      }),
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  createLocalAiSidecar,
}
