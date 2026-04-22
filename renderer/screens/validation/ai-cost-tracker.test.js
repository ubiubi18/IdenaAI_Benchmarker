/** @jest-environment jsdom */
import {persistState} from '../../shared/utils/persist'
import {
  appendValidationAiCostLedgerEntry,
  buildValidationAiCostLedgerStorageKey,
  computeValidationAiCostBreakdown,
  computeValidationAiCostTotals,
  loadValidationAiCostLedger,
} from './ai-cost-tracker'

let validationResultsStoreState = {}

function createValidationResultsStore() {
  return {
    loadState() {
      return {...validationResultsStoreState}
    },
    loadValue(key) {
      return validationResultsStoreState[key] || null
    },
    persistItem(key, value) {
      if (value == null) {
        delete validationResultsStoreState[key]
      } else {
        validationResultsStoreState[key] = value
      }
    },
    persistState(state) {
      validationResultsStoreState = state ? {...state} : {}
    },
  }
}

describe('validation ai cost tracker', () => {
  beforeEach(() => {
    validationResultsStoreState = {}
    window.idena = {
      storage: {
        validationResults: createValidationResultsStore(),
      },
    }
  })

  afterEach(() => {
    persistState('validationResults', null)
    delete window.idena
  })

  it('persists validation ai cost ledger entries by validation scope', () => {
    const scope = {
      epoch: 42,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: 1710000000000,
    }

    appendValidationAiCostLedgerEntry(scope, {
      action: 'short-session solve',
      provider: 'openai',
      model: 'gpt-4o-mini',
      sessionType: 'short',
      tokenUsage: {
        promptTokens: 210,
        completionTokens: 14,
        totalTokens: 224,
      },
      estimatedUsd: 0.0000399,
      actualUsd: 0.0000399,
    })

    expect(buildValidationAiCostLedgerStorageKey(scope)).toContain(
      'validation-ai-cost-ledger'
    )
    expect(loadValidationAiCostLedger(scope)).toMatchObject({
      entries: [
        expect.objectContaining({
          action: 'short-session solve',
          provider: 'openai',
          model: 'gpt-4o-mini',
          sessionType: 'short',
          tokenUsage: {
            promptTokens: 210,
            completionTokens: 14,
            totalTokens: 224,
          },
          estimatedUsd: 0.0000399,
          actualUsd: 0.0000399,
        }),
      ],
    })
  })

  it('computes aggregate totals across persisted entries', () => {
    const totals = computeValidationAiCostTotals({
      entries: [
        {
          action: 'short-session solve',
          tokenUsage: {
            promptTokens: 210,
            completionTokens: 14,
            totalTokens: 224,
          },
          estimatedUsd: 0.0000399,
          actualUsd: 0.0000399,
        },
        {
          action: 'long-session report review',
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
          },
          estimatedUsd: null,
          actualUsd: null,
        },
      ],
    })

    expect(totals).toMatchObject({
      count: 2,
      promptTokens: 310,
      completionTokens: 34,
      totalTokens: 344,
      estimatedUsd: 0.0000399,
      actualUsd: 0.0000399,
    })
  })

  it('computes session breakdown totals for short, long, reporting, and combined', () => {
    const breakdown = computeValidationAiCostBreakdown({
      entries: [
        {
          action: 'short-session solve',
          sessionType: 'short',
          tokenUsage: {
            promptTokens: 200,
            completionTokens: 20,
            totalTokens: 220,
          },
          estimatedUsd: 0.01,
          actualUsd: 0.01,
        },
        {
          action: 'long-session solve',
          sessionType: 'long',
          tokenUsage: {
            promptTokens: 300,
            completionTokens: 30,
            totalTokens: 330,
          },
          estimatedUsd: 0.02,
          actualUsd: 0.02,
        },
        {
          action: 'long-session report review',
          sessionType: 'long-report-review',
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 10,
            totalTokens: 110,
          },
          estimatedUsd: 0.005,
          actualUsd: 0.005,
        },
      ],
    })

    expect(breakdown.short).toMatchObject({
      count: 1,
      totalTokens: 220,
      estimatedUsd: 0.01,
      actualUsd: 0.01,
    })
    expect(breakdown.long).toMatchObject({
      count: 1,
      totalTokens: 330,
      estimatedUsd: 0.02,
      actualUsd: 0.02,
    })
    expect(breakdown.reporting).toMatchObject({
      count: 1,
      totalTokens: 110,
      estimatedUsd: 0.005,
      actualUsd: 0.005,
    })
    expect(breakdown.solveCombined).toMatchObject({
      count: 2,
      totalTokens: 550,
      estimatedUsd: 0.03,
      actualUsd: 0.03,
    })
    expect(breakdown.overall.count).toBe(3)
    expect(breakdown.overall.totalTokens).toBe(660)
    expect(breakdown.overall.estimatedUsd).toBeCloseTo(0.035, 10)
    expect(breakdown.overall.actualUsd).toBeCloseTo(0.035, 10)
  })
})
