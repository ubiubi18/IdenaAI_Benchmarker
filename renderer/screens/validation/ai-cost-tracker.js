import {loadPersistentStateValue, persistItem} from '../../shared/utils/persist'
import {buildValidationSessionScopeKey} from './utils'

export const VALIDATION_AI_COST_LEDGER_VERSION = 1
export const VALIDATION_AI_COST_LEDGER_STORAGE_SUFFIX =
  'validation-ai-cost-ledger'

function normalizeTokenUsage(usage = {}) {
  const promptTokens = Number(usage.promptTokens)
  const completionTokens = Number(usage.completionTokens)
  const totalTokens = Number(usage.totalTokens)

  const normalizedPrompt =
    Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0
  const normalizedCompletion =
    Number.isFinite(completionTokens) && completionTokens >= 0
      ? completionTokens
      : 0

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens:
      Number.isFinite(totalTokens) && totalTokens >= 0
        ? totalTokens
        : normalizedPrompt + normalizedCompletion,
  }
}

function normalizeUsd(value) {
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : null
}

function normalizeInteger(value) {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) && next >= 0 ? next : null
}

export function normalizeValidationAiCostLedgerEntry(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  return {
    id:
      String(source.id || '').trim() ||
      `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: String(source.time || '').trim() || new Date().toISOString(),
    action: String(source.action || '').trim() || 'unknown',
    provider: String(source.provider || '').trim() || 'unknown',
    model: String(source.model || '').trim() || 'unknown',
    sessionType: String(source.sessionType || '').trim() || null,
    totalFlips: normalizeInteger(source.totalFlips),
    appliedAnswers: normalizeInteger(source.appliedAnswers),
    tokenUsage: normalizeTokenUsage(source.tokenUsage),
    estimatedUsd: normalizeUsd(source.estimatedUsd),
    actualUsd: normalizeUsd(source.actualUsd),
  }
}

export function normalizeValidationAiCostLedger(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const entriesSource = Array.isArray(source.entries) ? source.entries : []

  return {
    version: VALIDATION_AI_COST_LEDGER_VERSION,
    updatedAt: String(source.updatedAt || '').trim() || null,
    entries: entriesSource
      .map((entry) => normalizeValidationAiCostLedgerEntry(entry))
      .slice(0, 50),
  }
}

export function buildValidationAiCostLedgerStorageKey(scope = {}) {
  const scopeKey = buildValidationSessionScopeKey(scope)
  return scopeKey
    ? `${scopeKey}:${VALIDATION_AI_COST_LEDGER_STORAGE_SUFFIX}`
    : ''
}

export function loadValidationAiCostLedger(scope = {}) {
  const key = buildValidationAiCostLedgerStorageKey(scope)

  if (!key) {
    return normalizeValidationAiCostLedger()
  }

  return normalizeValidationAiCostLedger(
    loadPersistentStateValue('validationResults', key)
  )
}

export function persistValidationAiCostLedger(scope = {}, ledger = {}) {
  const key = buildValidationAiCostLedgerStorageKey(scope)

  if (!key) {
    return false
  }

  persistItem(
    'validationResults',
    key,
    normalizeValidationAiCostLedger({
      ...ledger,
      updatedAt: new Date().toISOString(),
    })
  )

  return true
}

export function appendValidationAiCostLedgerEntry(scope = {}, entry = {}) {
  const currentLedger = loadValidationAiCostLedger(scope)
  const nextEntry = normalizeValidationAiCostLedgerEntry(entry)

  return persistValidationAiCostLedger(scope, {
    ...currentLedger,
    entries: [nextEntry].concat(currentLedger.entries || []).slice(0, 50),
  })
}

export function computeValidationAiCostTotals(ledger = {}) {
  const {entries} = normalizeValidationAiCostLedger(ledger)

  const totals = entries.reduce(
    (acc, entry) => ({
      promptTokens: acc.promptTokens + entry.tokenUsage.promptTokens,
      completionTokens:
        acc.completionTokens + entry.tokenUsage.completionTokens,
      totalTokens: acc.totalTokens + entry.tokenUsage.totalTokens,
      estimatedUsd:
        acc.estimatedUsd +
        (Number.isFinite(entry.estimatedUsd) ? entry.estimatedUsd : 0),
      actualUsd:
        acc.actualUsd +
        (Number.isFinite(entry.actualUsd) ? entry.actualUsd : 0),
      entriesWithEstimated:
        acc.entriesWithEstimated +
        (Number.isFinite(entry.estimatedUsd) ? 1 : 0),
      entriesWithActual:
        acc.entriesWithActual + (Number.isFinite(entry.actualUsd) ? 1 : 0),
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedUsd: 0,
      actualUsd: 0,
      entriesWithEstimated: 0,
      entriesWithActual: 0,
    }
  )

  return {
    count: entries.length,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    estimatedUsd: totals.entriesWithEstimated > 0 ? totals.estimatedUsd : null,
    actualUsd: totals.entriesWithActual > 0 ? totals.actualUsd : null,
  }
}

function classifyValidationAiCostEntry(entry = {}) {
  const action = String(entry.action || '')
    .trim()
    .toLowerCase()
  const sessionType = String(entry.sessionType || '')
    .trim()
    .toLowerCase()

  if (action === 'short-session solve' || sessionType === 'short') {
    return 'short'
  }

  if (action === 'long-session solve' || sessionType === 'long') {
    return 'long'
  }

  if (
    action === 'long-session report review' ||
    sessionType === 'long-report-review'
  ) {
    return 'reporting'
  }

  return 'other'
}

export function computeValidationAiCostBreakdown(ledger = {}) {
  const normalizedLedger = normalizeValidationAiCostLedger(ledger)
  const entries = normalizedLedger.entries || []
  const shortEntries = entries.filter(
    (entry) => classifyValidationAiCostEntry(entry) === 'short'
  )
  const longEntries = entries.filter(
    (entry) => classifyValidationAiCostEntry(entry) === 'long'
  )
  const reportingEntries = entries.filter(
    (entry) => classifyValidationAiCostEntry(entry) === 'reporting'
  )
  const solveEntries = entries.filter((entry) => {
    const category = classifyValidationAiCostEntry(entry)
    return category === 'short' || category === 'long'
  })

  return {
    short: computeValidationAiCostTotals({entries: shortEntries}),
    long: computeValidationAiCostTotals({entries: longEntries}),
    reporting: computeValidationAiCostTotals({entries: reportingEntries}),
    solveCombined: computeValidationAiCostTotals({entries: solveEntries}),
    overall: computeValidationAiCostTotals(normalizedLedger),
  }
}
