const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')

const appDataPath = require('./app-data-path')

const PROVIDERS = {
  OpenAI: 'openai',
  Gemini: 'gemini',
}

const DEFAULT_MODELS = {
  [PROVIDERS.OpenAI]: 'gpt-4o-mini',
  [PROVIDERS.Gemini]: 'gemini-2.0-flash',
}

const STRICT_PROFILE = {
  benchmarkProfile: 'strict',
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 2,
  maxRetries: 1,
  maxOutputTokens: 120,
}

const CUSTOM_LIMITS = {
  deadlineMs: [10 * 1000, 180 * 1000],
  requestTimeoutMs: [1000, 30 * 1000],
  maxConcurrency: [1, 6],
  maxRetries: [0, 3],
  maxOutputTokens: [16, 512],
}

const promptTemplate = ({hash}) =>
  `
You are solving an Idena short-session flip benchmark.
You are given two candidate stories of the same 4 images:
- LEFT story image
- RIGHT story image

Task:
1) Choose the most meaningful story.
2) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only left/right/skip for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual
- If uncertain, return "skip"

Flip hash: ${hash}
`.trim()

function createAiProviderBridge(logger) {
  const providerKeys = new Map([
    [PROVIDERS.OpenAI, null],
    [PROVIDERS.Gemini, null],
  ])

  function normalizeProvider(provider) {
    const normalized = String(provider || '')
      .trim()
      .toLowerCase()
    if (![PROVIDERS.OpenAI, PROVIDERS.Gemini].includes(normalized)) {
      throw new Error(`Unsupported provider: ${provider}`)
    }
    return normalized
  }

  function clamp(value, [min, max]) {
    return Math.max(min, Math.min(max, value))
  }

  function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function sanitizeBenchmarkProfile(payload = {}) {
    if (payload.benchmarkProfile !== 'custom') {
      return {
        ...STRICT_PROFILE,
      }
    }
    return {
      benchmarkProfile: 'custom',
      deadlineMs: clamp(
        toInt(payload.deadlineMs, STRICT_PROFILE.deadlineMs),
        CUSTOM_LIMITS.deadlineMs
      ),
      requestTimeoutMs: clamp(
        toInt(payload.requestTimeoutMs, STRICT_PROFILE.requestTimeoutMs),
        CUSTOM_LIMITS.requestTimeoutMs
      ),
      maxConcurrency: clamp(
        toInt(payload.maxConcurrency, STRICT_PROFILE.maxConcurrency),
        CUSTOM_LIMITS.maxConcurrency
      ),
      maxRetries: clamp(
        toInt(payload.maxRetries, STRICT_PROFILE.maxRetries),
        CUSTOM_LIMITS.maxRetries
      ),
      maxOutputTokens: clamp(
        toInt(payload.maxOutputTokens, STRICT_PROFILE.maxOutputTokens),
        CUSTOM_LIMITS.maxOutputTokens
      ),
    }
  }

  function getApiKey(provider) {
    const key = providerKeys.get(provider)
    if (!key) {
      throw new Error(`API key is not set for provider: ${provider}`)
    }
    return key
  }

  function setProviderKey({provider, apiKey}) {
    const normalized = normalizeProvider(provider)
    const key = String(apiKey || '').trim()
    if (!key) {
      throw new Error('API key is empty')
    }
    providerKeys.set(normalized, key)
    logger.info('AI provider key updated', {provider: normalized})
    return {ok: true, provider: normalized}
  }

  function clearProviderKey({provider}) {
    const normalized = normalizeProvider(provider)
    providerKeys.set(normalized, null)
    logger.info('AI provider key cleared', {provider: normalized})
    return {ok: true, provider: normalized}
  }

  function extractJsonBlock(rawText) {
    const text = String(rawText || '').trim()
    if (!text) {
      throw new Error('Empty provider response')
    }
    const full = text.match(/\{[\s\S]*\}/)
    if (!full) {
      throw new Error('Provider response does not contain JSON')
    }
    return JSON.parse(full[0])
  }

  function normalizeAnswer(answer) {
    const value = String(answer || '')
      .trim()
      .toLowerCase()
    if (['left', 'l', '1'].includes(value)) {
      return 'left'
    }
    if (['right', 'r', '2'].includes(value)) {
      return 'right'
    }
    return 'skip'
  }

  function normalizeConfidence(confidence) {
    const value = Number(confidence)
    if (!Number.isFinite(value)) {
      return 0
    }
    return Math.max(0, Math.min(1, value))
  }

  function normalizeDecision(parsed) {
    return {
      answer: normalizeAnswer(parsed && parsed.answer),
      confidence: normalizeConfidence(parsed && parsed.confidence),
      reasoning:
        typeof (parsed && parsed.reasoning) === 'string'
          ? parsed.reasoning.slice(0, 240)
          : undefined,
    }
  }

  function stripDataUrl(dataUrl) {
    const value = String(dataUrl || '')
    const match = value.match(/^data:(.*?);base64,(.*)$/)
    if (!match) {
      throw new Error('Image payload must be a base64 data URL')
    }
    return {
      mimeType: match[1] || 'image/png',
      data: match[2],
    }
  }

  async function callOpenAi({apiKey, model, flip, prompt, profile}) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        temperature: 0,
        max_tokens: profile.maxOutputTokens,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'user',
            content: [
              {type: 'text', text: prompt},
              {type: 'image_url', image_url: {url: flip.leftImage}},
              {type: 'image_url', image_url: {url: flip.rightImage}},
            ],
          },
        ],
      },
      {
        timeout: profile.requestTimeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    )
    const choices = response && response.data && response.data.choices
    const message =
      Array.isArray(choices) && choices.length && choices[0].message
    const content = message && message.content

    if (Array.isArray(content)) {
      return content
        .map((part) => part && part.text)
        .filter(Boolean)
        .join('\n')
    }

    return content || ''
  }

  async function callGemini({apiKey, model, flip, prompt, profile}) {
    const left = stripDataUrl(flip.leftImage)
    const right = stripDataUrl(flip.rightImage)
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        contents: [
          {
            role: 'user',
            parts: [{text: prompt}, {inlineData: left}, {inlineData: right}],
          },
        ],
        generationConfig: {
          temperature: 0,
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
    return parts
      .map((part) => part && part.text)
      .filter(Boolean)
      .join('\n')
  }

  async function withRetries(maxRetries, worker) {
    let attempt = 0
    while (attempt <= maxRetries) {
      try {
        return await worker(attempt)
      } catch (error) {
        if (attempt === maxRetries) {
          throw error
        }
        attempt += 1
      }
    }
    throw new Error('Retry loop terminated unexpectedly')
  }

  async function mapWithConcurrency(items, limit, mapper) {
    if (!items.length) return []
    const results = new Array(items.length)
    let cursor = 0
    const workers = Array.from(
      {length: Math.max(1, Math.min(limit, items.length))},
      async () => {
        while (cursor < items.length) {
          const current = cursor
          cursor += 1
          if (current >= items.length) return
          results[current] = await mapper(items[current], current)
        }
      }
    )
    await Promise.all(workers)
    return results
  }

  async function runProvider({provider, model, flip, profile}) {
    const apiKey = getApiKey(provider)
    const prompt = promptTemplate({hash: flip.hash})
    if (provider === PROVIDERS.OpenAI) {
      return callOpenAi({apiKey, model, flip, prompt, profile})
    }
    return callGemini({apiKey, model, flip, prompt, profile})
  }

  async function testProvider({provider, model}) {
    const normalized = normalizeProvider(provider)
    const finalModel = String(model || DEFAULT_MODELS[normalized]).trim()
    const startedAt = Date.now()
    const profile = sanitizeBenchmarkProfile()
    if (normalized === PROVIDERS.OpenAI) {
      const apiKey = getApiKey(normalized)
      await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: finalModel,
          temperature: 0,
          max_tokens: 8,
          messages: [{role: 'user', content: 'Reply with JSON: {"ok":true}'}],
        },
        {
          timeout: profile.requestTimeoutMs,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      )
    } else {
      const apiKey = getApiKey(normalized)
      await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          finalModel
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
    return {
      ok: true,
      provider: normalized,
      model: finalModel,
      latencyMs: Date.now() - startedAt,
    }
  }

  async function writeBenchmarkLog(entry) {
    try {
      const dir = path.join(appDataPath('userData'), 'ai-benchmark')
      await fs.ensureDir(dir)
      await fs.appendFile(
        path.join(dir, 'session-metrics.jsonl'),
        `${JSON.stringify(entry)}\n`
      )
    } catch (error) {
      logger.error('Unable to write AI benchmark log', {
        error: error.toString(),
      })
    }
  }

  async function solveFlipBatch(payload = {}) {
    const provider = normalizeProvider(payload.provider)
    const model = String(payload.model || DEFAULT_MODELS[provider]).trim()
    const flips = Array.isArray(payload.flips) ? payload.flips : []
    if (!flips.length) {
      throw new Error('No flips provided')
    }
    const profile = sanitizeBenchmarkProfile(payload)
    const startedAt = Date.now()
    const deadlineAt = startedAt + profile.deadlineMs

    const results = await mapWithConcurrency(
      flips,
      profile.maxConcurrency,
      async (flip) => {
        const flipStartedAt = Date.now()
        if (flipStartedAt >= deadlineAt) {
          return {
            hash: flip.hash,
            answer: 'skip',
            confidence: 0,
            reasoning: 'deadline exceeded before request',
            latencyMs: 0,
            error: 'deadline_exceeded',
          }
        }
        try {
          const raw = await withRetries(profile.maxRetries, async () =>
            runProvider({provider, model, flip, profile})
          )
          const parsed = extractJsonBlock(raw)
          const decision = normalizeDecision(parsed)
          return {
            hash: flip.hash,
            ...decision,
            latencyMs: Date.now() - flipStartedAt,
          }
        } catch (error) {
          return {
            hash: flip.hash,
            answer: 'skip',
            confidence: 0,
            reasoning: 'provider error',
            latencyMs: Date.now() - flipStartedAt,
            error: error.toString(),
          }
        }
      }
    )

    const summary = {
      totalFlips: results.length,
      elapsedMs: Date.now() - startedAt,
      skipped: results.filter((x) => x.answer === 'skip').length,
      left: results.filter((x) => x.answer === 'left').length,
      right: results.filter((x) => x.answer === 'right').length,
    }

    await writeBenchmarkLog({
      time: new Date().toISOString(),
      provider,
      model,
      profile,
      session: payload.session || null,
      summary,
      flips: results.map(
        ({hash, answer, confidence, latencyMs, error, reasoning}) => ({
          hash,
          answer,
          confidence,
          latencyMs,
          error,
          reasoning,
        })
      ),
    })

    return {
      provider,
      model,
      profile,
      summary,
      results,
    }
  }

  return {
    setProviderKey,
    clearProviderKey,
    testProvider,
    solveFlipBatch,
  }
}

module.exports = {
  createAiProviderBridge,
}
