const {
  buildLocalAiRuntimePayload,
  checkAiProviderReadiness,
  formatMissingAiProviders,
  getRequiredAiProviders,
} = require('./ai-provider-readiness')

describe('ai-provider-readiness', () => {
  it('collects all required providers for ensemble mode without duplicates', () => {
    expect(
      getRequiredAiProviders({
        provider: 'openai',
        ensembleEnabled: true,
        ensembleProvider2Enabled: true,
        ensembleProvider2: 'gemini',
        ensembleProvider3Enabled: true,
        ensembleProvider3: 'openai',
      })
    ).toEqual(['openai', 'gemini'])
  })

  it('does not require cloud keys for legacy-only mode', async () => {
    await expect(
      checkAiProviderReadiness({
        bridge: {
          hasProviderKey: jest.fn(),
        },
        aiSolver: {
          legacyHeuristicEnabled: true,
          legacyHeuristicOnly: true,
        },
      })
    ).resolves.toMatchObject({
      allReady: true,
      primaryReady: true,
      requiredProviders: [],
      missingProviders: [],
    })
  })

  it('reports missing providers across ensemble slots', async () => {
    await expect(
      checkAiProviderReadiness({
        bridge: {
          hasProviderKey: jest.fn(async ({provider}) => ({
            hasKey: provider === 'openai',
          })),
        },
        aiSolver: {
          provider: 'openai',
          ensembleEnabled: true,
          ensembleProvider2Enabled: true,
          ensembleProvider2: 'gemini',
          ensembleProvider3Enabled: true,
          ensembleProvider3: 'anthropic',
        },
      })
    ).resolves.toMatchObject({
      allReady: false,
      primaryReady: true,
      missingProviders: ['gemini', 'anthropic'],
    })
  })

  it('returns a readable missing-provider list', () => {
    expect(formatMissingAiProviders(['openai', 'gemini', 'openai', ''])).toBe(
      'openai, gemini'
    )
  })

  it('keeps the local AI enabled flag in the runtime payload', () => {
    expect(
      buildLocalAiRuntimePayload({
        enabled: true,
        runtimeBackend: 'ollama-direct',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        adapterStrategy: 'lora',
        trainingPolicy: 'manual',
        rankingPolicy: {allowPublicIndexerFallback: false},
      })
    ).toMatchObject({
      enabled: true,
      runtimeBackend: 'ollama-direct',
      baseUrl: 'http://127.0.0.1:11434',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b',
      adapterStrategy: 'lora',
      trainingPolicy: 'manual',
      rankingPolicy: {allowPublicIndexerFallback: false},
    })
  })

  it('preserves the managed runtime family in the runtime payload', () => {
    expect(
      buildLocalAiRuntimePayload({
        enabled: true,
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'molmo2-o',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'allenai/Molmo2-O-7B',
        visionModel: 'allenai/Molmo2-O-7B',
      })
    ).toMatchObject({
      enabled: true,
      runtimeBackend: 'local-runtime-service',
      runtimeFamily: 'molmo2-o',
      baseUrl: 'http://127.0.0.1:8080',
      endpoint: 'http://127.0.0.1:8080',
      model: 'allenai/Molmo2-O-7B',
      visionModel: 'allenai/Molmo2-O-7B',
    })
  })

  it('rejects unsafe local AI endpoints before checking the bridge', async () => {
    const localBridge = {
      status: jest.fn(),
    }

    await expect(
      checkAiProviderReadiness({
        localBridge,
        localAi: {
          enabled: true,
          runtimeBackend: 'ollama-direct',
          baseUrl: 'https://example.com:11434',
          model: 'llama3.1:8b',
        },
        aiSolver: {
          provider: 'local-ai',
        },
      })
    ).resolves.toMatchObject({
      allReady: false,
      primaryReady: false,
      missingProviders: ['local-ai'],
      error:
        'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
    })

    expect(localBridge.status).not.toHaveBeenCalled()
  })
})
