const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')

const {
  PROVIDERS,
  DEFAULT_MODELS,
  PROVIDER_CONFIG_DEFAULTS,
  OPENAI_COMPATIBLE_PROVIDERS,
} = require('./constants')
const {promptTemplate} = require('./prompt')
const {sanitizeBenchmarkProfile} = require('./profile')
const {
  extractJsonBlock,
  normalizeAnswer,
  normalizeConfidence,
  normalizeDecision,
} = require('./decision')
const {withRetries, mapWithConcurrency} = require('./concurrency')
const {
  callOpenAi,
  testOpenAiProvider,
  listOpenAiModels,
} = require('./providers/openai')
const {
  callGemini,
  testGeminiProvider,
  listGeminiModels,
} = require('./providers/gemini')
const {
  callAnthropic,
  testAnthropicProvider,
  listAnthropicModels,
} = require('./providers/anthropic')
const {
  LEGACY_HEURISTIC_PROVIDER,
  LEGACY_HEURISTIC_MODEL,
  LEGACY_HEURISTIC_STRATEGY,
  solveLegacyHeuristicDecision,
} = require('./providers/legacy-heuristic')

const SUPPORTED_PROVIDERS = Object.values(PROVIDERS)
const MAX_CONSULTANTS = 4
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

function isOpenAiCompatibleProvider(provider) {
  return OPENAI_COMPATIBLE_PROVIDERS.includes(provider)
}

function resolveProviderConfig(provider, providerConfig = null) {
  const defaults =
    PROVIDER_CONFIG_DEFAULTS &&
    PROVIDER_CONFIG_DEFAULTS[provider] &&
    typeof PROVIDER_CONFIG_DEFAULTS[provider] === 'object'
      ? PROVIDER_CONFIG_DEFAULTS[provider]
      : null

  const overrides =
    providerConfig && typeof providerConfig === 'object' ? providerConfig : null

  if (!defaults && !overrides) {
    return null
  }

  return {
    ...(defaults || {}),
    ...(overrides || {}),
  }
}

function normalizeConsultantWeight(value, fallback = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function getRemoteErrorPayload(data) {
  if (!data) {
    return {}
  }

  if (typeof data === 'string') {
    return {message: data}
  }

  if (typeof data !== 'object') {
    return {}
  }

  if (data.error && typeof data.error === 'object') {
    return {
      message: data.error.message || '',
      code: data.error.code || data.error.type || '',
      type: data.error.type || '',
    }
  }

  return {
    message: data.message || data.error_description || '',
    code: data.code || '',
    type: data.type || '',
  }
}

function createProviderErrorMessage({provider, model, operation, error}) {
  const status = error && error.response && error.response.status
  const statusText = error && error.response && error.response.statusText
  const remote = getRemoteErrorPayload(
    error && error.response && error.response.data
  )

  const marker = []
  if (Number.isFinite(status)) {
    marker.push(String(status))
  }
  if (remote.code) {
    marker.push(String(remote.code))
  } else if (remote.type) {
    marker.push(String(remote.type))
  } else if (error && error.code) {
    marker.push(String(error.code))
  }

  const reason =
    String(remote.message || '').trim() ||
    String(statusText || '').trim() ||
    String((error && error.message) || '').trim() ||
    String(error || 'Unknown error')

  const markerText = marker.length ? ` (${marker.join(' ')})` : ''
  return `${String(provider || 'provider')} ${String(
    operation || 'request'
  )} failed${markerText} for model ${String(model || '').trim()}: ${reason}`
}

function getResponseStatus(error) {
  return error && error.response && error.response.status
}

function getRetryAfterMs(error) {
  const headers = (error && error.response && error.response.headers) || {}
  const raw = headers['retry-after'] || headers['Retry-After']
  if (raw == null) {
    return null
  }

  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber * 1000
  }

  const asDate = Date.parse(String(raw))
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now())
  }

  return null
}

function hashScore(value) {
  const text = String(value || '')
  let score = 17
  for (let index = 0; index < text.length; index += 1) {
    score = (score * 131 + text.charCodeAt(index)) % 2147483647
  }
  return score
}

function buildSwapPlan(flips) {
  const total = Array.isArray(flips) ? flips.length : 0
  if (!total) {
    return []
  }

  const swapTarget = Math.ceil(total / 2)
  const scored = flips.map((flip, index) => ({
    index,
    score: hashScore(`${flip && flip.hash ? flip.hash : ''}:${index}`),
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.index - b.index
  })

  const swapPlan = Array(total).fill(false)
  for (let index = 0; index < swapTarget; index += 1) {
    const target = scored[index]
    if (target) {
      swapPlan[target.index] = true
    }
  }

  return swapPlan
}

function remapDecisionIfSwapped(decision, swapped) {
  if (!swapped) {
    return decision
  }

  if (decision.answer === 'left') {
    return {...decision, answer: 'right'}
  }

  if (decision.answer === 'right') {
    return {...decision, answer: 'left'}
  }

  return decision
}

function normalizeConsultProviders(payload, primaryProvider, primaryModel) {
  const legacyHeuristicEnabled = Boolean(
    payload && payload.legacyHeuristicEnabled
  )
  const legacyHeuristicOnly = Boolean(
    legacyHeuristicEnabled && payload && payload.legacyHeuristicOnly
  )
  const primaryWeight = normalizeConsultantWeight(
    payload && payload.ensemblePrimaryWeight,
    1
  )
  const result = []
  const seen = new Set()

  if (!legacyHeuristicOnly) {
    result.push({
      provider: primaryProvider,
      model: primaryModel,
      source: 'primary',
      weight: primaryWeight,
    })
    seen.add(`${primaryProvider}:${String(primaryModel).toLowerCase()}`)
  }

  const providerConfig =
    payload &&
    payload.providerConfig &&
    typeof payload.providerConfig === 'object'
      ? payload.providerConfig
      : null

  const rawCandidates = Array.isArray(payload && payload.consultProviders)
    ? payload.consultProviders
    : []

  const consultSlotsFromSettings =
    payload && payload.ensembleEnabled && !legacyHeuristicOnly
      ? [
          {
            enabled: payload.ensembleProvider2Enabled,
            provider: payload.ensembleProvider2,
            model: payload.ensembleModel2,
            source: 'ensemble-slot-2',
            weight: payload.ensembleProvider2Weight,
          },
          {
            enabled: payload.ensembleProvider3Enabled,
            provider: payload.ensembleProvider3,
            model: payload.ensembleModel3,
            source: 'ensemble-slot-3',
            weight: payload.ensembleProvider3Weight,
          },
        ]
      : []

  const legacyHeuristicFromSettings = legacyHeuristicEnabled
    ? [
        {
          strategy: LEGACY_HEURISTIC_STRATEGY,
          source: 'legacy-heuristic',
          weight: payload.legacyHeuristicWeight,
        },
      ]
    : []

  const candidateList = legacyHeuristicOnly
    ? legacyHeuristicFromSettings
    : rawCandidates
        .concat(consultSlotsFromSettings)
        .concat(legacyHeuristicFromSettings)

  candidateList.forEach((candidate) => {
    if (!candidate || result.length >= MAX_CONSULTANTS) return
    if (candidate.enabled === false) return

    const strategy = String(candidate.strategy || '')
      .trim()
      .toLowerCase()
    const providerLike = String(candidate.provider || '')
      .trim()
      .toLowerCase()

    if (
      strategy === LEGACY_HEURISTIC_STRATEGY ||
      providerLike === LEGACY_HEURISTIC_PROVIDER
    ) {
      const strategyKey = `${LEGACY_HEURISTIC_PROVIDER}:${LEGACY_HEURISTIC_MODEL}`
      if (seen.has(strategyKey)) {
        return
      }

      seen.add(strategyKey)
      result.push({
        provider: LEGACY_HEURISTIC_PROVIDER,
        model: LEGACY_HEURISTIC_MODEL,
        source:
          String(candidate.source || 'legacy-heuristic').trim() ||
          'legacy-heuristic',
        weight: normalizeConsultantWeight(candidate.weight, 1),
        internalStrategy: LEGACY_HEURISTIC_STRATEGY,
      })
      return
    }

    let provider = ''
    try {
      provider = normalizeProvider(candidate.provider || primaryProvider)
    } catch (error) {
      return
    }

    const model = String(candidate.model || '').trim()
    if (!model) return

    const key = `${provider}:${model.toLowerCase()}`
    if (seen.has(key)) return

    seen.add(key)
    result.push({
      provider,
      model,
      source: String(candidate.source || 'consult').trim() || 'consult',
      weight: normalizeConsultantWeight(candidate.weight, 1),
      providerConfig:
        provider === PROVIDERS.Anthropic ||
        provider === PROVIDERS.OpenAICompatible
          ? candidate.providerConfig || providerConfig || null
          : candidate.providerConfig || null,
    })
  })

  return result.slice(0, MAX_CONSULTANTS)
}

function decisionToDistribution(decision = {}) {
  if (decision.error) {
    return {
      left: 0,
      right: 0,
      skip: 0,
      weight: 0,
    }
  }

  const answer = normalizeAnswer(decision.answer)
  const confidence = normalizeConfidence(decision.confidence)
  if (confidence <= 0) {
    return {
      left: 0,
      right: 0,
      skip: 0,
      weight: 0,
    }
  }

  const remainder = (1 - confidence) / 2
  const distribution = {
    left: remainder,
    right: remainder,
    skip: remainder,
    weight: 1,
  }
  distribution[answer] = confidence

  return distribution
}

function aggregateConsultantDecisions(decisions = []) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return {
      answer: 'skip',
      confidence: 0,
      reasoning: 'No consultant decisions available',
      probabilities: null,
      contributors: 0,
      totalWeight: 0,
    }
  }

  if (decisions.length === 1) {
    const item = decisions[0]
    return {
      answer: normalizeAnswer(item.answer),
      confidence: normalizeConfidence(item.confidence),
      reasoning: item.reasoning,
      probabilities: null,
      contributors: item.error ? 0 : 1,
      totalWeight: item.error ? 0 : normalizeConsultantWeight(item.weight, 1),
    }
  }

  const totals = {left: 0, right: 0, skip: 0}
  let contributors = 0
  let totalWeight = 0

  decisions.forEach((decision) => {
    const distribution = decisionToDistribution(decision)
    if (distribution.weight <= 0) return
    const decisionWeight = normalizeConsultantWeight(decision.weight, 1)
    totals.left += distribution.left * decisionWeight
    totals.right += distribution.right * decisionWeight
    totals.skip += distribution.skip * decisionWeight
    contributors += 1
    totalWeight += decisionWeight
  })

  if (contributors <= 0 || totalWeight <= 0) {
    const fallback = decisions.find((item) => !item.error) || decisions[0]
    return {
      answer: normalizeAnswer(fallback && fallback.answer),
      confidence: normalizeConfidence(fallback && fallback.confidence),
      reasoning:
        'All consultant requests failed; using fallback consultant decision',
      probabilities: null,
      contributors: 0,
      totalWeight: 0,
    }
  }

  const probabilities = {
    left: totals.left / totalWeight,
    right: totals.right / totalWeight,
    skip: totals.skip / totalWeight,
  }

  const ranked = ['left', 'right', 'skip'].sort((a, b) => {
    if (probabilities[b] === probabilities[a]) return 0
    return probabilities[b] - probabilities[a]
  })
  const answer = ranked[0]

  return {
    answer,
    confidence: normalizeConfidence(probabilities[answer]),
    reasoning: `ensemble average probabilities left=${probabilities.left.toFixed(
      3
    )}, right=${probabilities.right.toFixed(
      3
    )}, skip=${probabilities.skip.toFixed(3)}`,
    probabilities,
    contributors,
    totalWeight,
  }
}

function chooseDeterministicSide(hash) {
  return hashScore(String(hash || '')) % 2 === 0 ? 'left' : 'right'
}

function normalizeImageList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function resolveVisionModeForFlip(profile, flip) {
  const requested = String(
    profile && profile.flipVisionMode ? profile.flipVisionMode : 'composite'
  )
    .trim()
    .toLowerCase()

  if (requested === 'composite') {
    return {
      requested,
      applied: 'composite',
      leftFrames: [],
      rightFrames: [],
      fallbackReason: null,
    }
  }

  const leftFrames = normalizeImageList(flip && flip.leftFrames).slice(0, 4)
  const rightFrames = normalizeImageList(flip && flip.rightFrames).slice(0, 4)

  if (!leftFrames.length || !rightFrames.length) {
    return {
      requested,
      applied: 'composite',
      leftFrames: [],
      rightFrames: [],
      fallbackReason: 'missing_frames',
    }
  }

  return {
    requested,
    applied:
      requested === 'frames_single_pass' || requested === 'frames_two_pass'
        ? requested
        : 'composite',
    leftFrames,
    rightFrames,
    fallbackReason:
      requested === 'frames_single_pass' || requested === 'frames_two_pass'
        ? null
        : 'unsupported_mode',
  }
}

function buildProviderFlipForVision({
  flip,
  swapped,
  visionMode,
  leftFrames,
  rightFrames,
}) {
  const baseFlip = swapped
    ? {
        ...flip,
        leftImage: flip.rightImage,
        rightImage: flip.leftImage,
      }
    : {...flip}

  if (visionMode === 'composite') {
    return {
      ...baseFlip,
      images: [baseFlip.leftImage, baseFlip.rightImage].filter(Boolean),
    }
  }

  const effectiveLeftFrames = swapped ? rightFrames : leftFrames
  const effectiveRightFrames = swapped ? leftFrames : rightFrames

  return {
    ...baseFlip,
    leftFrames: effectiveLeftFrames,
    rightFrames: effectiveRightFrames,
    images: effectiveLeftFrames.concat(effectiveRightFrames),
  }
}

function createEmptyTokenUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
}

function normalizeTokenUsage(usage = {}) {
  const promptTokens = Number(usage.promptTokens)
  const completionTokens = Number(usage.completionTokens)
  const totalTokens = Number(usage.totalTokens)

  const normalizedPrompt =
    Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0
  const normalizedCompletion =
    Number.isFinite(completionTokens) && completionTokens >= 0
      ? completionTokens
      : 0

  const normalizedTotal =
    Number.isFinite(totalTokens) && totalTokens >= 0
      ? totalTokens
      : normalizedPrompt + normalizedCompletion

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens: normalizedTotal,
  }
}

function normalizeProviderResponse(providerResponse) {
  if (typeof providerResponse === 'string') {
    return {
      rawText: providerResponse,
      tokenUsage: createEmptyTokenUsage(),
    }
  }

  if (providerResponse && typeof providerResponse === 'object') {
    let rawText = ''

    if (typeof providerResponse.rawText === 'string') {
      rawText = providerResponse.rawText
    } else if (typeof providerResponse.content === 'string') {
      rawText = providerResponse.content
    }

    return {
      rawText,
      tokenUsage: normalizeTokenUsage(providerResponse.usage),
    }
  }

  return {
    rawText: '',
    tokenUsage: createEmptyTokenUsage(),
  }
}

function addTokenUsage(left = {}, right = {}) {
  const a = normalizeTokenUsage(left)
  const b = normalizeTokenUsage(right)
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

function summarizeTokenUsage(results) {
  return results.reduce(
    (acc, item) => {
      const usage = normalizeTokenUsage(item && item.tokenUsage)
      const hasUsage =
        usage.promptTokens > 0 ||
        usage.completionTokens > 0 ||
        usage.totalTokens > 0

      return {
        promptTokens: acc.promptTokens + usage.promptTokens,
        completionTokens: acc.completionTokens + usage.completionTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        flipsWithUsage: acc.flipsWithUsage + (hasUsage ? 1 : 0),
      }
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      flipsWithUsage: 0,
    }
  )
}

function createAiProviderBridge(logger, dependencies = {}) {
  const providerKeys = new Map(
    Object.values(PROVIDERS).map((provider) => [provider, null])
  )

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

  const sleep =
    typeof dependencies.sleep === 'function'
      ? dependencies.sleep
      : (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          })

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

  function hasProviderKey({provider}) {
    const normalized = normalizeProvider(provider)
    const key = providerKeys.get(normalized)
    return {
      ok: true,
      provider: normalized,
      hasKey: Boolean(key),
    }
  }

  async function runProvider({
    provider,
    model,
    flip,
    profile,
    apiKey,
    providerConfig,
    promptText = '',
    promptOptions = {},
  }) {
    const resolvedApiKey = apiKey || getApiKey(provider)
    const resolvedProviderConfig = resolveProviderConfig(
      provider,
      providerConfig
    )
    const prompt =
      String(promptText || '').trim() ||
      promptTemplate({
        hash: flip.hash,
        forceDecision: Boolean(promptOptions.forceDecision),
        secondPass: Boolean(promptOptions.secondPass),
        promptTemplateOverride: profile.promptTemplateOverride,
        uncertaintyRepromptInstruction: profile.uncertaintyRepromptInstruction,
        flipVisionMode: promptOptions.flipVisionMode || profile.flipVisionMode,
        promptPhase: promptOptions.promptPhase || 'decision',
        frameReasoning: promptOptions.frameReasoning || '',
      })

    if (isOpenAiCompatibleProvider(provider)) {
      return callOpenAi({
        httpClient,
        apiKey: resolvedApiKey,
        model,
        flip,
        prompt,
        profile,
        providerConfig: resolvedProviderConfig,
      })
    }

    if (provider === PROVIDERS.Anthropic) {
      return callAnthropic({
        httpClient,
        apiKey: resolvedApiKey,
        model,
        flip,
        prompt,
        profile,
        providerConfig: resolvedProviderConfig,
      })
    }

    return callGemini({
      httpClient,
      apiKey: resolvedApiKey,
      model,
      flip,
      prompt,
      profile,
    })
  }

  async function testProvider({provider, model, providerConfig}) {
    const normalized = normalizeProvider(provider)
    const finalModel = String(model || DEFAULT_MODELS[normalized]).trim()
    const startedAt = now()
    const profile = sanitizeBenchmarkProfile()
    const apiKey = getApiKey(normalized)
    const resolvedProviderConfig = resolveProviderConfig(
      normalized,
      providerConfig
    )

    try {
      await withRetries(1, async (attempt) => {
        try {
          if (isOpenAiCompatibleProvider(normalized)) {
            await testOpenAiProvider({
              httpClient,
              apiKey,
              model: finalModel,
              profile,
              providerConfig: resolvedProviderConfig,
            })
          } else if (normalized === PROVIDERS.Anthropic) {
            await testAnthropicProvider({
              httpClient,
              apiKey,
              model: finalModel,
              profile,
              providerConfig: resolvedProviderConfig,
            })
          } else {
            await testGeminiProvider({
              httpClient,
              apiKey,
              model: finalModel,
              profile,
            })
          }
        } catch (error) {
          const status = getResponseStatus(error)
          if (status === 429 && attempt < 1) {
            const retryAfterMs = getRetryAfterMs(error) || 1200
            logger.info('AI provider test hit rate limit, retrying', {
              provider: normalized,
              model: finalModel,
              retryAfterMs,
            })
            await sleep(retryAfterMs)
          }
          throw error
        }
      })
    } catch (error) {
      const message = createProviderErrorMessage({
        provider: normalized,
        model: finalModel,
        operation: 'test',
        error,
      })
      logger.error('AI provider test failed', {
        provider: normalized,
        model: finalModel,
        error: message,
      })
      throw new Error(message)
    }

    return {
      ok: true,
      provider: normalized,
      model: finalModel,
      latencyMs: now() - startedAt,
    }
  }

  async function listModels({provider, providerConfig}) {
    const normalized = normalizeProvider(provider)
    const profile = sanitizeBenchmarkProfile()
    const apiKey = getApiKey(normalized)
    const resolvedProviderConfig = resolveProviderConfig(
      normalized,
      providerConfig
    )

    try {
      let models = []
      if (isOpenAiCompatibleProvider(normalized)) {
        models = await listOpenAiModels({
          httpClient,
          apiKey,
          profile,
          providerConfig: resolvedProviderConfig,
        })
      } else if (normalized === PROVIDERS.Anthropic) {
        models = await listAnthropicModels({
          httpClient,
          apiKey,
          profile,
          providerConfig: resolvedProviderConfig,
        })
      } else {
        models = await listGeminiModels({
          httpClient,
          apiKey,
          profile,
        })
      }

      const unique = Array.from(
        new Set(models.map((item) => String(item || '').trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b))

      return {
        ok: true,
        provider: normalized,
        total: unique.length,
        models: unique,
      }
    } catch (error) {
      const message = createProviderErrorMessage({
        provider: normalized,
        model: '-',
        operation: 'list_models',
        error,
      })

      logger.error('AI provider model list failed', {
        provider: normalized,
        error: message,
      })

      throw new Error(message)
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
    const legacyOnlyMode = Boolean(
      payload && payload.legacyHeuristicEnabled && payload.legacyHeuristicOnly
    )
    const flips = Array.isArray(payload.flips) ? payload.flips : []
    const providerConfig = payload.providerConfig || null
    const consultProviders = normalizeConsultProviders(payload, provider, model)
    const consultProvidersWithKeys = consultProviders.map((consultant) => ({
      ...consultant,
      apiKey:
        consultant.internalStrategy === LEGACY_HEURISTIC_STRATEGY
          ? null
          : getApiKey(consultant.provider),
    }))

    if (!flips.length) {
      throw new Error('No flips provided')
    }
    if (!consultProviders.length) {
      throw new Error('No consultant strategies available')
    }

    const profile = sanitizeBenchmarkProfile(payload)
    const startedAt = now()
    const deadlineAt = startedAt + profile.deadlineMs
    const swapPlan = buildSwapPlan(flips)
    const interFlipDelayMs = Math.max(0, Number(profile.interFlipDelayMs) || 0)
    const onFlipStart =
      typeof payload.onFlipStart === 'function' ? payload.onFlipStart : null
    const onFlipResult =
      typeof payload.onFlipResult === 'function' ? payload.onFlipResult : null

    function emitFlipStart(event) {
      if (!onFlipStart) {
        return
      }
      try {
        onFlipStart(event)
      } catch (error) {
        logger.error('AI solver onFlipStart callback failed', {
          error: error.toString(),
        })
      }
    }

    function emitFlipResult(event) {
      if (!onFlipResult) {
        return
      }
      try {
        onFlipResult(event)
      } catch (error) {
        logger.error('AI solver onFlipResult callback failed', {
          error: error.toString(),
        })
      }
    }

    async function solveSingleFlip(flip, flipIndex) {
      const flipStartedAt = now()
      const swapped = swapPlan[flipIndex] === true
      const vision = resolveVisionModeForFlip(profile, flip)

      if (flipStartedAt >= deadlineAt) {
        if (profile.forceDecision) {
          const forcedAnswer = chooseDeterministicSide(flip.hash)
          return {
            hash: flip.hash,
            answer: forcedAnswer,
            rawAnswerBeforeRemap: 'skip',
            finalAnswerAfterRemap: forcedAnswer,
            confidence: 0,
            reasoning: `deadline exceeded, forced ${forcedAnswer}`,
            latencyMs: 0,
            error: 'deadline_exceeded',
            sideSwapped: swapped,
            flipVisionModeRequested: vision.requested,
            flipVisionModeApplied: vision.applied,
            flipVisionModeFallback: vision.fallbackReason,
            forcedDecision: true,
            forcedDecisionReason: 'deadline_exceeded',
            tokenUsage: createEmptyTokenUsage(),
          }
        }
        return {
          hash: flip.hash,
          answer: 'skip',
          rawAnswerBeforeRemap: 'skip',
          finalAnswerAfterRemap: 'skip',
          confidence: 0,
          reasoning: 'deadline exceeded before request',
          latencyMs: 0,
          error: 'deadline_exceeded',
          sideSwapped: swapped,
          flipVisionModeRequested: vision.requested,
          flipVisionModeApplied: vision.applied,
          flipVisionModeFallback: vision.fallbackReason,
          tokenUsage: createEmptyTokenUsage(),
        }
      }

      const providerFlip = buildProviderFlipForVision({
        flip,
        swapped,
        visionMode: vision.applied,
        leftFrames: vision.leftFrames,
        rightFrames: vision.rightFrames,
      })

      emitFlipStart({
        type: 'flip-start',
        flipIndex,
        hash: flip.hash,
        leftImage: flip.leftImage,
        rightImage: flip.rightImage,
        leftFrames: vision.leftFrames,
        rightFrames: vision.rightFrames,
        sideSwapped: swapped,
        flipVisionModeRequested: vision.requested,
        flipVisionModeApplied: vision.applied,
        flipVisionModeFallback: vision.fallbackReason,
      })

      const callProviderPass = async ({
        secondPass = false,
        allowSkip = true,
      } = {}) => {
        const invokeConsultantOnce = async (consultant, promptOptions) =>
          withRetries(profile.maxRetries, async (attempt) => {
            try {
              return await invokeProvider({
                provider: consultant.provider,
                model: consultant.model,
                flip: providerFlip,
                profile,
                apiKey: consultant.apiKey,
                providerConfig: consultant.providerConfig || providerConfig,
                promptOptions,
              })
            } catch (error) {
              const status = getResponseStatus(error)
              if (status === 429 && attempt < profile.maxRetries) {
                const retryAfterMs =
                  getRetryAfterMs(error) || Math.max(500, 700 * (attempt + 1))
                await sleep(retryAfterMs)
              }
              throw error
            }
          })

        const solveConsultant = async (consultant) => {
          try {
            if (consultant.internalStrategy === LEGACY_HEURISTIC_STRATEGY) {
              const heuristicRawDecision = solveLegacyHeuristicDecision({
                flip: providerFlip,
              })
              const heuristicDecision = remapDecisionIfSwapped(
                heuristicRawDecision,
                swapped
              )

              return {
                provider: consultant.provider,
                model: consultant.model,
                weight: normalizeConsultantWeight(consultant.weight, 1),
                answer: normalizeAnswer(heuristicDecision.answer),
                confidence: normalizeConfidence(heuristicDecision.confidence),
                reasoning: heuristicDecision.reasoning,
                rawAnswerBeforeRemap: normalizeAnswer(
                  heuristicRawDecision.answer
                ),
                finalAnswerAfterRemap: normalizeAnswer(
                  heuristicDecision.answer
                ),
                error: null,
                tokenUsage: createEmptyTokenUsage(),
                frameReasoningUsed: false,
              }
            }

            let decisionResponse
            let combinedTokenUsage = createEmptyTokenUsage()
            let frameReasoningUsed = false

            if (vision.applied === 'frames_two_pass') {
              const frameReasoningResponse = await invokeConsultantOnce(
                consultant,
                {
                  secondPass,
                  forceDecision: false,
                  flipVisionMode: vision.applied,
                  promptPhase: 'frame_reasoning',
                }
              )
              const normalizedFrameReasoning = normalizeProviderResponse(
                frameReasoningResponse
              )
              combinedTokenUsage = addTokenUsage(
                combinedTokenUsage,
                normalizedFrameReasoning.tokenUsage
              )
              frameReasoningUsed = true

              decisionResponse = await invokeConsultantOnce(consultant, {
                secondPass,
                forceDecision: !allowSkip,
                flipVisionMode: vision.applied,
                promptPhase: 'decision_from_frame_reasoning',
                frameReasoning: normalizedFrameReasoning.rawText,
              })
            } else {
              decisionResponse = await invokeConsultantOnce(consultant, {
                secondPass,
                forceDecision: !allowSkip,
                flipVisionMode: vision.applied,
                promptPhase: 'decision',
              })
            }

            const {rawText, tokenUsage} =
              normalizeProviderResponse(decisionResponse)
            combinedTokenUsage = addTokenUsage(combinedTokenUsage, tokenUsage)

            const parsed = extractJsonBlock(rawText)
            const rawDecision = normalizeDecision(parsed)
            const decision = remapDecisionIfSwapped(rawDecision, swapped)

            return {
              provider: consultant.provider,
              model: consultant.model,
              weight: normalizeConsultantWeight(consultant.weight, 1),
              answer: normalizeAnswer(decision.answer),
              confidence: normalizeConfidence(decision.confidence),
              reasoning: decision.reasoning,
              rawAnswerBeforeRemap: normalizeAnswer(rawDecision.answer),
              finalAnswerAfterRemap: normalizeAnswer(decision.answer),
              error: null,
              tokenUsage: combinedTokenUsage,
              frameReasoningUsed,
            }
          } catch (error) {
            const message = createProviderErrorMessage({
              provider: consultant.provider,
              model: consultant.model,
              operation: 'request',
              error,
            })
            return {
              provider: consultant.provider,
              model: consultant.model,
              weight: normalizeConsultantWeight(consultant.weight, 1),
              answer: 'skip',
              confidence: 0,
              reasoning: 'provider error',
              error: message,
              tokenUsage: createEmptyTokenUsage(),
              frameReasoningUsed: false,
            }
          }
        }

        const consultantDecisions = await Promise.all(
          consultProvidersWithKeys.map((consultant) =>
            solveConsultant(consultant)
          )
        )

        const aggregate = aggregateConsultantDecisions(consultantDecisions)
        const consultantTokenUsage = consultantDecisions.reduce(
          (acc, item) => addTokenUsage(acc, item.tokenUsage),
          createEmptyTokenUsage()
        )
        const consultedProviders = consultantDecisions.map(
          ({
            provider: consultProvider,
            model: consultModel,
            weight: itemWeight,
            answer,
            confidence,
            error,
          }) => ({
            provider: consultProvider,
            model: consultModel,
            weight: normalizeConsultantWeight(itemWeight, 1),
            answer,
            confidence,
            error,
          })
        )
        const providerErrors = consultantDecisions
          .filter((item) => item.error)
          .map((item) => item.error)
        const singleConsultantDecision =
          consultantDecisions.length === 1 ? consultantDecisions[0] : null
        const rawAnswerBeforeRemap = singleConsultantDecision
          ? normalizeAnswer(singleConsultantDecision.rawAnswerBeforeRemap)
          : aggregate.answer
        const finalAnswerAfterRemap = singleConsultantDecision
          ? normalizeAnswer(singleConsultantDecision.finalAnswerAfterRemap)
          : aggregate.answer

        return {
          hash: flip.hash,
          answer: aggregate.answer,
          confidence: aggregate.confidence,
          reasoning: aggregate.reasoning,
          rawAnswerBeforeRemap,
          finalAnswerAfterRemap,
          error:
            providerErrors.length > 0
              ? providerErrors.slice(0, 3).join(' | ')
              : null,
          sideSwapped: swapped,
          flipVisionModeRequested: vision.requested,
          flipVisionModeApplied: vision.applied,
          flipVisionModeFallback: vision.fallbackReason,
          tokenUsage: consultantTokenUsage,
          secondPass,
          frameReasoningUsed: consultantDecisions.some(
            (item) => item.frameReasoningUsed
          ),
          consultedProviders,
          ensembleProbabilities: aggregate.probabilities,
          ensembleContributors: aggregate.contributors,
          ensembleTotalWeight: aggregate.totalWeight,
          ensembleConsulted: consultantDecisions.length,
        }
      }

      const allowSkipFirstPass = !(
        profile.forceDecision && !profile.uncertaintyRepromptEnabled
      )
      const firstPassResult = await callProviderPass({
        secondPass: false,
        allowSkip: allowSkipFirstPass,
      })
      let finalResult = firstPassResult
      let mergedTokenUsage = addTokenUsage(
        createEmptyTokenUsage(),
        firstPassResult.tokenUsage
      )

      const shouldReprompt =
        profile.uncertaintyRepromptEnabled &&
        deadlineAt - now() >= profile.uncertaintyRepromptMinRemainingMs &&
        (firstPassResult.answer === 'skip' ||
          firstPassResult.confidence < profile.uncertaintyConfidenceThreshold)

      if (shouldReprompt) {
        const secondPassResult = await callProviderPass({
          secondPass: true,
          allowSkip: false,
        })
        mergedTokenUsage = addTokenUsage(
          mergedTokenUsage,
          secondPassResult.tokenUsage
        )
        finalResult = {
          ...secondPassResult,
          uncertaintyRepromptUsed: true,
          firstPass: {
            answer: firstPassResult.answer,
            confidence: firstPassResult.confidence,
            error: firstPassResult.error,
          },
        }
      }

      if (profile.forceDecision && finalResult.answer === 'skip') {
        const forcedAnswer = chooseDeterministicSide(flip.hash)
        finalResult = {
          ...finalResult,
          answer: forcedAnswer,
          finalAnswerAfterRemap: forcedAnswer,
          forcedDecision: true,
          forcedDecisionReason: finalResult.error
            ? 'provider_error'
            : 'uncertain_or_skip',
          reasoning: finalResult.reasoning
            ? `${finalResult.reasoning}; forced ${forcedAnswer}`
            : `forced ${forcedAnswer}`,
        }
      }

      return {
        ...finalResult,
        latencyMs: now() - flipStartedAt,
        tokenUsage: mergedTokenUsage,
      }
    }

    function toProgressEvent(flip, flipIndex, result) {
      return {
        type: 'flip-result',
        flipIndex,
        hash: flip.hash,
        leftImage: flip.leftImage,
        rightImage: flip.rightImage,
        leftFrames: normalizeImageList(flip.leftFrames).slice(0, 4),
        rightFrames: normalizeImageList(flip.rightFrames).slice(0, 4),
        ...result,
      }
    }

    let results = []
    if (profile.maxConcurrency <= 1) {
      for (let flipIndex = 0; flipIndex < flips.length; flipIndex += 1) {
        // eslint-disable-next-line no-await-in-loop
        const result = await solveSingleFlip(flips[flipIndex], flipIndex)
        results.push(result)
        emitFlipResult(toProgressEvent(flips[flipIndex], flipIndex, result))

        if (interFlipDelayMs > 0 && flipIndex < flips.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(interFlipDelayMs)
        }
      }
    } else {
      results = await mapWithConcurrency(
        flips,
        profile.maxConcurrency,
        async (flip, flipIndex) => {
          const result = await solveSingleFlip(flip, flipIndex)
          emitFlipResult(toProgressEvent(flip, flipIndex, result))
          return result
        }
      )
    }

    const tokenUsageSummary = summarizeTokenUsage(results)
    const reportedProvider = legacyOnlyMode
      ? LEGACY_HEURISTIC_PROVIDER
      : provider
    const reportedModel = legacyOnlyMode ? LEGACY_HEURISTIC_MODEL : model
    const summary = {
      totalFlips: results.length,
      elapsedMs: now() - startedAt,
      skipped: results.filter((x) => x.answer === 'skip').length,
      left: results.filter((x) => x.answer === 'left').length,
      right: results.filter((x) => x.answer === 'right').length,
      consultedProviders: consultProviders.map(
        ({provider: itemProvider, model: itemModel, weight: itemWeight}) => ({
          provider: itemProvider,
          model: itemModel,
          weight: normalizeConsultantWeight(itemWeight, 1),
        })
      ),
      tokens: tokenUsageSummary,
      diagnostics: {
        swapped: results.filter((x) => x.sideSwapped === true).length,
        notSwapped: results.filter((x) => x.sideSwapped !== true).length,
        rawLeft: results.filter((x) => x.rawAnswerBeforeRemap === 'left')
          .length,
        rawRight: results.filter((x) => x.rawAnswerBeforeRemap === 'right')
          .length,
        rawSkip: results.filter((x) => x.rawAnswerBeforeRemap === 'skip')
          .length,
        finalLeft: results.filter((x) => x.finalAnswerAfterRemap === 'left')
          .length,
        finalRight: results.filter((x) => x.finalAnswerAfterRemap === 'right')
          .length,
        finalSkip: results.filter((x) => x.finalAnswerAfterRemap === 'skip')
          .length,
        remappedDecisions: results.filter((x) => {
          if (
            x.rawAnswerBeforeRemap !== 'left' &&
            x.rawAnswerBeforeRemap !== 'right'
          ) {
            return false
          }
          return x.rawAnswerBeforeRemap !== x.finalAnswerAfterRemap
        }).length,
        providerErrors: results.filter((x) => Boolean(x.error)).length,
      },
    }

    await writeBenchmarkLog({
      time: new Date().toISOString(),
      provider: reportedProvider,
      model: reportedModel,
      profile,
      session: payload.session || null,
      summary,
      flips: results.map(
        ({
          hash,
          answer,
          confidence,
          latencyMs,
          error,
          reasoning,
          sideSwapped,
          rawAnswerBeforeRemap,
          finalAnswerAfterRemap,
          tokenUsage,
          uncertaintyRepromptUsed,
          forcedDecision,
          forcedDecisionReason,
          frameReasoningUsed,
          flipVisionModeRequested,
          flipVisionModeApplied,
          flipVisionModeFallback,
          consultedProviders,
          ensembleProbabilities,
          ensembleContributors,
          ensembleTotalWeight,
          ensembleConsulted,
        }) => ({
          hash,
          answer,
          confidence,
          latencyMs,
          error,
          reasoning,
          sideSwapped,
          rawAnswerBeforeRemap,
          finalAnswerAfterRemap,
          tokenUsage,
          uncertaintyRepromptUsed,
          forcedDecision,
          forcedDecisionReason,
          frameReasoningUsed,
          flipVisionModeRequested,
          flipVisionModeApplied,
          flipVisionModeFallback,
          consultedProviders,
          ensembleProbabilities,
          ensembleContributors,
          ensembleTotalWeight,
          ensembleConsulted,
        })
      ),
    })

    return {
      provider: reportedProvider,
      model: reportedModel,
      profile,
      summary,
      results,
    }
  }

  return {
    setProviderKey,
    clearProviderKey,
    hasProviderKey,
    testProvider,
    listModels,
    solveFlipBatch,
  }
}

module.exports = {
  createAiProviderBridge,
  normalizeProvider,
}
