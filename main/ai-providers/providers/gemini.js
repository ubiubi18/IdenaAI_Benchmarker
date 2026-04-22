const {stripDataUrl} = require('../decision')

function toTokenNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function normalizeGeminiUsage(usage = {}) {
  return {
    promptTokens: toTokenNumber(usage.promptTokenCount),
    completionTokens: toTokenNumber(usage.candidatesTokenCount),
    totalTokens: toTokenNumber(usage.totalTokenCount),
  }
}

function normalizeGeminiModelName(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^models\//, '')
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeApiVersion(value) {
  const text = String(value || 'v1beta').trim()
  return text.replace(/^\/+/, '').replace(/\/+$/, '') || 'v1beta'
}

function resolveGeminiEndpoint({model, apiKey, providerConfig = {}}) {
  const config = providerConfig || {}
  const baseUrl = trimTrailingSlash(
    config.baseUrl || 'https://generativelanguage.googleapis.com'
  )
  const apiVersion = normalizeApiVersion(config.apiVersion || 'v1beta')
  const apiKeyValue = String(apiKey || '').trim()
  const modelName = String(model || '').trim()

  if (!apiKeyValue) {
    throw new Error('Gemini API key is empty')
  }

  return `${baseUrl}/${apiVersion}/models/${encodeURIComponent(
    modelName
  )}:generateContent?key=${encodeURIComponent(apiKeyValue)}`
}

function toImagePartFromDataUrl(image) {
  return {inlineData: stripDataUrl(image)}
}

function toAspectRatio(size) {
  const match = String(size || '')
    .trim()
    .match(/^(\d{2,5})x(\d{2,5})$/i)

  if (!match) return ''

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return ''
  }

  const gcd = (a, b) => {
    let left = Math.abs(Math.trunc(a))
    let right = Math.abs(Math.trunc(b))
    while (right) {
      const next = left % right
      left = right
      right = next
    }
    return left || 1
  }

  const divisor = gcd(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function dedupePayloads(payloads) {
  const seen = new Set()
  return payloads.filter((payload) => {
    const marker = JSON.stringify(payload)
    if (seen.has(marker)) {
      return false
    }
    seen.add(marker)
    return true
  })
}

function shouldTryNextImagePayloadVariant(error) {
  const status = Number(error && error.response && error.response.status)
  return status === 400 || status === 422
}

function buildGeminiImagePayloadVariants({
  prompt,
  size = '1024x1024',
  quality = '',
  style = '',
}) {
  const normalizedPrompt = String(prompt || '').trim()
  const normalizedStyle = String(style || '').trim()
  const normalizedQuality = String(quality || '').trim()
  const aspectRatio = toAspectRatio(size)

  const promptText = [
    normalizedPrompt,
    normalizedStyle ? `Style constraints: ${normalizedStyle}` : '',
    normalizedQuality ? `Quality hint: ${normalizedQuality}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const contents = [{role: 'user', parts: [{text: promptText}]}]

  const imageConfig = aspectRatio ? {aspectRatio} : null

  return dedupePayloads([
    {
      contents,
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(imageConfig ? {imageConfig} : {}),
      },
    },
    {
      contents,
      generationConfig: {
        ...(imageConfig ? {imageConfig} : {}),
      },
    },
    {
      contents,
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
    },
    {
      contents,
    },
  ])
}

function extractGeminiImage(responseData) {
  const candidates = Array.isArray(responseData && responseData.candidates)
    ? responseData.candidates
    : []

  const textParts = []
  for (const candidate of candidates) {
    const parts =
      candidate && candidate.content && Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : []

    for (const part of parts) {
      const inlineData = part && (part.inlineData || part.inline_data)
      if (inlineData && inlineData.data) {
        const mimeType =
          String(inlineData.mimeType || inlineData.mime_type || 'image/png')
            .trim()
            .toLowerCase()
            .split(';')[0] || 'image/png'
        return {
          imageDataUrl: `data:${mimeType};base64,${String(inlineData.data)}`,
          revisedPrompt: textParts.join('\n').trim(),
        }
      }
      if (part && part.text) {
        textParts.push(String(part.text))
      }
    }
  }

  throw new Error('Gemini image generation returned no inline image data')
}

async function postGeminiImageWithFallback({
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
        shouldTryNextImagePayloadVariant(error)
      if (!canRetry) {
        throw error
      }
    }
  }

  throw lastError || new Error('Gemini image request failed')
}

async function callGemini({
  httpClient,
  apiKey,
  model,
  flip,
  prompt,
  systemPrompt,
  profile,
  providerConfig,
  promptOptions = {},
}) {
  const images = (
    Array.isArray(flip && flip.images) && flip.images.length
      ? flip.images
      : [flip && flip.leftImage, flip && flip.rightImage]
  ).filter(Boolean)
  const imageParts = images.map((image) => toImagePartFromDataUrl(image))
  const structuredOutput =
    promptOptions &&
    promptOptions.structuredOutput &&
    typeof promptOptions.structuredOutput === 'object'
      ? promptOptions.structuredOutput
      : null
  const responseSchema =
    structuredOutput &&
    structuredOutput.responseSchema &&
    typeof structuredOutput.responseSchema === 'object'
      ? structuredOutput.responseSchema
      : null

  const response = await httpClient.post(
    resolveGeminiEndpoint({model, apiKey, providerConfig}),
    {
      ...(String(systemPrompt || '').trim()
        ? {
            systemInstruction: {
              parts: [{text: String(systemPrompt).trim()}],
            },
          }
        : {}),
      contents: [
        {
          role: 'user',
          parts: [{text: prompt}, ...imageParts],
        },
      ],
      generationConfig: {
        temperature: profile.temperature,
        responseMimeType: 'application/json',
        ...(Number(profile.maxOutputTokens) > 0
          ? {maxOutputTokens: profile.maxOutputTokens}
          : {}),
        ...(responseSchema ? {responseSchema} : {}),
      },
    },
    {
      timeout: profile.requestTimeoutMs,
    }
  )

  const candidates = response && response.data && response.data.candidates
  const firstCandidate = Array.isArray(candidates) && candidates[0]
  const content = firstCandidate && firstCandidate.content
  const parts = (content && content.parts) || []

  const rawText = parts
    .map((part) => part && part.text)
    .filter(Boolean)
    .join('\n')
  const promptFeedback =
    response && response.data && response.data.promptFeedback
      ? response.data.promptFeedback
      : {}
  const finishReason = String(
    (firstCandidate && firstCandidate.finishReason) || ''
  )
    .trim()
    .toUpperCase()
  const blockReason = String(promptFeedback.blockReason || '')
    .trim()
    .toUpperCase()

  return {
    rawText,
    usage: normalizeGeminiUsage(
      response && response.data && response.data.usageMetadata
    ),
    providerMeta: {
      finishReason,
      blockReason,
      refusal: '',
      safetyBlock:
        blockReason === 'SAFETY' ||
        finishReason === 'SAFETY' ||
        blockReason === 'PROHIBITED_CONTENT',
      truncated:
        finishReason === 'MAX_TOKENS' || finishReason === 'MAX_OUTPUT_TOKENS',
    },
  }
}

async function callGeminiImage({
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
  const endpoint = resolveGeminiEndpoint({model, apiKey, providerConfig})
  const response = await postGeminiImageWithFallback({
    httpClient,
    endpoint,
    payloadVariants: buildGeminiImagePayloadVariants({
      prompt,
      size,
      quality,
      style,
    }),
    requestConfig: {
      timeout: profile.requestTimeoutMs,
    },
  })

  const image = extractGeminiImage(response && response.data)
  return {
    imageDataUrl: image.imageDataUrl,
    revisedPrompt: image.revisedPrompt,
    usage: normalizeGeminiUsage(
      response && response.data && response.data.usageMetadata
    ),
  }
}

async function testGeminiProvider({httpClient, apiKey, model, profile}) {
  await httpClient.post(
    resolveGeminiEndpoint({model, apiKey}),
    {
      contents: [
        {role: 'user', parts: [{text: 'Reply with JSON: {"ok":true}'}]},
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16,
      },
    },
    {
      timeout: profile.requestTimeoutMs,
    }
  )
}

async function listGeminiModels({httpClient, apiKey, profile, providerConfig}) {
  const config = providerConfig || {}
  const baseUrl = trimTrailingSlash(
    config.baseUrl || 'https://generativelanguage.googleapis.com'
  )
  const apiVersion = normalizeApiVersion(config.apiVersion || 'v1beta')
  const response = await httpClient.get(
    `${baseUrl}/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`,
    {
      timeout: profile.requestTimeoutMs,
    }
  )

  const models = Array.isArray(
    response && response.data && response.data.models
  )
    ? response.data.models
    : []

  return models
    .filter((item) => {
      const methods = Array.isArray(item && item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : []
      return methods.includes('generateContent')
    })
    .map((item) => normalizeGeminiModelName(item && item.name))
    .filter(Boolean)
}

module.exports = {
  callGemini,
  callGeminiImage,
  testGeminiProvider,
  listGeminiModels,
}
