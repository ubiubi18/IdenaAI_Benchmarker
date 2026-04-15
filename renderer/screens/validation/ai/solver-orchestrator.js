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

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
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

async function composeFlipVariant({flip, variant}) {
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

  const frameWidth = 512
  const frameHeight = 384
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

async function composeFlipFrames({flip, variant}) {
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

  const frameWidth = 512
  const frameHeight = 384

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
    flip && flip.decoded && !flip.failed && flip.images && flip.orders
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

  return {
    totalFlips: results.length,
    elapsedMs: Date.now() - startedAt,
    skipped: results.filter(({answer}) => answer === 'skip').length,
    left: results.filter(({answer}) => answer === 'left').length,
    right: results.filter(({answer}) => answer === 'right').length,
    tokens,
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
    },
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
} = {}) {
  const bridge = ensureBridge()

  const profile = normalizeProfile(aiSolver)
  const provider = String(aiSolver.provider || 'openai')
    .trim()
    .toLowerCase()
  const model = aiSolver.model || 'gpt-5.4'
  const providerConfig = buildProviderConfig(aiSolver)
  const consultProviders = buildConsultProviders(aiSolver, providerConfig)

  const candidateFlips = pickCandidateFlips({
    sessionType,
    shortFlips,
    longFlips,
    maxFlips,
  })

  if (!candidateFlips.length) {
    throw new Error('No solvable flips available for AI helper')
  }

  const startedAt = Date.now()
  const buildDeadlineAt = Date.now() + profile.deadlineMs
  const payloadFlips = []
  const useFrameVision =
    profile.flipVisionMode !== 'composite' || provider === 'local-ai'

  for (
    let candidateIndex = 0;
    candidateIndex < candidateFlips.length;
    candidateIndex += 1
  ) {
    if (Date.now() >= buildDeadlineAt) break
    const flip = candidateFlips[candidateIndex]
    const leftImage = await composeFlipVariant({
      flip,
      variant: AnswerType.Left,
    })
    const rightImage = await composeFlipVariant({
      flip,
      variant: AnswerType.Right,
    })
    const leftFrames = useFrameVision
      ? await composeFlipFrames({
          flip,
          variant: AnswerType.Left,
        })
      : []
    const rightFrames = useFrameVision
      ? await composeFlipFrames({
          flip,
          variant: AnswerType.Right,
        })
      : []
    const payload = {
      hash: flip.hash,
      leftImage,
      rightImage,
      leftFrames,
      rightFrames,
    }
    payloadFlips.push(payload)

    if (onProgress) {
      onProgress({
        stage: 'prepared',
        sessionType,
        index: candidateIndex + 1,
        total: candidateFlips.length,
        hash: flip.hash,
        leftImage,
        rightImage,
        leftFrames,
        rightFrames,
      })
    }
  }

  if (!payloadFlips.length) {
    throw new Error('Unable to prepare flip image payload before deadline')
  }

  const results = []

  for (let index = 0; index < payloadFlips.length; index += 1) {
    const payloadFlip = payloadFlips[index]

    if (onProgress) {
      onProgress({
        stage: 'solving',
        sessionType,
        index: index + 1,
        total: payloadFlips.length,
        hash: payloadFlip.hash,
        leftImage: payloadFlip.leftImage,
        rightImage: payloadFlip.rightImage,
        leftFrames: payloadFlip.leftFrames,
        rightFrames: payloadFlip.rightFrames,
      })
    }

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
      deadlineMs: profile.deadlineMs,
      requestTimeoutMs: profile.requestTimeoutMs,
      maxConcurrency: 1,
      maxRetries: profile.maxRetries,
      maxOutputTokens: profile.maxOutputTokens,
      temperature: profile.temperature,
      forceDecision: profile.forceDecision,
      uncertaintyRepromptEnabled: profile.uncertaintyRepromptEnabled,
      uncertaintyConfidenceThreshold: profile.uncertaintyConfidenceThreshold,
      uncertaintyRepromptMinRemainingMs:
        profile.uncertaintyRepromptMinRemainingMs,
      uncertaintyRepromptInstruction: profile.uncertaintyRepromptInstruction,
      promptTemplateOverride: profile.promptTemplateOverride,
      flipVisionMode: profile.flipVisionMode,
      flips: [payloadFlip],
      session: {
        ...(sessionMeta || {}),
        sessionType,
        flipIndex: index + 1,
        totalFlips: payloadFlips.length,
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
      total: payloadFlips.length,
      hash: solved.hash,
      answer: solved.answer,
      option,
      confidence: solved.confidence,
      latencyMs: solved.latencyMs,
      error: solved.error,
      leftImage: payloadFlip.leftImage,
      rightImage: payloadFlip.rightImage,
      leftFrames: payloadFlip.leftFrames,
      rightFrames: payloadFlip.rightFrames,
      rawAnswerBeforeRemap: solved.rawAnswerBeforeRemap,
      finalAnswerAfterRemap: solved.finalAnswerAfterRemap,
      sideSwapped: solved.sideSwapped,
      tokenUsage: normalizeTokenUsage(solved.tokenUsage),
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

    const delayMs = Math.max(0, toNumberOrFallback(profile.interFlipDelayMs, 0))
    if (delayMs > 0 && index < payloadFlips.length - 1) {
      if (onProgress) {
        onProgress({
          stage: 'waiting',
          sessionType,
          index: index + 1,
          total: payloadFlips.length,
          waitMs: delayMs,
        })
      }
      await sleep(delayMs)
    }
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
    }))
    .filter(({option}) => option > 0)

  const summary = summarizeResults(results, startedAt)
  if (onProgress) {
    onProgress({
      stage: 'completed',
      sessionType,
      summary,
      total: payloadFlips.length,
      appliedAnswers: answers.length,
    })
  }

  return {
    provider,
    model,
    profile,
    summary,
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
