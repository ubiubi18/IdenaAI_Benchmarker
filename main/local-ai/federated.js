const crypto = require('crypto')
const path = require('path')
const {createLocalAiStorage} = require('./storage')

const UPDATE_BUNDLE_VERSION = 1
const RECEIVED_INDEX_VERSION = 1
const AGGREGATION_RESULT_VERSION = 1
const MIN_COMPATIBLE_BUNDLES = 2
const DEFAULT_BASE_MODEL_ID = 'local-ai:sidecar:mvp-placeholder-v1'
const PLACEHOLDER_IDENTITY = 'identity-unavailable'
const PLACEHOLDER_SIGNATURE_REASON =
  'idena_signing_unavailable_in_main_process'

function normalizeEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) && epoch >= 0 ? epoch : null
}

function normalizeIdentity(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    const identity = value.trim()
    return identity || null
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const identity = String(value.address || value.identity || '').trim()
    return identity || null
  }

  return null
}

function normalizeFilePath(filePath) {
  const nextPath = String(filePath || '').trim()
  return nextPath ? path.resolve(nextPath) : null
}

function assertBundlePath(storage, filePath) {
  const sourcePath = normalizeFilePath(filePath)

  if (!sourcePath) {
    return null
  }

  const allowedRoots = [
    storage.resolveLocalAiPath('incoming'),
    storage.resolveLocalAiPath('bundles'),
  ]
    .map((rootPath) => path.resolve(rootPath))
    .filter(Boolean)

  for (const allowedRoot of allowedRoots) {
    const allowedPrefix = `${allowedRoot}${path.sep}`

    if (sourcePath === allowedRoot || sourcePath.startsWith(allowedPrefix)) {
      return sourcePath
    }
  }

  throw new Error('bundle_path_outside_incoming')
}

function normalizeSignature(signature) {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    return null
  }

  const value = String(signature.value || '').trim()
  const type = String(signature.type || '').trim()

  if (!value || !type) {
    return null
  }

  return {
    value,
    type,
    signed: Boolean(signature.signed),
    reason: String(signature.reason || '').trim() || null,
  }
}

function manifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('manifests', `epoch-${epoch}-manifest.json`)
}

function bundlePath(storage, epoch, identity) {
  const safeIdentity =
    String(identity || PLACEHOLDER_IDENTITY)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || PLACEHOLDER_IDENTITY

  return storage.resolveLocalAiPath(
    'bundles',
    `update-${epoch}-${safeIdentity}.json`
  )
}

function receivedIndexPath(storage) {
  return storage.resolveLocalAiPath('received', 'index.json')
}

function receivedBundlePath(storage, epoch, bundleId) {
  return storage.resolveLocalAiPath('received', String(epoch), `${bundleId}.json`)
}

function aggregationResultPath(storage) {
  return storage.resolveLocalAiPath('aggregation', 'aggregated-model.json')
}

function buildSignaturePayload(payload) {
  return JSON.stringify(payload)
}

async function resolveIdentity(getIdentity) {
  if (typeof getIdentity !== 'function') {
    return {
      identity: PLACEHOLDER_IDENTITY,
      isPlaceholder: true,
      source: 'placeholder',
    }
  }

  try {
    const resolved = normalizeIdentity(await getIdentity())

    if (resolved) {
      return {
        identity: resolved,
        isPlaceholder: false,
        source: 'idena-identity',
      }
    }
  } catch {
    // Bundle generation must still work locally without identity plumbing.
  }

  return {
    identity: PLACEHOLDER_IDENTITY,
    isPlaceholder: true,
    source: 'placeholder',
  }
}

function createPlaceholderSignature(storage, payload) {
  return {
    value: storage.sha256(buildSignaturePayload(payload)),
    type: 'placeholder_sha256',
    signed: false,
    reason: PLACEHOLDER_SIGNATURE_REASON,
  }
}

async function signBundlePayload({
  storage,
  payload,
  identityInfo,
  signPayload,
}) {
  if (identityInfo.isPlaceholder || typeof signPayload !== 'function') {
    return createPlaceholderSignature(storage, payload)
  }

  try {
    const signature = String(await signPayload(buildSignaturePayload(payload)))
      .trim()

    if (!signature) {
      return {
        ...createPlaceholderSignature(storage, payload),
        reason: 'idena_sign_returned_empty_signature',
      }
    }

    return {
      value: signature,
      type: 'idena_rpc_signature',
      signed: true,
      reason: null,
    }
  } catch {
    return {
      ...createPlaceholderSignature(storage, payload),
      reason: 'idena_sign_failed',
    }
  }
}

function normalizeBaseModelReference(storage, value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const baseModelId =
    String(source.baseModelId || DEFAULT_BASE_MODEL_ID).trim() ||
    DEFAULT_BASE_MODEL_ID
  const baseModelHash =
    String(source.baseModelHash || '').trim() || storage.sha256(baseModelId)

  return {baseModelId, baseModelHash}
}

async function resolveBaseModelReference(storage, getBaseModelReference) {
  if (typeof getBaseModelReference !== 'function') {
    return normalizeBaseModelReference(storage)
  }

  try {
    return normalizeBaseModelReference(storage, await getBaseModelReference())
  } catch {
    return normalizeBaseModelReference(storage)
  }
}

function computeBundleId(storage, bundle) {
  return storage.sha256(JSON.stringify(bundle))
}

function containsRawPayload(value, depth = 0) {
  if (depth > 6 || value == null) {
    return false
  }

  if (typeof value === 'string') {
    return value.startsWith('data:image/')
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsRawPayload(item, depth + 1))
  }

  if (typeof value !== 'object') {
    return false
  }

  return Object.entries(value).some(([key, item]) => {
    if (
      [
        'images',
        'leftImage',
        'rightImage',
        'leftFrames',
        'rightFrames',
        'privateHex',
        'publicHex',
      ].includes(key)
    ) {
      return true
    }

    return containsRawPayload(item, depth + 1)
  })
}

function defaultReceivedIndex() {
  return {
    version: RECEIVED_INDEX_VERSION,
    bundles: [],
  }
}

function normalizeReceivedEntry(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  const bundleId = String(item.bundleId || '').trim()
  const nonce = String(item.nonce || '').trim()
  const storedPath = String(item.storedPath || '').trim()
  const importedAt = String(item.importedAt || '').trim()
  const identity = normalizeIdentity(item.identity)
  const epoch = normalizeEpoch(item.epoch)

  if (!bundleId || !nonce || !storedPath || !importedAt || epoch === null) {
    return null
  }

  return {
    bundleId,
    nonce,
    storedPath,
    importedAt,
    identity: identity || PLACEHOLDER_IDENTITY,
    epoch,
    baseModelId: String(item.baseModelId || '').trim() || DEFAULT_BASE_MODEL_ID,
    baseModelHash: String(item.baseModelHash || '').trim() || null,
    signatureType: String(item.signatureType || '').trim() || null,
    signed: Boolean(item.signed),
  }
}

function normalizeReceivedIndex(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const bundles = Array.isArray(source.bundles)
    ? source.bundles.map(normalizeReceivedEntry).filter(Boolean)
    : []

  return {
    version: RECEIVED_INDEX_VERSION,
    bundles,
  }
}

function validateBundleShape(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return {ok: false, reason: 'schema_invalid'}
  }

  if (bundle.version !== UPDATE_BUNDLE_VERSION) {
    return {ok: false, reason: 'schema_invalid'}
  }

  if (bundle.bundleType !== 'local-ai-update') {
    return {ok: false, reason: 'schema_invalid'}
  }

  if (!bundle.payload || typeof bundle.payload !== 'object' || Array.isArray(bundle.payload)) {
    return {ok: false, reason: 'schema_invalid'}
  }

  const payload = bundle.payload
  const signature = normalizeSignature(bundle.signature)
  const epoch = normalizeEpoch(payload.epoch)
  const identity = normalizeIdentity(payload.identity)
  const baseModelId = String(payload.baseModelId || '').trim()
  const baseModelHash = String(payload.baseModelHash || '').trim()
  const nonce = String(payload.nonce || '').trim()
  const generatedAt = String(payload.generatedAt || '').trim()
  const deltaType = String(payload.deltaType || '').trim()
  const manifest =
    payload.manifest && typeof payload.manifest === 'object'
      ? payload.manifest
      : null
  const metrics =
    payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : null
  const eligibleFlipHashes = Array.isArray(payload.eligibleFlipHashes)
    ? payload.eligibleFlipHashes.filter(Boolean)
    : null

  if (
    epoch === null ||
    !identity ||
    !baseModelId ||
    !baseModelHash ||
    !nonce ||
    !generatedAt ||
    !deltaType ||
    !manifest ||
    !String(manifest.file || '').trim() ||
    !String(manifest.sha256 || '').trim() ||
    !metrics ||
    !eligibleFlipHashes ||
    !signature
  ) {
    return {ok: false, reason: 'schema_invalid'}
  }

  if (baseModelHash !== crypto.createHash('sha256').update(baseModelId).digest('hex')) {
    return {ok: false, reason: 'base_model_mismatch'}
  }

  if (containsRawPayload(bundle)) {
    return {ok: false, reason: 'contains_raw_payload'}
  }

  return {
    ok: true,
    payload,
    signature,
    epoch,
    identity,
    baseModelId,
    baseModelHash,
    nonce,
    eligibleFlipHashes,
  }
}

async function verifyBundleSignature({
  storage,
  payload,
  signature,
  identity,
  verifySignature,
}) {
  if (signature.type === 'placeholder_sha256') {
    // Placeholder verification is only integrity-level, not identity-level.
    const expected = storage.sha256(buildSignaturePayload(payload))

    if (
      signature.signed ||
      identity !== PLACEHOLDER_IDENTITY ||
      signature.reason !== PLACEHOLDER_SIGNATURE_REASON ||
      signature.value !== expected
    ) {
      return {ok: false, reason: 'signature_invalid'}
    }

    return {ok: true, signed: false, signatureType: signature.type}
  }

  if (signature.type === 'idena_rpc_signature') {
    if (typeof verifySignature !== 'function') {
      return {ok: false, reason: 'signature_unverifiable'}
    }

    try {
      const verified = await verifySignature({
        payload,
        identity,
        signature: signature.value,
      })

      return verified
        ? {ok: true, signed: true, signatureType: signature.type}
        : {ok: false, reason: 'signature_invalid'}
    } catch {
      return {ok: false, reason: 'signature_invalid'}
    }
  }

  return {ok: false, reason: 'signature_invalid'}
}

function buildAggregationSummary({
  baseModelId,
  baseModelHash,
  compatibleBundles,
  skipped,
  deltaAvailability,
  reason,
}) {
  return {
    version: AGGREGATION_RESULT_VERSION,
    aggregated: false,
    mode: 'metadata_only_noop',
    baseModelId,
    baseModelHash,
    minimumCompatibleBundles: MIN_COMPATIBLE_BUNDLES,
    compatibleCount: compatibleBundles.length,
    skippedCount: skipped.length,
    acceptedCount: compatibleBundles.length,
    rejectedCount: skipped.length,
    deltaAvailability,
    reason,
    generatedAt: new Date().toISOString(),
    compatibleBundles: compatibleBundles.map(({entry, validation}) => ({
      bundleId: entry.bundleId,
      epoch: validation.epoch,
      identity: validation.identity,
      deltaType: String(validation.payload.deltaType || '').trim() || 'none',
      storedPath: entry.storedPath,
    })),
    skipped,
  }
}

function buildImportResult({
  accepted,
  reason,
  identity = null,
  epoch = null,
  bundlePath = null,
  storedPath = null,
  bundleId = null,
  signed,
  signatureType = null,
}) {
  const result = {
    accepted,
    reason,
    identity,
    epoch,
    bundlePath,
    storedPath,
    acceptedCount: accepted ? 1 : 0,
    rejectedCount: accepted ? 0 : 1,
  }

  if (bundleId) {
    result.bundleId = bundleId
  }

  if (typeof signed === 'boolean') {
    result.signed = signed
  }

  if (signatureType) {
    result.signatureType = signatureType
  }

  return result
}

function logAcceptedBundles(logger, acceptedBundles) {
  if (!logger || typeof logger.debug !== 'function') {
    return
  }

  acceptedBundles.forEach((entry, index) => {
    logger.debug('Local AI accepted bundle observed', {
      index,
      bundleId: entry.bundleId,
      epoch: entry.epoch,
      fileName: path.basename(entry.storedPath),
    })
  })
}

function logRejectedBundles(logger, skipped) {
  if (!logger || typeof logger.debug !== 'function') {
    return
  }

  skipped.forEach((entry, index) => {
    logger.debug('Local AI bundle rejected during aggregation', {
      index,
      bundleId: entry.bundleId,
      reason: entry.reason,
    })
  })
}

function logImportResult(logger, result) {
  if (!logger || typeof logger.debug !== 'function') {
    return
  }

  logger.debug(
    result.accepted
      ? 'Local AI update bundle accepted'
      : 'Local AI update bundle rejected',
    {
      bundleId: result.bundleId || null,
      epoch: result.epoch,
      identity: result.identity,
      fileName: result.bundlePath ? path.basename(result.bundlePath) : null,
      storedFileName: result.storedPath ? path.basename(result.storedPath) : null,
      reason: result.reason,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
    }
  )
}

function createLocalAiFederated({
  logger,
  isDev = false,
  storage,
  getIdentity,
  signPayload,
  verifySignature,
  getBaseModelReference,
} = {}) {
  const localAiStorage = storage || createLocalAiStorage()

  async function buildUpdateBundle(epochValue) {
    const epoch = normalizeEpoch(epochValue)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextManifestPath = manifestPath(localAiStorage, epoch)

    if (!(await localAiStorage.exists(nextManifestPath))) {
      throw new Error(`Local AI manifest for epoch ${epoch} does not exist`)
    }

    const manifest = await localAiStorage.readJson(nextManifestPath)
    const eligibleFlipHashes = Array.isArray(manifest.eligibleFlipHashes)
      ? manifest.eligibleFlipHashes.filter(Boolean)
      : []
    const excluded = Array.isArray(manifest.excluded) ? manifest.excluded : []
    const baseModelId =
      String(manifest.baseModelId || DEFAULT_BASE_MODEL_ID).trim() ||
      DEFAULT_BASE_MODEL_ID
    const baseModelHash = localAiStorage.sha256(baseModelId)
    const manifestSha256 = localAiStorage.sha256(JSON.stringify(manifest))
    const generatedAt = new Date().toISOString()
    const nonce = crypto.randomBytes(16).toString('hex')
    const identityInfo = await resolveIdentity(getIdentity)
    const payload = {
      epoch,
      identity: identityInfo.identity,
      baseModelId,
      baseModelHash,
      nonce,
      eligibleFlipHashes,
      manifest: {
        file: path.basename(nextManifestPath),
        sha256: manifestSha256,
      },
      deltaType: 'none',
      metrics: {
        eligibleCount: eligibleFlipHashes.length,
        excludedCount: excluded.length,
      },
      generatedAt,
    }
    const signature = await signBundlePayload({
      storage: localAiStorage,
      payload,
      identityInfo,
      signPayload,
    })
    const bundle = {
      version: UPDATE_BUNDLE_VERSION,
      bundleType: 'local-ai-update',
      payload,
      signature,
    }
    const nextBundlePath = bundlePath(
      localAiStorage,
      epoch,
      identityInfo.identity
    )

    await localAiStorage.writeJsonAtomic(nextBundlePath, bundle)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI update bundle built', {
        epoch,
        identity: identityInfo.identity,
        signed: signature.signed,
        eligibleCount: eligibleFlipHashes.length,
        bundlePath: nextBundlePath,
      })
    }

    return {
      epoch,
      identity: identityInfo.identity,
      bundlePath: nextBundlePath,
      signed: signature.signed,
      deltaType: payload.deltaType,
      eligibleCount: eligibleFlipHashes.length,
    }
  }

  async function importUpdateBundle(filePath) {
    let sourcePath = null

    try {
      sourcePath = assertBundlePath(localAiStorage, filePath)
    } catch {
      const result = buildImportResult({
        accepted: false,
        reason: 'bundle_path_outside_incoming',
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    }

    if (!sourcePath) {
      const result = buildImportResult({
        accepted: false,
        reason: 'file_path_required',
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    }

    if (!(await localAiStorage.exists(sourcePath))) {
      const result = buildImportResult({
        accepted: false,
        reason: 'file_not_found',
        bundlePath: sourcePath,
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    }

    let bundle

    try {
      bundle = await localAiStorage.readJson(sourcePath)
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error('Unable to load Local AI update bundle', {
          fileName: path.basename(sourcePath),
          error: error.toString(),
        })
      }

      const result = buildImportResult({
        accepted: false,
        reason: 'schema_invalid',
        bundlePath: sourcePath,
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    }

    const validation = validateBundleShape(bundle)

    if (!validation.ok) {
      const result = buildImportResult({
        accepted: false,
        reason: validation.reason,
        bundlePath: sourcePath,
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    }

    let bundleId = null

    try {
      const expectedBaseModel = await resolveBaseModelReference(
        localAiStorage,
        getBaseModelReference
      )

      if (
        validation.baseModelId !== expectedBaseModel.baseModelId ||
        validation.baseModelHash !== expectedBaseModel.baseModelHash
      ) {
        const result = buildImportResult({
          accepted: false,
          reason: 'base_model_mismatch',
          identity: validation.identity,
          epoch: validation.epoch,
          bundlePath: sourcePath,
        })

        if (isDev) {
          logImportResult(logger, result)
        }

        return result
      }

      const signatureCheck = await verifyBundleSignature({
        storage: localAiStorage,
        payload: validation.payload,
        signature: validation.signature,
        identity: validation.identity,
        verifySignature,
      })

      if (!signatureCheck.ok) {
        const result = buildImportResult({
          accepted: false,
          reason: signatureCheck.reason,
          identity: validation.identity,
          epoch: validation.epoch,
          bundlePath: sourcePath,
        })

        if (isDev) {
          logImportResult(logger, result)
        }

        return result
      }

      bundleId = computeBundleId(localAiStorage, bundle)
      const nextReceivedIndex = normalizeReceivedIndex(
        await localAiStorage.readJson(
          receivedIndexPath(localAiStorage),
          defaultReceivedIndex()
        )
      )

      if (
        nextReceivedIndex.bundles.some((item) => item.nonce === validation.nonce)
      ) {
        const result = buildImportResult({
          accepted: false,
          reason: 'duplicate_nonce',
          identity: validation.identity,
          epoch: validation.epoch,
          bundlePath: sourcePath,
          bundleId,
        })

        if (isDev) {
          logImportResult(logger, result)
        }

        return result
      }

      if (nextReceivedIndex.bundles.some((item) => item.bundleId === bundleId)) {
        const result = buildImportResult({
          accepted: false,
          reason: 'duplicate_bundle',
          identity: validation.identity,
          epoch: validation.epoch,
          bundlePath: sourcePath,
          bundleId,
        })

        if (isDev) {
          logImportResult(logger, result)
        }

        return result
      }

      const storedPath = receivedBundlePath(
        localAiStorage,
        validation.epoch,
        bundleId
      )
      const importedAt = new Date().toISOString()

      await localAiStorage.writeJsonAtomic(storedPath, bundle)
      await localAiStorage.writeJsonAtomic(receivedIndexPath(localAiStorage), {
        version: RECEIVED_INDEX_VERSION,
        bundles: nextReceivedIndex.bundles.concat({
          bundleId,
          nonce: validation.nonce,
          storedPath,
          importedAt,
          identity: validation.identity,
          epoch: validation.epoch,
          baseModelId: validation.baseModelId,
          baseModelHash: validation.baseModelHash,
          signatureType: validation.signature.type,
          signed: signatureCheck.signed,
        }),
      })

      const result = buildImportResult({
        accepted: true,
        reason: null,
        identity: validation.identity,
        epoch: validation.epoch,
        bundlePath: sourcePath,
        storedPath,
        bundleId,
        signed: signatureCheck.signed,
        signatureType: validation.signature.type,
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error('Local AI update bundle import failed', {
          fileName: path.basename(sourcePath),
          bundleId,
          error: error.toString(),
        })
      }

      const result = buildImportResult({
        accepted: false,
        reason: 'import_failed',
        identity: validation.identity,
        epoch: validation.epoch,
        bundlePath: sourcePath,
        bundleId,
      })

      if (isDev) {
        logImportResult(logger, result)
      }

      return result
    }
  }

  async function aggregateAcceptedBundles() {
    const expectedBaseModel = await resolveBaseModelReference(
      localAiStorage,
      getBaseModelReference
    )
    const nextReceivedIndex = normalizeReceivedIndex(
      await localAiStorage.readJson(
        receivedIndexPath(localAiStorage),
        defaultReceivedIndex()
      )
    )
    const acceptedBundles = nextReceivedIndex.bundles
    const compatibleBundles = []
    const skipped = []

    if (isDev) {
      logAcceptedBundles(logger, acceptedBundles)
    }

    for (const entry of acceptedBundles) {
      if (
        entry.baseModelId !== expectedBaseModel.baseModelId ||
        entry.baseModelHash !== expectedBaseModel.baseModelHash
      ) {
        skipped.push({
          bundleId: entry.bundleId,
          reason: 'base_model_mismatch',
        })
        continue
      }

      if (!(await localAiStorage.exists(entry.storedPath))) {
        skipped.push({
          bundleId: entry.bundleId,
          reason: 'missing_bundle_file',
        })
        continue
      }

      let bundle

      try {
        bundle = await localAiStorage.readJson(entry.storedPath)
      } catch {
        skipped.push({
          bundleId: entry.bundleId,
          reason: 'schema_invalid',
        })
        continue
      }

      const validation = validateBundleShape(bundle)

      if (!validation.ok) {
        skipped.push({
          bundleId: entry.bundleId,
          reason: validation.reason,
        })
        continue
      }

      if (computeBundleId(localAiStorage, bundle) !== entry.bundleId) {
        skipped.push({
          bundleId: entry.bundleId,
          reason: 'bundle_id_mismatch',
        })
        continue
      }

      if (
        validation.baseModelId !== expectedBaseModel.baseModelId ||
        validation.baseModelHash !== expectedBaseModel.baseModelHash
      ) {
        skipped.push({
          bundleId: entry.bundleId,
          reason: 'base_model_mismatch',
        })
        continue
      }

      compatibleBundles.push({entry, validation})
    }

    if (isDev) {
      logRejectedBundles(logger, skipped)
    }

    const bundlesWithDeltas = compatibleBundles.filter(({validation}) => {
      const deltaType = String(validation.payload.deltaType || '').trim()
      return deltaType && deltaType !== 'none'
    })
    let reason = 'no_real_model_deltas'
    let deltaAvailability = 'none'

    if (compatibleBundles.length < MIN_COMPATIBLE_BUNDLES) {
      reason = 'insufficient_compatible_bundles'
    } else if (bundlesWithDeltas.length > 0) {
      reason = 'unsupported_delta_payload'
      deltaAvailability = 'unsupported'
    }

    // MVP boundary: record compatibility and readiness only until real delta payloads exist.
    const result = buildAggregationSummary({
      baseModelId: expectedBaseModel.baseModelId,
      baseModelHash: expectedBaseModel.baseModelHash,
      compatibleBundles,
      skipped,
      deltaAvailability,
      reason,
    })
    const outputPath = aggregationResultPath(localAiStorage)

    await localAiStorage.writeJsonAtomic(outputPath, result)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI aggregation completed', {
        aggregated: result.aggregated,
        mode: result.mode,
      compatibleCount: result.compatibleCount,
      skippedCount: result.skippedCount,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      reason: result.reason,
      outputPath,
    })
    }

    return {
      aggregated: result.aggregated,
      mode: result.mode,
      compatibleCount: result.compatibleCount,
      skippedCount: result.skippedCount,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      outputPath,
      baseModelId: result.baseModelId,
    }
  }

  return {
    aggregateAcceptedBundles,
    buildUpdateBundle,
    importUpdateBundle,
  }
}

module.exports = {
  DEFAULT_BASE_MODEL_ID,
  PLACEHOLDER_IDENTITY,
  PLACEHOLDER_SIGNATURE_REASON,
  createLocalAiFederated,
}
