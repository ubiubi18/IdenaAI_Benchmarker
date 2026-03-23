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

    const result = await bridge.solveFlipBatch({
      provider: 'openai',
      model: 'gpt-4o-mini',
      benchmarkProfile: 'custom',
      deadlineMs: 10000,
      requestTimeoutMs: 1000,
      maxConcurrency: 1,
      maxRetries: 0,
      maxOutputTokens: 64,
      flips: [{hash: 'flip-1'}, {hash: 'flip-2'}],
    })

    expect(invokeProvider).toHaveBeenCalledTimes(1)
    expect(result.results[0]).toMatchObject({
      hash: 'flip-1',
      answer: 'left',
      confidence: 0.9,
    })
    expect(result.results[1]).toMatchObject({
      hash: 'flip-2',
      answer: 'skip',
      error: 'deadline_exceeded',
    })
    expect(writeBenchmarkLog).toHaveBeenCalledTimes(1)
  })
})
