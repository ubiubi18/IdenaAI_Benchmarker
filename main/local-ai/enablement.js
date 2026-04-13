const LOCAL_AI_DISABLED_ERROR = 'Local AI is disabled'

function isLocalAiEnabled(settings = {}) {
  return Boolean(settings && settings.localAi && settings.localAi.enabled)
}

function ensureLocalAiEnabled(settings = {}) {
  if (!isLocalAiEnabled(settings)) {
    throw new Error(LOCAL_AI_DISABLED_ERROR)
  }
}

module.exports = {
  LOCAL_AI_DISABLED_ERROR,
  isLocalAiEnabled,
  ensureLocalAiEnabled,
}
