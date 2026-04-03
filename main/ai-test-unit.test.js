const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createAiTestUnitBridge} = require('./ai-test-unit')

function mockLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
  }
}

function createMockAiProviderBridge() {
  return {
    solveFlipBatch: jest.fn(async ({flips, onFlipStart, onFlipResult}) => {
      const results = flips.map((flip, flipIndex) => ({
        hash: flip.hash,
        answer: 'left',
        confidence: 1,
        latencyMs: 1,
        flipIndex,
        leftImage: flip.leftImage,
        rightImage: flip.rightImage,
      }))

      if (typeof onFlipStart === 'function') {
        results.forEach((result) => {
          onFlipStart({
            type: 'flip-start',
            hash: result.hash,
            flipIndex: result.flipIndex,
            leftImage: result.leftImage,
            rightImage: result.rightImage,
          })
        })
      }

      if (typeof onFlipResult === 'function') {
        results.forEach((result) => {
          onFlipResult({
            type: 'flip-result',
            ...result,
          })
        })
      }

      return {
        summary: {
          totalFlips: flips.length,
          elapsedMs: 10,
          skipped: 0,
          left: flips.length,
          right: 0,
          diagnostics: {
            swapped: 0,
            notSwapped: flips.length,
            rawLeft: flips.length,
            rawRight: 0,
            rawSkip: 0,
            finalLeft: flips.length,
            finalRight: 0,
            finalSkip: 0,
            remappedDecisions: 0,
            providerErrors: 0,
          },
        },
        results,
      }
    }),
  }
}

describe('ai-test-unit bridge', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-ai-test-unit-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('adds and lists queue flips', async () => {
    const bridge = createAiTestUnitBridge({
      logger: mockLogger(),
      aiProviderBridge: createMockAiProviderBridge(),
      dependencies: {
        getUserDataPath: () => tempDir,
        now: () => 1000,
      },
    })

    const addResult = await bridge.addFlips({
      source: 'test',
      flips: [
        {
          hash: 'flip-a',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
        },
      ],
    })

    expect(addResult).toMatchObject({
      ok: true,
      added: 1,
      total: 1,
    })

    const list = await bridge.listFlips({limit: 10, offset: 0})
    expect(list.total).toBe(1)
    expect(list.flips[0]).toMatchObject({
      hash: 'flip-a',
      source: 'test',
    })
  })

  it('runs queue in batches and dequeues processed flips', async () => {
    const aiProviderBridge = createMockAiProviderBridge()
    const bridge = createAiTestUnitBridge({
      logger: mockLogger(),
      aiProviderBridge,
      dependencies: {
        getUserDataPath: () => tempDir,
        now: () => 1000,
      },
    })

    await bridge.addFlips({
      source: 'test',
      flips: [
        {
          hash: 'flip-a',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          expectedAnswer: 'left',
        },
        {
          hash: 'flip-b',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          expectedAnswer: 'right',
        },
      ],
    })

    const runResult = await bridge.run({
      provider: 'openai',
      model: 'gpt-4o-mini',
      batchSize: 1,
      maxFlips: 2,
      dequeue: true,
    })

    expect(runResult.totalBatches).toBe(2)
    expect(runResult.totalFlips).toBe(2)
    expect(runResult.summary.diagnostics).toMatchObject({
      swapped: 0,
      notSwapped: 2,
      rawLeft: 2,
      rawRight: 0,
      rawSkip: 0,
      finalLeft: 2,
      finalRight: 0,
      finalSkip: 0,
      remappedDecisions: 0,
      providerErrors: 0,
    })
    expect(runResult.summary.evaluation).toMatchObject({
      labeled: 2,
      answered: 2,
      skippedLabeled: 0,
      correct: 1,
      correctAnswered: 1,
      expectedLeft: 1,
      expectedRight: 1,
      expectedSkip: 0,
      accuracyLabeled: 0.5,
      accuracyAnswered: 0.5,
    })
    expect(aiProviderBridge.solveFlipBatch).toHaveBeenCalledTimes(2)

    const queueAfter = await bridge.listFlips({limit: 10, offset: 0})
    expect(queueAfter.total).toBe(0)
  })

  it('caps queue length and drops oldest flips', async () => {
    const bridge = createAiTestUnitBridge({
      logger: mockLogger(),
      aiProviderBridge: createMockAiProviderBridge(),
      dependencies: {
        getUserDataPath: () => tempDir,
        now: () => 1000,
        maxQueuedFlips: 2,
      },
    })

    const result = await bridge.addFlips({
      source: 'test',
      flips: [
        {
          hash: 'flip-a',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
        },
        {
          hash: 'flip-b',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
        },
        {
          hash: 'flip-c',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
        },
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      added: 3,
      total: 2,
      dropped: 1,
    })

    const list = await bridge.listFlips({limit: 10, offset: 0})
    expect(list.total).toBe(2)
    expect(list.flips.map((x) => x.hash)).toEqual(['flip-b', 'flip-c'])
  })

  it('rotates oversized queue files instead of parsing them', async () => {
    const logger = mockLogger()
    const bridge = createAiTestUnitBridge({
      logger,
      aiProviderBridge: createMockAiProviderBridge(),
      dependencies: {
        getUserDataPath: () => tempDir,
        now: () => 1000,
        maxQueueFileBytes: 1024 * 1024,
      },
    })

    const queueDir = path.join(tempDir, 'ai-benchmark')
    const queueFile = path.join(queueDir, 'test-unit-flips.json')
    await fs.ensureDir(queueDir)
    const largePayload = `["${'x'.repeat(2 * 1024 * 1024)}"]`
    await fs.writeFile(queueFile, largePayload)

    const list = await bridge.listFlips({limit: 10, offset: 0})

    expect(list.total).toBe(0)
    const files = await fs.readdir(queueDir)
    expect(files.some((name) => name.includes('.oversize-'))).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('emits live progress events during run', async () => {
    const bridge = createAiTestUnitBridge({
      logger: mockLogger(),
      aiProviderBridge: createMockAiProviderBridge(),
      dependencies: {
        getUserDataPath: () => tempDir,
        now: sequenceNow([1000, 1005, 1010, 1020, 1030, 1040]),
      },
    })

    await bridge.addFlips({
      source: 'test',
      flips: [
        {
          hash: 'flip-a',
          leftImage: 'data:image/png;base64,AAA=',
          rightImage: 'data:image/png;base64,BBB=',
          expectedAnswer: 'left',
        },
      ],
    })

    const onProgress = jest.fn()
    await bridge.run(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        batchSize: 1,
        maxFlips: 1,
      },
      {onProgress}
    )

    const eventTypes = onProgress.mock.calls.map(([event]) => event.type)
    expect(eventTypes).toContain('run-start')
    expect(eventTypes).toContain('flip-start')
    expect(eventTypes).toContain('flip-result')
    expect(eventTypes).toContain('run-complete')

    const flipResultEvent = onProgress.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'flip-result')
    expect(flipResultEvent).toMatchObject({
      expectedAnswer: 'left',
      isCorrect: true,
    })
  })
})

function sequenceNow(values) {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)]
    index += 1
    return value
  }
}
