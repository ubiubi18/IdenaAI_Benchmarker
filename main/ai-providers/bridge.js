const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')

const {PROVIDERS, DEFAULT_MODELS} = require('./constants')
const {promptTemplate} = require('./prompt')
const {sanitizeBenchmarkProfile} = require('./profile')
const {extractJsonBlock, normalizeDecision} = require('./decision')
const {withRetries, mapWithConcurrency} = require('./concurrency')
const {callOpenAi, testOpenAiProvider} = require('./providers/openai')
const {callGemini, testGeminiProvider} = require('./providers/gemini')

const SUPPORTED_PROVIDERS = [PROVIDERS.OpenAI, PROVIDERS.Gemini]
let appDataPath = null

try {
  // eslint-disable-next-line global-require
  appDataPath = require('../app-data-path')
} catch (error) {
  appDataPath = null
}

function resolveUserDataPath() {
  if (!appDataPath) {
    throw new Error('app-data-path is unavailable in this environment')
  }
  return appDataPath('userData')
}

function normalizeProvider(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()

  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    throw new Error(`Unsupported provider: ${provider}`)
  }

  return normalized
}

function createAiProviderBridge(logger, dependencies = {}) {
  const providerKeys = new Map([
    [PROVIDERS.OpenAI, null],
    [PROVIDERS.Gemini, null],
  ])

  const now =
    typeof dependencies.now === 'function' ? dependencies.now : () => Date.now()
  const httpClient = dependencies.httpClient || axios

  const getUserDataPath =
    typeof dependencies.getUserDataPath === 'function'
      ? dependencies.getUserDataPath
      : resolveUserDataPath

  const invokeProvider =
    typeof dependencies.invokeProvider === 'function'
      ? dependencies.invokeProvider
      : runProvider

  const writeBenchmarkLog =
    typeof dependencies.writeBenchmarkLog === 'function'
      ? dependencies.writeBenchmarkLog
      : writeBenchmarkLogDefault

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

  async function runProvider({provider, model, flip, profile}) {
    const apiKey = getApiKey(provider)
    const prompt = promptTemplate({hash: flip.hash})

    if (provider === PROVIDERS.OpenAI) {
      return callOpenAi({
        httpClient,
        apiKey,
        model,
        flip,
        prompt,
        profile,
      })
    }

    return callGemini({
      httpClient,
      apiKey,
      model,
      flip,
      prompt,
      profile,
    })
  }

  async function testProvider({provider, model}) {
    const normalized = normalizeProvider(provider)
    const finalModel = String(model || DEFAULT_MODELS[normalized]).trim()
    const startedAt = now()
    const profile = sanitizeBenchmarkProfile()
    const apiKey = getApiKey(normalized)

    if (normalized === PROVIDERS.OpenAI) {
      await testOpenAiProvider({
        httpClient,
        apiKey,
        model: finalModel,
        profile,
      })
    } else {
      await testGeminiProvider({
        httpClient,
        apiKey,
        model: finalModel,
        profile,
      })
    }

    return {
      ok: true,
      provider: normalized,
      model: finalModel,
      latencyMs: now() - startedAt,
    }
  }

  async function writeBenchmarkLogDefault(entry) {
    try {
      const dir = path.join(getUserDataPath(), 'ai-benchmark')
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
    const startedAt = now()
    const deadlineAt = startedAt + profile.deadlineMs

    const results = await mapWithConcurrency(
      flips,
      profile.maxConcurrency,
      async (flip) => {
        const flipStartedAt = now()

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
            invokeProvider({provider, model, flip, profile})
          )
          const parsed = extractJsonBlock(raw)
          const decision = normalizeDecision(parsed)

          return {
            hash: flip.hash,
            ...decision,
            latencyMs: now() - flipStartedAt,
          }
        } catch (error) {
          return {
            hash: flip.hash,
            answer: 'skip',
            confidence: 0,
            reasoning: 'provider error',
            latencyMs: now() - flipStartedAt,
            error: error.toString(),
          }
        }
      }
    )

    const summary = {
      totalFlips: results.length,
      elapsedMs: now() - startedAt,
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
  normalizeProvider,
}
