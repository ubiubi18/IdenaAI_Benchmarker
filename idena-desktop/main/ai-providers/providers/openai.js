function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function toTokenNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function normalizeOpenAiUsage(usage = {}) {
  return {
    promptTokens: toTokenNumber(usage.prompt_tokens),
    completionTokens: toTokenNumber(usage.completion_tokens),
    totalTokens: toTokenNumber(usage.total_tokens),
  }
}

function normalizePath(value, fallback) {
  const path = String(value || fallback || '').trim()
  if (!path) return fallback
  return path.startsWith('/') ? path : `/${path}`
}

function resolveOpenAiEndpoint(providerConfig = {}) {
  const config = providerConfig || {}
  const baseUrl = trimTrailingSlash(
    config.baseUrl || 'https://api.openai.com/v1'
  )
  const chatPath = normalizePath(config.chatPath, '/chat/completions')
  return `${baseUrl}${chatPath}`
}

function resolveOpenAiModelsEndpoint(providerConfig = {}) {
  const config = providerConfig || {}
  const baseUrl = trimTrailingSlash(
    config.baseUrl || 'https://api.openai.com/v1'
  )
  const modelsPath = normalizePath(config.modelsPath, '/models')
  return `${baseUrl}${modelsPath}`
}

function normalizeOpenAiModelList(data) {
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
        const candidate =
          item.id || item.model || item.name || item.slug || item.alias
        return String(candidate || '').trim()
      }
      return ''
    })
    .filter(Boolean)
}

function createAuthHeaders(apiKey, providerConfig = {}) {
  const config = providerConfig || {}
  const headerName = String(config.authHeader || 'Authorization').trim()
  const prefix = config.authPrefix == null ? 'Bearer' : config.authPrefix
  const normalizedPrefix = String(prefix || '').trim()
  const headerValue = normalizedPrefix
    ? `${normalizedPrefix} ${apiKey}`
    : String(apiKey || '')
  const baseHeaders = {
    [headerName || 'Authorization']: headerValue,
  }

  const extraHeaders =
    config && config.extraHeaders && typeof config.extraHeaders === 'object'
      ? config.extraHeaders
      : null

  if (!extraHeaders) {
    return baseHeaders
  }

  return Object.keys(extraHeaders).reduce(
    (acc, key) => {
      const headerKey = String(key || '').trim()
      if (!headerKey) return acc
      acc[headerKey] = String(extraHeaders[key] || '')
      return acc
    },
    {...baseHeaders}
  )
}

function getRemoteError(error) {
  const data = error && error.response && error.response.data
  if (data && typeof data === 'object' && data.error && data.error !== null) {
    return data.error
  }
  return data && typeof data === 'object' ? data : {}
}

function shouldRetryWithCompatibilityVariant(error) {
  const status = error && error.response && error.response.status
  if (status !== 400) {
    return false
  }

  const remote = getRemoteError(error)
  const code = String(remote.code || '')
    .trim()
    .toLowerCase()
  const type = String(remote.type || '')
    .trim()
    .toLowerCase()
  const param = String(remote.param || '')
    .trim()
    .toLowerCase()
  const message = String(remote.message || '')
    .trim()
    .toLowerCase()

  const marker = [code, type, param, message].join(' ')
  return (
    marker.includes('unsupported_parameter') ||
    marker.includes('unsupported parameter') ||
    marker.includes('not supported') ||
    marker.includes('max_tokens') ||
    marker.includes('max_completion_tokens') ||
    marker.includes('response_format') ||
    marker.includes('temperature')
  )
}

function buildMessageContent(prompt, images = []) {
  if (!Array.isArray(images) || images.length === 0) {
    return prompt
  }
  return [
    {type: 'text', text: prompt},
    ...images.map((url) => ({
      type: 'image_url',
      image_url: {url},
    })),
  ]
}

function buildOpenAiPayload({
  model,
  prompt,
  images,
  profile,
  tokenField,
  includeTemperature,
  includeResponseFormat,
}) {
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: buildMessageContent(prompt, images),
      },
    ],
  }

  if (includeTemperature) {
    payload.temperature = profile.temperature
  }

  if (tokenField && Number(profile.maxOutputTokens) > 0) {
    payload[tokenField] = Number(profile.maxOutputTokens)
  }

  if (includeResponseFormat) {
    payload.response_format = {
      type: 'json_object',
    }
  }

  return payload
}

function dedupePayloadVariants(payloads) {
  const seen = new Set()
  const result = []
  payloads.forEach((payload) => {
    const marker = JSON.stringify(payload)
    if (seen.has(marker)) return
    seen.add(marker)
    result.push(payload)
  })
  return result
}

function buildOpenAiPayloadVariants({model, prompt, images, profile}) {
  return dedupePayloadVariants([
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: 'max_tokens',
      includeTemperature: true,
      includeResponseFormat: true,
    }),
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: 'max_completion_tokens',
      includeTemperature: true,
      includeResponseFormat: true,
    }),
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: 'max_completion_tokens',
      includeTemperature: true,
      includeResponseFormat: false,
    }),
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: 'max_completion_tokens',
      includeTemperature: false,
      includeResponseFormat: false,
    }),
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: null,
      includeTemperature: false,
      includeResponseFormat: false,
    }),
  ])
}

async function postWithCompatibilityFallback({
  httpClient,
  endpoint,
  payloadVariants,
  requestConfig,
}) {
  let lastError = null
  for (let index = 0; index < payloadVariants.length; index += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await httpClient.post(
        endpoint,
        payloadVariants[index],
        requestConfig
      )
    } catch (error) {
      lastError = error
      const canRetry =
        index + 1 < payloadVariants.length &&
        shouldRetryWithCompatibilityVariant(error)
      if (!canRetry) {
        throw error
      }
    }
  }
  throw lastError || new Error('OpenAI request failed')
}

async function callOpenAi({
  httpClient,
  apiKey,
  model,
  flip,
  prompt,
  profile,
  providerConfig,
}) {
  const endpoint = resolveOpenAiEndpoint(providerConfig)
  const images = (
    Array.isArray(flip && flip.images) && flip.images.length
      ? flip.images
      : [flip && flip.leftImage, flip && flip.rightImage]
  ).filter(Boolean)

  const response = await postWithCompatibilityFallback({
    httpClient,
    endpoint,
    payloadVariants: buildOpenAiPayloadVariants({
      model,
      prompt,
      images,
      profile,
    }),
    requestConfig: {
      timeout: profile.requestTimeoutMs,
      headers: createAuthHeaders(apiKey, providerConfig),
    },
  })

  const choices = response && response.data && response.data.choices
  const message = Array.isArray(choices) && choices.length && choices[0].message
  const content = message && message.content

  const rawText = Array.isArray(content)
    ? content
        .map((part) => part && part.text)
        .filter(Boolean)
        .join('\n')
    : content || ''

  return {
    rawText,
    usage: normalizeOpenAiUsage(
      response && response.data && response.data.usage
    ),
  }
}

async function testOpenAiProvider({
  httpClient,
  apiKey,
  model,
  profile,
  providerConfig,
}) {
  const endpoint = resolveOpenAiEndpoint(providerConfig)
  await httpClient.post(
    endpoint,
    {
      model,
      messages: [{role: 'user', content: 'Reply with text: ok'}],
    },
    {
      timeout: profile.requestTimeoutMs,
      headers: createAuthHeaders(apiKey, providerConfig),
    }
  )
}

async function listOpenAiModels({httpClient, apiKey, profile, providerConfig}) {
  const endpoint = resolveOpenAiModelsEndpoint(providerConfig)
  const response = await httpClient.get(endpoint, {
    timeout: profile.requestTimeoutMs,
    headers: createAuthHeaders(apiKey, providerConfig),
  })

  return normalizeOpenAiModelList(response && response.data)
}

module.exports = {
  callOpenAi,
  testOpenAiProvider,
  listOpenAiModels,
}
