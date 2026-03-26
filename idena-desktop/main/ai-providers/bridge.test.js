const {createAiProviderBridge} = require('./bridge')

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
