const path = require('path')

const {createLocalAiStorage} = require('./storage')
const {resolveAdapterContract} = require('./adapter-contract')
const {createLocalAiSidecar} = require('./sidecar')
const {resolveModelReference} = require('./model-reference')
const {resolveLocalAiRuntimeAdapter} = require('./runtime-adapter')

const CAPTURE_INDEX_VERSION = 1
const TRAINING_CANDIDATE_PACKAGE_VERSION = 1
const MAX_CAPTURE_INDEX_ITEMS = 1000
const MAX_RECENT_CAPTURES = 20
const ELIGIBLE_CONSENSUS_ANSWERS = new Set(['left', 'right'])

function normalizeMode(value, fallback = 'sidecar') {
  const mode = String(value || fallback).trim()
  return mode || fallback
}

function normalizeBaseUrl(value, fallback = 'http://localhost:5000') {
  const baseUrl = String(value || fallback).trim()
  return baseUrl || fallback
}

function normalizeRuntimePayload(payload, fallbackRuntime = {}) {
  const nextPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}
  const runtime = resolveLocalAiRuntimeAdapter(nextPayload, fallbackRuntime)

  return {
    ...nextPayload,
    runtime: runtime.runtime,
    runtimeBackend: runtime.runtimeBackend,
    runtimeType: runtime.runtimeType,
    baseUrl: normalizeBaseUrl(
      nextPayload.baseUrl || nextPayload.endpoint,
      runtime.defaultBaseUrl
    ),
  }
}

function pickRuntimeInput(payload) {
  if (typeof payload.input !== 'undefined') {
    return payload.input
  }

  if (typeof payload.payload !== 'undefined') {
    return payload.payload
  }

  return payload
}

function normalizeEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) ? epoch : null
}

function normalizeFilePath(value) {
  const filePath = String(value || '').trim()
  return filePath ? path.resolve(filePath) : null
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

function hasExplicitConsensus(payload) {
  return Boolean(
    payload &&
      payload.consensus &&
      typeof payload.consensus === 'object' &&
      !Array.isArray(payload.consensus)
  )
}

function hasEligibleConsensusAnswer(consensus) {
  return Boolean(
    consensus &&
      consensus.finalAnswer &&
      ELIGIBLE_CONSENSUS_ANSWERS.has(String(consensus.finalAnswer).trim())
  )
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
    timestamp: Date.now(),
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
    timestamp: Number.isFinite(Number(item.timestamp))
      ? Number(item.timestamp)
      : Date.now(),
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

function adapterArtifactManifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('adapters', `epoch-${epoch}.json`)
}

function trainingCandidatePackagePath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'training-candidates',
    `epoch-${epoch}-candidates.json`
  )
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
  } else if (!hasEligibleConsensusAnswer(capture.consensus)) {
    reasons.push('invalid_consensus')
  }

  if (capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (!capture.panelCount) {
    reasons.push('missing_local_metadata')
  }

  return reasons
}

function getCaptureSkipReasons(payload, capture) {
  const reasons = []
  const explicitConsensus = hasExplicitConsensus(payload)

  if (capture && capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (capture && capture.consensus && capture.consensus.finalAnswer) {
    if (!hasEligibleConsensusAnswer(capture.consensus)) {
      reasons.push('invalid_consensus')
    }
  } else if (explicitConsensus) {
    reasons.push('missing_consensus')
  }

  return reasons
}

function collectInconsistencyFlags(excluded) {
  const flags = new Set()

  excluded.forEach(({reasons}) => {
    if (reasons.includes('missing_consensus')) {
      flags.add('contains_unresolved_captures')
    }

    if (reasons.includes('reported')) {
      flags.add('contains_reported_captures')
    }

    if (reasons.includes('invalid_consensus')) {
      flags.add('contains_invalid_consensus')
    }

    if (reasons.includes('epoch_mismatch')) {
      flags.add('contains_other_epoch_captures')
    }

    if (reasons.includes('missing_local_metadata')) {
      flags.add('contains_incomplete_metadata')
    }
  })

  return Array.from(flags)
}

function normalizePackagedCapturedAt(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    throw new Error('captured_at_required')
  }

  const nextDate = new Date(raw)

  if (!Number.isFinite(nextDate.getTime())) {
    throw new Error('captured_at_invalid')
  }

  return nextDate.toISOString()
}

function buildTrainingCandidateItem(capture) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error('invalid_capture')
  }

  if (!capture.consensus || !hasEligibleConsensusAnswer(capture.consensus)) {
    throw new Error('final_consensus_required')
  }

  return {
    flipHash: capture.flipHash,
    epoch: capture.epoch,
    sessionType: capture.sessionType,
    panelCount: capture.panelCount,
    timestamp: Number(capture.timestamp),
    capturedAt: normalizePackagedCapturedAt(capture.capturedAt),
    finalAnswer: capture.consensus.finalAnswer,
  }
}

function createLocalAiManager({
  logger,
  isDev = false,
  storage,
  sidecar,
  getModelReference,
} = {}) {
  const localAiStorage = storage || createLocalAiStorage()
  const localAiSidecar =
    sidecar ||
    createLocalAiSidecar({
      logger,
      isDev,
    })
  const initialRuntime = resolveLocalAiRuntimeAdapter()
  const state = {
    available: true,
    running: false,
    mode: 'sidecar',
    runtime: initialRuntime.runtime,
    runtimeBackend: initialRuntime.runtimeBackend,
    runtimeType: initialRuntime.runtimeType,
    baseUrl: initialRuntime.baseUrl,
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
      runtime: state.runtime,
      runtimeBackend: state.runtimeBackend,
      runtimeType: state.runtimeType,
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

  function applyRuntimeState(next) {
    state.mode = normalizeMode(next.mode, state.mode)
    state.runtime = next.runtime || state.runtime
    state.runtimeBackend = next.runtimeBackend || state.runtimeBackend
    state.runtimeType = next.runtimeType || state.runtimeType
    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)
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
    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const health = await localAiSidecar.getHealth({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
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
        runtimeBackend: next.runtimeBackend,
        runtimeType: next.runtimeType,
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

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)
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

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.listModels({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
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

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.chat({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      model: next.model,
      messages: next.messages,
      message: next.message,
      prompt: next.prompt,
      input: next.input,
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

  async function flipToText(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.flipToText({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
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

  async function checkFlipSequence(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.checkFlipSequence({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
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

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

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

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

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

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

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

    // Decoded flips often arrive before final consensus, so only explicit
    // disqualifiers are blocked here. Unknown cases still rely on manifest-time
    // post-consensus filtering.
    const skipReasons = getCaptureSkipReasons(payload, capture)

    if (skipReasons.length) {
      state.lastError = null

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Skipping ineligible local AI capture', {
          flipHash: capture.flipHash,
          reasons: skipReasons,
        })
      }

      return {
        ok: false,
        skipped: true,
        reasons: skipReasons,
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

    const next = normalizeRuntimePayload(epochValue)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : epochValue
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {...next, epoch},
      modelReference
    )

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

    const inconsistencyFlags = collectInconsistencyFlags(excluded)

    const manifest = {
      epoch,
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterStrategy: String(next.adapterStrategy || '').trim() || null,
      trainingPolicy: String(next.trainingPolicy || '').trim() || null,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      adapterArtifact: adapterContract.adapterArtifact || null,
      trainingConfigHash: adapterContract.trainingConfigHash,
      eligibleFlipHashes,
      flipCount: eligibleFlipHashes.length,
      excluded,
      skippedCount: excluded.length,
      inconsistencyFlags,
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

  async function registerAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const sourcePath = normalizeFilePath(
      next.sourcePath ||
        next.artifactPath ||
        (next.adapterArtifact &&
        typeof next.adapterArtifact === 'object' &&
        !Array.isArray(next.adapterArtifact)
          ? next.adapterArtifact.sourcePath ||
            next.adapterArtifact.path ||
            next.adapterArtifact.filePath
          : '')
    )

    if (!sourcePath) {
      throw new Error('Adapter source path is required')
    }

    if (!(await localAiStorage.exists(sourcePath))) {
      throw new Error('Adapter source file is unavailable')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterFile = path.basename(sourcePath)
    const sizeBytes = await localAiStorage.fileSize(sourcePath)
    const adapterSha256 = await localAiStorage.sha256File(sourcePath)
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {
        ...next,
        epoch,
        deltaType: 'lora_adapter',
        adapterSha256,
        adapterArtifact: {
          file: adapterFile,
          sourcePath,
          sizeBytes,
        },
      },
      modelReference
    )
    const adapterManifest = {
      epoch,
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      trainingConfigHash: adapterContract.trainingConfigHash,
      adapterArtifact: {
        file: adapterFile,
        sourcePath,
        sizeBytes,
      },
      registeredAt: new Date().toISOString(),
    }
    const nextManifestPath = adapterArtifactManifestPath(localAiStorage, epoch)

    await localAiStorage.writeJsonAtomic(nextManifestPath, adapterManifest)

    return {
      epoch,
      adapterManifestPath: nextManifestPath,
      ...adapterManifest,
    }
  }

  async function loadAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextManifestPath = adapterArtifactManifestPath(localAiStorage, epoch)
    const adapterManifest = await localAiStorage.readJson(
      nextManifestPath,
      null
    )

    if (!adapterManifest) {
      throw new Error('Adapter artifact is unavailable')
    }

    return {
      epoch,
      adapterManifestPath: nextManifestPath,
      ...adapterManifest,
    }
  }

  async function buildTrainingCandidatePackage(payload) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {...next, epoch},
      modelReference
    )

    const items = []
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

      try {
        items.push(buildTrainingCandidateItem(capture))
      } catch (error) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons: ['packaging_failed'],
        })

        if (logger && typeof logger.error === 'function') {
          logger.error('Unable to package local AI training candidate', {
            flipHash: capture.flipHash || null,
            epoch,
            error: error.toString(),
          })
        }
      }
    })

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    const inconsistencyFlags = collectInconsistencyFlags(excluded)
    const candidatePackage = {
      schemaVersion: TRAINING_CANDIDATE_PACKAGE_VERSION,
      packageType: 'local-ai-training-candidates',
      epoch,
      createdAt: new Date().toISOString(),
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterStrategy: String(next.adapterStrategy || '').trim() || null,
      trainingPolicy: String(next.trainingPolicy || '').trim() || null,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      adapterArtifact: adapterContract.adapterArtifact || null,
      trainingConfigHash: adapterContract.trainingConfigHash,
      reviewStatus: 'draft',
      reviewedAt: null,
      federatedReady: false,
      eligibleCount: items.length,
      excludedCount: excluded.length,
      inconsistencyFlags,
      items,
      excluded,
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, candidatePackage)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI training candidate package built', {
        epoch,
        eligibleCount: items.length,
        excludedCount: excluded.length,
        packagePath: nextPackagePath,
      })
    }

    return {
      epoch,
      eligibleCount: items.length,
      excludedCount: excluded.length,
      packagePath: nextPackagePath,
      package: next.includePackage ? candidatePackage : undefined,
    }
  }

  async function loadTrainingCandidatePackage(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    const candidatePackage = await localAiStorage.readTrainingCandidatePackage(
      nextPackagePath,
      null
    )

    if (!candidatePackage) {
      throw new Error('Training candidate package is unavailable')
    }

    return {
      epoch,
      eligibleCount: Number(candidatePackage.eligibleCount) || 0,
      excludedCount: Number(candidatePackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: candidatePackage,
    }
  }

  async function updateTrainingCandidatePackageReview(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    let candidatePackage

    try {
      candidatePackage =
        await localAiStorage.updateTrainingCandidatePackageReview(
          nextPackagePath,
          {
            reviewStatus: next.reviewStatus,
          }
        )
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('Training candidate package is unavailable')
      }

      throw error
    }

    return {
      epoch,
      eligibleCount: Number(candidatePackage.eligibleCount) || 0,
      excludedCount: Number(candidatePackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: candidatePackage,
    }
  }

  return {
    status,
    start,
    stop,
    listModels,
    chat,
    checkFlipSequence,
    flipToText,
    captionFlip,
    ocrImage,
    trainEpoch,
    captureFlip,
    registerAdapterArtifact,
    loadAdapterArtifact,
    buildManifest,
    buildTrainingCandidatePackage,
    loadTrainingCandidatePackage,
    updateTrainingCandidatePackageReview,
  }
}

module.exports = {
  createLocalAiManager,
  defaultCaptureIndex,
}
