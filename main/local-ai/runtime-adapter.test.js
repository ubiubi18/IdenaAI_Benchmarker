const {
  LOCAL_AI_DEFAULT_BASE_URL,
  LOCAL_AI_RUNTIME_BACKEND,
} = require('./constants')
const {
  LOCAL_AI_OLLAMA_DEFAULT_BASE_URL,
  LOCAL_AI_OLLAMA_RUNTIME,
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  LOCAL_AI_SIDECAR_RUNTIME_BACKEND,
  resolveLocalAiRuntimeAdapter,
  resolveLocalAiRuntimeBackend,
} = require('./runtime-adapter')

describe('local-ai runtime adapter', () => {
  it('maps ollama runtimeType into the neutral backend identifier', () => {
    expect(resolveLocalAiRuntimeBackend({runtimeType: 'ollama'})).toBe(
      LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    )
  })

  it('maps sidecar-like runtime names into the neutral backend identifier', () => {
    expect(resolveLocalAiRuntimeBackend({runtime: 'local-ai-sidecar'})).toBe(
      LOCAL_AI_SIDECAR_RUNTIME_BACKEND
    )
    expect(resolveLocalAiRuntimeBackend({runtimeType: 'phi-sidecar'})).toBe(
      LOCAL_AI_SIDECAR_RUNTIME_BACKEND
    )
  })

  it('derives the correct runtime config from runtimeBackend alone', () => {
    expect(
      resolveLocalAiRuntimeAdapter({runtimeBackend: 'ollama-direct'})
    ).toMatchObject({
      runtime: LOCAL_AI_OLLAMA_RUNTIME,
      runtimeBackend: LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
      runtimeType: 'ollama',
      defaultBaseUrl: LOCAL_AI_OLLAMA_DEFAULT_BASE_URL,
      baseUrl: LOCAL_AI_OLLAMA_DEFAULT_BASE_URL,
    })
  })

  it('falls back to the configured backend when payload omits runtime fields', () => {
    expect(
      resolveLocalAiRuntimeAdapter(
        {},
        {
          runtimeBackend: 'ollama-direct',
        }
      )
    ).toMatchObject({
      runtime: LOCAL_AI_OLLAMA_RUNTIME,
      runtimeBackend: LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
      runtimeType: 'ollama',
      baseUrl: LOCAL_AI_OLLAMA_DEFAULT_BASE_URL,
    })
  })

  it('keeps ollama-direct defaults when no explicit backend is provided', () => {
    expect(resolveLocalAiRuntimeAdapter()).toMatchObject({
      runtime: LOCAL_AI_OLLAMA_RUNTIME,
      runtimeBackend: LOCAL_AI_RUNTIME_BACKEND,
      runtimeType: 'ollama',
      baseUrl: LOCAL_AI_DEFAULT_BASE_URL,
    })
  })
})
