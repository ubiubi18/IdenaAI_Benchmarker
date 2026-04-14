const {
  LOCAL_AI_RUNTIME_BACKEND,
  LOCAL_AI_REASONER_BACKEND,
  LOCAL_AI_VISION_BACKEND,
  LOCAL_AI_CONTRACT_VERSION,
  LOCAL_AI_PUBLIC_MODEL_ID,
  LOCAL_AI_PUBLIC_VISION_ID,
  LOCAL_AI_BASE_MODEL_ID,
} = require('./constants')

function trimString(value) {
  return String(value || '').trim()
}

function normalizeModelReference(storage, value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  const publicModelId =
    trimString(source.publicModelId) || LOCAL_AI_PUBLIC_MODEL_ID
  const publicVisionId =
    trimString(source.publicVisionId) || LOCAL_AI_PUBLIC_VISION_ID
  const runtimeBackend =
    trimString(source.runtimeBackend || source.runtime) ||
    LOCAL_AI_RUNTIME_BACKEND
  const reasonerBackend =
    trimString(source.reasonerBackend || source.runtimeFamily) ||
    LOCAL_AI_REASONER_BACKEND
  const visionBackend =
    trimString(source.visionBackend) || LOCAL_AI_VISION_BACKEND
  const contractVersion =
    trimString(source.contractVersion) || LOCAL_AI_CONTRACT_VERSION
  const baseModelId = trimString(source.baseModelId) || LOCAL_AI_BASE_MODEL_ID
  const baseModelHash =
    trimString(source.baseModelHash) || storage.sha256(baseModelId)

  return {
    publicModelId,
    publicVisionId,
    runtimeBackend,
    reasonerBackend,
    visionBackend,
    contractVersion,
    baseModelId,
    baseModelHash,
  }
}

async function resolveModelReference(storage, getModelReference, payload = {}) {
  if (typeof getModelReference !== 'function') {
    return normalizeModelReference(storage, payload)
  }

  try {
    return normalizeModelReference(storage, await getModelReference(payload))
  } catch {
    return normalizeModelReference(storage, payload)
  }
}

module.exports = {
  normalizeModelReference,
  resolveModelReference,
}
