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

async function callGemini({httpClient, apiKey, model, flip, prompt, profile}) {
  const images = (
    Array.isArray(flip && flip.images) && flip.images.length
      ? flip.images
      : [flip && flip.leftImage, flip && flip.rightImage]
  ).filter(Boolean)
  const imageParts = images.map((image) => ({inlineData: stripDataUrl(image)}))

  const response = await httpClient.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      contents: [
        {
          role: 'user',
          parts: [{text: prompt}, ...imageParts],
        },
      ],
      generationConfig: {
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        responseMimeType: 'application/json',
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

  return {
    rawText,
    usage: normalizeGeminiUsage(
      response && response.data && response.data.usageMetadata
    ),
  }
}

async function testGeminiProvider({httpClient, apiKey, model, profile}) {
  await httpClient.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
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

async function listGeminiModels({httpClient, apiKey, profile}) {
  const response = await httpClient.get(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      apiKey
    )}`,
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
  testGeminiProvider,
  listGeminiModels,
}
