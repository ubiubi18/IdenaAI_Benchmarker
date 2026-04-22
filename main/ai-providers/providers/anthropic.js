const {stripDataUrl} = require('../decision')

const ANTHROPIC_API_VERSION = '2023-06-01'

function toTokenNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function normalizeAnthropicUsage(usage = {}) {
  return {
    promptTokens: toTokenNumber(usage.input_tokens),
    completionTokens: toTokenNumber(usage.output_tokens),
    totalTokens:
      toTokenNumber(usage.input_tokens) + toTokenNumber(usage.output_tokens),
  }
}

function resolveAnthropicMessagesEndpoint(providerConfig = {}) {
  const config =
    providerConfig && typeof providerConfig === 'object' ? providerConfig : {}
  const baseUrl = String(config.baseUrl || 'https://api.anthropic.com/v1')
    .trim()
    .replace(/\/+$/, '')
  const messagesPath = String(config.messagesPath || '/messages')
    .trim()
    .replace(/^([^/])/, '/$1')
  return `${baseUrl}${messagesPath}`
}

function resolveAnthropicModelsEndpoint(providerConfig = {}) {
  const config =
    providerConfig && typeof providerConfig === 'object' ? providerConfig : {}
  const baseUrl = String(config.baseUrl || 'https://api.anthropic.com/v1')
    .trim()
    .replace(/\/+$/, '')
  const modelsPath = String(config.modelsPath || '/models')
    .trim()
    .replace(/^([^/])/, '/$1')
  return `${baseUrl}${modelsPath}`
}

function createAnthropicHeaders(apiKey, providerConfig = {}) {
  const config =
    providerConfig && typeof providerConfig === 'object' ? providerConfig : {}
  const version = String(config.apiVersion || ANTHROPIC_API_VERSION).trim()

  return {
    'x-api-key': String(apiKey || '').trim(),
    'anthropic-version': version || ANTHROPIC_API_VERSION,
  }
}

function resolveAnthropicMaxTokens(profile = {}) {
  const configured = Number(profile.maxOutputTokens)
  if (configured > 0) {
    return configured
  }

  // Anthropic requires an explicit max_tokens field. In auto mode, keep this
  // ceiling generous and let timeout/deadline handling do the real limiting.
  return 1024
}

function normalizeAnthropicModelList(data) {
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
        return String(item.id || item.name || item.model || '').trim()
      }
      return ''
    })
    .filter(Boolean)
}

function toAnthropicImagePart(dataUrl) {
  const stripped = stripDataUrl(dataUrl)
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: stripped.mimeType || 'image/png',
      data: stripped.data,
    },
  }
}

function extractTextBlocks(content) {
  const blocks = Array.isArray(content) ? content : []
  return blocks
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      if (part.type === 'text') {
        return String(part.text || '')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function callAnthropic({
  httpClient,
  apiKey,
  model,
  flip,
  prompt,
  systemPrompt,
  profile,
  providerConfig,
}) {
  const endpoint = resolveAnthropicMessagesEndpoint(providerConfig)
  const images = (
    Array.isArray(flip && flip.images) && flip.images.length
      ? flip.images
      : [flip && flip.leftImage, flip && flip.rightImage]
  ).filter(Boolean)

  const response = await httpClient.post(
    endpoint,
    {
      model,
      ...(String(systemPrompt || '').trim()
        ? {system: String(systemPrompt).trim()}
        : {}),
      max_tokens: resolveAnthropicMaxTokens(profile),
      temperature: profile.temperature,
      messages: [
        {
          role: 'user',
          content: [
            {type: 'text', text: prompt},
            ...images.map((image) => toAnthropicImagePart(image)),
          ],
        },
      ],
    },
    {
      timeout: profile.requestTimeoutMs,
      headers: createAnthropicHeaders(apiKey, providerConfig),
    }
  )

  return {
    rawText: extractTextBlocks(
      response && response.data && response.data.content
    ),
    usage: normalizeAnthropicUsage(
      response && response.data && response.data.usage
    ),
  }
}

async function testAnthropicProvider({
  httpClient,
  apiKey,
  model,
  profile,
  providerConfig,
}) {
  const endpoint = resolveAnthropicMessagesEndpoint(providerConfig)
  await httpClient.post(
    endpoint,
    {
      model,
      max_tokens: 12,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [{type: 'text', text: 'Reply with {"ok":true}'}],
        },
      ],
    },
    {
      timeout: profile.requestTimeoutMs,
      headers: createAnthropicHeaders(apiKey, providerConfig),
    }
  )
}

async function listAnthropicModels({
  httpClient,
  apiKey,
  profile,
  providerConfig,
}) {
  const endpoint = resolveAnthropicModelsEndpoint(providerConfig)
  const response = await httpClient.get(endpoint, {
    timeout: profile.requestTimeoutMs,
    headers: createAnthropicHeaders(apiKey, providerConfig),
  })
  return normalizeAnthropicModelList(response && response.data)
}

module.exports = {
  callAnthropic,
  testAnthropicProvider,
  listAnthropicModels,
}
