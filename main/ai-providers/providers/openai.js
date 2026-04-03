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

function resolveOpenAiImagesEndpoint(providerConfig = {}) {
  const config = providerConfig || {}
  const baseUrl = trimTrailingSlash(
    config.baseUrl || 'https://api.openai.com/v1'
  )
  const imagesPath = normalizePath(config.imagesPath, '/images/generations')
  return `${baseUrl}${imagesPath}`
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
  responseFormat,
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
    payload.response_format =
      responseFormat && typeof responseFormat === 'object'
        ? responseFormat
        : {
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

function stringifyJsonLike(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch (error) {
    return ''
  }
}

function buildOpenAiPayloadVariants({
  model,
  prompt,
  images,
  profile,
  promptOptions = {},
}) {
  const structuredOutput =
    promptOptions &&
    promptOptions.structuredOutput &&
    typeof promptOptions.structuredOutput === 'object'
      ? promptOptions.structuredOutput
      : null
  const responseFormat =
    structuredOutput &&
    structuredOutput.responseFormat &&
    typeof structuredOutput.responseFormat === 'object'
      ? structuredOutput.responseFormat
      : null

  return dedupePayloadVariants([
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: 'max_tokens',
      includeTemperature: true,
      includeResponseFormat: true,
      responseFormat,
    }),
    buildOpenAiPayload({
      model,
      prompt,
      images,
      profile,
      tokenField: 'max_completion_tokens',
      includeTemperature: true,
      includeResponseFormat: true,
      responseFormat,
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

function extractOpenAiRawText(message) {
  const parsed = message && message.parsed
  const content = message && message.content
  const functionCall = message && message.function_call
  const toolCalls =
    message && Array.isArray(message.tool_calls) ? message.tool_calls : []

  if (parsed && typeof parsed === 'object') {
    return stringifyJsonLike(parsed)
  }

  if (
    functionCall &&
    typeof functionCall === 'object' &&
    typeof functionCall.arguments === 'string' &&
    functionCall.arguments.trim()
  ) {
    return functionCall.arguments
  }

  for (const toolCall of toolCalls) {
    const fn =
      toolCall && toolCall.function && typeof toolCall.function === 'object'
        ? toolCall.function
        : null
    if (fn && typeof fn.arguments === 'string' && fn.arguments.trim()) {
      return fn.arguments
    }
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return ''
        if (typeof part.text === 'string' && part.text.trim()) {
          return part.text
        }
        if (typeof part.output_text === 'string' && part.output_text.trim()) {
          return part.output_text
        }
        if (part.json && typeof part.json === 'object') {
          return stringifyJsonLike(part.json)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string' && content.text.trim()) {
      return content.text
    }
    if (typeof content.output_text === 'string' && content.output_text.trim()) {
      return content.output_text
    }
    return stringifyJsonLike(content)
  }

  return String(content || '')
}

function extractOpenAiProviderMeta(responseData) {
  const choices =
    responseData && Array.isArray(responseData.choices)
      ? responseData.choices
      : []
  const firstChoice = choices[0] || {}
  const message =
    firstChoice &&
    firstChoice.message &&
    typeof firstChoice.message === 'object'
      ? firstChoice.message
      : {}
  const finishReason = String(firstChoice.finish_reason || '')
    .trim()
    .toLowerCase()
  const refusalText = String(message.refusal || '').trim()

  return {
    finishReason,
    refusal: refusalText,
    safetyBlock: finishReason === 'content_filter',
    truncated: finishReason === 'length',
  }
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
  promptOptions = {},
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
      promptOptions,
    }),
    requestConfig: {
      timeout: profile.requestTimeoutMs,
      headers: createAuthHeaders(apiKey, providerConfig),
    },
  })

  const responseData = response && response.data
  const choices = responseData && responseData.choices
  const message = Array.isArray(choices) && choices.length && choices[0].message
  const rawText = extractOpenAiRawText(message)

  return {
    rawText,
    usage: normalizeOpenAiUsage(responseData && responseData.usage),
    providerMeta: extractOpenAiProviderMeta(responseData),
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
  const requestTimeoutMs = Math.max(
    Number(profile && profile.requestTimeoutMs) || 0,
    45 * 1000
  )
  await httpClient.post(
    endpoint,
    {
      model,
      messages: [{role: 'user', content: 'Reply with text: ok'}],
    },
    {
      timeout: requestTimeoutMs,
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

function toDataUrlFromBuffer(buffer, mimeType = 'image/png') {
  const encoded = Buffer.from(buffer).toString('base64')
  return `data:${mimeType};base64,${encoded}`
}

async function callOpenAiImage({
  httpClient,
  apiKey,
  model,
  prompt,
  profile,
  providerConfig,
  size = '1024x1024',
  quality = '',
  style = '',
}) {
  const endpoint = resolveOpenAiImagesEndpoint(providerConfig)
  const payload = {
    model,
    prompt,
    size,
    n: 1,
  }

  if (String(quality || '').trim()) {
    payload.quality = String(quality).trim()
  }
  if (String(style || '').trim()) {
    payload.style = String(style).trim()
  }

  const response = await httpClient.post(endpoint, payload, {
    timeout: profile.requestTimeoutMs,
    headers: createAuthHeaders(apiKey, providerConfig),
  })

  const first =
    Array.isArray(response && response.data && response.data.data) &&
    response.data.data.length
      ? response.data.data[0]
      : null

  if (!first) {
    throw new Error('Image generation returned no image data')
  }

  if (first.b64_json) {
    const mimeType =
      String(first.mime_type || 'image/png').trim() || 'image/png'
    return {
      imageDataUrl: `data:${mimeType};base64,${first.b64_json}`,
      revisedPrompt: String(first.revised_prompt || '').trim(),
      usage: normalizeOpenAiUsage(
        response && response.data && response.data.usage
      ),
    }
  }

  if (first.url) {
    const imageResponse = await httpClient.get(String(first.url), {
      responseType: 'arraybuffer',
      timeout: profile.requestTimeoutMs,
    })

    const mimeType = String(
      (imageResponse &&
        imageResponse.headers &&
        (imageResponse.headers['content-type'] ||
          imageResponse.headers['Content-Type'])) ||
        'image/png'
    )
      .trim()
      .toLowerCase()
      .split(';')[0]

    return {
      imageDataUrl: toDataUrlFromBuffer(
        imageResponse.data,
        mimeType || 'image/png'
      ),
      revisedPrompt: String(first.revised_prompt || '').trim(),
      usage: normalizeOpenAiUsage(
        response && response.data && response.data.usage
      ),
    }
  }

  throw new Error('Image generation payload did not include b64_json or url')
}

module.exports = {
  callOpenAi,
  callOpenAiImage,
  testOpenAiProvider,
  listOpenAiModels,
}
