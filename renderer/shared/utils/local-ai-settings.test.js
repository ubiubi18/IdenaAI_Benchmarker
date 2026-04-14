const {
  DEFAULT_LOCAL_AI_SETTINGS,
  buildLocalAiSettings,
  mergeLocalAiSettings,
  resolveLocalAiWireRuntimeType,
} = require('./local-ai-settings')

describe('local-ai settings schema', () => {
  it('uses neutral product defaults', () => {
    const settings = buildLocalAiSettings()

    expect(settings.runtimeBackend).toBe('sidecar-http')
    expect(settings.reasonerBackend).toBe('local-reasoner')
    expect(settings.visionBackend).toBe('local-vision')
    expect(settings.publicModelId).toBe('idena-core-v1')
    expect(settings.publicVisionId).toBe('idena-vision-v1')
    expect(settings.contractVersion).toBe('idena-local/v1')
    expect(settings.model).toBe('')
    expect(settings.visionModel).toBe('')
    expect(settings.runtimeType).toBe('')
  })

  it('migrates legacy phi contract settings to neutral public identifiers', () => {
    const settings = buildLocalAiSettings({
      runtimeType: 'phi-sidecar',
      runtimeFamily: 'phi-3.5-vision',
      model: 'phi-3.5-vision-instruct',
      visionModel: 'phi-3.5-vision',
      contractVersion: 'phi-sidecar/v1',
    })

    expect(settings.runtimeBackend).toBe('sidecar-http')
    expect(settings.reasonerBackend).toBe('local-reasoner')
    expect(settings.visionBackend).toBe('local-vision')
    expect(settings.publicModelId).toBe('idena-core-v1')
    expect(settings.publicVisionId).toBe('idena-vision-v1')
    expect(settings.contractVersion).toBe('idena-local/v1')
    expect(settings.runtimeType).toBe('phi-sidecar')
    expect(settings.runtimeFamily).toBe('phi-3.5-vision')
    expect(settings.model).toBe('phi-3.5-vision-instruct')
    expect(settings.visionModel).toBe('phi-3.5-vision')
  })

  it('keeps explicit neutral fields and nested preferences when merging', () => {
    const settings = mergeLocalAiSettings(
      buildLocalAiSettings({
        runtimeBackend: 'sidecar-http',
        federated: {enabled: false, minExamples: 5},
      }),
      {
        runtimeBackend: 'adapter-gateway',
        publicModelId: 'idena-core-v2',
        federated: {enabled: true},
      }
    )

    expect(settings.runtimeBackend).toBe('adapter-gateway')
    expect(settings.publicModelId).toBe('idena-core-v2')
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
    ).toBe('phi-sidecar')

    expect(
      resolveLocalAiWireRuntimeType({
        ...DEFAULT_LOCAL_AI_SETTINGS,
        runtimeType: 'custom-runtime',
      })
    ).toBe('custom-runtime')
  })
})
