const {createLocalAiStorage} = require('./storage')
const {createLocalAiSidecar} = require('./sidecar')

const CAPTURE_INDEX_VERSION = 1
const MAX_CAPTURE_INDEX_ITEMS = 1000
const MAX_RECENT_CAPTURES = 20

function normalizeMode(value, fallback = 'sidecar') {
  const mode = String(value || fallback).trim()
  return mode || fallback
}

function normalizeBaseUrl(value, fallback = 'http://localhost:5000') {
  const baseUrl = String(value || fallback).trim()
  return baseUrl || fallback
}

function normalizeRuntimePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : {}
}

function normalizeEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) ? epoch : null
}

function normalizeSessionType(value) {
  const sessionType = String(value || '').trim()
  return sessionType || null
}

function normalizePanelCount(value) {
  const panelCount = Number.parseInt(value, 10)
  return Number.isFinite(panelCount) && panelCount > 0 ? panelCount : 0
}

function normalizeConsensus(consensus) {
  if (!consensus || typeof consensus !== 'object' || Array.isArray(consensus)) {
    return null
  }

  const finalAnswer = String(
    consensus.finalAnswer || consensus.finalAnswerAfterRemap || ''
  )
    .trim()
    .toLowerCase()

  const reported = Boolean(consensus.reported)

  if (!finalAnswer && !reported) {
    return null
  }

  return {
    finalAnswer: finalAnswer || null,
    reported,
  }
}

function toCaptureMeta(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const flipHash = String(payload.flipHash || payload.hash || '').trim()

  if (!flipHash) {
    return null
  }

  const images = Array.isArray(payload.images) ? payload.images : []

  return {
    flipHash,
    epoch: normalizeEpoch(payload.epoch),
    sessionType: normalizeSessionType(payload.sessionType),
    panelCount: images.length,
    capturedAt: new Date().toISOString(),
    consensus: normalizeConsensus(payload.consensus),
  }
}

function normalizeCapture(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  const flipHash = String(item.flipHash || item.hash || '').trim()

  if (!flipHash) {
    return null
  }

  return {
    flipHash,
    epoch: normalizeEpoch(item.epoch),
    sessionType: normalizeSessionType(item.sessionType),
    panelCount: normalizePanelCount(item.panelCount),
    capturedAt:
      String(item.capturedAt || '').trim() || new Date().toISOString(),
    consensus: normalizeConsensus(item.consensus),
  }
}

function normalizeCaptureIndex(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const captures = Array.isArray(source.captures)
    ? source.captures
        .map(normalizeCapture)
        .filter(Boolean)
        .slice(-MAX_CAPTURE_INDEX_ITEMS)
    : []
  const capturedCount = Number.parseInt(source.capturedCount, 10)

  return {
    version: CAPTURE_INDEX_VERSION,
    capturedCount: Number.isFinite(capturedCount)
      ? Math.max(capturedCount, captures.length)
      : captures.length,
    captures,
    updatedAt: String(source.updatedAt || '').trim() || null,
  }
}

function defaultCaptureIndex() {
  return {
    version: CAPTURE_INDEX_VERSION,
    capturedCount: 0,
    captures: [],
    updatedAt: null,
  }
}

function captureIndexPath(storage) {
  return storage.resolveLocalAiPath('captures', 'index.json')
}

function manifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('manifests', `epoch-${epoch}-manifest.json`)
}

function createBaseModelId(mode) {
  return `local-ai:${normalizeMode(mode)}:mvp-placeholder-v1`
}

function reduceLatestCaptures(captures) {
  const uniqueCaptures = new Map()

  captures.forEach((capture) => {
    uniqueCaptures.set(capture.flipHash, capture)
  })

  return Array.from(uniqueCaptures.values())
}

function getExclusionReasons(capture, epoch) {
  const reasons = []

  if (!capture.flipHash) {
    reasons.push('missing_flip_hash')
  }

  if (capture.epoch === null) {
    reasons.push('missing_epoch')
  } else if (capture.epoch !== epoch) {
    reasons.push('epoch_mismatch')
  }

  if (!capture.consensus || !capture.consensus.finalAnswer) {
    reasons.push('missing_consensus')
  }

  if (capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (!capture.panelCount) {
    reasons.push('missing_local_metadata')
  }

  return reasons
}

function createLocalAiManager({logger, isDev = false, storage, sidecar} = {}) {
  const localAiStorage = storage || createLocalAiStorage()
  const localAiSidecar =
    sidecar ||
    createLocalAiSidecar({
      logger,
      isDev,
    })
  const state = {
    available: true,
    running: false,
    mode: 'sidecar',
    baseUrl: 'http://localhost:5000',
    capturedCount: 0,
    lastError: null,
    sidecarReachable: null,
    sidecarCheckedAt: null,
    sidecarModels: [],
    captureIndex: [],
    recentCaptures: [],
    loadError: null,
    hydrated: false,
  }

  let hydrationPromise = null
  let persistQueue = Promise.resolve()

  function currentStatus() {
    return {
      available: state.available,
      running: state.running,
      mode: state.mode,
      baseUrl: state.baseUrl,
      capturedCount: state.capturedCount,
      lastError: state.lastError,
      sidecarReachable: state.sidecarReachable,
      sidecarCheckedAt: state.sidecarCheckedAt,
      sidecarModelCount: state.sidecarModels.length,
    }
  }

  function updateSidecarState({reachable, models, checkedAt, lastError}) {
    state.sidecarReachable =
      typeof reachable === 'boolean' ? reachable : state.sidecarReachable
    state.sidecarCheckedAt = checkedAt || new Date().toISOString()
    state.sidecarModels = Array.isArray(models) ? models : state.sidecarModels
    state.lastError = lastError || null
  }

  async function hydrate() {
    if (state.hydrated) {
      return
    }

    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        try {
          const persisted = normalizeCaptureIndex(
            await localAiStorage.readJson(captureIndexPath(localAiStorage), {
              version: CAPTURE_INDEX_VERSION,
              capturedCount: 0,
              captures: [],
              updatedAt: null,
            })
          )

          state.captureIndex = persisted.captures
          state.recentCaptures = persisted.captures.slice(-MAX_RECENT_CAPTURES)
          state.capturedCount = persisted.capturedCount
          state.loadError = null
        } catch (error) {
          state.captureIndex = []
          state.recentCaptures = []
          state.capturedCount = 0
          state.loadError = error
          state.lastError = 'Unable to load local AI capture index'

          if (logger && typeof logger.error === 'function') {
            logger.error('Unable to load local AI capture index', {
              error: error.toString(),
            })
          }
        } finally {
          state.hydrated = true
        }
      })()
    }

    await hydrationPromise
  }

  async function persistCaptureIndex() {
    const nextIndex = {
      version: CAPTURE_INDEX_VERSION,
      capturedCount: state.capturedCount,
      captures: state.captureIndex,
      updatedAt: new Date().toISOString(),
    }

    persistQueue = persistQueue
      .catch(() => {})
      .then(() =>
        localAiStorage.writeJsonAtomic(
          captureIndexPath(localAiStorage),
          nextIndex
        )
      )

    return persistQueue
  }

  async function refreshSidecarStatus(payload = {}) {
    const next = normalizeRuntimePayload(payload)

    state.mode = normalizeMode(next.mode, state.mode)
    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)

    const health = await localAiSidecar.getHealth({
      baseUrl: state.baseUrl,
      timeoutMs: next.timeoutMs,
    })
    let models = {
      ok: false,
      models: [],
      total: 0,
      lastError: null,
    }

    if (health.ok) {
      models = await localAiSidecar.listModels({
        baseUrl: state.baseUrl,
        timeoutMs: next.timeoutMs,
      })
    }

    updateSidecarState({
      reachable: Boolean(health.ok),
      models: models.ok ? models.models : [],
      checkedAt: new Date().toISOString(),
      lastError: health.ok ? models.lastError : health.lastError,
    })

    return {
      ok: Boolean(health.ok),
      health,
      models,
      ...currentStatus(),
    }
  }

  async function status(payload = {}) {
    await hydrate()

    if (payload && payload.refresh) {
      return refreshSidecarStatus(payload)
    }

    return currentStatus()
  }

  async function start(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    state.mode = normalizeMode(next.mode, state.mode)
    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)
    state.running = true
    state.lastError = null

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI runtime marked as started', {
        mode: state.mode,
        capturedCount: state.capturedCount,
      })
    }

    return refreshSidecarStatus(next)
  }

  async function stop() {
    await hydrate()

    state.running = false
    state.lastError = null
    state.sidecarReachable = null
    state.sidecarCheckedAt = new Date().toISOString()
    state.sidecarModels = []

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI runtime marked as stopped', {
        capturedCount: state.capturedCount,
      })
    }

    return currentStatus()
  }

  async function listModels(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)

    const result = await localAiSidecar.listModels({
      baseUrl: state.baseUrl,
      timeoutMs: next.timeoutMs,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      models: result.ok ? result.models : [],
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function chat(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)

    const result = await localAiSidecar.chat({
      baseUrl: state.baseUrl,
      model: next.model,
      messages: next.messages,
      timeoutMs: next.timeoutMs,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function captionFlip(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)

    const result = await localAiSidecar.captionFlip({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function ocrImage(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)

    const result = await localAiSidecar.ocrImage({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function trainEpoch(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)

    const result = await localAiSidecar.trainEpoch({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function captureFlip(payload) {
    await hydrate()

    const capture = toCaptureMeta(payload)

    if (!capture) {
      state.lastError = 'Invalid local AI capture payload'

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Ignoring invalid local AI capture payload')
      }

      return {
        ok: false,
        error: state.lastError,
        ...currentStatus(),
      }
    }

    state.capturedCount += 1
    state.lastError = null
    state.captureIndex = state.captureIndex
      .concat(capture)
      .slice(-MAX_CAPTURE_INDEX_ITEMS)
    state.recentCaptures = state.captureIndex.slice(-MAX_RECENT_CAPTURES)

    try {
      await persistCaptureIndex()
      state.loadError = null
    } catch (error) {
      state.lastError = 'Unable to persist local AI capture index'

      if (logger && typeof logger.error === 'function') {
        logger.error('Unable to persist local AI capture index', {
          error: error.toString(),
        })
      }

      return {
        ok: false,
        error: state.lastError,
        ...currentStatus(),
      }
    }

    // MVP boundary: record metadata only, never retain decoded image bytes.
    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI flip captured', {
        flipHash: capture.flipHash,
        epoch: capture.epoch,
        sessionType: capture.sessionType,
        panelCount: capture.panelCount,
        capturedCount: state.capturedCount,
      })
    }

    return {
      ok: true,
      capture,
      ...currentStatus(),
    }
  }

  async function buildManifest(epochValue) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const epoch = normalizeEpoch(epochValue)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const eligibleFlipHashes = []
    const excluded = []

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      eligibleFlipHashes.push(capture.flipHash)
    })

    const manifest = {
      epoch,
      baseModelId: createBaseModelId(state.mode),
      eligibleFlipHashes,
      excluded,
      generatedAt: new Date().toISOString(),
    }
    const nextManifestPath = manifestPath(localAiStorage, epoch)

    await localAiStorage.writeJsonAtomic(nextManifestPath, manifest)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI manifest built', {
        epoch,
        eligibleCount: eligibleFlipHashes.length,
        excludedCount: excluded.length,
        manifestPath: nextManifestPath,
      })
    }

    return {
      epoch,
      eligibleCount: eligibleFlipHashes.length,
      excludedCount: excluded.length,
      manifestPath: nextManifestPath,
    }
  }

  return {
    status,
    start,
    stop,
    listModels,
    chat,
    captionFlip,
    ocrImage,
    trainEpoch,
    captureFlip,
    buildManifest,
  }
}

module.exports = {
  createLocalAiManager,
  defaultCaptureIndex,
}
