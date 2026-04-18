const {
  DEFAULT_LOCAL_AI_SETTINGS,
  DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
  DEFAULT_LOCAL_AI_OLLAMA_MODEL,
  DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
  RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
  RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
  RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
  STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
  FALLBACK_LOCAL_AI_TRAINING_MODEL,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE,
  DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE,
  DEVELOPER_LOCAL_TRAINING_PROFILE_CONFIG,
  DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
  DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID,
  DEFAULT_LOCAL_AI_PUBLIC_VISION_ID,
  buildLocalAiSettings,
  buildRecommendedLocalAiMacPreset,
  buildLocalAiRuntimePreset,
  getLocalAiEndpointSafety,
  mergeLocalAiSettings,
  normalizeDeveloperLocalTrainingProfile,
  normalizeDeveloperAiDraftTriggerMode,
  resolveDeveloperLocalTrainingProfileModelPath,
  resolveDeveloperLocalTrainingProfileRuntimeFallbackModel,
  resolveDeveloperLocalTrainingProfileRuntimeFallbackVisionModel,
  resolveDeveloperLocalTrainingProfileRuntimeModel,
  resolveDeveloperLocalTrainingProfileRuntimeVisionModel,
  resolveLocalAiWireRuntimeType,
} = require('./local-ai-settings')

describe('local-ai settings schema', () => {
  it('uses the recommended Ollama defaults', () => {
    const settings = buildLocalAiSettings()

    expect(settings.runtimeBackend).toBe('ollama-direct')
    expect(settings.reasonerBackend).toBe('local-reasoner')
    expect(settings.visionBackend).toBe('local-vision')
    expect(settings.publicModelId).toBe(DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID)
    expect(settings.publicVisionId).toBe(DEFAULT_LOCAL_AI_PUBLIC_VISION_ID)
    expect(settings.contractVersion).toBe('idena-local/v1')
    expect(settings.baseUrl).toBe(DEFAULT_LOCAL_AI_OLLAMA_BASE_URL)
    expect(settings.endpoint).toBe(DEFAULT_LOCAL_AI_OLLAMA_BASE_URL)
    expect(settings.model).toBe(DEFAULT_LOCAL_AI_OLLAMA_MODEL)
    expect(settings.visionModel).toBe(DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL)
    expect(settings.runtimeType).toBe('ollama')
    expect(settings.developerHumanTeacherSystemPrompt).toBe('')
    expect(settings.developerLocalTrainingProfile).toBe(
      DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE
    )
    expect(settings.developerAiDraftTriggerMode).toBe(
      DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE
    )
    expect(settings.shareHumanTeacherAnnotationsWithNetwork).toBe(false)
  })

  it('migrates legacy phi contract defaults into the Ollama setup', () => {
    const settings = buildLocalAiSettings({
      runtimeType: 'phi-sidecar',
      runtimeFamily: 'phi-3.5-vision',
      model: 'phi-3.5-vision-instruct',
      visionModel: 'phi-3.5-vision',
      baseUrl: 'http://127.0.0.1:5000',
      contractVersion: 'phi-sidecar/v1',
    })

    expect(settings.runtimeBackend).toBe('ollama-direct')
    expect(settings.reasonerBackend).toBe('local-reasoner')
    expect(settings.visionBackend).toBe('local-vision')
    expect(settings.publicModelId).toBe(DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID)
    expect(settings.publicVisionId).toBe(DEFAULT_LOCAL_AI_PUBLIC_VISION_ID)
    expect(settings.contractVersion).toBe('idena-local/v1')
    expect(settings.runtimeType).toBe('ollama')
    expect(settings.runtimeFamily).toBe('')
    expect(settings.baseUrl).toBe(DEFAULT_LOCAL_AI_OLLAMA_BASE_URL)
    expect(settings.model).toBe(DEFAULT_LOCAL_AI_OLLAMA_MODEL)
    expect(settings.visionModel).toBe(DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL)
  })

  it('upgrades legacy public identifiers to the branded IdenaAI names', () => {
    const settings = buildLocalAiSettings({
      publicModelId: 'idena-multimodal-v1',
      publicVisionId: 'idena-vision-v1',
    })

    expect(settings.publicModelId).toBe(DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID)
    expect(settings.publicVisionId).toBe(DEFAULT_LOCAL_AI_PUBLIC_VISION_ID)
  })

  it('keeps explicit neutral fields and nested preferences when merging', () => {
    const settings = mergeLocalAiSettings(
      buildLocalAiSettings({
        runtimeBackend: 'sidecar-http',
        federated: {enabled: false, minExamples: 5},
      }),
      {
        runtimeBackend: 'adapter-gateway',
        publicModelId: 'Idena-text-v2',
        federated: {enabled: true},
      }
    )

    expect(settings.runtimeBackend).toBe('adapter-gateway')
    expect(settings.publicModelId).toBe('Idena-text-v2')
    expect(settings.federated.enabled).toBe(true)
    expect(settings.federated.minExamples).toBe(5)
  })

  it('resolves legacy wire runtime types from the neutral backend when needed', () => {
    expect(
      resolveLocalAiWireRuntimeType({
        ...DEFAULT_LOCAL_AI_SETTINGS,
        runtimeBackend: 'ollama-direct',
      })
    ).toBe('ollama')

    expect(
      resolveLocalAiWireRuntimeType({
        ...DEFAULT_LOCAL_AI_SETTINGS,
        runtimeBackend: 'sidecar-http',
      })
    ).toBe('sidecar')

    expect(
      resolveLocalAiWireRuntimeType({
        ...DEFAULT_LOCAL_AI_SETTINGS,
        runtimeType: 'custom-runtime',
      })
    ).toBe('custom-runtime')
  })

  it('switches to the matching backend default URL when transport changes', () => {
    const settings = buildLocalAiSettings({
      runtimeBackend: 'ollama-direct',
      baseUrl: 'http://127.0.0.1:5000',
    })

    expect(settings.baseUrl).toBe(DEFAULT_LOCAL_AI_OLLAMA_BASE_URL)
    expect(settings.endpoint).toBe(DEFAULT_LOCAL_AI_OLLAMA_BASE_URL)
  })

  it('builds explicit backend presets for the settings UI', () => {
    expect(buildLocalAiRuntimePreset('ollama-direct')).toMatchObject({
      runtimeBackend: 'ollama-direct',
      baseUrl: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
      endpoint: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
      runtimeType: 'ollama',
      model: DEFAULT_LOCAL_AI_OLLAMA_MODEL,
      visionModel: DEFAULT_LOCAL_AI_OLLAMA_VISION_MODEL,
    })

    expect(buildLocalAiRuntimePreset('sidecar-http')).toMatchObject({
      runtimeBackend: 'sidecar-http',
      baseUrl: 'http://127.0.0.1:5000',
      endpoint: 'http://127.0.0.1:5000',
      runtimeType: 'sidecar',
      model: '',
      visionModel: '',
    })
  })

  it('builds a recommended Mac Ollama preset with qwen3.5:9b while keeping stronger and safe MLX fallbacks documented', () => {
    expect(buildRecommendedLocalAiMacPreset()).toMatchObject({
      runtimeBackend: 'ollama-direct',
      baseUrl: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
      endpoint: DEFAULT_LOCAL_AI_OLLAMA_BASE_URL,
      runtimeType: 'ollama',
      model: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
      visionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
    })

    expect(RECOMMENDED_LOCAL_AI_TRAINING_MODEL).toBe(
      'mlx-community/Qwen3.5-9B-MLX-4bit'
    )
    expect(STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL).toBe(
      'mlx-community/Qwen2.5-VL-7B-Instruct-4bit'
    )
    expect(FALLBACK_LOCAL_AI_TRAINING_MODEL).toBe(
      'mlx-community/Qwen2-VL-2B-Instruct-4bit'
    )
    expect(DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT).toMatch(
      /left-only or right-only bias/i
    )
  })

  it('keeps a persisted custom developer human-teacher system prompt', () => {
    const settings = buildLocalAiSettings({
      developerHumanTeacherSystemPrompt: 'Prefer chronology over slot bias.',
    })

    expect(settings.developerHumanTeacherSystemPrompt).toBe(
      'Prefer chronology over slot bias.'
    )
  })

  it('keeps a persisted developer local training profile', () => {
    const settings = buildLocalAiSettings({
      developerLocalTrainingProfile: 'balanced',
    })

    expect(settings.developerLocalTrainingProfile).toBe('strong')
    expect(normalizeDeveloperLocalTrainingProfile('unknown')).toBe(
      DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE
    )
    expect(normalizeDeveloperLocalTrainingProfile('safe')).toBe(
      DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE
    )
    expect(resolveDeveloperLocalTrainingProfileRuntimeModel('safe')).toBe(
      RECOMMENDED_LOCAL_AI_OLLAMA_MODEL
    )
    expect(resolveDeveloperLocalTrainingProfileRuntimeVisionModel('safe')).toBe(
      RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL
    )
    expect(
      resolveDeveloperLocalTrainingProfileRuntimeFallbackModel('safe')
    ).toBe('')
    expect(
      resolveDeveloperLocalTrainingProfileRuntimeFallbackVisionModel('safe')
    ).toBe('')
    expect(resolveDeveloperLocalTrainingProfileModelPath('safe')).toBe(
      RECOMMENDED_LOCAL_AI_TRAINING_MODEL
    )
    expect(resolveDeveloperLocalTrainingProfileRuntimeModel('strong')).toBe(
      RECOMMENDED_LOCAL_AI_OLLAMA_MODEL
    )
    expect(
      resolveDeveloperLocalTrainingProfileRuntimeVisionModel('strong')
    ).toBe(RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL)
    expect(
      resolveDeveloperLocalTrainingProfileRuntimeFallbackModel('strong')
    ).toBe('')
    expect(
      resolveDeveloperLocalTrainingProfileRuntimeFallbackVisionModel('strong')
    ).toBe('')
    expect(resolveDeveloperLocalTrainingProfileModelPath('strong')).toBe(
      RECOMMENDED_LOCAL_AI_TRAINING_MODEL
    )
    expect(DEVELOPER_LOCAL_TRAINING_PROFILE_CONFIG.strong).toMatchObject({
      modelPath: RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
      runtimeModel: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
    })
  })

  it('keeps a persisted developer annotation-sharing consent', () => {
    const settings = buildLocalAiSettings({
      shareHumanTeacherAnnotationsWithNetwork: true,
    })

    expect(settings.shareHumanTeacherAnnotationsWithNetwork).toBe(true)
  })

  it('keeps a persisted developer AI draft trigger mode', () => {
    const settings = buildLocalAiSettings({
      developerAiDraftTriggerMode: 'automatic',
    })

    expect(settings.developerAiDraftTriggerMode).toBe('automatic')
    expect(normalizeDeveloperAiDraftTriggerMode('manual')).toBe('manual')
    expect(normalizeDeveloperAiDraftTriggerMode('automatic')).toBe('automatic')
    expect(normalizeDeveloperAiDraftTriggerMode('unknown')).toBe(
      DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE
    )
  })

  it('accepts loopback-only Local AI endpoints', () => {
    expect(getLocalAiEndpointSafety('http://127.0.0.1:11434')).toMatchObject({
      safe: true,
      normalizedBaseUrl: 'http://127.0.0.1:11434',
    })

    expect(getLocalAiEndpointSafety('http://localhost:11434/')).toMatchObject({
      safe: true,
      normalizedBaseUrl: 'http://localhost:11434',
    })
  })

  it('rejects remote or credentialed Local AI endpoints', () => {
    expect(getLocalAiEndpointSafety('https://example.com:11434')).toMatchObject(
      {
        safe: false,
        reason: 'loopback_only',
      }
    )

    expect(
      getLocalAiEndpointSafety('http://user:pass@127.0.0.1:11434')
    ).toMatchObject({
      safe: false,
      reason: 'credentials_not_allowed',
    })
  })
})
