import {AnswerType} from '../../../shared/types'
import {filterRegularFlips, rearrangeFlips} from '../utils'

const DEFAULT_PROFILE = {
  benchmarkProfile: 'strict',
  deadlineMs: 60 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 1,
  maxRetries: 1,
  maxOutputTokens: 0,
  interFlipDelayMs: 650,
  temperature: 0,
  forceDecision: true,
  uncertaintyRepromptEnabled: true,
  uncertaintyConfidenceThreshold: 0.45,
  uncertaintyRepromptMinRemainingMs: 3500,
  uncertaintyRepromptInstruction: '',
  promptTemplateOverride: '',
  flipVisionMode: 'composite',
}

const LOCAL_AI_STRICT_PROFILE_OVERRIDES = {
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 15 * 1000,
  interFlipDelayMs: 0,
  flipVisionMode: 'frames_single_pass',
}
const LONG_SESSION_STRICT_PROFILE_OVERRIDES = {
  deadlineMs: 90 * 1000,
  requestTimeoutMs: 15 * 1000,
  interFlipDelayMs: 300,
  flipVisionMode: 'frames_two_pass',
}
const MIN_SOLVE_GUARD_MS = 1500
const IMAGE_PREP_BASE_MS = 2000
const IMAGE_PREP_PER_FLIP_MS = {
  default: 600,
  'local-ai': 1000,
}
const FRAME_REVIEW_PREP_MIN_MS = 900
const MIN_PER_FLIP_SOLVE_BUDGET_MS = 2500
const SHORT_SESSION_OPENAI_FAST_MODELS = ['gpt-5.4-mini', 'gpt-5.4']
const RETRY_BACKOFF_BASE_MS = 700
const EXPECTED_PASS_RUNTIME_MS = {
  default: 4500,
  openai: 3500,
  'local-ai': 7000,
}
const EXPECTED_OPENAI_SHORT_FAST_PASS_MS = 2500

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toNumberOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toFloatOrFallback(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeWeight(value, fallback = 1) {
  const parsed = toFloatOrFallback(value, fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function normalizeVisionMode(value, fallback = 'composite') {
  const mode = String(value || '')
    .trim()
    .toLowerCase()
  if (['composite', 'frames_single_pass', 'frames_two_pass'].includes(mode)) {
    return mode
  }
  return fallback
}

function getBaseSolvePassCount({flipVisionMode = 'composite'} = {}) {
  const normalizedVisionMode = normalizeVisionMode(flipVisionMode)
  return normalizedVisionMode === 'frames_two_pass' ? 2 : 1
}

function getRetryBackoffBudgetMs(maxRetries = 0) {
  const retries = Math.max(0, toNumberOrFallback(maxRetries, 0))
  let totalMs = 0

  for (let retryIndex = 0; retryIndex < retries; retryIndex += 1) {
    totalMs += Math.max(500, RETRY_BACKOFF_BASE_MS * (retryIndex + 1))
  }

  return totalMs
}

function estimateExpectedPassRuntimeMs({
  sessionType = 'short',
  provider = 'openai',
  requestTimeoutMs = DEFAULT_PROFILE.requestTimeoutMs,
  promptOptions = null,
} = {}) {
  const normalizedProvider = String(provider || '')
    .trim()
    .toLowerCase()
  const expectedBaselineMs =
    normalizedProvider === 'openai' &&
    sessionType === 'short' &&
    promptOptions &&
    promptOptions.openAiServiceTier === 'priority' &&
    promptOptions.openAiReasoningEffort === 'none'
      ? EXPECTED_OPENAI_SHORT_FAST_PASS_MS
      : EXPECTED_PASS_RUNTIME_MS[normalizedProvider] ||
        EXPECTED_PASS_RUNTIME_MS.default
  const timeoutMs = toNumberOrFallback(
    requestTimeoutMs,
    DEFAULT_PROFILE.requestTimeoutMs
  )

  return Math.max(
    MIN_PER_FLIP_SOLVE_BUDGET_MS,
    Math.min(timeoutMs, expectedBaselineMs)
  )
}

function estimateRetryReserveMs({
  flipCount = 0,
  maxRetries = 0,
  expectedPassRuntimeMs = MIN_PER_FLIP_SOLVE_BUDGET_MS,
} = {}) {
  const retries = Math.max(0, toNumberOrFallback(maxRetries, 0))
  if (retries < 1 || flipCount < 1) {
    return 0
  }

  return (
    Math.min(flipCount, retries) * Math.max(1000, expectedPassRuntimeMs * 0.5) +
    getRetryBackoffBudgetMs(retries)
  )
}

function estimateUncertaintyReviewFlipCount({
  sessionType = 'short',
  flipCount = 0,
  uncertaintyRepromptEnabled = false,
} = {}) {
  if (!uncertaintyRepromptEnabled || flipCount < 1) {
    return 0
  }

  if (sessionType === 'short') {
    return Math.min(flipCount, Math.max(1, Math.ceil(flipCount / 4)))
  }

  return Math.min(flipCount, Math.max(1, Math.ceil(flipCount / 3)))
}

function estimatePerFlipSolveRuntimeMs({
  sessionType = 'short',
  provider = 'openai',
  profile = {},
  promptOptions = null,
} = {}) {
  const solvePassCount = getBaseSolvePassCount({
    flipVisionMode: profile.flipVisionMode,
  })
  const expectedPassRuntimeMs = estimateExpectedPassRuntimeMs({
    sessionType,
    provider,
    requestTimeoutMs: profile.requestTimeoutMs,
    promptOptions,
  })

  return Math.max(
    MIN_PER_FLIP_SOLVE_BUDGET_MS,
    expectedPassRuntimeMs * solvePassCount +
      Math.max(0, toNumberOrFallback(profile.interFlipDelayMs, 0))
  )
}

function normalizeProfile(input = {}) {
  if (input.benchmarkProfile !== 'custom') {
    return {...DEFAULT_PROFILE}
  }

  return {
    benchmarkProfile: 'custom',
    deadlineMs: toNumberOrFallback(
      input.deadlineMs,
      DEFAULT_PROFILE.deadlineMs
    ),
    requestTimeoutMs: toNumberOrFallback(
      input.requestTimeoutMs,
      DEFAULT_PROFILE.requestTimeoutMs
    ),
    maxConcurrency: toNumberOrFallback(
      input.maxConcurrency,
      DEFAULT_PROFILE.maxConcurrency
    ),
    maxRetries: toNumberOrFallback(
      input.maxRetries,
      DEFAULT_PROFILE.maxRetries
    ),
    maxOutputTokens: toNumberOrFallback(
      input.maxOutputTokens,
      DEFAULT_PROFILE.maxOutputTokens
    ),
    interFlipDelayMs: toNumberOrFallback(
      input.interFlipDelayMs,
      DEFAULT_PROFILE.interFlipDelayMs
    ),
    temperature: toFloatOrFallback(
      input.temperature,
      DEFAULT_PROFILE.temperature
    ),
    forceDecision:
      input.forceDecision == null
        ? DEFAULT_PROFILE.forceDecision
        : Boolean(input.forceDecision),
    uncertaintyRepromptEnabled:
      input.uncertaintyRepromptEnabled == null
        ? DEFAULT_PROFILE.uncertaintyRepromptEnabled
        : Boolean(input.uncertaintyRepromptEnabled),
    uncertaintyConfidenceThreshold: toFloatOrFallback(
      input.uncertaintyConfidenceThreshold,
      DEFAULT_PROFILE.uncertaintyConfidenceThreshold
    ),
    uncertaintyRepromptMinRemainingMs: toNumberOrFallback(
      input.uncertaintyRepromptMinRemainingMs,
      DEFAULT_PROFILE.uncertaintyRepromptMinRemainingMs
    ),
    uncertaintyRepromptInstruction:
      typeof input.uncertaintyRepromptInstruction === 'string'
        ? input.uncertaintyRepromptInstruction
        : '',
    promptTemplateOverride:
      typeof input.promptTemplateOverride === 'string'
        ? input.promptTemplateOverride
        : '',
    flipVisionMode: normalizeVisionMode(
      input.flipVisionMode,
      DEFAULT_PROFILE.flipVisionMode
    ),
  }
}

function buildEffectiveProfile(profile, provider, sessionType = 'short') {
  let nextProfile = profile

  if (profile.benchmarkProfile !== 'custom' && sessionType === 'long') {
    nextProfile = {
      ...nextProfile,
      deadlineMs: LONG_SESSION_STRICT_PROFILE_OVERRIDES.deadlineMs,
      requestTimeoutMs: LONG_SESSION_STRICT_PROFILE_OVERRIDES.requestTimeoutMs,
      interFlipDelayMs: LONG_SESSION_STRICT_PROFILE_OVERRIDES.interFlipDelayMs,
      flipVisionMode:
        nextProfile.flipVisionMode === 'composite'
          ? LONG_SESSION_STRICT_PROFILE_OVERRIDES.flipVisionMode
          : nextProfile.flipVisionMode,
    }
  }

  if (
    String(provider || '')
      .trim()
      .toLowerCase() !== 'local-ai' ||
    nextProfile.benchmarkProfile === 'custom'
  ) {
    return nextProfile
  }

  return {
    ...nextProfile,
    deadlineMs: LOCAL_AI_STRICT_PROFILE_OVERRIDES.deadlineMs,
    requestTimeoutMs: LOCAL_AI_STRICT_PROFILE_OVERRIDES.requestTimeoutMs,
    interFlipDelayMs: LOCAL_AI_STRICT_PROFILE_OVERRIDES.interFlipDelayMs,
    flipVisionMode:
      nextProfile.flipVisionMode === 'composite'
        ? LOCAL_AI_STRICT_PROFILE_OVERRIDES.flipVisionMode
        : nextProfile.flipVisionMode,
  }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      reject(
        new Error(
          `Unable to load validation flip image${source ? ` (${source})` : ''}`
        )
      )
    }
    image.src = source
  })
}

function drawContain(context, image, target) {
  const sourceWidth = image.naturalWidth || image.width || target.width
  const sourceHeight = image.naturalHeight || image.height || target.height
  const ratio = Math.min(
    target.width / sourceWidth,
    target.height / sourceHeight
  )
  const drawWidth = sourceWidth * ratio
  const drawHeight = sourceHeight * ratio
  const offsetX = target.x + (target.width - drawWidth) / 2
  const offsetY = target.y + (target.height - drawHeight) / 2

  context.fillStyle = '#000000'
  context.fillRect(target.x, target.y, target.width, target.height)
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

async function composeFlipVariant({
  flip,
  variant,
  frameWidth = 512,
  frameHeight = 384,
}) {
  const imageOrder = Array.isArray(flip.orders?.[variant - 1])
    ? flip.orders[variant - 1]
    : []

  const orderedSources = (
    imageOrder.length
      ? imageOrder.map((index) => flip.images?.[index])
      : flip.images || []
  ).filter(Boolean)

  if (!orderedSources.length) {
    throw new Error(`Flip ${flip.hash} has no decoded images`)
  }

  const loadedImages = await Promise.all(
    orderedSources.map((source) => loadImage(source))
  )

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight * loadedImages.length

  const context = canvas.getContext('2d')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, canvas.width, canvas.height)

  loadedImages.forEach((image, index) => {
    drawContain(context, image, {
      x: 0,
      y: frameHeight * index,
      width: frameWidth,
      height: frameHeight,
    })
  })

  return canvas.toDataURL('image/png')
}

async function composeFlipFrames({
  flip,
  variant,
  frameWidth = 512,
  frameHeight = 384,
}) {
  const imageOrder = Array.isArray(flip.orders?.[variant - 1])
    ? flip.orders[variant - 1]
    : []

  const orderedSources = (
    imageOrder.length
      ? imageOrder.map((index) => flip.images?.[index])
      : flip.images || []
  ).filter(Boolean)

  if (!orderedSources.length) {
    throw new Error(`Flip ${flip.hash} has no decoded images`)
  }

  const loadedImages = await Promise.all(
    orderedSources.map((source) => loadImage(source))
  )

  return loadedImages.map((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = frameWidth
    canvas.height = frameHeight

    const context = canvas.getContext('2d')
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)

    drawContain(context, image, {
      x: 0,
      y: 0,
      width: frameWidth,
      height: frameHeight,
    })

    return canvas.toDataURL('image/png')
  })
}

function toAnswerOption(answer) {
  const value = String(answer || '')
    .trim()
    .toLowerCase()
  if (value === 'left') return AnswerType.Left
  if (value === 'right') return AnswerType.Right
  return AnswerType.None
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

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens:
      Number.isFinite(totalTokens) && totalTokens >= 0
        ? totalTokens
        : normalizedPrompt + normalizedCompletion,
  }
}

function normalizeCostSummary(costs = {}) {
  const estimatedUsd = Number(costs.estimatedUsd)
  const actualUsd = Number(costs.actualUsd)

  return {
    estimatedUsd:
      Number.isFinite(estimatedUsd) && estimatedUsd >= 0 ? estimatedUsd : null,
    actualUsd: Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : null,
  }
}

function summarizeFastMode(results = []) {
  const entries = results
    .map((item) => (item && item.fastMode ? item.fastMode : null))
    .filter((item) => item && item.requested)

  if (!entries.length) {
    return null
  }

  return {
    requested: true,
    requestedServiceTier:
      entries.find((item) => item.requestedServiceTier)?.requestedServiceTier ||
      null,
    requestedReasoningEffort:
      entries.find((item) => item.requestedReasoningEffort)
        ?.requestedReasoningEffort || null,
    appliedServiceTiers: Array.from(
      new Set(entries.map((item) => item.appliedServiceTier).filter(Boolean))
    ),
    compatibilityFallbackUsed: entries.some(
      (item) => item.compatibilityFallbackUsed
    ),
    missingRequestedParameters: Array.from(
      new Set(
        entries.flatMap((item) =>
          Array.isArray(item.missingRequestedParameters)
            ? item.missingRequestedParameters
            : []
        )
      )
    ),
    priorityDowngraded: entries.some((item) => item.priorityDowngraded),
    affectedFlips: entries.filter(
      (item) => item.compatibilityFallbackUsed || item.priorityDowngraded
    ).length,
  }
}

function ensureBridge() {
  if (
    !global.aiSolver ||
    typeof global.aiSolver.solveFlipBatch !== 'function'
  ) {
    throw new Error('AI solver bridge is not available in this build')
  }
  return global.aiSolver
}

function buildProviderConfig(aiSolver = {}) {
  const provider = String(aiSolver.provider || '')
    .trim()
    .toLowerCase()
  if (provider !== 'openai-compatible') {
    return null
  }

  return {
    name: aiSolver.customProviderName,
    baseUrl: aiSolver.customProviderBaseUrl,
    chatPath: aiSolver.customProviderChatPath,
  }
}

function normalizeConsultProvider(value) {
  const provider = String(value || '')
    .trim()
    .toLowerCase()
  if (
    [
      'openai',
      'openai-compatible',
      'gemini',
      'anthropic',
      'xai',
      'mistral',
      'groq',
      'deepseek',
      'openrouter',
    ].includes(provider)
  ) {
    return provider
  }
  return null
}

function buildConsultProviders(aiSolver = {}, providerConfig = null) {
  if (!aiSolver.ensembleEnabled) {
    return []
  }

  const consultSlots = [
    {
      enabled: aiSolver.ensembleProvider2Enabled,
      provider: aiSolver.ensembleProvider2,
      model: aiSolver.ensembleModel2,
      weight: aiSolver.ensembleProvider2Weight,
      source: 'ensemble-slot-2',
    },
    {
      enabled: aiSolver.ensembleProvider3Enabled,
      provider: aiSolver.ensembleProvider3,
      model: aiSolver.ensembleModel3,
      weight: aiSolver.ensembleProvider3Weight,
      source: 'ensemble-slot-3',
    },
  ]

  return consultSlots
    .filter((slot) => slot.enabled)
    .map((slot) => {
      const provider = normalizeConsultProvider(slot.provider)
      const model = String(slot.model || '').trim()
      if (!provider || !model) {
        return null
      }

      return {
        provider,
        model,
        weight: normalizeWeight(slot.weight, 1),
        source: slot.source,
        providerConfig:
          provider === 'openai-compatible' ? {...(providerConfig || {})} : null,
      }
    })
    .filter(Boolean)
    .slice(0, 2)
}

function isSolvableFlip(flip) {
  return Boolean(
    flip &&
      flip.decoded &&
      !flip.failed &&
      !(Number(flip.option) > 0) &&
      flip.images &&
      flip.orders
  )
}

function pickCandidateFlips({
  sessionType,
  shortFlips = [],
  longFlips = [],
  maxFlips,
}) {
  if (sessionType === 'long') {
    const list = rearrangeFlips(
      Array.isArray(longFlips) ? longFlips : []
    ).filter(isSolvableFlip)
    const safeMaxLong = Number.isFinite(maxFlips) ? maxFlips : list.length
    return list.slice(0, Math.max(1, safeMaxLong))
  }

  const shortList = rearrangeFlips(filterRegularFlips(shortFlips))
    .filter(isSolvableFlip)
    .slice(0, 6)
  const safeMax = Number.isFinite(maxFlips) ? maxFlips : shortList.length
  return shortList.slice(0, Math.max(1, safeMax))
}

function summarizeResults(results, startedAt) {
  const tokens = results.reduce(
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

  const costs = results.reduce(
    (acc, item) => {
      const nextCosts = normalizeCostSummary(item && item.costs)

      return {
        estimatedUsd:
          acc.estimatedUsd +
          (Number.isFinite(nextCosts.estimatedUsd)
            ? nextCosts.estimatedUsd
            : 0),
        actualUsd:
          acc.actualUsd +
          (Number.isFinite(nextCosts.actualUsd) ? nextCosts.actualUsd : 0),
        pricedResults:
          acc.pricedResults +
          (Number.isFinite(nextCosts.estimatedUsd) ||
          Number.isFinite(nextCosts.actualUsd)
            ? 1
            : 0),
      }
    },
    {
      estimatedUsd: 0,
      actualUsd: 0,
      pricedResults: 0,
    }
  )

  return {
    totalFlips: results.length,
    elapsedMs: Date.now() - startedAt,
    skipped: results.filter(({answer}) => answer === 'skip').length,
    left: results.filter(({answer}) => answer === 'left').length,
    right: results.filter(({answer}) => answer === 'right').length,
    tokens,
    costs: {
      estimatedUsd: costs.pricedResults > 0 ? costs.estimatedUsd : null,
      actualUsd: costs.pricedResults > 0 ? costs.actualUsd : null,
      pricedResults: costs.pricedResults,
    },
    diagnostics: {
      swapped: results.filter(({sideSwapped}) => sideSwapped === true).length,
      notSwapped: results.filter(({sideSwapped}) => sideSwapped !== true)
        .length,
      rawLeft: results.filter(
        ({rawAnswerBeforeRemap}) => rawAnswerBeforeRemap === 'left'
      ).length,
      rawRight: results.filter(
        ({rawAnswerBeforeRemap}) => rawAnswerBeforeRemap === 'right'
      ).length,
      rawSkip: results.filter(
        ({rawAnswerBeforeRemap}) => rawAnswerBeforeRemap === 'skip'
      ).length,
      finalLeft: results.filter(
        ({finalAnswerAfterRemap}) => finalAnswerAfterRemap === 'left'
      ).length,
      finalRight: results.filter(
        ({finalAnswerAfterRemap}) => finalAnswerAfterRemap === 'right'
      ).length,
      finalSkip: results.filter(
        ({finalAnswerAfterRemap}) => finalAnswerAfterRemap === 'skip'
      ).length,
      remappedDecisions: results.filter((item) => {
        if (
          item.rawAnswerBeforeRemap !== 'left' &&
          item.rawAnswerBeforeRemap !== 'right'
        ) {
          return false
        }
        return item.rawAnswerBeforeRemap !== item.finalAnswerAfterRemap
      }).length,
      providerErrors: results.filter((item) => Boolean(item.error)).length,
      uncertaintyReprompts: results.filter(
        (item) => item && item.uncertaintyRepromptUsed
      ).length,
      forcedDecisions: results.filter((item) => item && item.forcedDecision)
        .length,
      randomForcedDecisions: results.filter(
        (item) =>
          item && item.forcedDecision && item.forcedDecisionPolicy === 'random'
      ).length,
      ensembleTieBreaks: results.filter(
        (item) => item && item.ensembleTieBreakApplied
      ).length,
      annotatedFrameReviews: results.filter(
        (item) => item && item.secondPassStrategy === 'annotated_frame_review'
      ).length,
    },
  }
}

function normalizeDeadlineAt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getTimeRemainingMs(deadlineAt) {
  if (!Number.isFinite(deadlineAt)) {
    return Infinity
  }

  return deadlineAt - Date.now()
}

function createSessionWindowError() {
  const error = new Error('Not enough time left in session for AI solve')
  error.code = 'session_window_too_small'
  return error
}

function resolveShortSessionOpenAiFastMode({
  sessionType,
  aiSolver = {},
  provider,
  model,
}) {
  if (
    sessionType !== 'short' ||
    provider !== 'openai' ||
    aiSolver.shortSessionOpenAiFastEnabled !== true
  ) {
    return {
      model,
      promptOptions: null,
    }
  }

  const requestedModel = String(aiSolver.shortSessionOpenAiFastModel || '')
    .trim()
    .toLowerCase()
  const fastModel = SHORT_SESSION_OPENAI_FAST_MODELS.includes(requestedModel)
    ? requestedModel
    : 'gpt-5.4-mini'

  return {
    model: fastModel,
    promptOptions: {
      openAiServiceTier: 'priority',
      openAiReasoningEffort: 'none',
    },
  }
}

function ensureRuntimeRemaining(deadlineAt, minimumMs = 0) {
  if (!Number.isFinite(deadlineAt)) {
    return
  }

  if (Date.now() + Math.max(0, minimumMs) > deadlineAt) {
    throw createSessionWindowError()
  }
}

export function planValidationAiSolve({
  sessionType = 'short',
  shortFlips = [],
  longFlips = [],
  aiSolver = {},
  maxFlips,
} = {}) {
  const profile = normalizeProfile(aiSolver)
  const provider = String(aiSolver.provider || 'openai')
    .trim()
    .toLowerCase()
  const effectiveProfile = buildEffectiveProfile(profile, provider, sessionType)
  const defaultModel = String(aiSolver.model || 'gpt-5.4').trim() || 'gpt-5.4'
  const shortSessionOpenAiFastMode = resolveShortSessionOpenAiFastMode({
    sessionType,
    aiSolver,
    provider,
    model: defaultModel,
  })
  const {model, promptOptions} = shortSessionOpenAiFastMode
  const providerConfig = buildProviderConfig(aiSolver)
  const consultProviders = buildConsultProviders(aiSolver, providerConfig)
  const candidateFlips = pickCandidateFlips({
    sessionType,
    shortFlips,
    longFlips,
    maxFlips,
  })

  return {
    sessionType,
    profile,
    provider,
    effectiveProfile,
    model,
    providerConfig,
    consultProviders,
    promptOptions,
    candidateFlips,
  }
}

export function estimateValidationAiSolveBudget(options = {}) {
  const solvePlan = planValidationAiSolve(options)
  const {
    provider,
    effectiveProfile,
    candidateFlips,
    promptOptions,
    sessionType,
  } = solvePlan
  const shouldPrepareFramePayloads =
    effectiveProfile.flipVisionMode !== 'composite' ||
    provider === 'local-ai' ||
    effectiveProfile.uncertaintyRepromptEnabled
  const prepPerFlipMs = shouldPrepareFramePayloads
    ? Math.max(
        FRAME_REVIEW_PREP_MIN_MS,
        IMAGE_PREP_PER_FLIP_MS[provider] || IMAGE_PREP_PER_FLIP_MS.default
      )
    : IMAGE_PREP_PER_FLIP_MS[provider] || IMAGE_PREP_PER_FLIP_MS.default
  const perFlipSolveMs = estimatePerFlipSolveRuntimeMs({
    sessionType,
    provider,
    profile: effectiveProfile,
    promptOptions,
  })
  const uncertaintyReviewFlipCount = estimateUncertaintyReviewFlipCount({
    sessionType,
    flipCount: candidateFlips.length,
    uncertaintyRepromptEnabled: effectiveProfile.uncertaintyRepromptEnabled,
  })
  const expectedPassRuntimeMs = estimateExpectedPassRuntimeMs({
    sessionType,
    provider,
    requestTimeoutMs: effectiveProfile.requestTimeoutMs,
    promptOptions,
  })
  const uncertaintyReviewReserveMs =
    uncertaintyReviewFlipCount > 0
      ? uncertaintyReviewFlipCount * (prepPerFlipMs + expectedPassRuntimeMs * 2)
      : 0
  const retryReserveMs = estimateRetryReserveMs({
    flipCount: candidateFlips.length,
    maxRetries: effectiveProfile.maxRetries,
    expectedPassRuntimeMs,
  })

  return {
    ...solvePlan,
    flipCount: candidateFlips.length,
    prepPerFlipMs,
    perFlipSolveMs,
    uncertaintyReviewFlipCount,
    uncertaintyReviewReserveMs,
    retryReserveMs,
    estimatedMs:
      IMAGE_PREP_BASE_MS +
      candidateFlips.length * (prepPerFlipMs + perFlipSolveMs) +
      uncertaintyReviewReserveMs +
      retryReserveMs,
  }
}

export async function solveValidationSessionWithAi({
  sessionType = 'short',
  shortFlips = [],
  longFlips = [],
  aiSolver = {},
  sessionMeta = null,
  onProgress,
  onDecision,
  maxFlips,
  hardDeadlineAt = null,
} = {}) {
  const bridge = ensureBridge()
  const {
    profile,
    provider,
    effectiveProfile,
    model,
    providerConfig,
    consultProviders,
    promptOptions,
    candidateFlips,
  } = planValidationAiSolve({
    sessionType,
    shortFlips,
    longFlips,
    aiSolver,
    maxFlips,
  })

  if (!candidateFlips.length) {
    throw new Error('No solvable flips available for AI helper')
  }

  const startedAt = Date.now()
  const sessionDeadlineAt = normalizeDeadlineAt(hardDeadlineAt)
  ensureRuntimeRemaining(sessionDeadlineAt, MIN_SOLVE_GUARD_MS)
  const buildDeadlineAt = Number.isFinite(sessionDeadlineAt)
    ? Math.min(
        sessionDeadlineAt,
        Date.now() + Math.max(effectiveProfile.deadlineMs, 15 * 1000)
      )
    : Date.now() + Math.max(effectiveProfile.deadlineMs, 15 * 1000)
  const useFrameVision =
    effectiveProfile.flipVisionMode !== 'composite' || provider === 'local-ai'
  const prepareFramePayloads =
    useFrameVision || effectiveProfile.uncertaintyRepromptEnabled
  const frameRenderSize =
    provider === 'local-ai'
      ? {frameWidth: 384, frameHeight: 288}
      : {frameWidth: 512, frameHeight: 384}

  const results = []
  const totalFlips = candidateFlips.length

  for (let index = 0; index < candidateFlips.length; index += 1) {
    ensureRuntimeRemaining(sessionDeadlineAt, MIN_SOLVE_GUARD_MS)
    if (Date.now() >= buildDeadlineAt) break
    const flip = candidateFlips[index]
    const leftImage =
      effectiveProfile.flipVisionMode === 'composite'
        ? await composeFlipVariant({
            flip,
            variant: AnswerType.Left,
            ...frameRenderSize,
          })
        : null
    const rightImage =
      effectiveProfile.flipVisionMode === 'composite'
        ? await composeFlipVariant({
            flip,
            variant: AnswerType.Right,
            ...frameRenderSize,
          })
        : null
    const leftFrames = prepareFramePayloads
      ? await composeFlipFrames({
          flip,
          variant: AnswerType.Left,
          ...frameRenderSize,
        })
      : []
    const rightFrames = prepareFramePayloads
      ? await composeFlipFrames({
          flip,
          variant: AnswerType.Right,
          ...frameRenderSize,
        })
      : []
    const payloadFlip = {
      hash: flip.hash,
      leftImage,
      rightImage,
      leftFrames,
      rightFrames,
    }

    if (onProgress) {
      onProgress({
        stage: 'prepared',
        sessionType,
        index: index + 1,
        total: totalFlips,
        hash: flip.hash,
        leftImage,
        rightImage,
        leftFrames,
        rightFrames,
      })
    }

    ensureRuntimeRemaining(
      sessionDeadlineAt,
      Math.max(MIN_SOLVE_GUARD_MS, effectiveProfile.requestTimeoutMs)
    )

    if (onProgress) {
      onProgress({
        stage: 'solving',
        sessionType,
        index: index + 1,
        total: totalFlips,
        hash: payloadFlip.hash,
        leftImage: payloadFlip.leftImage,
        rightImage: payloadFlip.rightImage,
        leftFrames: payloadFlip.leftFrames,
        rightFrames: payloadFlip.rightFrames,
      })
    }

    const remainingSessionMs = getTimeRemainingMs(sessionDeadlineAt)
    const batchResult = await bridge.solveFlipBatch({
      provider,
      model,
      providerConfig,
      ensembleEnabled: Boolean(aiSolver.ensembleEnabled),
      ensemblePrimaryWeight: normalizeWeight(aiSolver.ensemblePrimaryWeight, 1),
      legacyHeuristicEnabled: Boolean(aiSolver.legacyHeuristicEnabled),
      legacyHeuristicWeight: normalizeWeight(aiSolver.legacyHeuristicWeight, 1),
      legacyHeuristicOnly: Boolean(aiSolver.legacyHeuristicOnly),
      consultProviders,
      benchmarkProfile: profile.benchmarkProfile,
      deadlineMs: Number.isFinite(remainingSessionMs)
        ? Math.max(
            1000,
            Math.min(effectiveProfile.deadlineMs, remainingSessionMs)
          )
        : effectiveProfile.deadlineMs,
      requestTimeoutMs: effectiveProfile.requestTimeoutMs,
      maxConcurrency: 1,
      maxRetries: effectiveProfile.maxRetries,
      maxOutputTokens: effectiveProfile.maxOutputTokens,
      temperature: effectiveProfile.temperature,
      forceDecision: effectiveProfile.forceDecision,
      uncertaintyRepromptEnabled: effectiveProfile.uncertaintyRepromptEnabled,
      uncertaintyConfidenceThreshold:
        effectiveProfile.uncertaintyConfidenceThreshold,
      uncertaintyRepromptMinRemainingMs:
        effectiveProfile.uncertaintyRepromptMinRemainingMs,
      uncertaintyRepromptInstruction:
        effectiveProfile.uncertaintyRepromptInstruction,
      promptTemplateOverride: effectiveProfile.promptTemplateOverride,
      flipVisionMode: effectiveProfile.flipVisionMode,
      promptOptions,
      flips: [payloadFlip],
      session: {
        ...(sessionMeta || {}),
        sessionType,
        flipIndex: index + 1,
        totalFlips,
      },
    })

    const solved = (batchResult.results || [])[0] || {
      hash: payloadFlip.hash,
      answer: 'skip',
      confidence: 0,
      latencyMs: 0,
      error: 'no_result',
      reasoning: 'provider returned no result',
      rawAnswerBeforeRemap: 'skip',
      finalAnswerAfterRemap: 'skip',
      sideSwapped: false,
    }

    results.push(solved)

    const option = toAnswerOption(solved.answer)
    const decision = {
      sessionType,
      index: index + 1,
      total: totalFlips,
      hash: solved.hash,
      answer: solved.answer,
      option,
      confidence: solved.confidence,
      latencyMs: solved.latencyMs,
      error: solved.error,
      fastMode: solved.fastMode || null,
      leftImage: payloadFlip.leftImage,
      rightImage: payloadFlip.rightImage,
      leftFrames: payloadFlip.leftFrames,
      rightFrames: payloadFlip.rightFrames,
      rawAnswerBeforeRemap: solved.rawAnswerBeforeRemap,
      finalAnswerAfterRemap: solved.finalAnswerAfterRemap,
      sideSwapped: solved.sideSwapped,
      tokenUsage: normalizeTokenUsage(solved.tokenUsage),
      costs: normalizeCostSummary(solved.costs),
      reasoning: solved.reasoning,
      uncertaintyRepromptUsed: Boolean(solved.uncertaintyRepromptUsed),
      forcedDecision: Boolean(solved.forcedDecision),
      forcedDecisionPolicy: solved.forcedDecisionPolicy || null,
      forcedDecisionReason: solved.forcedDecisionReason || null,
      ensembleTieBreakApplied: Boolean(solved.ensembleTieBreakApplied),
      ensembleTieBreakCandidates: Array.isArray(
        solved.ensembleTieBreakCandidates
      )
        ? solved.ensembleTieBreakCandidates
        : null,
      secondPassStrategy: solved.secondPassStrategy || null,
      frameReasoningUsed: Boolean(solved.frameReasoningUsed),
      firstPass: solved.firstPass || null,
    }

    if (onProgress) {
      onProgress({
        stage: 'solved',
        ...decision,
      })
    }

    if (onDecision) {
      await onDecision(decision)
    }

    const delayMs = Math.max(
      0,
      toNumberOrFallback(effectiveProfile.interFlipDelayMs, 0)
    )
    if (delayMs > 0 && index < totalFlips - 1) {
      const remainingBeforeDelayMs = getTimeRemainingMs(sessionDeadlineAt)
      const waitMs = Number.isFinite(remainingBeforeDelayMs)
        ? Math.min(
            delayMs,
            Math.max(0, remainingBeforeDelayMs - MIN_SOLVE_GUARD_MS)
          )
        : delayMs
      if (onProgress) {
        onProgress({
          stage: 'waiting',
          sessionType,
          index: index + 1,
          total: totalFlips,
          waitMs,
        })
      }
      if (waitMs > 0) {
        await sleep(waitMs)
      }
    }
  }

  if (!results.length) {
    throw new Error('Unable to prepare flip image payload before deadline')
  }

  const answers = results
    .map((item) => ({
      hash: item.hash,
      option: toAnswerOption(item.answer),
      answer: item.answer,
      confidence: item.confidence,
      latencyMs: item.latencyMs,
      reasoning: item.reasoning,
      error: item.error,
      tokenUsage: normalizeTokenUsage(item.tokenUsage),
      costs: normalizeCostSummary(item.costs),
    }))
    .filter(({option}) => option > 0)

  const summary = summarizeResults(results, startedAt)
  const fastMode = summarizeFastMode(results)
  if (onProgress) {
    onProgress({
      stage: 'completed',
      sessionType,
      summary,
      total: results.length,
      appliedAnswers: answers.length,
    })
  }

  return {
    provider,
    model,
    profile: effectiveProfile,
    summary,
    fastMode,
    results,
    answers,
  }
}

export async function solveShortSessionWithAi({
  shortFlips = [],
  aiSolver = {},
  sessionMeta = null,
  onProgress,
  onDecision,
} = {}) {
  return solveValidationSessionWithAi({
    sessionType: 'short',
    shortFlips,
    aiSolver,
    sessionMeta,
    onProgress,
    onDecision,
    maxFlips: 6,
  })
}
