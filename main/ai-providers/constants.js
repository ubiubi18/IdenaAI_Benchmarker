const PROVIDERS = {
  OpenAI: 'openai',
  LocalAI: 'local-ai',
  OpenAICompatible: 'openai-compatible',
  Gemini: 'gemini',
  Anthropic: 'anthropic',
  XAI: 'xai',
  Mistral: 'mistral',
  Groq: 'groq',
  DeepSeek: 'deepseek',
  OpenRouter: 'openrouter',
}

const DEFAULT_MODELS = {
  [PROVIDERS.OpenAI]: 'gpt-5.4',
  [PROVIDERS.LocalAI]: '',
  [PROVIDERS.OpenAICompatible]: 'gpt-4o-mini',
  [PROVIDERS.Gemini]: 'gemini-2.0-flash',
  [PROVIDERS.Anthropic]: 'claude-3-7-sonnet-latest',
  [PROVIDERS.XAI]: 'grok-2-vision-latest',
  [PROVIDERS.Mistral]: 'mistral-large-latest',
  [PROVIDERS.Groq]: 'llama-3.2-90b-vision-preview',
  [PROVIDERS.DeepSeek]: 'deepseek-chat',
  [PROVIDERS.OpenRouter]: 'openai/gpt-4o-mini',
}

const PROVIDER_CONFIG_DEFAULTS = {
  [PROVIDERS.OpenAI]: {
    baseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  [PROVIDERS.OpenAICompatible]: {
    baseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  [PROVIDERS.XAI]: {
    baseUrl: 'https://api.x.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  [PROVIDERS.Mistral]: {
    baseUrl: 'https://api.mistral.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  [PROVIDERS.Groq]: {
    baseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  [PROVIDERS.DeepSeek]: {
    baseUrl: 'https://api.deepseek.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  [PROVIDERS.OpenRouter]: {
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    extraHeaders: {
      'HTTP-Referer': 'https://idena-benchmark.local',
      'X-Title': 'Idena Benchmark Desktop',
    },
  },
}

const OPENAI_COMPATIBLE_PROVIDERS = [
  PROVIDERS.OpenAI,
  PROVIDERS.OpenAICompatible,
  PROVIDERS.XAI,
  PROVIDERS.Mistral,
  PROVIDERS.Groq,
  PROVIDERS.DeepSeek,
  PROVIDERS.OpenRouter,
]

const STRICT_PROFILE = {
  benchmarkProfile: 'strict',
  // Target benchmark path: 6 flips solved within 60 seconds.
  deadlineMs: 60 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 1,
  maxRetries: 1,
  // 0 means "auto": do not impose an explicit completion token cap unless a
  // provider requires one. Runtime is bounded primarily by request/deadline.
  maxOutputTokens: 0,
  interFlipDelayMs: 650,
  temperature: 0,
  forceDecision: true,
  uncertaintyRepromptEnabled: true,
  uncertaintyConfidenceThreshold: 0.45,
  uncertaintyRepromptMinRemainingMs: 3500,
  uncertaintyRepromptInstruction: '',
  promptTemplateOverride: '',
  flipVisionMode: 'composite',
}

const CUSTOM_LIMITS = {
  deadlineMs: [10 * 1000, 180 * 1000],
  requestTimeoutMs: [1000, 180 * 1000],
  maxConcurrency: [1, 6],
  maxRetries: [0, 3],
  maxOutputTokens: [0, 8192],
  interFlipDelayMs: [0, 5000],
  temperature: [0, 2],
  uncertaintyConfidenceThreshold: [0, 1],
  uncertaintyRepromptMinRemainingMs: [500, 30 * 1000],
}

module.exports = {
  PROVIDERS,
  DEFAULT_MODELS,
  PROVIDER_CONFIG_DEFAULTS,
  OPENAI_COMPATIBLE_PROVIDERS,
  STRICT_PROFILE,
  CUSTOM_LIMITS,
}
