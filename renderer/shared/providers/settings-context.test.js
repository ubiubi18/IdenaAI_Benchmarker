const {
  buildAiSolverSettings,
  buildEffectiveSettingsState,
  isValidationRehearsalNodeSettings,
} = require('./settings-context')

describe('settings-context ai solver normalization', () => {
  it('keeps the default system reserve for AI sessions', () => {
    expect(buildAiSolverSettings()).toMatchObject({
      memoryBudgetGiB: 32,
      systemReserveGiB: 6,
      localAiMemoryReference: 'molmo2-o-7b',
    })
  })

  it('normalizes explicit reserve values', () => {
    expect(
      buildAiSolverSettings({
        memoryBudgetGiB: '24',
        systemReserveGiB: '7',
      })
    ).toMatchObject({
      memoryBudgetGiB: 24,
      systemReserveGiB: 7,
    })
  })

  it('falls back when the reserve is invalid', () => {
    expect(
      buildAiSolverSettings({
        systemReserveGiB: '-5',
      })
    ).toMatchObject({
      systemReserveGiB: 6,
    })
  })

  it('caps the reserve at a sane upper bound', () => {
    expect(
      buildAiSolverSettings({
        systemReserveGiB: '999',
      })
    ).toMatchObject({
      systemReserveGiB: 64,
    })
  })

  it('normalizes short-session OpenAI fast mode settings', () => {
    expect(
      buildAiSolverSettings({
        shortSessionOpenAiFastEnabled: 1,
        shortSessionOpenAiFastModel: 'not-a-model',
      })
    ).toMatchObject({
      shortSessionOpenAiFastEnabled: true,
      shortSessionOpenAiFastModel: 'gpt-5.4-mini',
    })
  })

  it('accepts gpt-5.5 fast-mode selections without downgrading them', () => {
    expect(
      buildAiSolverSettings({
        shortSessionOpenAiFastEnabled: true,
        shortSessionOpenAiFastModel: 'gpt-5.5-mini',
      })
    ).toMatchObject({
      shortSessionOpenAiFastEnabled: true,
      shortSessionOpenAiFastModel: 'gpt-5.5-mini',
    })
  })

  it('keeps the internal node preference while routing through an ephemeral rehearsal node', () => {
    expect(
      buildEffectiveSettingsState(
        {
          runInternalNode: true,
          useExternalNode: false,
          url: 'http://localhost:9009',
          externalApiKey: '',
        },
        {
          url: 'http://127.0.0.1:22301',
          apiKey: 'rehearsal-secret',
          label: 'Validation rehearsal node',
        }
      )
    ).toMatchObject({
      runInternalNode: true,
      useExternalNode: true,
      url: 'http://127.0.0.1:22301',
      externalApiKey: 'rehearsal-secret',
      externalNodeMode: 'ephemeral',
      ephemeralExternalNodeConnected: true,
    })
  })

  it('detects rehearsal sessions from the ephemeral connection flag', () => {
    expect(
      isValidationRehearsalNodeSettings({
        useExternalNode: true,
        ephemeralExternalNodeConnected: true,
        externalNodeLabel: '',
      })
    ).toBe(true)
  })
})
