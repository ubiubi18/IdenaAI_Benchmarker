const {
  LOCAL_AI_ADAPTER_STRATEGY,
  LOCAL_AI_TRAINING_POLICY,
} = require('./constants')

const DEFAULT_LOCAL_AI_ADAPTER_FORMAT = 'peft_lora_v1'
const DEFAULT_LOCAL_AI_DELTA_TYPE = 'pending_adapter'
const CONCRETE_LOCAL_AI_DELTA_TYPE = 'lora_adapter'

function trimString(value) {
  return String(value || '').trim()
}

function buildTrainingConfigSource(payload = {}, modelReference = {}) {
  return {
    adapterStrategy:
      trimString(payload.adapterStrategy) || LOCAL_AI_ADAPTER_STRATEGY,
    trainingPolicy:
      trimString(payload.trainingPolicy) || LOCAL_AI_TRAINING_POLICY,
    publicModelId:
      trimString(modelReference.publicModelId || payload.publicModelId) || null,
    publicVisionId:
      trimString(modelReference.publicVisionId || payload.publicVisionId) ||
      null,
    runtimeBackend:
      trimString(modelReference.runtimeBackend || payload.runtimeBackend) ||
      null,
    reasonerBackend:
      trimString(modelReference.reasonerBackend || payload.reasonerBackend) ||
      null,
    visionBackend:
      trimString(modelReference.visionBackend || payload.visionBackend) || null,
    contractVersion:
      trimString(modelReference.contractVersion || payload.contractVersion) ||
      null,
    baseModelId:
      trimString(modelReference.baseModelId || payload.baseModelId) || null,
    baseModelHash:
      trimString(modelReference.baseModelHash || payload.baseModelHash) || null,
  }
}

function buildTrainingConfigHash(storage, payload = {}, modelReference = {}) {
  return storage.sha256(
    JSON.stringify(buildTrainingConfigSource(payload, modelReference))
  )
}

function normalizeEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) && epoch >= 0 ? epoch : null
}

function normalizeAdapterArtifactRecord(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null
  }

  const nestedArtifact =
    record.adapterArtifact &&
    typeof record.adapterArtifact === 'object' &&
    !Array.isArray(record.adapterArtifact)
      ? record.adapterArtifact
      : {}

  const file =
    trimString(nestedArtifact.file || record.artifactFile || record.file) ||
    null
  const rawSize =
    nestedArtifact.sizeBytes || record.artifactSizeBytes || record.sizeBytes
  const sizeBytes = Number.parseInt(rawSize, 10)

  if (!file && !Number.isFinite(sizeBytes)) {
    return null
  }

  return {
    file,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
  }
}

function resolveExplicitAdapterContract(
  storage,
  payload = {},
  modelReference = {}
) {
  const adapterSha256 = trimString(payload.adapterSha256) || null
  const adapterFormat =
    trimString(payload.adapterFormat) || DEFAULT_LOCAL_AI_ADAPTER_FORMAT
  const deltaTypeInput = trimString(payload.deltaType).toLowerCase()
  let deltaType = DEFAULT_LOCAL_AI_DELTA_TYPE

  if (deltaTypeInput && deltaTypeInput !== 'none') {
    deltaType = deltaTypeInput
  } else if (adapterSha256) {
    deltaType = CONCRETE_LOCAL_AI_DELTA_TYPE
  }

  return {
    deltaType,
    adapterFormat,
    adapterSha256,
    adapterArtifact: normalizeAdapterArtifactRecord(payload),
    trainingConfigHash:
      trimString(payload.trainingConfigHash) ||
      buildTrainingConfigHash(storage, payload, modelReference),
  }
}

function adapterManifestCandidates(storage, payload = {}) {
  if (
    !storage ||
    typeof storage.resolveLocalAiPath !== 'function' ||
    typeof storage.exists !== 'function' ||
    typeof storage.readJson !== 'function'
  ) {
    return []
  }

  const epoch = normalizeEpoch(payload.epoch)
  const candidates = []

  if (epoch !== null) {
    candidates.push(
      storage.resolveLocalAiPath('adapters', `epoch-${epoch}.json`)
    )
  }

  candidates.push(storage.resolveLocalAiPath('adapters', 'current.json'))

  return Array.from(new Set(candidates.filter(Boolean)))
}

function isCompatibleAdapterRecord(record, payload = {}, modelReference = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return false
  }

  const expectedBaseModelId =
    trimString(modelReference.baseModelId || payload.baseModelId) || null
  const expectedBaseModelHash =
    trimString(modelReference.baseModelHash || payload.baseModelHash) || null
  const recordBaseModelId = trimString(record.baseModelId) || null
  const recordBaseModelHash = trimString(record.baseModelHash) || null

  if (
    expectedBaseModelId &&
    recordBaseModelId &&
    recordBaseModelId !== expectedBaseModelId
  ) {
    return false
  }

  if (
    expectedBaseModelHash &&
    recordBaseModelHash &&
    recordBaseModelHash !== expectedBaseModelHash
  ) {
    return false
  }

  return Boolean(trimString(record.adapterSha256))
}

async function readStoredAdapterContract(
  storage,
  payload = {},
  modelReference = {}
) {
  for (const candidatePath of adapterManifestCandidates(storage, payload)) {
    if (await storage.exists(candidatePath)) {
      const record = await storage.readJson(candidatePath, null)

      if (isCompatibleAdapterRecord(record, payload, modelReference)) {
        return {
          deltaType: CONCRETE_LOCAL_AI_DELTA_TYPE,
          adapterFormat:
            trimString(record.adapterFormat) || DEFAULT_LOCAL_AI_ADAPTER_FORMAT,
          adapterSha256: trimString(record.adapterSha256) || null,
          adapterArtifact: normalizeAdapterArtifactRecord(record),
          trainingConfigHash:
            trimString(record.trainingConfigHash) ||
            buildTrainingConfigHash(storage, payload, modelReference),
        }
      }
    }
  }

  return null
}

async function resolveAdapterContract(
  storage,
  payload = {},
  modelReference = {}
) {
  const explicitContract = resolveExplicitAdapterContract(
    storage,
    payload,
    modelReference
  )

  if (explicitContract.adapterSha256) {
    return explicitContract
  }

  const storedContract = await readStoredAdapterContract(
    storage,
    payload,
    modelReference
  )

  if (storedContract) {
    return {
      ...explicitContract,
      ...storedContract,
    }
  }

  return explicitContract
}

function hasConcreteAdapterDelta(payload = {}) {
  return (
    trimString(payload.deltaType).toLowerCase() ===
      CONCRETE_LOCAL_AI_DELTA_TYPE && Boolean(trimString(payload.adapterSha256))
  )
}

module.exports = {
  CONCRETE_LOCAL_AI_DELTA_TYPE,
  DEFAULT_LOCAL_AI_ADAPTER_FORMAT,
  DEFAULT_LOCAL_AI_DELTA_TYPE,
  buildTrainingConfigHash,
  buildTrainingConfigSource,
  hasConcreteAdapterDelta,
  resolveAdapterContract,
}
