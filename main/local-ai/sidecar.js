const axios = require('axios')

const DEFAULT_BASE_URL = 'http://localhost:5000'
const DEFAULT_MODEL = ''
const DEFAULT_RUNTIME = 'local-ai-sidecar'
const DEFAULT_RUNTIME_TYPE = 'ollama'
const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'
const DEFAULT_VISION_MODEL = 'moondream'
const DEFAULT_TIMEOUT_MS = 5000
const MAX_FLIP_IMAGES = 8
const CHECKER_CLASSIFICATIONS = new Set([
  'consistent',
  'ambiguous',
  'inconsistent',
])
const CHECKER_CONFIDENCES = new Set(['low', 'medium', 'high'])

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeBaseUrl(value, fallback = DEFAULT_BASE_URL) {
  const baseUrl = trimTrailingSlash(String(value || fallback).trim())
  return baseUrl || fallback
}

function normalizeRuntimeType(value, fallback = DEFAULT_RUNTIME_TYPE) {
  const runtimeType = String(value || fallback).trim().toLowerCase()
  return runtimeType || fallback
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

function normalizeChatMessage(item) {
  if (typeof item === 'string') {
    const content = item.trim()

    return content ? {role: 'user', content} : null
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  const role = String(item.role || 'user').trim().toLowerCase() || 'user'
  const content =
    typeof item.content === 'string'
      ? item.content.trim()
      : typeof item.message === 'string'
      ? item.message.trim()
      : typeof item.text === 'string'
      ? item.text.trim()
      : ''

  return content ? {role, content} : null
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

function normalizeOllamaContent(data) {
  const content =
    data &&
    data.message &&
    typeof data.message === 'object' &&
    typeof data.message.content === 'string'
      ? data.message.content.trim()
      : ''

  return content || null
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
    item.imageDataUrl ||
      item.image ||
      item.src ||
      item.base64
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
    } else if (
      input.imageDataUrl ||
      input.image ||
      input.src
    ) {
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

function buildPanelCaptionMessages(image, index) {
  return [
    {
      role: 'system',
      content:
        'You are a local vision helper for one flip panel. Return one concise plain-text caption. Describe only visible content. Do not perform OCR or invent hidden text.',
    },
    {
      role: 'user',
      content: `Describe panel ${index + 1} in one concise plain-text sentence.`,
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
  const classification = String(parsed && parsed.classification ? parsed.classification : '')
    .trim()
    .toLowerCase()
  const confidence = String(parsed && parsed.confidence ? parsed.confidence : '')
    .trim()
    .toLowerCase()
  const reason = String(parsed && parsed.reason ? parsed.reason : '')
    .trim()

  if (!CHECKER_CLASSIFICATIONS.has(classification)) {
    throw new Error('Local AI checker response included an unsupported classification')
  }

  if (!CHECKER_CONFIDENCES.has(confidence)) {
    throw new Error('Local AI checker response included an unsupported confidence')
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
  async function captionFlipPanels({
    baseUrl,
    runtimeType,
    visionModel,
    input,
    timeoutMs,
  }) {
    const nextRuntimeType = normalizeRuntimeType(runtimeType)
    const nextVisionModel = normalizeVisionModel(visionModel)
    const images = normalizeFlipImages(input)

    if (!nextVisionModel) {
      return buildFlipPipelineConfigError({
        baseUrl,
        runtimeType: nextRuntimeType,
        visionModel: '',
        model: '',
        error: 'vision_model_required',
        lastError: 'Local AI vision model is required for Ollama panel captioning',
      })
    }

    if (images.length === 0) {
      return {
        ok: false,
        status: 'validation_error',
        provider: 'local-ai',
        runtimeType: nextRuntimeType,
        visionModel: nextVisionModel,
        model: '',
        baseUrl: String(baseUrl || '').trim() || null,
        endpoint: null,
        text: null,
        error: 'image_required',
        lastError: 'flipToText requires one or more panel images',
      }
    }

    const captions = []

    for (const [index, image] of images.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const result = await requestOllamaChat({
        baseUrl,
        runtimeType: nextRuntimeType,
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
      runtimeType: nextRuntimeType,
      visionModel: nextVisionModel,
      captions,
      baseUrl: normalizeBaseUrl(baseUrl, DEFAULT_OLLAMA_ENDPOINT),
      lastError: null,
    }
  }

  async function reduceFlipSequence({
    baseUrl,
    runtimeType,
    visionModel,
    model,
    captions,
    timeoutMs,
  }) {
    const nextRuntimeType = normalizeRuntimeType(runtimeType)
    const nextVisionModel = normalizeVisionModel(visionModel)
    const nextModel = String(model || '').trim()

    if (!nextModel) {
      return buildFlipPipelineConfigError({
        baseUrl,
        runtimeType: nextRuntimeType,
        visionModel: nextVisionModel,
        model: '',
        error: 'model_required',
        lastError: 'Local AI text model is required for flip sequence reduction',
      })
    }

    return requestOllamaChat({
      baseUrl,
      runtimeType: nextRuntimeType,
      model: nextModel,
      messages: buildSequenceReductionMessages(captions),
      timeoutMs,
    })
  }

  async function runFlipSequencePipeline({
    baseUrl,
    runtimeType,
    visionModel,
    model,
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const nextRuntimeType = normalizeRuntimeType(runtimeType)
    const nextVisionModel = normalizeVisionModel(visionModel)
    const nextModel = String(model || '').trim()
    const captioning = await captionFlipPanels({
      baseUrl,
      runtimeType: nextRuntimeType,
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
      baseUrl,
      runtimeType: nextRuntimeType,
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
    runtimeType,
    model = '',
    messages = [],
    timeoutMs = 15 * 1000,
  } = {}) {
    const nextRuntimeType = normalizeRuntimeType(runtimeType)
    const nextBaseUrl = String(baseUrl || '').trim()
    const nextModel = String(model || '').trim()
    const nextMessages = Array.isArray(messages) ? messages : []

    if (nextRuntimeType !== 'ollama') {
      return {
        ok: false,
        status: 'config_error',
        provider: 'local-ai',
        runtimeType: nextRuntimeType,
        model: nextModel,
        baseUrl: nextBaseUrl || null,
        endpoint: null,
        text: null,
        error: 'unsupported_runtime_type',
        lastError: `Unsupported Local AI runtime type: ${nextRuntimeType}`,
      }
    }

    if (!nextBaseUrl) {
      return {
        ok: false,
        status: 'config_error',
        provider: 'local-ai',
        runtimeType: nextRuntimeType,
        model: nextModel,
        baseUrl: null,
        endpoint: null,
        text: null,
        error: 'endpoint_required',
        lastError: 'Local AI endpoint is required for Ollama requests',
      }
    }

    if (!nextModel) {
      return {
        ok: false,
        status: 'config_error',
        provider: 'local-ai',
        runtimeType: nextRuntimeType,
        model: '',
        baseUrl: normalizeBaseUrl(nextBaseUrl, DEFAULT_OLLAMA_ENDPOINT),
        endpoint: null,
        text: null,
        error: 'model_required',
        lastError: 'Local AI model is required for Ollama requests',
      }
    }

    if (nextMessages.length === 0) {
      return {
        ok: false,
        status: 'validation_error',
        provider: 'local-ai',
        runtimeType: nextRuntimeType,
        model: nextModel,
        baseUrl: normalizeBaseUrl(nextBaseUrl, DEFAULT_OLLAMA_ENDPOINT),
        endpoint: null,
        text: null,
        error: 'message_required',
        lastError: 'Local AI text input is required',
      }
    }

    const endpoint = buildEndpoint(
      normalizeBaseUrl(nextBaseUrl, DEFAULT_OLLAMA_ENDPOINT),
      '/api/chat'
    )

    try {
      const response = await httpClient.post(
        endpoint,
        {
          model: nextModel,
          messages: nextMessages,
          stream: false,
        },
        {
          timeout: timeoutMs,
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
          runtimeType: nextRuntimeType,
          model: nextModel,
          baseUrl: normalizeBaseUrl(nextBaseUrl, DEFAULT_OLLAMA_ENDPOINT),
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
        runtimeType: nextRuntimeType,
        model: String(data && data.model ? data.model : nextModel).trim() || nextModel,
        baseUrl: normalizeBaseUrl(nextBaseUrl, DEFAULT_OLLAMA_ENDPOINT),
        endpoint: response && response.config && response.config.url,
        text,
        lastError: null,
      }
    } catch (error) {
      return {
        ok: false,
        status: 'unavailable',
        provider: 'local-ai',
        runtimeType: nextRuntimeType,
        model: nextModel,
        baseUrl: normalizeBaseUrl(nextBaseUrl, DEFAULT_OLLAMA_ENDPOINT),
        endpoint,
        text: null,
        error: 'unavailable',
        lastError: createErrorMessage(
          error,
          'Local AI Ollama request failed'
        ),
      }
    }
  }

  async function getHealth({
    baseUrl,
    runtimeType,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    const nextRuntimeType = normalizeRuntimeType(runtimeType, 'sidecar')
    const nextBaseUrl = normalizeBaseUrl(
      baseUrl,
      nextRuntimeType === 'ollama' ? DEFAULT_OLLAMA_ENDPOINT : DEFAULT_BASE_URL
    )
    const endpoint = buildEndpoint(
      nextBaseUrl,
      nextRuntimeType === 'ollama' ? '/api/version' : '/health'
    )

    try {
      const response = await httpClient.get(endpoint, {
        timeout: timeoutMs,
      })

      return {
        ok: true,
        status: 'ok',
        reachable: true,
        runtime: nextRuntimeType === 'ollama' ? 'ollama' : DEFAULT_RUNTIME,
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
        runtime: nextRuntimeType === 'ollama' ? 'ollama' : DEFAULT_RUNTIME,
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
    runtimeType,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    const nextRuntimeType = normalizeRuntimeType(runtimeType, 'sidecar')
    const nextBaseUrl = normalizeBaseUrl(
      baseUrl,
      nextRuntimeType === 'ollama' ? DEFAULT_OLLAMA_ENDPOINT : DEFAULT_BASE_URL
    )

    try {
      const response =
        nextRuntimeType === 'ollama'
          ? await httpClient.get(buildEndpoint(nextBaseUrl, '/api/tags'), {
              timeout: timeoutMs,
            })
          : await requestWithFallback(
              ['/v1/models', '/models'].map((candidate) =>
                buildEndpoint(nextBaseUrl, candidate)
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
    runtimeType,
    model = '',
    messages = [],
    message,
    prompt,
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const nextMessages = normalizeChatMessages({
      messages,
      message,
      prompt,
      input,
    })
    const result = await requestOllamaChat({
      baseUrl,
      runtimeType,
      model,
      messages: nextMessages,
      timeoutMs,
    })

    return {
      ...result,
      content: result.ok ? result.text : null,
    }
  }

  async function flipToText({
    baseUrl,
    runtimeType,
    visionModel,
    model = '',
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const result = await runFlipSequencePipeline({
      baseUrl,
      runtimeType,
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
    runtimeType,
    visionModel,
    model = '',
    input,
    timeoutMs = 15 * 1000,
  } = {}) {
    const pipeline = await runFlipSequencePipeline({
      baseUrl,
      runtimeType,
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

    const checkerResult = await requestOllamaChat({
      baseUrl,
      runtimeType,
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
    checkFlipSequence,
    flipToText,
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
  DEFAULT_RUNTIME,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_RUNTIME_TYPE,
  createLocalAiSidecar,
}
