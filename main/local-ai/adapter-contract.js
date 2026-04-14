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

function resolveAdapterContract(storage, payload = {}, modelReference = {}) {
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
    trainingConfigHash:
      trimString(payload.trainingConfigHash) ||
      buildTrainingConfigHash(storage, payload, modelReference),
  }
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
