const {createAiProviderBridge} = require('./bridge')
const {selectSensePair} = require('./senseSelector')

function mockLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
  }
}

function sequenceClock(values) {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)]
    index += 1
    return value
  }
}

const STORY_PANEL_ROLES = ['before', 'trigger', 'reaction', 'after']

function makeComplianceReport(overrides = {}) {
  return {
    keyword_relevance: 'pass',
    no_text_needed: 'pass',
    no_order_labels: 'pass',
    no_inappropriate_content: 'pass',
    single_story_only: 'pass',
    no_waking_up_template: 'pass',
    no_thumbs_up_down: 'pass',
    no_enumeration_logic: 'pass',
    no_screen_or_page_keyword_cheat: 'pass',
    causal_clarity: 'pass',
    consensus_clarity: 'pass',
    ...overrides,
  }
}

function makeStrictStoryOption({
  title,
  storySummary,
  panels,
  complianceReport = null,
}) {
  return {
    title,
    story_summary: storySummary,
    panels: panels.map((panel, index) => ({
      panel: index + 1,
      role: STORY_PANEL_ROLES[index],
      description: String(panel.description || panel).trim(),
      required_visibles:
        Array.isArray(panel.required_visibles) && panel.required_visibles.length
          ? panel.required_visibles
          : ['subject', `anchor-${index + 1}`],
      state_change_from_previous:
        String(panel.state_change_from_previous || '').trim() ||
        (index === 0 ? 'n/a' : `Visible change appears in panel ${index + 1}.`),
    })),
    compliance_report: makeComplianceReport(complianceReport || {}),
    risk_flags: [],
    revision_if_risky: '',
  }
}

function makeStrictStoryResponse(stories, providerMeta = null) {
  return {
    rawText: JSON.stringify({stories}),
    usage: {
      promptTokens: 40,
      completionTokens: 30,
      totalTokens: 70,
    },
    ...(providerMeta ? {providerMeta} : {}),
  }
}

describe('createAiProviderBridge', () => {
  it('marks remaining flips as deadline_exceeded once budget is passed', async () => {
    const writeBenchmarkLog = jest.fn().mockResolvedValue(undefined)
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"left","confidence":0.9}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog,
      now: sequenceClock([1000, 1000, 3500, 12000, 13000]),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      deadlineMs: 10000,
      requestTimeoutMs: 1000,
      maxConcurrency: 1,
      maxRetries: 0,
      maxOutputTokens: 64,
      forceDecision: false,
      uncertaintyRepromptEnabled: false,
      flips: [{hash: 'flip-2'}, {hash: 'flip-4'}],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(result.results[0]).toMatchObject({
      hash: 'flip-2',
      rawAnswerBeforeRemap: 'left',
      finalAnswerAfterRemap: result.results[0].answer,
      confidence: 0.9,
    })
    expect(result.results[1]).toMatchObject({
      hash: 'flip-4',
      answer: 'skip',
      error: 'deadline_exceeded',
    })
    expect(writeBenchmarkLog).toHaveBeenCalledTimes(1)
  })

  it('returns a readable provider error for failed OpenAI test calls', async () => {
    const logger = mockLogger()
    const httpClient = {
      post: jest.fn().mockRejectedValue({
        response: {
          status: 401,
          data: {
            error: {
              code: 'invalid_api_key',
              message: 'Incorrect API key provided',
            },
          },
        },
      }),
    }

    const bridge = createAiProviderBridge(logger, {httpClient})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    await expect(
      bridge.testProvider({provider: 'openai', model: 'gpt-4o-mini'})
    ).rejects.toThrow(
      'openai test failed (401 invalid_api_key) for model gpt-4o-mini: Incorrect API key provided'
    )

    expect(logger.error).toHaveBeenCalled()
  })

  it('retries provider test once on 429 and succeeds', async () => {
    const logger = mockLogger()
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce({
          response: {status: 429, headers: {'retry-after': '0'}},
          message: 'rate limited',
        })
        .mockResolvedValueOnce({data: {id: 'ok'}}),
    }
    const sleep = jest.fn().mockResolvedValue(undefined)
    const bridge = createAiProviderBridge(logger, {httpClient, sleep})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.testProvider({
      provider: 'openai',
      model: 'gpt-4o-mini',
    })

    expect(result.ok).toBe(true)
    expect(httpClient.post).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('retries one flip request on 429 and records the successful answer', async () => {
    const writeBenchmarkLog = jest.fn().mockResolvedValue(undefined)
    const invokeProvider = jest
      .fn()
      .mockRejectedValueOnce({
        response: {status: 429, headers: {'retry-after': '0'}},
        message: 'rate limited',
      })
      .mockResolvedValueOnce('{"answer":"right","confidence":0.8}')

    const sleep = jest.fn().mockResolvedValue(undefined)

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog,
      sleep,
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      deadlineMs: 10000,
      requestTimeoutMs: 1000,
      maxConcurrency: 1,
      maxRetries: 1,
      maxOutputTokens: 64,
      flips: [{hash: 'flip-rate-limit'}],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(result.results[0]).toMatchObject({
      hash: 'flip-rate-limit',
      sideSwapped: true,
      rawAnswerBeforeRemap: 'right',
      finalAnswerAfterRemap: 'left',
      answer: 'left',
      confidence: 0.8,
    })
  })

  it('remaps right-biased answers when side order is swapped', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"right","confidence":0.8}')
    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      flips: [{hash: 'flip-1', leftImage: 'left', rightImage: 'right'}],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(result.results[0]).toMatchObject({
      hash: 'flip-1',
      sideSwapped: true,
      rawAnswerBeforeRemap: 'right',
      finalAnswerAfterRemap: 'left',
      answer: 'left',
      confidence: 0.8,
    })
    expect(invokeProvider.mock.calls[0][0].flip).toMatchObject({
      hash: 'flip-1',
      leftImage: 'right',
      rightImage: 'left',
    })
  })

  it('fails fast when solveFlipBatch is called without provider key', async () => {
    const invokeProvider = jest.fn()
    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})

    await expect(
      bridge.solveFlipBatch({
        provider: 'openai',
        model: 'gpt-4o-mini',
        flips: [{hash: 'flip-no-key'}],
      })
    ).rejects.toThrow('API key is not set for provider: openai')

    expect(invokeProvider).not.toHaveBeenCalled()
  })

  it('allows legacy-only mode without any cloud provider API key', async () => {
    const invokeProvider = jest.fn()
    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      legacyHeuristicEnabled: true,
      legacyHeuristicOnly: true,
      legacyHeuristicWeight: 1,
      flips: [
        {
          hash: 'flip-legacy-only',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          leftFrames: [
            'data:image/png;base64,L1=',
            'data:image/png;base64,L2=',
            'data:image/png;base64,L3=',
            'data:image/png;base64,L4=',
          ],
          rightFrames: [
            'data:image/png;base64,R1=',
            'data:image/png;base64,R2=',
            'data:image/png;base64,R3=',
            'data:image/png;base64,R4=',
          ],
        },
      ],
    })

    expect(invokeProvider).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      provider: 'legacy-heuristic',
      model: 'legacy-heuristic-v1',
    })
    expect(result.results[0].consultedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'legacy-heuristic',
          model: 'legacy-heuristic-v1',
        }),
      ])
    )
  })

  it('reports provider key presence for selected provider', () => {
    const bridge = createAiProviderBridge(mockLogger())

    expect(bridge.hasProviderKey({provider: 'openai'})).toEqual({
      ok: true,
      provider: 'openai',
      hasKey: false,
    })

    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})
    expect(bridge.hasProviderKey({provider: 'openai'})).toEqual({
      ok: true,
      provider: 'openai',
      hasKey: true,
    })

    bridge.clearProviderKey({provider: 'openai'})
    expect(bridge.hasProviderKey({provider: 'openai'})).toEqual({
      ok: true,
      provider: 'openai',
      hasKey: false,
    })
  })

  it('supports openai-compatible provider endpoint config', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValue({data: {choices: [{message: {content: '{}'}}]}}),
    }
    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'openai-compatible', apiKey: 'sk-custom'})

    const result = await bridge.testProvider({
      provider: 'openai-compatible',
      model: 'custom-model',
      providerConfig: {
        baseUrl: 'https://example-provider.local/v1',
        chatPath: '/chat/completions',
      },
    })

    expect(result).toMatchObject({
      ok: true,
      provider: 'openai-compatible',
      model: 'custom-model',
    })
    expect(httpClient.post).toHaveBeenCalledWith(
      'https://example-provider.local/v1/chat/completions',
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-custom',
        }),
      })
    )
  })

  it('balances side swapping to an even split for 6 flips', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"left","confidence":0.8}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      maxConcurrency: 2,
      flips: [
        {hash: 'flip-1'},
        {hash: 'flip-2'},
        {hash: 'flip-3'},
        {hash: 'flip-4'},
        {hash: 'flip-5'},
        {hash: 'flip-6'},
      ],
    })

    expect(result.summary.diagnostics).toMatchObject({
      swapped: 3,
      notSwapped: 3,
      rawLeft: 6,
      finalLeft: 3,
      finalRight: 3,
      remappedDecisions: 3,
    })
  })

  it('tracks token usage per flip and in summary totals', async () => {
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: '{"answer":"left","confidence":0.9}',
      usage: {
        promptTokens: 210,
        completionTokens: 14,
        totalTokens: 224,
      },
    })
    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      flips: [{hash: 'flip-token-1'}, {hash: 'flip-token-2'}],
    })

    expect(result.results[0]).toMatchObject({
      tokenUsage: {
        promptTokens: 210,
        completionTokens: 14,
        totalTokens: 224,
      },
    })
    expect(result.summary.tokens).toMatchObject({
      promptTokens: 420,
      completionTokens: 28,
      totalTokens: 448,
      flipsWithUsage: 2,
    })
  })

  it('uses strict sequential pacing and emits per-flip progress', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"left","confidence":0.8}')
    const sleep = jest.fn().mockResolvedValue(undefined)
    const onFlipStart = jest.fn()
    const onFlipResult = jest.fn()

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      sleep,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      flips: [
        {
          hash: 'flip-strict-1',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
        },
        {
          hash: 'flip-strict-2',
          leftImage: 'data:image/png;base64,CCC=',
          rightImage: 'data:image/png;base64,DDD=',
        },
      ],
      onFlipStart,
      onFlipResult,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(650)
    expect(onFlipStart).toHaveBeenCalledTimes(2)
    expect(onFlipStart.mock.calls[0][0]).toMatchObject({
      type: 'flip-start',
      hash: 'flip-strict-1',
    })
    expect(onFlipResult).toHaveBeenCalledTimes(2)
    expect(onFlipResult.mock.calls[0][0]).toMatchObject({
      type: 'flip-result',
      hash: 'flip-strict-1',
    })
  })

  it('forces non-skip answer when forceDecision is enabled', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"skip","confidence":0.1}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      forceDecision: true,
      uncertaintyRepromptEnabled: false,
      flips: [{hash: 'flip-force-1'}],
    })

    expect(result.results[0].answer).not.toBe('skip')
    expect(result.results[0]).toMatchObject({
      forcedDecision: true,
    })
  })

  it('runs an uncertainty second pass when confidence is below threshold', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce('{"answer":"skip","confidence":0.15}')
      .mockResolvedValueOnce('{"answer":"right","confidence":0.81}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      forceDecision: true,
      uncertaintyRepromptEnabled: true,
      uncertaintyConfidenceThreshold: 0.7,
      uncertaintyRepromptMinRemainingMs: 500,
      flips: [{hash: 'flip-second-pass-1'}],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(result.results[0]).toMatchObject({
      uncertaintyRepromptUsed: true,
    })
  })

  it('uses frame-by-frame single-pass mode when frame payload exists', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"right","confidence":0.82}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      flipVisionMode: 'frames_single_pass',
      uncertaintyRepromptEnabled: false,
      flips: [
        {
          hash: 'flip-frames-single-pass',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          leftFrames: [
            'data:image/png;base64,L1=',
            'data:image/png;base64,L2=',
            'data:image/png;base64,L3=',
            'data:image/png;base64,L4=',
          ],
          rightFrames: [
            'data:image/png;base64,R1=',
            'data:image/png;base64,R2=',
            'data:image/png;base64,R3=',
            'data:image/png;base64,R4=',
          ],
        },
      ],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(invokeProvider.mock.calls[0][0].promptOptions).toMatchObject({
      flipVisionMode: 'frames_single_pass',
      promptPhase: 'decision',
    })
    expect(invokeProvider.mock.calls[0][0].flip.images).toHaveLength(8)
    expect(result.results[0]).toMatchObject({
      flipVisionModeApplied: 'frames_single_pass',
      flipVisionModeFallback: null,
    })
  })

  it('falls back to composite mode when frame payload is missing', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"left","confidence":0.74}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      flipVisionMode: 'frames_single_pass',
      uncertaintyRepromptEnabled: false,
      flips: [
        {
          hash: 'flip-frames-missing',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
        },
      ],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(invokeProvider.mock.calls[0][0].promptOptions).toMatchObject({
      flipVisionMode: 'composite',
      promptPhase: 'decision',
    })
    expect(result.results[0]).toMatchObject({
      flipVisionModeRequested: 'frames_single_pass',
      flipVisionModeApplied: 'composite',
      flipVisionModeFallback: 'missing_frames',
    })
  })

  it('runs two-pass frame reasoning before decision in frames_two_pass mode', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce(
        '{"leftFrames":["a","b","c","d"],"rightFrames":["e","f","g","h"],"leftStory":"left","rightStory":"right","confidenceLeft":0.45,"confidenceRight":0.62}'
      )
      .mockResolvedValueOnce('{"answer":"left","confidence":0.79}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      flipVisionMode: 'frames_two_pass',
      uncertaintyRepromptEnabled: false,
      flips: [
        {
          hash: 'flip-frames-two-pass',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          leftFrames: [
            'data:image/png;base64,L1=',
            'data:image/png;base64,L2=',
            'data:image/png;base64,L3=',
            'data:image/png;base64,L4=',
          ],
          rightFrames: [
            'data:image/png;base64,R1=',
            'data:image/png;base64,R2=',
            'data:image/png;base64,R3=',
            'data:image/png;base64,R4=',
          ],
        },
      ],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(invokeProvider.mock.calls[0][0].promptOptions).toMatchObject({
      flipVisionMode: 'frames_two_pass',
      promptPhase: 'frame_reasoning',
    })
    expect(invokeProvider.mock.calls[1][0].promptOptions).toMatchObject({
      flipVisionMode: 'frames_two_pass',
      promptPhase: 'decision_from_frame_reasoning',
    })
    expect(result.results[0]).toMatchObject({
      frameReasoningUsed: true,
      flipVisionModeApplied: 'frames_two_pass',
    })
  })

  it('aggregates up to three consultant models with averaged probabilities', async () => {
    const invokeProvider = jest.fn().mockImplementation(({provider, model}) => {
      if (provider === 'openai' && model === 'gpt-4o-mini') {
        return Promise.resolve('{"answer":"left","confidence":0.9}')
      }
      if (provider === 'gemini' && model === 'gemini-2.0-flash') {
        return Promise.resolve('{"answer":"right","confidence":0.6}')
      }
      if (provider === 'openai-compatible' && model === 'gpt-4.1-mini') {
        return Promise.resolve('{"answer":"right","confidence":0.8}')
      }
      return Promise.resolve('{"answer":"skip","confidence":0}')
    })

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test-openai'})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'sk-test-gemini'})
    bridge.setProviderKey({
      provider: 'openai-compatible',
      apiKey: 'sk-test-compatible',
    })

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      flips: [
        {hash: 'flip-ensemble-1', leftImage: 'left', rightImage: 'right'},
      ],
      consultProviders: [
        {provider: 'gemini', model: 'gemini-2.0-flash'},
        {
          provider: 'openai-compatible',
          model: 'gpt-4.1-mini',
          providerConfig: {
            baseUrl: 'https://example-provider.local/v1',
            chatPath: '/chat/completions',
          },
        },
      ],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(3)
    expect(result.results[0]).toMatchObject({
      answer: 'left',
      ensembleConsulted: 3,
      ensembleContributors: 3,
    })
    expect(result.results[0].consultedProviders).toHaveLength(3)
    expect(result.results[0].ensembleProbabilities).toEqual(
      expect.objectContaining({
        left: expect.any(Number),
        right: expect.any(Number),
        skip: expect.any(Number),
      })
    )
    expect(result.summary.consultedProviders).toHaveLength(3)
  })

  it('supports weighted ensemble voting for future model calibration', async () => {
    const invokeProvider = jest.fn().mockImplementation(({provider, model}) => {
      if (provider === 'openai' && model === 'gpt-4o-mini') {
        return Promise.resolve('{"answer":"left","confidence":1.0}')
      }
      if (provider === 'gemini' && model === 'gemini-2.0-flash') {
        return Promise.resolve('{"answer":"right","confidence":0.6}')
      }
      if (provider === 'openai-compatible' && model === 'gpt-4.1-mini') {
        return Promise.resolve('{"answer":"right","confidence":0.6}')
      }
      return Promise.resolve('{"answer":"skip","confidence":0}')
    })

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test-openai'})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'sk-test-gemini'})
    bridge.setProviderKey({
      provider: 'openai-compatible',
      apiKey: 'sk-test-compatible',
    })

    const basePayload = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      flips: [
        {
          hash: 'flip-ensemble-weighted',
          leftImage: 'left',
          rightImage: 'right',
        },
      ],
      consultProviders: [
        {provider: 'gemini', model: 'gemini-2.0-flash'},
        {
          provider: 'openai-compatible',
          model: 'gpt-4.1-mini',
          providerConfig: {
            baseUrl: 'https://example-provider.local/v1',
            chatPath: '/chat/completions',
          },
        },
      ],
    }

    const equalWeightResult = await bridge.solveFlipBatch(basePayload)
    const weightedResult = await bridge.solveFlipBatch({
      ...basePayload,
      ensemblePrimaryWeight: 1,
      consultProviders: [
        {...basePayload.consultProviders[0], weight: 3},
        {...basePayload.consultProviders[1], weight: 2},
      ],
    })

    expect(equalWeightResult.results[0].answer).not.toBe(
      weightedResult.results[0].answer
    )
    expect(weightedResult.results[0].consultedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({provider: 'openai', weight: 1}),
        expect.objectContaining({provider: 'gemini', weight: 3}),
        expect.objectContaining({provider: 'openai-compatible', weight: 2}),
      ])
    )
    expect(weightedResult.results[0]).toMatchObject({
      ensembleConsulted: 3,
      ensembleContributors: 3,
      ensembleTotalWeight: 6,
    })
  })

  it('adds legacy heuristic strategy as an extra weighted consultant', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValue('{"answer":"right","confidence":0.7}')

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      writeBenchmarkLog: jest.fn().mockResolvedValue(undefined),
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test-openai'})

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      legacyHeuristicEnabled: true,
      legacyHeuristicWeight: 0.6,
      flips: [
        {
          hash: 'flip-legacy-strategy',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          leftFrames: [
            'data:image/png;base64,L1=',
            'data:image/png;base64,L2=',
            'data:image/png;base64,L3=',
            'data:image/png;base64,L4=',
          ],
          rightFrames: [
            'data:image/png;base64,R1=',
            'data:image/png;base64,R2=',
            'data:image/png;base64,R3=',
            'data:image/png;base64,R4=',
          ],
        },
      ],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(result.results[0].consultedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({provider: 'openai'}),
        expect.objectContaining({
          provider: 'legacy-heuristic',
          model: 'legacy-heuristic-v1',
          weight: 0.6,
        }),
      ])
    )
    expect(result.results[0]).toMatchObject({
      ensembleConsulted: 2,
      ensembleContributors: 2,
    })
  })

  it('fails when an enabled consultant provider key is missing', async () => {
    const invokeProvider = jest.fn()
    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    await expect(
      bridge.solveFlipBatch({
        provider: 'openai',
        model: 'gpt-4o-mini',
        flips: [{hash: 'flip-needs-gemini-key'}],
        consultProviders: [{provider: 'gemini', model: 'gemini-2.0-flash'}],
      })
    ).rejects.toThrow('API key is not set for provider: gemini')
  })

  it('lists latest models for openai-compatible providers such as xai', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: {
          data: [{id: 'grok-2-latest'}, {id: 'grok-2-vision-latest'}],
        },
      }),
      post: jest.fn().mockResolvedValue({data: {id: 'ok'}}),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'xai', apiKey: 'xai-test-key'})

    const result = await bridge.listModels({provider: 'xai'})

    expect(result).toEqual({
      ok: true,
      provider: 'xai',
      total: 2,
      models: ['grok-2-latest', 'grok-2-vision-latest'],
    })
    expect(httpClient.get).toHaveBeenCalledWith(
      'https://api.x.ai/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer xai-test-key',
        }),
      })
    )
  })

  it('applies compliance-first story planner prompt and parses structured story output', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Safe literal flow',
            storySummary:
              'A person writes a note, loses it in wind, finds it again, and stores it safely.',
            panels: [
              {
                description: 'A person writes a note on a bench in a park.',
                required_visibles: ['person', 'note', 'bench'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A gust of wind lifts the note from the bench while the person reaches out.',
                required_visibles: ['wind', 'note', 'person'],
                state_change_from_previous:
                  'The note leaves the bench and starts moving through the air.',
              },
              {
                description:
                  'The note lands near a tree and the person picks it up.',
                required_visibles: ['note', 'tree', 'person'],
                state_change_from_previous:
                  'The note has landed by the tree and is being recovered.',
              },
              {
                description:
                  'The person places the recovered note in a folder and closes it.',
                required_visibles: ['person', 'note', 'folder'],
                state_change_from_previous:
                  'The recovered note is now stored inside the closed folder.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Spare literal flow',
            storySummary:
              'A person pins down a note, wind loosens it, the note is caught, and it ends secure in a folder.',
            panels: [
              {
                description:
                  'A person places a note on a bench and pins it with one hand.',
                required_visibles: ['person', 'note', 'bench'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'Wind catches the note edge and peels it away from the bench.',
                required_visibles: ['wind', 'note', 'bench'],
                state_change_from_previous:
                  'The note lifts from the bench and starts to fly away.',
              },
              {
                description:
                  'The person catches the airborne note beside a nearby tree.',
                required_visibles: ['person', 'note', 'tree'],
                state_change_from_previous:
                  'The note has been caught in midair near the tree.',
              },
              {
                description:
                  'The person tucks the note into a folder and holds it shut.',
                required_visibles: ['person', 'note', 'folder'],
                state_change_from_previous:
                  'The note is now secured inside the folder.',
              },
            ],
          }),
        ])
      )
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Safer literal flow',
            storySummary:
              'A person writes a note, wind moves it, the person retrieves it, and stores it safely.',
            panels: [
              {
                description: 'A person writes a note on a bench in a park.',
                required_visibles: ['person', 'note', 'bench'],
                state_change_from_previous: 'n/a',
              },
              {
                description: 'Wind lifts the note from the bench.',
                required_visibles: ['wind', 'note', 'bench'],
                state_change_from_previous:
                  'The note is now moving through the air.',
              },
              {
                description: 'The note lands near a tree and is picked up.',
                required_visibles: ['note', 'tree', 'person'],
                state_change_from_previous:
                  'The note has landed near the tree and is being picked up.',
              },
              {
                description: 'The person puts the note into a folder.',
                required_visibles: ['person', 'note', 'folder'],
                state_change_from_previous:
                  'The note is now stored inside the folder.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Bench recovery',
            storySummary:
              'A person drops a note to the wind, retrieves it by a tree, and stores it in a folder.',
            panels: [
              {
                description: 'A person holds a note on a park bench.',
                required_visibles: ['person', 'note', 'bench'],
                state_change_from_previous: 'n/a',
              },
              {
                description: "Wind pulls the note from the person's hand.",
                required_visibles: ['wind', 'note', 'person'],
                state_change_from_previous:
                  "The note has left the person's hand and is flying away.",
              },
              {
                description: 'The note lands by a tree and the person grabs it.',
                required_visibles: ['note', 'tree', 'person'],
                state_change_from_previous:
                  'The note has landed and is being recovered at the tree.',
              },
              {
                description: 'The person closes the note inside a folder.',
                required_visibles: ['person', 'note', 'folder'],
                state_change_from_previous:
                  'The note is now enclosed in the folder.',
              },
            ],
          }),
        ])
      )

    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['note', 'wind'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    const callPayload = invokeProvider.mock.calls[0][0]
    const auditPayload = invokeProvider.mock.calls[1][0]
    expect(callPayload.promptOptions).toMatchObject({
      promptPhase: 'story_options',
      structuredOutput: expect.any(Object),
    })
    expect(auditPayload.promptOptions).toMatchObject({
      promptPhase: 'story_audit',
      structuredOutput: expect.any(Object),
    })
    expect(callPayload.promptText).toContain(
      'Idena flip storyline planner and compliance checker'
    )
    expect(callPayload.promptText).toContain('Generate 3 candidate storylines')
    expect(callPayload.promptText).toContain('no_text_needed')
    expect(callPayload.promptText).toContain('4-panel storyboard checklist')
    expect(callPayload.promptText).toContain('causality >= 4')
    expect(callPayload.promptText).toContain(
      'Think like a storyboard collaborator, not a policy robot.'
    )
    expect(callPayload.promptText).toContain(
      'Compact positive/negative exemplars (openai_like_compact_exemplars):'
    )
    expect(callPayload.promptText).toContain(
      'The person observes the final result.'
    )
    expect(callPayload.promptText).toContain(
      'Allow ordinary fear, tension, conflict, surprise, creepy atmosphere, safe tool use, accidental mess, and non-graphic consequences when they improve clarity.'
    )
    expect(callPayload.promptText).not.toContain(
      'Do not include inappropriate, sexual, violent, or shocking content.'
    )
    expect(callPayload.promptText).not.toContain('Optimize for "boringly clear".')
    expect(auditPayload.promptText).toContain(
      'Audit this concept and hard-reject only clearly extreme or provider-triggering content.'
    )
    expect(auditPayload.promptText).toContain(
      'panel 4 must be a direct visible consequence of panel 3'
    )
    expect(result.stories[0]).toMatchObject({
      title: 'Safer literal flow',
      storySummary:
        'A person writes a note, wind moves it, the person retrieves it, and stores it safely.',
      panels: [
        'A person writes a note on a bench in a park.',
        'Wind lifts the note from the bench.',
        'The note lands near a tree and is picked up.',
        'The person puts the note into a folder.',
      ],
      complianceReport: expect.objectContaining({
        keyword_relevance: 'pass',
        no_text_needed: 'pass',
        consensus_clarity: 'pass',
      }),
      riskFlags: [],
    })
    expect(result.tokenUsage).toMatchObject({
      promptTokens: 80,
      completionTokens: 60,
      totalTokens: 140,
    })
  })

  it('builds keyword-based fallback story options when provider returns empty text', async () => {
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: '',
      usage: {
        promptTokens: 18,
        completionTokens: 0,
        totalTokens: 18,
      },
    })

    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['monkey', 'focus'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(result.stories).toHaveLength(2)
    expect(result.stories[0].panels.join(' ')).toContain('monkey')
    expect(result.stories[0].panels.join(' ')).toContain('focus')
    expect(result.stories[0].panels).not.toEqual([
      'Panel 1: add a clear event in the story.',
      'Panel 2: add a clear event in the story.',
      'Panel 3: add a clear event in the story.',
      'Panel 4: add a clear event in the story.',
    ])
    expect(result.stories[1].panels.join(' ')).toContain('monkey')
    expect(result.stories[1].panels.join(' ')).toContain('focus')
  })

  it('salvages readable unstructured story text before dropping to local fallback', async () => {
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce({
        rawText: [
          'Panel 1: A person studies a mirror in a bedroom.',
          'Panel 2: A ghost appears in the mirror and the person jolts backward.',
          'Panel 3: The mirror tilts and a hairbrush drops to the floor.',
          'Panel 4: The person stares at the tilted mirror while the ghost remains inside it.',
        ].join('\n'),
        usage: {
          promptTokens: 24,
          completionTokens: 32,
          totalTokens: 56,
        },
      })
      .mockResolvedValueOnce({
        rawText: [
          'Panel 1: A person studies a mirror in a bedroom.',
          'Panel 2: A ghost appears in the mirror and the person jolts backward.',
          'Panel 3: The mirror tilts and a hairbrush drops to the floor.',
          'Panel 4: The person stares at the tilted mirror while the ghost remains inside it.',
        ].join('\n'),
        usage: {
          promptTokens: 24,
          completionTokens: 32,
          totalTokens: 56,
        },
      })

    const logger = mockLogger()
    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['mirror', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(result.generationPath).toContain('lenient_salvage')
    expect(
      result.stories.some(
        (story) =>
          !/local fallback/i.test(String(story && story.rationale ? story.rationale : ''))
      )
    ).toBe(true)
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain('mirror')
    expect(logger.info).toHaveBeenCalledWith(
      'AI story lenient salvage path',
      expect.objectContaining({
        provider: 'openai',
        acceptedStories: expect.any(Number),
      })
    )
  })

  it('returns explicit storyboard starter guidance for ambiguous raw-keyword fallback', async () => {
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: '',
      usage: {
        promptTokens: 18,
        completionTokens: 0,
        totalTokens: 18,
      },
    })

    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['jump', 'sport'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(result.metrics.fallback_used).toBe(true)
    expect(result.stories[0]).toMatchObject({
      isStoryboardStarter: true,
    })
    expect(result.stories[0].rationale).toMatch(/storyboard starter/i)
    expect(result.stories[0].editingTip).toMatch(/Rewrite all 4 panels/i)
    expect(
      result.stories[0].panels[0].includes('Pick one specific actor or object') ||
        result.stories[0].panels[0].includes('Choose a concrete room')
    ).toBe(true)
    expect(result.stories[0].panels.join(' ')).not.toContain(
      'The person makes one concrete move'
    )
  })

  it('includes compact provider-specific exemplars in story prompts and can disable them', async () => {
    const logger = mockLogger()
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Hallway fright',
            storySummary:
              'A ghost appears in a hallway, a person jolts in shock, drops a cup, and ends beside a puddle.',
            panels: [
              {
                description:
                  'A calm person carries a cup through a hallway.',
                required_visibles: ['person', 'cup', 'hallway'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A visible ghost appears in front of the person and the person jolts in surprise.',
                required_visibles: ['ghost', 'person', 'cup'],
                state_change_from_previous:
                  'The hallway now contains a ghost and the person starts to recoil.',
              },
              {
                description:
                  'The cup hits the floor and water spreads while the person steps back.',
                required_visibles: ['cup', 'water', 'ghost'],
                state_change_from_previous:
                  'The cup has fallen and water now covers the floor.',
              },
              {
                description:
                  'The person stands away from the puddle while the ghost remains visible.',
                required_visibles: ['person', 'ghost', 'puddle'],
                state_change_from_previous:
                  'The puddle stays on the floor and the person has retreated.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Locker fright',
            storySummary:
              'A ghost opens a locker door, a student jerks in shock, books scatter, and the ghost lingers in the hall.',
            panels: [
              {
                description:
                  'A student stands at a locker with a stack of books in a school hallway.',
                required_visibles: ['student', 'locker', 'books'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A ghost pushes the locker door open and the student jerks backward in shock.',
                required_visibles: ['ghost', 'student', 'locker door'],
                state_change_from_previous:
                  'The locker door moves open and the student visibly recoils.',
              },
              {
                description:
                  'The books tumble into the hallway while the ghost remains beside the locker.',
                required_visibles: ['books', 'ghost', 'hallway'],
                state_change_from_previous:
                  'The dropped books now scatter across the floor.',
              },
              {
                description:
                  'The student crouches over the scattered books while the ghost floats beside the open locker.',
                required_visibles: ['student', 'ghost', 'scattered books'],
                state_change_from_previous:
                  'The student has moved down to the floor and the locker stays open.',
              },
            ],
          }),
        ])
      )
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Mirror fright',
            storySummary:
              'A ghost appears in a mirror, a person startles, drops a brush, and the mirror remains tilted.',
            panels: [
              {
                description: 'A person wipes a mirror in a dressing room.',
                required_visibles: ['person', 'mirror', 'brush'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A ghost appears in the mirror and the person jolts in shock.',
                required_visibles: ['ghost', 'mirror', 'person'],
                state_change_from_previous:
                  'The ghost is now visible in the mirror and the person recoils.',
              },
              {
                description:
                  'The brush drops as the mirror tilts while the ghost remains reflected inside.',
                required_visibles: ['brush', 'mirror', 'ghost'],
                state_change_from_previous:
                  'The brush has fallen and the mirror now tilts.',
              },
              {
                description:
                  'The fallen brush lies below the tilted mirror while the ghost stays reflected inside.',
                required_visibles: ['brush', 'tilted mirror', 'ghost'],
                state_change_from_previous:
                  'The mirror remains tilted and the brush stays on the floor.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Window fright',
            storySummary:
              'A ghost appears at a window, a person startles, drops a lamp, and steps away from the broken lamp.',
            panels: [
              {
                description:
                  'A person reads beside a window with a small lamp.',
                required_visibles: ['person', 'window', 'lamp'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A ghost appears outside the window and the person jolts in shock.',
                required_visibles: ['ghost', 'window', 'person'],
                state_change_from_previous:
                  'The ghost is now visible outside the window and the person recoils.',
              },
              {
                description:
                  'The lamp falls from the table while the ghost remains visible outside.',
                required_visibles: ['lamp', 'ghost', 'window'],
                state_change_from_previous:
                  'The lamp has fallen and the table is now empty.',
              },
              {
                description:
                  'The person stands away from the broken lamp while the ghost stays outside the window.',
                required_visibles: ['person', 'broken lamp', 'ghost'],
                state_change_from_previous:
                  'The lamp is now broken on the floor and the person has retreated.',
              },
            ],
          }),
        ])
      )

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'gemini-test-key'})

    await bridge.generateStoryOptions({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      fastStoryMode: true,
      keywords: ['shock', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    await bridge.generateStoryOptions({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      fastStoryMode: false,
      keywords: ['mirror', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
      storyExemplarsEnabled: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(4)
    const fastPrompt = invokeProvider.mock.calls[0][0].promptText
    const strictPrompt = invokeProvider.mock.calls[1][0].promptText

    expect(fastPrompt).toContain(
      'Compact exemplar steering (gemini_visual_compact_exemplars):'
    )
    expect(fastPrompt).toContain('Positive:')
    expect(fastPrompt).toContain('Negative:')
    expect(fastPrompt).toContain(
      'same porch repeated four times, tiny expression changes'
    )
    expect(fastPrompt).toContain(
      'Keyword 1 "shock" -> emotional shock or startled reaction that is visible on a person'
    )
    expect(fastPrompt).toContain(
      '{"panel":1,"role":"before","description":"...","required_visibles":["...","..."],"state_change_from_previous":"n/a"}'
    )
    expect(fastPrompt).not.toContain(
      'Do not include inappropriate, sexual, violent, or shocking content.'
    )

    expect(strictPrompt).not.toContain('Compact positive/negative exemplars')
    expect(logger.info).toHaveBeenCalledWith(
      'AI story prompt steering',
      expect.objectContaining({
        provider: 'gemini',
        fastStoryMode: true,
        exemplarsEnabled: true,
        promptVariantUsed: 'gemini_visual_compact_exemplars',
      })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'AI story prompt steering',
      expect.objectContaining({
        provider: 'gemini',
        fastStoryMode: false,
        exemplarsEnabled: false,
        promptVariantUsed: 'gemini_visual_compact_exemplars',
      })
    )
  })

  it('retries with a schema reminder when the provider returns malformed story JSON', async () => {
    const logger = mockLogger()
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce({
        rawText: JSON.stringify({
          stories: [
            {
              title: 'Bad option',
              story_summary: 'Too loose.',
              panels: ['one', 'two', 'three', 'four'],
            },
            {
              title: 'Bad option 2',
              story_summary: 'Also too loose.',
              panels: ['one', 'two', 'three', 'four'],
            },
          ],
        }),
        usage: {
          promptTokens: 20,
          completionTokens: 12,
          totalTokens: 32,
        },
      })
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Hallway fright',
            storySummary:
              'A ghost appears in a hallway, a person jolts in shock, drops a cup, and ends beside a puddle.',
            panels: [
              {
                description:
                  'A calm person carries a cup through a quiet hallway.',
                required_visibles: ['person', 'cup', 'hallway'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A visible ghost appears in front of the person and the person jolts in surprise.',
                required_visibles: ['ghost', 'person', 'cup'],
                state_change_from_previous:
                  'The hallway now contains a ghost and the person starts to recoil.',
              },
              {
                description:
                  'The cup hits the floor and water spreads while the person steps back.',
                required_visibles: ['cup', 'water', 'ghost'],
                state_change_from_previous:
                  'The cup has fallen and water now covers the floor.',
              },
              {
                description:
                  'The person stands away from the puddle while the ghost remains visible.',
                required_visibles: ['person', 'ghost', 'puddle'],
                state_change_from_previous:
                  'The puddle stays on the floor and the person has retreated.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Basement surprise',
            storySummary:
              'A person opens a basement door, sees a ghost, recoils in shock, and backs away from the stairs.',
            panels: [
              {
                description:
                  'A person reaches for a basement door at the end of a hallway.',
                required_visibles: ['person', 'door', 'hallway'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'The door swings open and a pale ghost appears on the basement stairs as the person jolts backward in shock.',
                required_visibles: ['ghost', 'person', 'stairs'],
                state_change_from_previous:
                  'The opened door reveals the ghost and the person recoils.',
              },
              {
                description:
                  'The person drops a flashlight and its beam swings across the stairs under the ghost.',
                required_visibles: ['person', 'flashlight', 'ghost'],
                state_change_from_previous:
                  'The flashlight has fallen and its beam now sweeps across the stairs.',
              },
              {
                description:
                  'The person stands against the hallway wall while the fallen flashlight lies on the stairs and the ghost remains visible.',
                required_visibles: ['person', 'ghost', 'hallway wall'],
                state_change_from_previous:
                  'The person now stands against the hallway wall while the flashlight lies on the stairs.',
              },
            ],
          }),
        ])
      )

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['shock', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(invokeProvider.mock.calls[0][0].promptOptions).toMatchObject({
      promptPhase: 'story_options',
      structuredOutput: expect.any(Object),
    })
    expect(invokeProvider.mock.calls[1][0].promptOptions).toMatchObject({
      promptPhase: 'story_options_schema_retry',
      structuredOutput: expect.any(Object),
    })
    expect(invokeProvider.mock.calls[1][0].promptText).toContain('Schema retry:')
    expect(result.metrics.parse_fail).toBe(1)
    expect(result.metrics.safe_replan_used).toBe(false)
    expect(result.metrics.fallback_used).toBe(false)
    expect(result.generationPath).toBe('provider_story_options_schema_retry')
    expect(logger.info).toHaveBeenCalledWith(
      'AI story retry path',
      expect.objectContaining({
        reason: 'schema_invalid',
        to: 'provider_story_options_schema_retry',
      })
    )
  })

  it('uses safe reinterpretation before fallback when the provider refuses', async () => {
    const logger = mockLogger()
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce({
        rawText: "I'm sorry, but I can't help with that request.",
        usage: {
          promptTokens: 18,
          completionTokens: 8,
          totalTokens: 26,
        },
        providerMeta: {
          refusal: "I can't help with that request.",
          finishReason: 'stop',
        },
      })
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Window scare',
            storySummary:
              'A ghost appears at a window, a person jolts in shock, spills a lamp, and ends beside the broken lamp.',
            panels: [
              {
                description:
                  'A calm person reads beside a window with a table lamp.',
                required_visibles: ['person', 'window', 'lamp'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A bright ghost appears outside the window and the person jolts in shock.',
                required_visibles: ['ghost', 'person', 'window'],
                state_change_from_previous:
                  'The ghost is now visible and the person visibly startles.',
              },
              {
                description:
                  'The person knocks the lamp from the table as the ghost stays framed in the window.',
                required_visibles: ['person', 'lamp', 'ghost'],
                state_change_from_previous:
                  'The falling lamp shows the shock causing a visible accident.',
              },
              {
                description:
                  'The broken lamp lies on the floor while the ghost remains outside the window and the person stands back from the mess.',
                required_visibles: ['broken lamp', 'ghost', 'person'],
                state_change_from_previous:
                  'The lamp is now broken on the floor and the shock has left a clear mess.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Locker scare',
            storySummary:
              'A ghost opens a locker door, a student jerks in shock, books scatter, and the ghost lingers in the hall.',
            panels: [
              {
                description:
                  'A student stands at a locker with a stack of books in a school hallway.',
                required_visibles: ['student', 'locker', 'books'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'A ghost pushes the locker door open and the student jerks backward in shock.',
                required_visibles: ['ghost', 'student', 'locker door'],
                state_change_from_previous:
                  'The locker door moves open and the student visibly recoils.',
              },
              {
                description:
                  'The books tumble into the hallway while the ghost remains beside the locker.',
                required_visibles: ['books', 'ghost', 'hallway'],
                state_change_from_previous:
                  'The dropped books now scatter across the floor.',
              },
              {
                description:
                  'The student crouches over the scattered books while the ghost floats beside the open locker.',
                required_visibles: ['student', 'ghost', 'scattered books'],
                state_change_from_previous:
                  'The student has moved down to the floor and the locker stays open.',
              },
            ],
          }),
        ])
      )

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['shock', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(invokeProvider.mock.calls[1][0].promptOptions).toMatchObject({
      promptPhase: 'story_options_safe_replan',
      structuredOutput: expect.any(Object),
    })
    expect(invokeProvider.mock.calls[1][0].promptText).toContain(
      'Safe reinterpretation retry:'
    )
    expect(result.metrics.parse_fail).toBe(0)
    expect(result.metrics.safe_replan_used).toBe(true)
    expect(result.metrics.fallback_used).toBe(false)
    expect(result.generationPath).toBe('provider_story_options_safe_replan')
    expect(logger.info).toHaveBeenCalledWith(
      'AI story refusal',
      expect.objectContaining({
        attempt: 'provider_story_options',
      })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'AI story safe reinterpretation path',
      expect.objectContaining({
        reason: 'refusal',
        to: 'provider_story_options_safe_replan',
      })
    )
  })

  it('uses safe reinterpretation before fallback when the provider safety-blocks the story', async () => {
    const logger = mockLogger()
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce({
        rawText: '',
        usage: {
          promptTokens: 18,
          completionTokens: 0,
          totalTokens: 18,
        },
        providerMeta: {
          safetyBlock: true,
          blockReason: 'SAFETY',
          finishReason: 'SAFETY',
        },
      })
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Workshop tension',
            storySummary:
              'A clown carefully starts a chainsaw, wood chips fly, and the finished carving remains on the bench.',
            panels: [
              {
                description:
                  'A clown in safety goggles stands beside a chainsaw and a wooden log in a workshop.',
                required_visibles: ['clown', 'chainsaw', 'wooden log'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'The clown starts the chainsaw and lowers it onto the wooden log.',
                required_visibles: ['clown', 'chainsaw', 'wooden log'],
                state_change_from_previous:
                  'The chainsaw is now running and touching the log.',
              },
              {
                description:
                  'Wood chips scatter as the clown carves the log while stepping back from the spray.',
                required_visibles: ['clown', 'chainsaw', 'wood chips'],
                state_change_from_previous:
                  'The log is being carved and wood chips now fill the air.',
              },
              {
                description:
                  'The clown sets the chainsaw down and shows the finished wooden sculpture on the bench.',
                required_visibles: ['clown', 'chainsaw', 'wooden sculpture'],
                state_change_from_previous:
                  'The cutting has ended and a finished sculpture is now visible.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Outdoor carving',
            storySummary:
              'A clown shapes a wood block with a chainsaw and then presents the finished figure.',
            panels: [
              {
                description:
                  'A clown carries a chainsaw toward an outdoor carving booth with a wood block.',
                required_visibles: ['clown', 'chainsaw', 'wood block'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'The clown starts shaping the wood block with the chainsaw.',
                required_visibles: ['clown', 'chainsaw', 'wood block'],
                state_change_from_previous:
                  'The chainsaw is now cutting into the block.',
              },
              {
                description:
                  'The carving takes form as wood chips scatter around the booth.',
                required_visibles: ['chainsaw', 'wood chips', 'carving'],
                state_change_from_previous:
                  'A partial carving is now visible and chips have scattered.',
              },
              {
                description:
                  'The clown presents the completed wooden figure with the chainsaw resting on the table.',
                required_visibles: ['clown', 'completed wooden figure', 'chainsaw'],
                state_change_from_previous:
                  'The carving is complete and the chainsaw is no longer in use.',
              },
            ],
          }),
        ])
      )

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['clown', 'chainsaw'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(invokeProvider.mock.calls[1][0].promptOptions).toMatchObject({
      promptPhase: 'story_options_safe_replan',
      structuredOutput: expect.any(Object),
    })
    expect(result.metrics.parse_fail).toBe(0)
    expect(result.metrics.safe_replan_used).toBe(true)
    expect(result.metrics.fallback_used).toBe(false)
    expect(logger.info).toHaveBeenCalledWith(
      'AI story blocked',
      expect.objectContaining({
        attempt: 'provider_story_options',
      })
    )
  })

  it('keeps refusal separate from parse_fail and still falls back with locked senses after safe replan fails', async () => {
    const logger = mockLogger()
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce({
        rawText: "Sorry, but I can't help with that request.",
        usage: {
          promptTokens: 18,
          completionTokens: 7,
          totalTokens: 25,
        },
        providerMeta: {
          refusal: "Sorry, but I can't help with that request.",
        },
      })
      .mockResolvedValueOnce({
        rawText: 'I still cannot comply with that request.',
        usage: {
          promptTokens: 18,
          completionTokens: 7,
          totalTokens: 25,
        },
        providerMeta: {
          refusal: 'I still cannot comply with that request.',
        },
      })

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['shock', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(2)
    expect(result.metrics.parse_fail).toBe(0)
    expect(result.metrics.safe_replan_used).toBe(true)
    expect(result.metrics.fallback_used).toBe(true)
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain('ghost')
    expect(result.stories[0].panels.join(' ').toLowerCase()).toMatch(
      /startled|shock|jolts/
    )
    expect(result.stories[0].panels.join(' ').toLowerCase()).not.toContain(
      'electric'
    )
    expect(logger.info).toHaveBeenCalledWith(
      'AI story final fallback path',
      expect.objectContaining({
        lastOutcome: 'refusal',
      })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'AI story fallback sense lock',
      expect.objectContaining({
        fallbackUsedLockedSenses: true,
      })
    )
  })

  it('uses locked senses in fallback stories instead of ambiguous raw keyword drift', async () => {
    const logger = mockLogger()
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: '',
      usage: {
        promptTokens: 18,
        completionTokens: 0,
        totalTokens: 18,
      },
    })

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['shock', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    const joinedPanels = result.stories[0].panels.join(' ').toLowerCase()

    expect(result.senseSelection.selected_pair).toMatchObject({
      keyword_1_sense_id: 'shock_emotional_startle',
      keyword_2_sense_id: 'ghost_visible_spirit',
    })
    expect(joinedPanels).toContain('ghost')
    expect(joinedPanels).toMatch(/startled|jolts|startled reaction/)
    expect(joinedPanels).not.toContain('electric jolt')
    expect(joinedPanels).not.toContain('starts interacting with both')
    expect(joinedPanels).not.toContain('uses shock as a clear tool')
    expect(joinedPanels).not.toContain('observes the final result')
    expect(logger.info).toHaveBeenCalledWith(
      'AI story fallback sense lock',
      expect.objectContaining({
        fallbackUsedLockedSenses: true,
        chosenSenses: expect.objectContaining({
          keyword_1: expect.objectContaining({
            sense_id: 'shock_emotional_startle',
          }),
          keyword_2: expect.objectContaining({
            sense_id: 'ghost_visible_spirit',
          }),
        }),
      })
    )
  })

  it('keeps tense but non-graphic tool-use stories instead of over-blocking them', async () => {
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: JSON.stringify({
        stories: [
          {
            title: 'Workshop tension',
            story_summary:
              'A clown carefully starts a chainsaw, wood chips fly, and the finished carving remains on the bench.',
            panels: [
              {
                panel: 1,
                role: 'before',
                description:
                  'A clown in safety goggles stands beside a chainsaw and a wooden log in a workshop.',
                required_visibles: ['clown', 'chainsaw', 'wooden log'],
                state_change_from_previous: 'n/a',
              },
              {
                panel: 2,
                role: 'trigger',
                description:
                  'The clown starts the chainsaw and lowers it onto the wooden log.',
                required_visibles: ['clown', 'chainsaw', 'wooden log'],
                state_change_from_previous:
                  'The chainsaw is now running and touching the log.',
              },
              {
                panel: 3,
                role: 'reaction',
                description:
                  'Wood chips scatter as the clown carves the log while stepping back from the spray.',
                required_visibles: ['clown', 'chainsaw', 'wood chips'],
                state_change_from_previous:
                  'The log is being carved and wood chips now fill the air.',
              },
              {
                panel: 4,
                role: 'after',
                description:
                  'The clown sets the chainsaw down and shows the finished wooden sculpture on the bench.',
                required_visibles: ['clown', 'chainsaw', 'wooden sculpture'],
                state_change_from_previous:
                  'The cutting has ended and a finished sculpture is now visible.',
              },
            ],
            compliance_report: {
              keyword_relevance: 'pass',
              no_text_needed: 'pass',
              no_order_labels: 'pass',
              no_inappropriate_content: 'pass',
              single_story_only: 'pass',
              no_waking_up_template: 'pass',
              no_thumbs_up_down: 'pass',
              no_enumeration_logic: 'pass',
              no_screen_or_page_keyword_cheat: 'pass',
              causal_clarity: 'pass',
              consensus_clarity: 'pass',
            },
            risk_flags: [],
            revision_if_risky: '',
          },
          {
            title: 'Outdoor carving',
            story_summary:
              'A clown shapes a wood block with a chainsaw and then presents the finished figure.',
            panels: [
              {
                panel: 1,
                role: 'before',
                description:
                  'A clown carries a chainsaw toward an outdoor carving booth with a wood block.',
                required_visibles: ['clown', 'chainsaw', 'wood block'],
                state_change_from_previous: 'n/a',
              },
              {
                panel: 2,
                role: 'trigger',
                description:
                  'The clown starts shaping the wood block with the chainsaw.',
                required_visibles: ['clown', 'chainsaw', 'wood block'],
                state_change_from_previous:
                  'The chainsaw is now cutting into the block.',
              },
              {
                panel: 3,
                role: 'reaction',
                description:
                  'The carving takes form as wood chips scatter around the booth.',
                required_visibles: ['chainsaw', 'wood chips', 'carving'],
                state_change_from_previous:
                  'A partial carving is now visible and chips have scattered.',
              },
              {
                panel: 4,
                role: 'after',
                description:
                  'The clown presents the completed wooden figure with the chainsaw resting on the table.',
                required_visibles: ['clown', 'completed wooden figure', 'chainsaw'],
                state_change_from_previous:
                  'The carving is complete and the chainsaw is no longer in use.',
              },
            ],
            compliance_report: {
              keyword_relevance: 'pass',
              no_text_needed: 'pass',
              no_order_labels: 'pass',
              no_inappropriate_content: 'pass',
              single_story_only: 'pass',
              no_waking_up_template: 'pass',
              no_thumbs_up_down: 'pass',
              no_enumeration_logic: 'pass',
              no_screen_or_page_keyword_cheat: 'pass',
              causal_clarity: 'pass',
              consensus_clarity: 'pass',
            },
            risk_flags: [],
            revision_if_risky: '',
          },
        ],
      }),
      usage: {
        promptTokens: 44,
        completionTokens: 38,
        totalTokens: 82,
      },
    })

    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['clown', 'chainsaw'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(invokeProvider.mock.calls[0][0].promptText).toContain(
      'Allow ordinary fear, tension, conflict, surprise, creepy atmosphere, safe tool use, accidental mess, and non-graphic consequences when they improve clarity.'
    )
    expect(result.metrics.fallback_used).toBe(false)
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain(
      'chainsaw'
    )
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain('clown')
    expect(result.stories[0].rationale).not.toMatch(/local fallback/i)
  })

  it('reranks bland near-duplicate provider options below a more diverse valid pair', async () => {
    const logger = mockLogger()
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: JSON.stringify({
        stories: [
          {
            title: 'Mirror scare A',
            story_summary:
              'A ghost appears in a dressing-room mirror, a person startles, drops a cloth, and the mirror stays tilted.',
            panels: [
              {
                panel: 1,
                role: 'before',
                description:
                  'A person wipes a mirror in a dressing room with a cloth.',
                required_visibles: ['person', 'mirror', 'cloth'],
                state_change_from_previous: 'n/a',
              },
              {
                panel: 2,
                role: 'trigger',
                description:
                  'A ghost appears clearly inside the mirror and the person jolts in shock.',
                required_visibles: ['ghost', 'mirror', 'person'],
                state_change_from_previous:
                  'The ghost is now visible in the mirror and the person recoils.',
              },
              {
                panel: 3,
                role: 'reaction',
                description:
                  'The cloth drops as the mirror tilts while the ghost remains reflected inside.',
                required_visibles: ['cloth', 'mirror', 'ghost'],
                state_change_from_previous:
                  'The cloth has fallen and the mirror now tilts.',
              },
              {
                panel: 4,
                role: 'after',
                description:
                  'The fallen cloth lies below the tilted mirror while the ghost stays reflected inside.',
                required_visibles: ['cloth', 'tilted mirror', 'ghost'],
                state_change_from_previous:
                  'The mirror remains tilted and the cloth stays on the floor.',
              },
            ],
            compliance_report: makeComplianceReport(),
            risk_flags: [],
            revision_if_risky: '',
          },
          {
            title: 'Mirror scare B',
            story_summary:
              'A ghost appears in the same dressing-room mirror, a person startles, drops a spray bottle, and the mirror stays tilted.',
            panels: [
              {
                panel: 1,
                role: 'before',
                description:
                  'A person wipes the same mirror in the same dressing room with a spray bottle.',
                required_visibles: ['person', 'mirror', 'spray bottle'],
                state_change_from_previous: 'n/a',
              },
              {
                panel: 2,
                role: 'trigger',
                description:
                  'A ghost appears clearly inside the same mirror and the person jerks in shock.',
                required_visibles: ['ghost', 'mirror', 'person'],
                state_change_from_previous:
                  'The ghost is now visible in the mirror and the person recoils.',
              },
              {
                panel: 3,
                role: 'reaction',
                description:
                  'The spray bottle drops as the mirror tilts while the ghost remains reflected inside.',
                required_visibles: ['spray bottle', 'mirror', 'ghost'],
                state_change_from_previous:
                  'The spray bottle has fallen and the mirror now tilts.',
              },
              {
                panel: 4,
                role: 'after',
                description:
                  'The fallen spray bottle lies below the tilted mirror while the ghost stays reflected inside.',
                required_visibles: ['spray bottle', 'tilted mirror', 'ghost'],
                state_change_from_previous:
                  'The mirror remains tilted and the spray bottle stays on the floor.',
              },
            ],
            compliance_report: makeComplianceReport(),
            risk_flags: [],
            revision_if_risky: '',
          },
        ],
      }),
      usage: {
        promptTokens: 32,
        completionTokens: 28,
        totalTokens: 60,
      },
    })

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['mirror', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(result.stories).toHaveLength(2)
    expect(result.stories.map((story) => story.title)).toContain('Mirror scare A')
    expect(
      result.stories.some((story) =>
        /local fallback/i.test(String(story.rationale || ''))
      )
    ).toBe(true)
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain('mirror')
    expect(result.stories[1].panels.join(' ').toLowerCase()).toContain('ghost')
    expect(result.stories[0].senseSelection.selected_pair).toMatchObject({
      keyword_1_sense_id: 'mirror_reflective_object',
      keyword_2_sense_id: 'ghost_visible_spirit',
    })
    expect(
      result.stories.map((story) => story.panels[0].toLowerCase()).join(' || ')
    ).toContain('dressing room')
    expect(
      result.stories.map((story) => story.panels[0].toLowerCase()).join(' || ')
    ).toContain('hallway corner')
    expect(logger.info).toHaveBeenCalledWith(
      'AI story diversity pairwise scores',
      expect.objectContaining({
        pairs: expect.any(Array),
      })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'AI story final selected option pair',
      expect.objectContaining({
        diversityWeakness: expect.any(String),
      })
    )
  })

  it('rejects weak generic provider stories and falls back to higher-quality locked-sense stories', async () => {
    const logger = mockLogger()
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: JSON.stringify({
        stories: [
          {
            title: 'Option 1',
            story_summary: 'A person vaguely deals with shock and a ghost.',
            panels: [
              {
                panel: 1,
                role: 'before',
                description: 'A person interacts with a ghost in a hallway.',
                required_visibles: ['person', 'ghost'],
                state_change_from_previous: 'n/a',
              },
              {
                panel: 2,
                role: 'trigger',
                description:
                  'The person interacts with shock in the same scene.',
                required_visibles: ['person', 'shock'],
                state_change_from_previous: 'a visible change occurs',
              },
              {
                panel: 3,
                role: 'reaction',
                description:
                  'The person uses shock as a tool beside the ghost.',
                required_visibles: ['person', 'shock', 'ghost'],
                state_change_from_previous: 'something changes',
              },
              {
                panel: 4,
                role: 'after',
                description: 'The person observes the final result.',
                required_visibles: ['person', 'hallway'],
                state_change_from_previous: 'the scene changes',
              },
            ],
            compliance_report: {
              keyword_relevance: 'pass',
              no_text_needed: 'pass',
              no_order_labels: 'pass',
              no_inappropriate_content: 'pass',
              single_story_only: 'pass',
              no_waking_up_template: 'pass',
              no_thumbs_up_down: 'pass',
              no_enumeration_logic: 'pass',
              no_screen_or_page_keyword_cheat: 'pass',
              causal_clarity: 'pass',
              consensus_clarity: 'pass',
            },
            risk_flags: [],
            revision_if_risky: '',
          },
          {
            title: 'Option 2',
            story_summary: 'A second vague version of the same story.',
            panels: [
              {
                panel: 1,
                role: 'before',
                description: 'A person interacts with a ghost in a hallway.',
                required_visibles: ['person', 'ghost'],
                state_change_from_previous: 'n/a',
              },
              {
                panel: 2,
                role: 'trigger',
                description:
                  'The person interacts with shock in the same scene again.',
                required_visibles: ['person', 'shock'],
                state_change_from_previous: 'a visible change occurs',
              },
              {
                panel: 3,
                role: 'reaction',
                description: 'The person interacts with the ghost once more.',
                required_visibles: ['person', 'ghost'],
                state_change_from_previous: 'something changes',
              },
              {
                panel: 4,
                role: 'after',
                description: 'The person observes the final result again.',
                required_visibles: ['person', 'hallway'],
                state_change_from_previous: 'the scene changes',
              },
            ],
            compliance_report: {
              keyword_relevance: 'pass',
              no_text_needed: 'pass',
              no_order_labels: 'pass',
              no_inappropriate_content: 'pass',
              single_story_only: 'pass',
              no_waking_up_template: 'pass',
              no_thumbs_up_down: 'pass',
              no_enumeration_logic: 'pass',
              no_screen_or_page_keyword_cheat: 'pass',
              causal_clarity: 'pass',
              consensus_clarity: 'pass',
            },
            risk_flags: [],
            revision_if_risky: '',
          },
        ],
      }),
      usage: {
        promptTokens: 32,
        completionTokens: 24,
        totalTokens: 56,
      },
    })

    const bridge = createAiProviderBridge(logger, {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['shock', 'ghost'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(result.metrics).toMatchObject({
      fallback_used: true,
      low_concreteness_fail: expect.any(Number),
      weak_progression_fail: expect.any(Number),
      total_latency_ms: expect.any(Number),
    })
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain('ghost')
    expect(result.stories[0].panels.join(' ').toLowerCase()).toMatch(
      /startled|jolts|surprise/
    )
    expect(result.stories[0].panels.join(' ').toLowerCase()).not.toContain(
      'interacts with'
    )
    expect(logger.info).toHaveBeenCalledWith(
      'AI story quality reject',
      expect.objectContaining({
        source: 'provider_story_options',
      })
    )
  })

  it('uses the Python story pipeline when enabled and skips provider calls', async () => {
    const invokeProvider = jest.fn()
    const runPythonFlipStoryPipeline = jest.fn().mockResolvedValue({
      semanticPlan: {
        keyword_1_analysis: {
          keyword: 'clown',
          renderable_keyword: 'clown',
          role: 'actor',
          risk_level: 'neutral',
          safe_use_context: 'N/A',
        },
        keyword_2_analysis: {
          keyword: 'chainsaw',
          renderable_keyword: 'chainsaw',
          role: 'tool',
          risk_level: 'risk-bearing',
          safe_use_context:
            'Bright woodworking studio, protective goggles and gloves, cutting only a wooden log.',
        },
        safe_use_context:
          'Bright woodworking studio, protective goggles and gloves, cutting only a wooden log.',
        overarching_intent:
          'Use this human seed as the safe narrative anchor: clown makes an ice sculpture safely.',
      },
      storyPanels: [
        'A clown in protective gear stands near a chainsaw and a wooden log.',
        'The clown starts cutting the log with the chainsaw under supervision.',
        'The log becomes a clear sculpture shape while the chainsaw remains visible.',
        'The clown presents the finished sculpture with the chainsaw set down safely.',
      ],
    })
    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      runPythonFlipStoryPipeline,
    })

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['clown', 'chainsaw'],
      includeNoise: false,
      hasCustomStory: false,
      humanStorySeed: 'clown makes an ice sculpture safely',
      usePythonFlipPipeline: true,
    })

    expect(runPythonFlipStoryPipeline).toHaveBeenCalledTimes(1)
    expect(invokeProvider).not.toHaveBeenCalled()
    expect(result.generationPath).toBe('python_story_pipeline')
    expect(result.stories).toHaveLength(2)
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain('clown')
    expect(result.stories[0].panels.join(' ').toLowerCase()).toContain(
      'chainsaw'
    )
    expect(result.semanticPlan).toMatchObject({
      keyword_1_analysis: expect.objectContaining({keyword: 'clown'}),
      keyword_2_analysis: expect.objectContaining({keyword: 'chainsaw'}),
    })
  })

  it('falls back to provider story flow when Python pipeline fails', async () => {
    const runPythonFlipStoryPipeline = jest
      .fn()
      .mockRejectedValue(new Error('python failed'))
    const invokeProvider = jest
      .fn()
      .mockResolvedValueOnce(
        makeStrictStoryResponse([
          makeStrictStoryOption({
            title: 'Workshop carving',
            storySummary:
              'A clown prepares a log, carves it with a chainsaw, and presents the finished sculpture.',
            panels: [
              {
                description:
                  'A clown enters a bright workshop with a chainsaw and log.',
                required_visibles: ['clown', 'chainsaw', 'log'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'The clown positions the log and starts the chainsaw on the workbench.',
                required_visibles: ['clown', 'chainsaw', 'log'],
                state_change_from_previous:
                  'The chainsaw starts and the log is now positioned for cutting.',
              },
              {
                description:
                  'Wood chips scatter as the clown safely carves the log with the chainsaw.',
                required_visibles: ['clown', 'chainsaw', 'wood chips'],
                state_change_from_previous:
                  'The log is being carved and wood chips now fly from the cut.',
              },
              {
                description:
                  'The clown shows the finished sculpture on the workbench with the chainsaw set down.',
                required_visibles: ['clown', 'sculpture', 'chainsaw'],
                state_change_from_previous:
                  'The sculpture is finished and the chainsaw is no longer in use.',
              },
            ],
          }),
          makeStrictStoryOption({
            title: 'Outdoor carving',
            storySummary:
              'A clown starts a chainsaw at a carving booth, shapes a wooden block, and presents the finished figure.',
            panels: [
              {
                description:
                  'A clown arrives at an outdoor carving booth with a chainsaw and wooden block.',
                required_visibles: ['clown', 'chainsaw', 'wooden block'],
                state_change_from_previous: 'n/a',
              },
              {
                description:
                  'The clown starts shaping the wooden block with the chainsaw.',
                required_visibles: ['clown', 'chainsaw', 'wooden block'],
                state_change_from_previous:
                  'The chainsaw is now cutting into the block.',
              },
              {
                description:
                  'The carving takes form as wood chips scatter around the booth.',
                required_visibles: ['chainsaw', 'wood chips', 'carving'],
                state_change_from_previous:
                  'A partial carving is now visible and chips have scattered.',
              },
              {
                description:
                  'The clown presents the completed wooden figure with the chainsaw resting on the table.',
                required_visibles: ['clown', 'completed wooden figure', 'chainsaw'],
                state_change_from_previous:
                  'The carving is complete and the chainsaw is no longer in use.',
              },
            ],
          }),
        ])
      )

    const bridge = createAiProviderBridge(mockLogger(), {
      invokeProvider,
      runPythonFlipStoryPipeline,
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['clown', 'chainsaw'],
      includeNoise: false,
      hasCustomStory: false,
      usePythonFlipPipeline: true,
    })

    expect(runPythonFlipStoryPipeline).toHaveBeenCalledTimes(1)
    expect(invokeProvider).toHaveBeenCalledTimes(3)
    expect(result.stories).toHaveLength(2)
    expect(result.generationPath).not.toBe('python_story_pipeline')
  })

  it('does not enforce human seed guidance in fast story prompt mode', async () => {
    const invokeProvider = jest.fn().mockResolvedValue(
      makeStrictStoryResponse([
        makeStrictStoryOption({
          title: 'Watered plant',
          storySummary: 'A person waters a dry plant and it grows upright.',
          panels: [
            {
              description: 'A person places a dry plant on a table.',
              required_visibles: ['person', 'plant', 'table'],
              state_change_from_previous: 'n/a',
            },
            {
              description: 'The person pours water into the pot.',
              required_visibles: ['person', 'water', 'pot'],
              state_change_from_previous:
                'Water is now being poured into the pot.',
            },
            {
              description: 'The stem rises and the leaves open above the pot.',
              required_visibles: ['plant', 'stem', 'leaves'],
              state_change_from_previous:
                'The plant has started growing taller with opened leaves.',
            },
            {
              description: 'The plant stands healthy and taller on the table.',
              required_visibles: ['plant', 'table', 'leaves'],
              state_change_from_previous:
                'The plant is now upright and visibly healthier.',
            },
          ],
        }),
        makeStrictStoryOption({
          title: 'Repotted plant',
          storySummary:
            'A person repots a weak plant, settles the roots, and the plant stands upright.',
          panels: [
            {
              description: 'A person lifts a weak plant from a small pot.',
              required_visibles: ['person', 'plant', 'small pot'],
              state_change_from_previous: 'n/a',
            },
            {
              description:
                'The person moves the plant into a larger pot with fresh soil.',
              required_visibles: ['person', 'plant', 'larger pot'],
              state_change_from_previous:
                'The plant has been moved into the larger pot.',
            },
            {
              description: 'The roots settle as soil is pressed into the pot.',
              required_visibles: ['roots', 'soil', 'pot'],
              state_change_from_previous:
                'Fresh soil now surrounds the roots inside the larger pot.',
            },
            {
              description: 'The plant stands upright in the new pot.',
              required_visibles: ['plant', 'new pot', 'soil'],
              state_change_from_previous:
                'The plant is now upright and stable in the new pot.',
            },
          ],
        }),
      ])
    )
    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      fastStoryMode: true,
      keywords: ['plant', 'water'],
      humanStorySeed: 'A person saves a dying plant by watering it.',
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    const callPayload = invokeProvider.mock.calls[0][0]
    expect(callPayload.promptText).not.toContain('human seed premise')
    expect(callPayload.promptText).not.toContain(
      'A person saves a dying plant by watering it.'
    )
  })

  it('rejects boilerplate panel placeholders and falls back to keyword-based stories', async () => {
    const invokeProvider = jest.fn().mockResolvedValue({
      rawText: JSON.stringify({
        stories: [
          {
            title: 'Option 1',
            panels: [
              'Panel 1: add a clear event in the story.',
              'Panel 2: add a clear event in the story.',
              'Panel 3: add a clear event in the story.',
              'Panel 4: add a clear event in the story.',
            ],
          },
        ],
      }),
      usage: {
        promptTokens: 20,
        completionTokens: 12,
        totalTokens: 32,
      },
    })

    const bridge = createAiProviderBridge(mockLogger(), {invokeProvider})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateStoryOptions({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keywords: ['wolf', 'fairy'],
      includeNoise: false,
      hasCustomStory: false,
    })

    expect(result.stories).toHaveLength(2)
    expect(result.stories[0].panels.join(' ')).toContain('wolf')
    expect(result.stories[0].panels.join(' ')).toContain('fairy')
    expect(
      result.stories.some((story) =>
        story.panels.some((panel) =>
          /add a clear event in the story/i.test(String(panel || ''))
        )
      )
    ).toBe(false)
  })

  it('threads locked senses into every panel prompt to prevent sense drift', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: 'AAA=',
                      mimeType: 'image/png',
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 1,
            totalTokenCount: 11,
          },
        },
      }),
      get: jest.fn(),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'gemini-test-key'})

    const senseSelection = selectSensePair({
      keywordA: 'shock',
      keywordB: 'ghost',
    })

    const result = await bridge.generateFlipPanels({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      imageModel: 'gemini-2.5-flash-image',
      imageSize: '1024x1024',
      requestTimeoutMs: 15000,
      textAuditEnabled: false,
      maxRetries: 0,
      keywords: ['shock', 'ghost'],
      senseSelection,
      storyPanels: [
        'A calm person carries a cup through a hallway.',
        'A visible ghost appears and the person jolts in surprise.',
        'The cup hits the floor and water spreads across the hallway.',
        'The startled person steps back while the ghost remains visible.',
      ],
    })

    expect(result.panels).toHaveLength(4)
    result.panels.forEach((panel) => {
      expect(panel.panelPrompt).toContain(
        'Keyword 1 "shock" -> emotional shock or startled reaction that is visible on a person'
      )
      expect(panel.panelPrompt).toContain(
        'Keyword 2 "ghost" -> visible ghost figure or floating spirit'
      )
      expect(panel.panelPrompt).not.toContain('electric shock or electrical jolt')
    })
  })

  it('lists latest models for gemini and strips models/ prefix', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: {
          models: [
            {
              name: 'models/gemini-2.0-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        },
      }),
      post: jest.fn().mockResolvedValue({data: {id: 'ok'}}),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'gemini-test-key'})

    const result = await bridge.listModels({provider: 'gemini'})

    expect(result).toEqual({
      ok: true,
      provider: 'gemini',
      total: 2,
      models: ['gemini-2.0-flash', 'gemini-2.5-pro'],
    })
  })

  it('routes AI image search through gemini image generation endpoint', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {text: 'image ready'},
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: 'AAA=',
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 3,
            totalTokenCount: 15,
          },
        },
      }),
      get: jest.fn(),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'gemini-test-key'})

    const result = await bridge.generateImageSearchResults({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      imageModel: 'gemini-2.5-flash-image',
      prompt: 'draw a cat near a lamp',
      maxImages: 1,
      requestTimeoutMs: 15000,
    })

    expect(result).toMatchObject({
      ok: true,
      provider: 'gemini',
      imageModel: 'gemini-2.5-flash-image',
    })
    expect(result.images).toHaveLength(1)
    expect(result.images[0].image).toBe('data:image/png;base64,AAA=')
    expect(httpClient.post).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=gemini-test-key'
      ),
      expect.objectContaining({
        contents: expect.any(Array),
      }),
      expect.objectContaining({
        timeout: expect.any(Number),
      })
    )
  })

  it('routes flip panel generation through gemini image endpoint', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: 'AAA=',
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 1,
            totalTokenCount: 11,
          },
        },
      }),
      get: jest.fn(),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'gemini', apiKey: 'gemini-test-key'})

    const result = await bridge.generateFlipPanels({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      imageModel: 'gemini-2.5-flash-image',
      imageSize: '1024x1024',
      requestTimeoutMs: 15000,
      textAuditEnabled: false,
      maxRetries: 0,
      keywords: ['cat', 'lamp'],
      storyPanels: [
        'Panel 1: cat sits near lamp.',
        'Panel 2: lamp turns on.',
        'Panel 3: cat moves closer.',
        'Panel 4: cat sleeps under warm light.',
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      provider: 'gemini',
      imageModel: 'gemini-2.5-flash-image',
      generatedPanelCount: 4,
    })
    expect(result.panels).toHaveLength(4)
    expect(result.panels[0].imageDataUrl).toBe('data:image/png;base64,AAA=')
    expect(result.panels[0].panelPrompt).not.toContain(
      'Human story seed to preserve:'
    )
    expect(result.panels[0].panelPrompt).not.toContain('human seed premise')
    expect(httpClient.post).toHaveBeenCalledTimes(4)
  })

  it('retries a rendered panel when validator detects OCR leakage', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            data: [
              {
                b64_json: 'AAA=',
                mime_type: 'image/png',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 0,
              total_tokens: 10,
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [
              {
                b64_json: 'BBB=',
                mime_type: 'image/png',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 0,
              total_tokens: 10,
            },
          },
        }),
      get: jest.fn(),
    }
    let ocrAttemptCount = 0
    const bridge = createAiProviderBridge(mockLogger(), {
      httpClient,
      storyValidatorHooks: {
        ocrTextCheck: jest.fn().mockImplementation(async () => {
          ocrAttemptCount += 1
          if (ocrAttemptCount === 1) {
            return {
              passed: false,
              detected_text: ['SALE'],
              confidence: 0.97,
              retry_recommendation: 'remove storefront text',
            }
          }
          return {
            passed: true,
            detected_text: [],
            confidence: 0.92,
          }
        }),
        keywordVisibilityCheck: jest.fn().mockResolvedValue({
          passed: true,
          keywords: [
            {keyword: 'shock', visible: true, confidence: 0.88},
            {keyword: 'ghost', visible: true, confidence: 0.9},
          ],
        }),
        alignmentCheck: jest.fn().mockResolvedValue({
          passed: true,
          aligned: true,
          confidence: 0.85,
          mismatch_reasons: [],
        }),
        policyRiskCheck: jest.fn().mockResolvedValue({
          passed: true,
          risk_level: 'low',
          triggered_categories: [],
          should_replan: false,
          should_retry_panel: false,
        }),
      },
    })
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateFlipPanels({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      imageModel: 'gpt-image-1-mini',
      imageSize: '1024x1024',
      requestTimeoutMs: 15000,
      textAuditEnabled: false,
      validatorEnabled: true,
      validatorMaxRetries: 1,
      maxRetries: 0,
      regenerateIndices: [0],
      existingPanels: [
        'data:image/png;base64,OLD0',
        'data:image/png;base64,OLD1',
        'data:image/png;base64,OLD2',
        'data:image/png;base64,OLD3',
      ],
      keywords: ['shock', 'ghost'],
      storyPanels: [
        'A person walks quietly through a hallway.',
        'A ghost appears and shocks the person.',
        'The person drops a cup and steps back.',
        'Water spreads while the ghost remains visible.',
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.panels[0].imageDataUrl).toBe('data:image/png;base64,BBB=')
    expect(result.panels[0].panelPrompt).toContain(
      'Critical retry: previous output contained forbidden text or logo-like markings.'
    )
    expect(result.textOverlayRetryCount).toBe(1)
    expect(result.textAuditByPanel[0]).toMatchObject({
      checked: true,
      passed: true,
      hasText: false,
      attempts: 2,
      retriesUsed: 1,
      reason: '',
      detectedText: [],
    })
    expect(result.validatorAuditByPanel[0]).toMatchObject({
      invoked: true,
      passed: true,
      failureReasons: [],
      panelRepairReason: '',
    })
    expect(result.validatorMetrics).toMatchObject({
      validator_invoked: 2,
      ocr_fail: 1,
      visibility_fail: 0,
      alignment_fail: 0,
      policy_fail: 0,
      validator_retry_count: 1,
    })
    expect(result.validatorMetrics.panel_repair_reason).toEqual([
      {
        panel: 0,
        attempt: 1,
        reason: 'ocr_text_leakage',
      },
    ])
    expect(httpClient.post).toHaveBeenCalledTimes(2)
  })

  it('repairs a single rendered panel after story-level feedback finds near-duplicate progression', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'AAA=', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'BBB=', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'BBB=', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'DDD=', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'EEE=', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        }),
      get: jest.fn(),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateFlipPanels({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      imageModel: 'gpt-image-1-mini',
      imageSize: '1024x1024',
      requestTimeoutMs: 15000,
      textAuditEnabled: false,
      validatorEnabled: false,
      maxRetries: 0,
      keywords: ['shock', 'ghost'],
      storyPanels: [
        'A calm person enters a hallway with a cup.',
        'A ghost appears and the person jolts in shock.',
        'The cup drops and water spreads across the floor.',
        'The person backs away from the puddle while the ghost remains visible.',
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.panels[2].imageDataUrl).toBe('data:image/png;base64,EEE=')
    expect(result.panels[2].panelPrompt).toContain(
      'Story-level repair: differentiate this panel from the previous one with a clearly different composition and visible state change.'
    )
    expect(result.renderFeedback.verdict).toBe('accept_rendered_story')
    expect(result.renderFeedback.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verdict: 'repair_selected_panels',
          repairPanelIndices: [2],
        }),
      ])
    )
    expect(result.renderFeedbackMetrics).toMatchObject({
      rendered_story_accept: 1,
      rendered_story_repair: 1,
      panel_repair_count: 1,
      rendered_near_duplicate_fail: 1,
    })
    expect(httpClient.post).toHaveBeenCalledTimes(5)
  })

  it('switches to the stronger rendered alternative story when the selected render is repetitive', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'A1A1', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'B2B2', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'B2B2', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'D4D4', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'X1X1', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'Y2Y2', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'Z3Z3', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{b64_json: 'W4W4', mime_type: 'image/png'}],
            usage: {prompt_tokens: 10, completion_tokens: 0, total_tokens: 10},
          },
        }),
      get: jest.fn(),
    }

    const senseSelection = selectSensePair({
      keywordA: 'mirror',
      keywordB: 'ghost',
    })
    const storyOptions = [
      {
        id: 'option-1',
        title: 'Mirror scare',
        panels: [
          'A person wipes a mirror in a dressing room with a cloth.',
          'A ghost appears clearly inside the mirror and the person jolts in shock.',
          'The cloth drops as the mirror tilts while the ghost remains reflected inside.',
          'The fallen cloth lies below the tilted mirror while the ghost stays reflected inside.',
        ],
        senseSelection,
      },
      {
        id: 'option-2',
        title: 'Basement ghost',
        panels: [
          'A person reaches for a basement door with a flashlight.',
          'The door swings open and a ghost appears on the basement stairs.',
          'The flashlight drops and its beam swings across the stairs under the ghost.',
          'The person backs away from the stairs while the ghost remains visible above the fallen flashlight.',
        ],
        senseSelection,
      },
    ]

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateFlipPanels({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      imageModel: 'gpt-image-1-mini',
      imageSize: '1024x1024',
      requestTimeoutMs: 15000,
      textAuditEnabled: false,
      validatorEnabled: false,
      maxRetries: 0,
      keywords: ['mirror', 'ghost'],
      storyOptions,
      selectedStoryId: 'option-1',
      storyPanels: storyOptions[0].panels,
      senseSelection,
    })

    expect(result.ok).toBe(true)
    expect(result.selectedStory).toMatchObject({
      id: 'option-2',
      title: 'Basement ghost',
    })
    expect(result.renderFeedback.switchedToAlternativeOption).toBe(true)
    expect(result.renderFeedback.previousStoryId).toBe('option-1')
    expect(result.panels[0].panelStory).toContain('basement door')
    expect(result.renderFeedbackMetrics).toMatchObject({
      rendered_story_accept: 1,
      rendered_story_reject: 1,
      switched_to_alternative_option: 1,
      rendered_near_duplicate_fail: 1,
    })
    expect(httpClient.post).toHaveBeenCalledTimes(8)
  })

  it('escalates image timeout on timeout errors without ECONNABORTED code', async () => {
    const timeoutError = new Error('timeout of 180000ms exceeded')
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          data: {
            data: [
              {
                b64_json: 'AAA=',
                mime_type: 'image/png',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 0,
              total_tokens: 10,
            },
          },
        }),
      get: jest.fn(),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'openai', apiKey: 'sk-test'})

    const result = await bridge.generateFlipPanels({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      imageModel: 'gpt-image-1-mini',
      imageSize: '1024x1024',
      requestTimeoutMs: 9000,
      maxRetries: 0,
      textAuditEnabled: false,
      regenerateIndices: [0],
      existingPanels: [
        'data:image/png;base64,OLD0',
        'data:image/png;base64,OLD1',
        'data:image/png;base64,OLD2',
        'data:image/png;base64,OLD3',
      ],
      keywords: ['cat', 'lamp'],
      storyPanels: [
        'Panel 1: cat near lamp.',
        'Panel 2: lamp turns on.',
        'Panel 3: cat moves closer.',
        'Panel 4: cat sleeps by lamp.',
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.panels[0].imageDataUrl).toBe('data:image/png;base64,AAA=')
    expect(httpClient.post).toHaveBeenCalledTimes(2)
    expect(httpClient.post.mock.calls[0][2].timeout).toBe(180000)
    expect(httpClient.post.mock.calls[1][2].timeout).toBe(270000)
  })

  it('rejects image generation for providers without image routing support', async () => {
    const bridge = createAiProviderBridge(mockLogger(), {
      httpClient: {
        post: jest.fn(),
        get: jest.fn(),
      },
    })
    bridge.setProviderKey({provider: 'anthropic', apiKey: 'anthropic-test-key'})

    await expect(
      bridge.generateImageSearchResults({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        imageModel: 'claude-image-1',
        prompt: 'draw a simple cat',
        maxImages: 1,
      })
    ).rejects.toThrow(
      'AI image search is not available for provider: anthropic. Supported providers: openai-compatible and gemini.'
    )
  })

  it('tests anthropic provider connectivity and lists anthropic models', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({data: {id: 'ok'}}),
      get: jest.fn().mockResolvedValue({
        data: {
          data: [
            {id: 'claude-3-7-sonnet-latest'},
            {id: 'claude-3-5-haiku-latest'},
          ],
        },
      }),
    }

    const bridge = createAiProviderBridge(mockLogger(), {httpClient})
    bridge.setProviderKey({provider: 'anthropic', apiKey: 'anthropic-test-key'})

    const testResult = await bridge.testProvider({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
    })
    const listResult = await bridge.listModels({provider: 'anthropic'})

    expect(testResult).toMatchObject({
      ok: true,
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
    })
    expect(listResult).toEqual({
      ok: true,
      provider: 'anthropic',
      total: 2,
      models: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
    })
    expect(httpClient.post).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'anthropic-test-key',
          'anthropic-version': '2023-06-01',
        }),
      })
    )
    expect(httpClient.get).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'anthropic-test-key',
        }),
      })
    )
  })
})
