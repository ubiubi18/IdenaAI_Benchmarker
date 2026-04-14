const {
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
})
