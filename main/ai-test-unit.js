const fs = require('fs-extra')
const path = require('path')

const DEFAULT_BATCH_SIZE = 20
const MAX_BATCH_SIZE = 100
const MAX_RUN_FLIPS = 2000
const MAX_QUEUED_FLIPS = 500
// Keep below sizes that previously caused JSON parse/runtime failures on macOS.
const MAX_QUEUE_FILE_BYTES = 400 * 1024 * 1024
let appDataPath = null

try {
  // eslint-disable-next-line global-require
  appDataPath = require('./app-data-path')
} catch (error) {
  appDataPath = null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function ensureDataUrl(value, name) {
  const result = String(value || '').trim()
  if (!result) {
    throw new Error(`${name} is required`)
  }
  if (!result.startsWith('data:')) {
    throw new Error(`${name} must be a data URL`)
  }
  return result
}

function normalizeExpectedAnswer(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()

  if (!raw) {
    return null
  }
  if (raw === 'left' || raw === 'l') {
    return 'left'
  }
  if (raw === 'right' || raw === 'r') {
    return 'right'
  }
  if (raw === 'skip' || raw === 'report' || raw === 'inappropriate') {
    return 'skip'
  }
  return null
}

function normalizeAiAnswer(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()

  if (raw === 'left' || raw === 'l') {
    return 'left'
  }
  if (raw === 'right' || raw === 'r') {
    return 'right'
  }
  return 'skip'
}

function sanitizeFlip(flip, index) {
  const hash = String(
    flip && flip.hash ? flip.hash : `local-test-flip-${Date.now()}-${index}`
  ).trim()

  if (!hash) {
    throw new Error('Flip hash is required')
  }

  const expectedAnswer = normalizeExpectedAnswer(flip && flip.expectedAnswer)
  const leftFrames = Array.isArray(flip && flip.leftFrames)
    ? flip.leftFrames
        .slice(0, 4)
        .map((frame, frameIndex) =>
          ensureDataUrl(frame, `leftFrames[${frameIndex}]`)
        )
    : []
  const rightFrames = Array.isArray(flip && flip.rightFrames)
    ? flip.rightFrames
        .slice(0, 4)
        .map((frame, frameIndex) =>
          ensureDataUrl(frame, `rightFrames[${frameIndex}]`)
        )
    : []
  const result = {
    hash,
    leftImage: ensureDataUrl(flip && flip.leftImage, 'leftImage'),
    rightImage: ensureDataUrl(flip && flip.rightImage, 'rightImage'),
    expectedAnswer,
  }

  if (leftFrames.length && rightFrames.length) {
    result.leftFrames = leftFrames
    result.rightFrames = rightFrames
  }

  return result
}

function sanitizeFlips(flips) {
  const list = Array.isArray(flips) ? flips : []
  if (!list.length) {
    throw new Error('No flips provided')
  }
  return list.map((flip, index) => sanitizeFlip(flip, index))
}

function createAiTestUnitBridge({logger, aiProviderBridge, dependencies = {}}) {
  function resolveUserDataPath() {
    if (!appDataPath) {
      throw new Error('app-data-path is unavailable in this environment')
    }
    return appDataPath('userData')
  }

  const getUserDataPath =
    typeof dependencies.getUserDataPath === 'function'
      ? dependencies.getUserDataPath
      : resolveUserDataPath

  const now =
    typeof dependencies.now === 'function' ? dependencies.now : () => Date.now()

  const maxQueuedFlips = clamp(
    toInt(dependencies.maxQueuedFlips, MAX_QUEUED_FLIPS),
    1,
    5000
  )
  const maxQueueFileBytes = Math.max(
    1024 * 1024,
    toInt(dependencies.maxQueueFileBytes, MAX_QUEUE_FILE_BYTES)
  )

  function benchmarkDir() {
    return path.join(getUserDataPath(), 'ai-benchmark')
  }

  function queuePath() {
    return path.join(benchmarkDir(), 'test-unit-flips.json')
  }

  function runLogPath() {
    return path.join(benchmarkDir(), 'test-unit-runs.jsonl')
  }

  async function loadQueue() {
    try {
      const file = queuePath()
      if (!(await fs.pathExists(file))) {
        return []
      }

      const stats = await fs.stat(file)
      if (stats.size > maxQueueFileBytes) {
        const rotatedPath = `${file}.oversize-${Date.now()}`
        logger.error('AI test unit queue file is too large, rotating file', {
          file,
          bytes: stats.size,
          maxBytes: maxQueueFileBytes,
          rotatedPath,
        })

        try {
          await fs.move(file, rotatedPath, {overwrite: true})
        } catch (moveError) {
          logger.error('Unable to rotate oversized AI test unit queue file', {
            file,
            rotatedPath,
            error: moveError.toString(),
          })
        }

        await saveQueue([])
        return []
      }

      const queue = await fs.readJson(file)
      return Array.isArray(queue) ? queue : []
    } catch (error) {
      logger.error('Unable to load AI test unit queue', {
        error: error.toString(),
      })
      return []
    }
  }

  async function saveQueue(queue) {
    await fs.ensureDir(benchmarkDir())
    await fs.writeJson(queuePath(), queue)
  }

  async function writeRunLog(entry) {
    await fs.ensureDir(benchmarkDir())
    await fs.appendFile(runLogPath(), `${JSON.stringify(entry)}\n`)
  }

  function mapQueuedFlip(item) {
    const result = {
      hash: item.hash,
      leftImage: item.leftImage,
      rightImage: item.rightImage,
      expectedAnswer: normalizeExpectedAnswer(item.expectedAnswer),
    }
    const leftFrames = Array.isArray(item && item.leftFrames)
      ? item.leftFrames.slice(0, 4).filter(Boolean)
      : []
    const rightFrames = Array.isArray(item && item.rightFrames)
      ? item.rightFrames.slice(0, 4).filter(Boolean)
      : []
    if (leftFrames.length && rightFrames.length) {
      result.leftFrames = leftFrames
      result.rightFrames = rightFrames
    }
    return result
  }

  function summarizeBatches(batches) {
    return batches.reduce(
      (acc, batch) => {
        const summary = batch.summary || {}
        const diagnostics = summary.diagnostics || {}
        const tokens = summary.tokens || {}
        return {
          totalFlips: acc.totalFlips + (summary.totalFlips || 0),
          elapsedMs: acc.elapsedMs + (summary.elapsedMs || 0),
          skipped: acc.skipped + (summary.skipped || 0),
          left: acc.left + (summary.left || 0),
          right: acc.right + (summary.right || 0),
          tokens: {
            promptTokens: acc.tokens.promptTokens + (tokens.promptTokens || 0),
            completionTokens:
              acc.tokens.completionTokens + (tokens.completionTokens || 0),
            totalTokens: acc.tokens.totalTokens + (tokens.totalTokens || 0),
            flipsWithUsage:
              acc.tokens.flipsWithUsage + (tokens.flipsWithUsage || 0),
          },
          diagnostics: {
            swapped: acc.diagnostics.swapped + (diagnostics.swapped || 0),
            notSwapped:
              acc.diagnostics.notSwapped + (diagnostics.notSwapped || 0),
            rawLeft: acc.diagnostics.rawLeft + (diagnostics.rawLeft || 0),
            rawRight: acc.diagnostics.rawRight + (diagnostics.rawRight || 0),
            rawSkip: acc.diagnostics.rawSkip + (diagnostics.rawSkip || 0),
            finalLeft: acc.diagnostics.finalLeft + (diagnostics.finalLeft || 0),
            finalRight:
              acc.diagnostics.finalRight + (diagnostics.finalRight || 0),
            finalSkip: acc.diagnostics.finalSkip + (diagnostics.finalSkip || 0),
            remappedDecisions:
              acc.diagnostics.remappedDecisions +
              (diagnostics.remappedDecisions || 0),
            providerErrors:
              acc.diagnostics.providerErrors +
              (diagnostics.providerErrors || 0),
          },
        }
      },
      {
        totalFlips: 0,
        elapsedMs: 0,
        skipped: 0,
        left: 0,
        right: 0,
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          flipsWithUsage: 0,
        },
        diagnostics: {
          swapped: 0,
          notSwapped: 0,
          rawLeft: 0,
          rawRight: 0,
          rawSkip: 0,
          finalLeft: 0,
          finalRight: 0,
          finalSkip: 0,
          remappedDecisions: 0,
          providerErrors: 0,
        },
      }
    )
  }

  function evaluateResults({selectedFlips, batches}) {
    const flatResults = []
    ;(Array.isArray(batches) ? batches : []).forEach((batch) => {
      const results = Array.isArray(batch && batch.results) ? batch.results : []
      results.forEach((result) => {
        flatResults.push(result || {})
      })
    })

    const evaluation = {
      labeled: 0,
      answered: 0,
      skippedLabeled: 0,
      correct: 0,
      correctAnswered: 0,
      expectedLeft: 0,
      expectedRight: 0,
      expectedSkip: 0,
      accuracyLabeled: 0,
      accuracyAnswered: 0,
    }

    for (
      let resultIndex = 0;
      resultIndex < flatResults.length && resultIndex < selectedFlips.length;
      resultIndex += 1
    ) {
      const flip = selectedFlips[resultIndex] || {}
      const expectedAnswer = normalizeExpectedAnswer(flip.expectedAnswer)
      if (expectedAnswer) {
        evaluation.labeled += 1
        if (expectedAnswer === 'left') {
          evaluation.expectedLeft += 1
        } else if (expectedAnswer === 'right') {
          evaluation.expectedRight += 1
        } else {
          evaluation.expectedSkip += 1
        }

        const answer = normalizeAiAnswer(
          (flatResults[resultIndex] || {}).answer
        )
        if (answer === 'skip') {
          evaluation.skippedLabeled += 1
        } else {
          evaluation.answered += 1
        }

        if (answer === expectedAnswer) {
          evaluation.correct += 1
          if (answer !== 'skip') {
            evaluation.correctAnswered += 1
          }
        }
      }
    }

    evaluation.accuracyLabeled =
      evaluation.labeled > 0 ? evaluation.correct / evaluation.labeled : 0
    evaluation.accuracyAnswered =
      evaluation.answered > 0
        ? evaluation.correctAnswered / evaluation.answered
        : 0

    return evaluation
  }

  async function addFlips(payload = {}) {
    const source = String(payload.source || 'manual').trim() || 'manual'
    const flips = sanitizeFlips(payload.flips)
    const queue = await loadQueue()

    const additions = flips.map((flip, index) => ({
      id: `${now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
      source,
      addedAt: new Date().toISOString(),
      ...flip,
      meta: payload.meta || null,
    }))

    const nextQueue = queue.concat(additions)
    const dropped = Math.max(0, nextQueue.length - maxQueuedFlips)
    const boundedQueue = dropped ? nextQueue.slice(-maxQueuedFlips) : nextQueue

    if (dropped > 0) {
      logger.info('AI test unit queue capped, dropped oldest flips', {
        dropped,
        maxQueuedFlips,
      })
    }

    await saveQueue(boundedQueue)

    return {
      ok: true,
      added: additions.length,
      total: boundedQueue.length,
      dropped,
    }
  }

  async function listFlips(payload = {}) {
    const queue = await loadQueue()
    const limit = clamp(toInt(payload.limit, 200), 1, 2000)
    const offset = Math.max(0, toInt(payload.offset, 0))
    const page = queue.slice(offset, offset + limit)

    return {
      ok: true,
      total: queue.length,
      offset,
      limit,
      flips: page,
    }
  }

  async function clearFlips() {
    await saveQueue([])
    return {
      ok: true,
      total: 0,
    }
  }

  async function run(payload = {}, options = {}) {
    const onProgress =
      typeof options.onProgress === 'function' ? options.onProgress : null
    const emitProgress = (event) => {
      if (!onProgress) {
        return
      }
      try {
        onProgress(event)
      } catch (error) {
        logger.error('AI test unit progress callback failed', {
          error: error.toString(),
        })
      }
    }

    const queue = await loadQueue()
    const runFlips = Array.isArray(payload.flips)
      ? sanitizeFlips(payload.flips)
      : queue.map(mapQueuedFlip)

    if (!runFlips.length) {
      throw new Error('No flips available in local test unit queue')
    }

    const batchSize = clamp(
      toInt(payload.batchSize, DEFAULT_BATCH_SIZE),
      1,
      MAX_BATCH_SIZE
    )
    const maxFlips = clamp(
      toInt(payload.maxFlips, runFlips.length),
      1,
      MAX_RUN_FLIPS
    )

    const selectedFlips = runFlips.slice(0, maxFlips)

    const batches = []
    const startedAt = now()
    const totalBatches =
      selectedFlips.length > 0 ? Math.ceil(selectedFlips.length / batchSize) : 0

    emitProgress({
      type: 'run-start',
      requestId: payload.requestId || null,
      provider: payload.provider,
      model: payload.model,
      totalFlips: selectedFlips.length,
      totalBatches,
      batchSize,
      startedAt: new Date().toISOString(),
    })

    for (let index = 0; index < selectedFlips.length; index += batchSize) {
      const batchFlips = selectedFlips.slice(index, index + batchSize)
      const batchNumber = Math.floor(index / batchSize) + 1
      const batchStartedAt = now()

      emitProgress({
        type: 'batch-start',
        requestId: payload.requestId || null,
        batch: batchNumber,
        count: batchFlips.length,
        processedBeforeBatch: index,
        totalFlips: selectedFlips.length,
        startedAt: new Date().toISOString(),
      })

      const result = await aiProviderBridge.solveFlipBatch({
        ...payload,
        maxConcurrency: 1,
        flips: batchFlips,
        session: {
          type: 'local-test-unit',
          batch: batchNumber,
          startedAt: new Date().toISOString(),
          ...(payload.session || {}),
        },
        onFlipStart: (flipStart) => {
          const indexedFlip =
            batchFlips[toInt(flipStart && flipStart.flipIndex, -1)] || null
          const expectedAnswer =
            normalizeExpectedAnswer(
              indexedFlip && indexedFlip.expectedAnswer
            ) || null
          emitProgress({
            type: 'flip-start',
            requestId: payload.requestId || null,
            batch: batchNumber,
            batchFlipCount: batchFlips.length,
            processedBeforeBatch: index,
            elapsedMs: now() - startedAt,
            expectedAnswer,
            ...flipStart,
          })
        },
        onFlipResult: (flipResult) => {
          const indexedFlip =
            batchFlips[toInt(flipResult && flipResult.flipIndex, -1)] || null
          const expectedAnswer =
            normalizeExpectedAnswer(
              indexedFlip && indexedFlip.expectedAnswer
            ) || null
          const normalizedAnswer = normalizeAiAnswer(
            flipResult && flipResult.answer
          )
          emitProgress({
            type: 'flip-result',
            requestId: payload.requestId || null,
            batch: batchNumber,
            batchFlipCount: batchFlips.length,
            processedBeforeBatch: index,
            elapsedMs: now() - startedAt,
            expectedAnswer,
            isCorrect:
              expectedAnswer == null
                ? null
                : normalizedAnswer === expectedAnswer,
            ...flipResult,
          })
        },
      })

      batches.push({
        batch: batchNumber,
        count: batchFlips.length,
        summary: result.summary,
        results: result.results,
      })

      emitProgress({
        type: 'batch-complete',
        requestId: payload.requestId || null,
        batch: batchNumber,
        count: batchFlips.length,
        elapsedMs: now() - batchStartedAt,
        totalElapsedMs: now() - startedAt,
        summary: result.summary,
      })
    }

    if (payload.dequeue === true && !Array.isArray(payload.flips)) {
      await saveQueue(queue.slice(selectedFlips.length))
    }

    const summary = summarizeBatches(batches)
    summary.evaluation = evaluateResults({
      selectedFlips,
      batches,
    })
    const response = {
      ok: true,
      provider: payload.provider,
      model: payload.model,
      batchSize,
      totalBatches: batches.length,
      totalFlips: selectedFlips.length,
      elapsedMs: now() - startedAt,
      summary,
      batches,
      queueAfterRun:
        payload.dequeue === true
          ? queue.length - selectedFlips.length
          : queue.length,
    }

    emitProgress({
      type: 'run-complete',
      requestId: payload.requestId || null,
      provider: payload.provider,
      model: payload.model,
      totalFlips: response.totalFlips,
      totalBatches: response.totalBatches,
      elapsedMs: response.elapsedMs,
      summary: response.summary,
      queueAfterRun: response.queueAfterRun,
      finishedAt: new Date().toISOString(),
    })

    try {
      await writeRunLog({
        time: new Date().toISOString(),
        type: 'local-test-unit-run',
        request: {
          provider: payload.provider,
          model: payload.model,
          benchmarkProfile: payload.benchmarkProfile,
          ensembleEnabled: Boolean(payload.ensembleEnabled),
          ensemblePrimaryWeight:
            Number(payload.ensemblePrimaryWeight) > 0
              ? Number(payload.ensemblePrimaryWeight)
              : 1,
          consultProviders: Array.isArray(payload.consultProviders)
            ? payload.consultProviders.map(({provider, model, weight}) => ({
                provider,
                model,
                weight: Number(weight) > 0 ? Number(weight) : 1,
              }))
            : [],
          batchSize,
          maxFlips,
          dequeue: payload.dequeue === true,
          source: Array.isArray(payload.flips) ? 'adhoc' : 'queue',
        },
        summary: response.summary,
        elapsedMs: response.elapsedMs,
      })
    } catch (error) {
      logger.error('Unable to write local test unit run log', {
        error: error.toString(),
      })
    }

    return response
  }

  return {
    addFlips,
    listFlips,
    clearFlips,
    run,
  }
}

module.exports = {
  createAiTestUnitBridge,
}
