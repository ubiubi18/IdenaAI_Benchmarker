import {
  estimateValidationAiSolveBudget,
  planValidationAiSolve,
} from './solver-orchestrator'

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
    const shortFlips = Array.from({length: 8}, (_, index) =>
      createDecodedFlip(`short-${index + 1}`)
    )

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
        shortSessionOpenAiFastModel: 'gpt-5.4-mini',
      },
    })

    const longPlan = planValidationAiSolve({
      sessionType: 'long',
      longFlips: [createDecodedFlip('long-fast-1')],
      aiSolver: {
        provider: 'openai',
        model: 'gpt-5.4',
        shortSessionOpenAiFastEnabled: true,
        shortSessionOpenAiFastModel: 'gpt-5.4-mini',
      },
    })

    expect(shortPlan.model).toBe('gpt-5.4-mini')
    expect(shortPlan.promptOptions).toEqual({
      openAiServiceTier: 'priority',
      openAiReasoningEffort: 'none',
    })
    expect(longPlan.model).toBe('gpt-5.4')
    expect(longPlan.promptOptions).toBeNull()
  })
})
