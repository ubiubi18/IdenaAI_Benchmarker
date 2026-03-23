const PROVIDERS = {
  OpenAI: 'openai',
  Gemini: 'gemini',
}

const DEFAULT_MODELS = {
  [PROVIDERS.OpenAI]: 'gpt-4o-mini',
  [PROVIDERS.Gemini]: 'gemini-2.0-flash',
}

const STRICT_PROFILE = {
  benchmarkProfile: 'strict',
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 2,
  maxRetries: 1,
  maxOutputTokens: 120,
}

const CUSTOM_LIMITS = {
  deadlineMs: [10 * 1000, 180 * 1000],
  requestTimeoutMs: [1000, 30 * 1000],
  maxConcurrency: [1, 6],
  maxRetries: [0, 3],
  maxOutputTokens: [16, 512],
}

module.exports = {
  PROVIDERS,
  DEFAULT_MODELS,
  STRICT_PROFILE,
  CUSTOM_LIMITS,
}
