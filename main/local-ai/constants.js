const LOCAL_AI_PROVIDER = 'local-ai'
const LOCAL_AI_RUNTIME_MODE = 'sidecar'
const LOCAL_AI_RUNTIME = 'phi-local-sidecar'
const LOCAL_AI_RUNTIME_FAMILY = 'phi-3.5-vision'
const LOCAL_AI_DEFAULT_BASE_URL = 'http://127.0.0.1:5000'
const LOCAL_AI_DEFAULT_MODEL = 'phi-3.5-vision-instruct'
const LOCAL_AI_ADAPTER_STRATEGY = 'lora-first'
const LOCAL_AI_TRAINING_POLICY = 'approved-post-consensus-only'
const LOCAL_AI_CONTRACT_VERSION = 'phi-sidecar/v1'
const LOCAL_AI_BASE_MODEL_ID =
  'local-ai:phi-3.5-vision:adapter-lora-first-v1'

module.exports = {
  LOCAL_AI_PROVIDER,
  LOCAL_AI_RUNTIME_MODE,
  LOCAL_AI_RUNTIME,
  LOCAL_AI_RUNTIME_FAMILY,
  LOCAL_AI_DEFAULT_BASE_URL,
  LOCAL_AI_DEFAULT_MODEL,
  LOCAL_AI_ADAPTER_STRATEGY,
  LOCAL_AI_TRAINING_POLICY,
  LOCAL_AI_CONTRACT_VERSION,
  LOCAL_AI_BASE_MODEL_ID,
}
