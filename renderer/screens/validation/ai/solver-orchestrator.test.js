import {
  estimateValidationAiSolveBudget,
  planValidationAiSolve,
  solveValidationSessionWithAi,
} from './solver-orchestrator'
import {AnswerType} from '../../../shared/types'

function createDecodedFlip(hash) {
  return {
    hash,
    decoded: true,
    failed: false,
    images: ['panel-1', 'panel-2', 'panel-3', 'panel-4'],
    orders: [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
    ],
  }
}

describe('solver-orchestrator planning', () => {
  it('limits short-session plans to six regular solvable flips', () => {
    const shortFlips = Array.from({length: 8}, (_, index) => {
      const flip = createDecodedFlip(`short-${index + 1}`)
      if (index === 1) {
        flip.option = AnswerType.Left
      }
      return flip
    })

    const plan = planValidationAiSolve({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
      },
    })

    expect(plan.candidateFlips).toHaveLength(6)
    expect(plan.provider).toBe('openai')
    expect(plan.model).toBe('gpt-5.4')
    expect(plan.candidateFlips.some((flip) => flip.hash === 'short-2')).toBe(
      false
    )
  })

  it('applies the strict local-ai runtime overrides to planning and budgeting', () => {
    const longFlips = [createDecodedFlip('long-1'), createDecodedFlip('long-2')]

    const budget = estimateValidationAiSolveBudget({
      sessionType: 'long',
      longFlips,
      aiSolver: {
        provider: 'local-ai',
        benchmarkProfile: 'strict',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
      },
    })

    expect(budget.flipCount).toBe(2)
    expect(budget.effectiveProfile.requestTimeoutMs).toBe(15000)
    expect(budget.effectiveProfile.interFlipDelayMs).toBe(0)
    expect(budget.estimatedMs).toBeGreaterThan(0)
  })

  it('uses the short-session OpenAI fast override only for short session', () => {
    const shortPlan = planValidationAiSolve({
      sessionType: 'short',
      shortFlips: [createDecodedFlip('short-fast-1')],
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
        shortSessionOpenAiFastEnabled: true,
        shortSessionOpenAiFastModel: 'gpt-5.5-mini',
      },
    })

    const longPlan = planValidationAiSolve({
      sessionType: 'long',
      longFlips: [createDecodedFlip('long-fast-1')],
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
        shortSessionOpenAiFastEnabled: true,
        shortSessionOpenAiFastModel: 'gpt-5.5-mini',
      },
    })

    expect(shortPlan.model).toBe('gpt-5.5-mini')
    expect(shortPlan.promptOptions).toEqual({
      openAiServiceTier: 'priority',
      openAiReasoningEffort: 'none',
    })
    expect(longPlan.model).toBe('gpt-5.4')
    expect(longPlan.promptOptions).toBeNull()
  })

  it('uses a more deliberate strict profile for long-session OpenAI solving', () => {
    const comparisonFlips = Array.from({length: 6}, (_, index) =>
      createDecodedFlip(`comparison-${index + 1}`)
    )

    const shortBudget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips: comparisonFlips,
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
      },
    })

    const longBudget = estimateValidationAiSolveBudget({
      sessionType: 'long',
      longFlips: comparisonFlips,
      maxFlips: 6,
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
      },
    })

    expect(shortBudget.effectiveProfile.flipVisionMode).toBe('composite')
    expect(longBudget.effectiveProfile.flipVisionMode).toBe('frames_two_pass')
    expect(longBudget.effectiveProfile.requestTimeoutMs).toBeGreaterThan(
      shortBudget.effectiveProfile.requestTimeoutMs
    )
    expect(longBudget.estimatedMs).toBeGreaterThan(shortBudget.estimatedMs)
  })

  it('budgets extra model passes for uncertainty reprompts and two-pass vision', () => {
    const shortFlips = Array.from({length: 6}, (_, index) =>
      createDecodedFlip(`short-budget-${index + 1}`)
    )

    const singlePassBudget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        benchmarkProfile: 'custom',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
        flipVisionMode: 'composite',
        uncertaintyRepromptEnabled: false,
      },
    })

    const repromptBudget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        benchmarkProfile: 'custom',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
        flipVisionMode: 'composite',
        uncertaintyRepromptEnabled: true,
      },
    })

    const framesTwoPassBudget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        benchmarkProfile: 'custom',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
        flipVisionMode: 'frames_two_pass',
        uncertaintyRepromptEnabled: true,
      },
    })

    expect(repromptBudget.estimatedMs).toBeGreaterThan(
      singlePassBudget.estimatedMs
    )
    expect(repromptBudget.uncertaintyReviewFlipCount).toBeLessThan(
      repromptBudget.flipCount
    )
    expect(framesTwoPassBudget.estimatedMs).toBeGreaterThan(
      repromptBudget.estimatedMs
    )
  })

  it('keeps short-session preflight budgeting on the fast path for most flips', () => {
    const shortFlips = Array.from({length: 6}, (_, index) =>
      createDecodedFlip(`short-fast-budget-${index + 1}`)
    )

    const budget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
        shortSessionOpenAiFastEnabled: true,
        benchmarkProfile: 'custom',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
        maxRetries: 1,
        uncertaintyRepromptEnabled: true,
      },
    })

    expect(budget.flipCount).toBe(6)
    expect(budget.uncertaintyReviewFlipCount).toBe(2)
    expect(Math.ceil(budget.estimatedMs / 1000)).toBeLessThan(90)
  })

  it('budgets retry attempts and backoff into the preflight estimate', () => {
    const shortFlips = [createDecodedFlip('short-retry-budget-1')]

    const noRetryBudget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        benchmarkProfile: 'custom',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
        maxRetries: 0,
        uncertaintyRepromptEnabled: true,
      },
    })

    const retryBudget = estimateValidationAiSolveBudget({
      sessionType: 'short',
      shortFlips,
      aiSolver: {
        provider: 'openai',
        benchmarkProfile: 'custom',
        requestTimeoutMs: 9000,
        interFlipDelayMs: 650,
        maxRetries: 2,
        uncertaintyRepromptEnabled: true,
      },
    })

    expect(retryBudget.estimatedMs).toBeGreaterThan(noRetryBudget.estimatedMs)
  })

  it('surfaces image load failures as readable errors', async () => {
    const originalImage = global.Image
    const originalAiSolver = global.aiSolver

    class BrokenImage {
      set src(value) {
        this.currentSrc = value
        setTimeout(() => {
          this.onerror?.({
            type: 'error',
            target: {currentSrc: value},
          })
        }, 0)
      }
    }

    global.Image = BrokenImage
    global.aiSolver = {
      solveFlipBatch: jest.fn(),
    }

    await expect(
      solveValidationSessionWithAi({
        sessionType: 'short',
        shortFlips: [createDecodedFlip('short-broken-1')],
        aiSolver: {
          provider: 'openai',
          model: 'gpt-5.4',
        },
        hardDeadlineAt: Date.now() + 60 * 1000,
      })
    ).rejects.toThrow('Unable to load validation flip image (panel-1)')

    global.Image = originalImage
    global.aiSolver = originalAiSolver
  })

  it('forwards second-pass trace fields into solved progress events', async () => {
    const originalImage = global.Image
    const originalAiSolver = global.aiSolver
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = jest.spyOn(document, 'createElement')
    const onProgress = jest.fn()

    function ReadyImage() {
      this.width = 100
      this.height = 100
      this.naturalWidth = 100
      this.naturalHeight = 100
    }

    Object.defineProperty(ReadyImage.prototype, 'src', {
      set(value) {
        this.currentSrc = value
        setTimeout(() => {
          this.onload?.()
        }, 0)
      },
    })

    global.Image = ReadyImage
    global.aiSolver = {
      solveFlipBatch: jest.fn().mockResolvedValue({
        results: [
          {
            hash: 'short-forward-1',
            answer: 'right',
            confidence: 0.31,
            latencyMs: 234,
            reasoning: 'right story stays more coherent',
            rawAnswerBeforeRemap: 'skip',
            finalAnswerAfterRemap: 'right',
            sideSwapped: false,
            tokenUsage: {
              promptTokens: 11,
              completionTokens: 7,
              totalTokens: 18,
            },
            costs: {
              estimatedUsd: 0.001,
              actualUsd: 0.001,
            },
            uncertaintyRepromptUsed: true,
            forcedDecision: true,
            forcedDecisionPolicy: 'random',
            forcedDecisionReason: 'uncertain_or_skip',
            secondPassStrategy: 'annotated_frame_review',
            frameReasoningUsed: true,
            firstPass: {
              answer: 'skip',
              confidence: 0.12,
              reasoning: 'initial pass could not separate the stories',
              strategy: 'initial_decision',
            },
          },
        ],
      }),
    }
    createElementSpy.mockImplementation((tagName, ...args) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '#000000',
            fillRect: jest.fn(),
            drawImage: jest.fn(),
          }),
          toDataURL: jest.fn(() => 'data:image/png;base64,MOCK'),
        }
      }

      return originalCreateElement(tagName, ...args)
    })

    try {
      await solveValidationSessionWithAi({
        sessionType: 'short',
        shortFlips: [createDecodedFlip('short-forward-1')],
        aiSolver: {
          provider: 'openai',
          model: 'gpt-5.4',
          benchmarkProfile: 'custom',
        },
        hardDeadlineAt: Date.now() + 60 * 1000,
        onProgress,
      })

      const solvedEvent = onProgress.mock.calls
        .map(([event]) => event)
        .find((event) => event.stage === 'solved')

      expect(solvedEvent).toMatchObject({
        hash: 'short-forward-1',
        answer: 'right',
        reasoning: 'right story stays more coherent',
        uncertaintyRepromptUsed: true,
        forcedDecision: true,
        forcedDecisionPolicy: 'random',
        forcedDecisionReason: 'uncertain_or_skip',
        secondPassStrategy: 'annotated_frame_review',
        frameReasoningUsed: true,
        firstPass: expect.objectContaining({
          answer: 'skip',
          strategy: 'initial_decision',
        }),
      })
    } finally {
      createElementSpy.mockRestore()
      global.Image = originalImage
      global.aiSolver = originalAiSolver
    }
  })

  it('prepares and solves flips one by one instead of prebuilding the whole batch', async () => {
    const originalImage = global.Image
    const originalAiSolver = global.aiSolver
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = jest.spyOn(document, 'createElement')
    const onProgress = jest.fn()

    function ReadyImage() {
      this.width = 100
      this.height = 100
      this.naturalWidth = 100
      this.naturalHeight = 100
    }

    Object.defineProperty(ReadyImage.prototype, 'src', {
      set() {
        setTimeout(() => {
          this.onload?.()
        }, 0)
      },
    })

    global.Image = ReadyImage
    global.aiSolver = {
      solveFlipBatch: jest
        .fn()
        .mockResolvedValueOnce({
          results: [
            {
              hash: 'long-serial-1',
              answer: 'left',
              confidence: 0.81,
              latencyMs: 111,
              reasoning: 'left is more coherent',
              rawAnswerBeforeRemap: 'left',
              finalAnswerAfterRemap: 'left',
              sideSwapped: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            {
              hash: 'long-serial-2',
              answer: 'right',
              confidence: 0.84,
              latencyMs: 112,
              reasoning: 'right is more coherent',
              rawAnswerBeforeRemap: 'right',
              finalAnswerAfterRemap: 'right',
              sideSwapped: false,
            },
          ],
        }),
    }
    createElementSpy.mockImplementation((tagName, ...args) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '#000000',
            fillRect: jest.fn(),
            drawImage: jest.fn(),
          }),
          toDataURL: jest.fn(() => 'data:image/png;base64,MOCK'),
        }
      }

      return originalCreateElement(tagName, ...args)
    })

    try {
      await solveValidationSessionWithAi({
        sessionType: 'long',
        longFlips: [
          createDecodedFlip('long-serial-1'),
          createDecodedFlip('long-serial-2'),
        ],
        maxFlips: 2,
        aiSolver: {
          provider: 'openai',
          model: 'gpt-5.4',
          benchmarkProfile: 'custom',
          flipVisionMode: 'frames_two_pass',
          uncertaintyRepromptEnabled: false,
          interFlipDelayMs: 0,
        },
        hardDeadlineAt: Date.now() + 60 * 1000,
        onProgress,
      })

      const stages = onProgress.mock.calls.map(([event]) => ({
        stage: event.stage,
        hash: event.hash || null,
      }))

      expect(stages).toEqual([
        {stage: 'prepared', hash: 'long-serial-1'},
        {stage: 'solving', hash: 'long-serial-1'},
        {stage: 'solved', hash: 'long-serial-1'},
        {stage: 'prepared', hash: 'long-serial-2'},
        {stage: 'solving', hash: 'long-serial-2'},
        {stage: 'solved', hash: 'long-serial-2'},
        {stage: 'completed', hash: null},
      ])
    } finally {
      createElementSpy.mockRestore()
      global.Image = originalImage
      global.aiSolver = originalAiSolver
    }
  })
})
