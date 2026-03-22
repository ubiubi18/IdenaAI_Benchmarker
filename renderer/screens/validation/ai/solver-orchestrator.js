import {AnswerType} from '../../../shared/types'
import {filterRegularFlips, rearrangeFlips} from '../utils'

const DEFAULT_PROFILE = {
  benchmarkProfile: 'strict',
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 2,
  maxRetries: 1,
  maxOutputTokens: 120,
}

function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return Promise.resolve([])

  const results = new Array(items.length)
  let cursor = 0

  const workers = Array.from(
    {length: Math.max(1, Math.min(limit, items.length))},
    async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await mapper(items[index], index)
      }
    }
  )

  return Promise.all(workers).then(() => results)
}

function toNumberOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
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

function toAnswerOption(answer) {
  const value = String(answer || '')
    .trim()
    .toLowerCase()
  if (value === 'left') return AnswerType.Left
  if (value === 'right') return AnswerType.Right
  return AnswerType.None
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

export async function solveShortSessionWithAi({
  shortFlips = [],
  aiSolver = {},
  sessionMeta = null,
  onProgress,
} = {}) {
  const bridge = ensureBridge()

  const profile = normalizeProfile(aiSolver)
  const provider = aiSolver.provider || 'openai'
  const model = aiSolver.model || 'gpt-4o-mini'

  const candidateFlips = rearrangeFlips(filterRegularFlips(shortFlips))
    .filter(
      ({decoded, images, orders, failed}) =>
        !failed && decoded && images && orders
    )
    .slice(0, 6)

  if (!candidateFlips.length) {
    throw new Error('No solvable short-session flips available for AI helper')
  }

  const buildDeadlineAt = Date.now() + profile.deadlineMs
  const payloadFlips = (
    await mapWithConcurrency(
      candidateFlips,
      profile.maxConcurrency,
      async (flip, index) => {
        if (Date.now() >= buildDeadlineAt) return null

        const leftImage = await composeFlipVariant({
          flip,
          variant: AnswerType.Left,
        })
        const rightImage = await composeFlipVariant({
          flip,
          variant: AnswerType.Right,
        })

        if (onProgress) {
          onProgress({
            stage: 'prepared',
            index: index + 1,
            total: candidateFlips.length,
            hash: flip.hash,
          })
        }

        return {
          hash: flip.hash,
          leftImage,
          rightImage,
        }
      }
    )
  ).filter(Boolean)

  if (!payloadFlips.length) {
    throw new Error('Unable to prepare flip image payload before deadline')
  }

  const result = await bridge.solveFlipBatch({
    provider,
    model,
    flips: payloadFlips,
    session: sessionMeta,
    ...profile,
  })

  const answers = (result.results || [])
    .map((item) => ({
      hash: item.hash,
      option: toAnswerOption(item.answer),
      answer: item.answer,
      confidence: item.confidence,
      latencyMs: item.latencyMs,
      reasoning: item.reasoning,
      error: item.error,
    }))
    .filter(({option}) => option > 0)

  return {
    ...result,
    answers,
  }
}
