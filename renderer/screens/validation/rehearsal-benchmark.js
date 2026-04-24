import {loadPersistentStateValue, persistItem} from '../../shared/utils/persist'
import {AnswerType, RelevanceType} from '../../shared/types'
import {buildValidationSessionScopeKey, filterRegularFlips} from './utils'

export const REHEARSAL_BENCHMARK_REVIEW_VERSION = 1
export const REHEARSAL_BENCHMARK_REVIEW_STORAGE_SUFFIX =
  'rehearsal-benchmark-review'
export const REHEARSAL_BENCHMARK_ANNOTATION_DATASET_VERSION = 1
export const REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY =
  'rehearsal-benchmark-annotations'

const UNSAFE_REHEARSAL_BENCHMARK_OBJECT_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

function normalizeRehearsalBenchmarkHash(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^_flip_/u, '')

  return UNSAFE_REHEARSAL_BENCHMARK_OBJECT_KEYS.has(normalized)
    ? ''
    : normalized
}

function normalizeExpectedAnswer(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['left', 'right', 'skip'].includes(next) ? next : null
}

function normalizeExpectedStrength(value) {
  const next = String(value || '').trim()
  return next || null
}

function normalizeConsensusCount(value) {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) && next >= 0 ? next : 0
}

function normalizeConsensusVotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const left = normalizeConsensusCount(value.Left ?? value.left)
  const right = normalizeConsensusCount(value.Right ?? value.right)
  const reported = normalizeConsensusCount(
    value.Reported ?? value.reported ?? value.skip ?? value.inappropriate
  )
  const total = left + right + reported

  if (total < 1) {
    return null
  }

  return {
    left,
    right,
    reported,
    total,
  }
}

function normalizeSeedSourceLabel(value) {
  const next = String(value || '').trim()
  return next || null
}

function normalizeSeedWordEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const name = String(value.name || '').trim()
  const desc = String(value.desc || value.description || '').trim()

  if (!(name || desc)) {
    return null
  }

  return {
    name,
    desc,
  }
}

function normalizeSeedWords(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(normalizeSeedWordEntry).filter(Boolean).slice(0, 2)
}

function normalizeSeedSourceStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const normalized = {
    epoch:
      Number.isFinite(Number(value.epoch)) && Number(value.epoch) > 0
        ? Number(value.epoch)
        : null,
    author: String(value.author || '').trim() || null,
    status: String(value.status || '').trim() || null,
    shortRespCount: Number.isFinite(Number(value.shortRespCount))
      ? Number(value.shortRespCount)
      : null,
    longRespCount: Number.isFinite(Number(value.longRespCount))
      ? Number(value.longRespCount)
      : null,
    wrongWords: value.wrongWords === true,
    wrongWordsVotes: Number.isFinite(Number(value.wrongWordsVotes))
      ? Number(value.wrongWordsVotes)
      : null,
    withPrivatePart: value.withPrivatePart === true,
    grade: Number.isFinite(Number(value.grade)) ? Number(value.grade) : null,
    gradeScore: Number.isFinite(Number(value.gradeScore))
      ? Number(value.gradeScore)
      : null,
    createdAt: String(value.createdAt || '').trim() || null,
    block: Number.isFinite(Number(value.block)) ? Number(value.block) : null,
    tx: String(value.tx || '').trim() || null,
  }

  return Object.values(normalized).some(
    (entry) => entry !== null && entry !== false
  )
    ? normalized
    : null
}

export function normalizeRehearsalSeedFlipMeta(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const words = normalizeSeedWords(value.words)
  const expectedAnswer =
    normalizeExpectedAnswer(value.expectedAnswer) ||
    normalizeExpectedAnswer(value.consensusAnswer) ||
    normalizeExpectedAnswer(
      Array.isArray(value.agreedAnswer) && value.agreedAnswer[0]
    ) ||
    normalizeExpectedAnswer(
      Array.isArray(value.agreed_answer) && value.agreed_answer[0]
    )

  if (!expectedAnswer && words.length < 1) {
    return null
  }

  const consensusAnswer =
    normalizeExpectedAnswer(value.consensusAnswer) ||
    normalizeExpectedAnswer(
      Array.isArray(value.agreedAnswer) && value.agreedAnswer[0]
    ) ||
    normalizeExpectedAnswer(
      Array.isArray(value.agreed_answer) && value.agreed_answer[0]
    ) ||
    expectedAnswer
  const consensusStrength =
    normalizeExpectedStrength(value.consensusStrength) ||
    normalizeExpectedStrength(
      Array.isArray(value.agreedAnswer) && value.agreedAnswer[1]
    ) ||
    normalizeExpectedStrength(
      Array.isArray(value.agreed_answer) && value.agreed_answer[1]
    ) ||
    normalizeExpectedStrength(value.expectedStrength)

  return {
    expectedAnswer,
    expectedStrength:
      normalizeExpectedStrength(value.expectedStrength) || consensusStrength,
    consensusAnswer,
    consensusStrength,
    consensusVotes: normalizeConsensusVotes(
      value.consensusVotes || value.votes
    ),
    words,
    sourceStats: normalizeSeedSourceStats(value.sourceStats || value.stats),
    sourceDataset: normalizeSeedSourceLabel(
      value.sourceDataset || value.source_dataset
    ),
    sourceSplit: normalizeSeedSourceLabel(
      value.sourceSplit || value.source_split
    ),
  }
}

export function normalizeRehearsalSeedFlipMetaByHash(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value).reduce((result, [hash, meta]) => {
    const normalizedHash = normalizeRehearsalBenchmarkHash(hash)
    const normalizedMeta = normalizeRehearsalSeedFlipMeta(meta)

    if (normalizedHash && normalizedMeta) {
      result[normalizedHash] = normalizedMeta
    }

    return result
  }, {})
}

export function mergeRehearsalSeedMetaIntoFlips(flips, metaByHash = {}) {
  const nextFlips = Array.isArray(flips) ? flips : []
  const normalizedMetaByHash = normalizeRehearsalSeedFlipMetaByHash(metaByHash)
  let hasChanges = false

  const mergedFlips = nextFlips.map((flip) => {
    const meta =
      normalizedMetaByHash[normalizeRehearsalBenchmarkHash(flip?.hash || '')]

    if (!meta) {
      return flip
    }

    if (
      flip.expectedAnswer === meta.expectedAnswer &&
      (flip.expectedStrength || null) === meta.expectedStrength &&
      (flip.consensusAnswer || null) === meta.consensusAnswer &&
      (flip.consensusStrength || null) === meta.consensusStrength &&
      JSON.stringify(flip.consensusVotes || null) ===
        JSON.stringify(meta.consensusVotes || null) &&
      JSON.stringify(Array.isArray(flip.words) ? flip.words : []) ===
        JSON.stringify(meta.words) &&
      JSON.stringify(flip.sourceStats || null) ===
        JSON.stringify(meta.sourceStats || null) &&
      (flip.sourceDataset || null) === meta.sourceDataset &&
      (flip.sourceSplit || null) === meta.sourceSplit
    ) {
      return flip
    }

    hasChanges = true

    return {
      ...flip,
      expectedAnswer: meta.expectedAnswer,
      expectedStrength: meta.expectedStrength,
      consensusAnswer: meta.consensusAnswer,
      consensusStrength: meta.consensusStrength,
      consensusVotes: meta.consensusVotes,
      words:
        Array.isArray(flip.words) && flip.words.length > 0
          ? flip.words
          : meta.words,
      sourceStats: flip.sourceStats || meta.sourceStats,
      sourceDataset: flip.sourceDataset || meta.sourceDataset,
      sourceSplit: flip.sourceSplit || meta.sourceSplit,
    }
  })

  return hasChanges ? mergedFlips : nextFlips
}

export function hasMissingRehearsalSeedMeta(flips, metaByHash = {}) {
  const nextFlips = Array.isArray(flips) ? flips : []
  const normalizedMetaByHash = normalizeRehearsalSeedFlipMetaByHash(metaByHash)

  return nextFlips.some((flip) => {
    const hash = normalizeRehearsalBenchmarkHash(flip?.hash || '')
    const meta = normalizedMetaByHash[hash]
    const metaHasExpectedAnswer = Boolean(
      normalizeExpectedAnswer(meta?.expectedAnswer)
    )

    return (
      hash &&
      meta &&
      ((metaHasExpectedAnswer &&
        normalizeExpectedAnswer(flip?.expectedAnswer) === null) ||
        (Array.isArray(meta.words) &&
          meta.words.length > 0 &&
          (!Array.isArray(flip?.words) || flip.words.length < 2)))
    )
  })
}

export function getValidationFlipAnswerLabel(value) {
  switch (Number(value)) {
    case AnswerType.Left:
      return 'left'
    case AnswerType.Right:
      return 'right'
    case AnswerType.Inappropriate:
      return 'skip'
    default:
      return null
  }
}

function buildBenchmarkItemsForSession(flips, sessionType) {
  const nextFlips =
    sessionType === 'short' ? filterRegularFlips(flips || []) : flips || []

  return nextFlips
    .filter((flip) => normalizeExpectedAnswer(flip?.expectedAnswer))
    .map((flip) => {
      const selectedAnswer = getValidationFlipAnswerLabel(flip?.option)
      const expectedAnswer = normalizeExpectedAnswer(flip?.expectedAnswer)

      return {
        ...flip,
        sessionType,
        selectedAnswer,
        expectedAnswer,
        expectedStrength: normalizeExpectedStrength(flip?.expectedStrength),
        consensusAnswer:
          normalizeExpectedAnswer(flip?.consensusAnswer) || expectedAnswer,
        consensusStrength:
          normalizeExpectedStrength(flip?.consensusStrength) ||
          normalizeExpectedStrength(flip?.expectedStrength),
        consensusVotes: normalizeConsensusVotes(flip?.consensusVotes),
        words: normalizeSeedWords(flip?.words),
        sourceStats: normalizeSeedSourceStats(flip?.sourceStats),
        sourceDataset: normalizeSeedSourceLabel(flip?.sourceDataset),
        sourceSplit: normalizeSeedSourceLabel(flip?.sourceSplit),
        isCorrect: Boolean(
          selectedAnswer && expectedAnswer && selectedAnswer === expectedAnswer
        ),
        reported: flip?.relevance === RelevanceType.Irrelevant,
        best: flip?.best === true,
      }
    })
}

export function buildRehearsalBenchmarkItems(validationState) {
  const context = validationState?.context || {}

  return [
    ...buildBenchmarkItemsForSession(context.shortFlips, 'short'),
    ...buildBenchmarkItemsForSession(context.longFlips, 'long'),
  ]
}

function computeBenchmarkStats(items = []) {
  const total = items.length
  const answered = items.filter(({selectedAnswer}) =>
    Boolean(selectedAnswer)
  ).length
  const correct = items.filter(({isCorrect}) => isCorrect === true).length
  const incorrect = Math.max(0, answered - correct)
  const unanswered = Math.max(0, total - answered)
  const reported = items.filter((item) => item.reported === true).length
  const best = items.filter((item) => item.best === true).length

  return {
    total,
    answered,
    correct,
    incorrect,
    unanswered,
    reported,
    best,
    accuracy: total > 0 ? correct / total : null,
    answeredAccuracy: answered > 0 ? correct / answered : null,
  }
}

function hasConsensusVotes(item) {
  return Number(item?.consensusVotes?.total) > 0
}

function hasSeedWords(item) {
  return Array.isArray(item?.words) && item.words.length >= 2
}

function hasSourceStats(item) {
  return Boolean(item?.sourceStats)
}

function computeConsensusCoverage(total, consensusTotal) {
  return total > 0 ? consensusTotal / total : null
}

function buildRehearsalBenchmarkNote({
  total = 0,
  consensusBackedTotal = 0,
  sourceDataset = null,
} = {}) {
  const datasetLabel = sourceDataset || 'FLIP-Challenge'

  if (consensusBackedTotal > 0) {
    return `${datasetLabel} agreed-answer labels are available for this rehearsal run. Raw vote consensus is bundled for ${consensusBackedTotal}/${total} benchmark flips and is tracked as a consensus-backed subset.`
  }

  return `${datasetLabel} agreed-answer labels are available for this rehearsal run, but this local rehearsal slice does not include raw vote counts. Benchmark accuracy is therefore label-based rather than vote-backed consensus accuracy.`
}

export function computeRehearsalBenchmarkSummary(validationState) {
  const items = buildRehearsalBenchmarkItems(validationState)
  const shortItems = items.filter(({sessionType}) => sessionType === 'short')
  const longItems = items.filter(({sessionType}) => sessionType === 'long')
  const shortConsensusItems = shortItems.filter(hasConsensusVotes)
  const longConsensusItems = longItems.filter(hasConsensusVotes)
  const consensusItems = items.filter(hasConsensusVotes)
  const keywordItems = items.filter(hasSeedWords)
  const statsItems = items.filter(hasSourceStats)
  const short = {
    ...computeBenchmarkStats(shortItems),
    consensusBacked: computeBenchmarkStats(shortConsensusItems),
    keywordReady: shortItems.filter(hasSeedWords).length,
    sourceStatsReady: shortItems.filter(hasSourceStats).length,
  }
  const long = {
    ...computeBenchmarkStats(longItems),
    consensusBacked: computeBenchmarkStats(longConsensusItems),
    keywordReady: longItems.filter(hasSeedWords).length,
    sourceStatsReady: longItems.filter(hasSourceStats).length,
  }
  const overallStats = computeBenchmarkStats(items)
  const consensusBacked = computeBenchmarkStats(consensusItems)
  const sourceDataset =
    items.find((item) => item?.sourceDataset)?.sourceDataset || 'FLIP-Challenge'

  return {
    available: items.length > 0,
    sourceLabel:
      consensusBacked.total > 0
        ? 'FLIP-Challenge benchmark + consensus subset'
        : 'FLIP-Challenge seed benchmark',
    note: buildRehearsalBenchmarkNote({
      total: overallStats.total,
      consensusBackedTotal: consensusBacked.total,
      sourceDataset,
    }),
    items,
    rawConsensusAvailable: consensusBacked.total > 0,
    consensusBacked: {
      ...consensusBacked,
      coverage: computeConsensusCoverage(
        overallStats.total,
        consensusBacked.total
      ),
    },
    keywordReady: {
      total: keywordItems.length,
      coverage: computeConsensusCoverage(
        overallStats.total,
        keywordItems.length
      ),
    },
    sourceStatsReady: {
      total: statsItems.length,
      coverage: computeConsensusCoverage(overallStats.total, statsItems.length),
    },
    sessions: {
      short,
      long,
    },
    ...overallStats,
  }
}

function normalizeBenchmarkReviewStatus(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['match', 'mismatch', 'unclear'].includes(next) ? next : ''
}

function normalizeBenchmarkReportReviewStatus(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['ok', 'false_positive', 'missed_report', 'unclear'].includes(next)
    ? next
    : ''
}

function normalizeBenchmarkReviewNote(value) {
  return String(value || '')
    .trim()
    .slice(0, 4000)
}

function normalizeBenchmarkSessionType(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['short', 'long'].includes(next) ? next : null
}

function normalizeBenchmarkEpoch(value) {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) ? next : null
}

function normalizeBenchmarkValidationStart(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const next = String(value || '').trim()
  return next || null
}

function hasMeaningfulRehearsalBenchmarkAnnotation(value = {}) {
  const annotation =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  return Boolean(
    annotation.status || annotation.reportStatus || annotation.note
  )
}

function normalizeRehearsalBenchmarkAuditStatus(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['skipped', 'completed'].includes(next) ? next : ''
}

export function normalizeRehearsalBenchmarkReviewState(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const annotationsSource =
    source.annotationsByHash &&
    typeof source.annotationsByHash === 'object' &&
    !Array.isArray(source.annotationsByHash)
      ? source.annotationsByHash
      : {}

  return {
    version: REHEARSAL_BENCHMARK_REVIEW_VERSION,
    updatedAt: String(source.updatedAt || '').trim() || null,
    auditStatus: normalizeRehearsalBenchmarkAuditStatus(source.auditStatus),
    annotationsByHash: Object.entries(annotationsSource).reduce(
      (result, [hash, annotation]) => {
        const normalizedHash = normalizeRehearsalBenchmarkHash(hash)
        const nextAnnotation =
          annotation &&
          typeof annotation === 'object' &&
          !Array.isArray(annotation)
            ? annotation
            : {}

        if (!normalizedHash) {
          return result
        }

        result[normalizedHash] = {
          status: normalizeBenchmarkReviewStatus(nextAnnotation.status),
          reportStatus: normalizeBenchmarkReportReviewStatus(
            nextAnnotation.reportStatus
          ),
          note: normalizeBenchmarkReviewNote(nextAnnotation.note),
          updatedAt: String(nextAnnotation.updatedAt || '').trim() || null,
        }

        return result
      },
      {}
    ),
  }
}

function normalizeRehearsalBenchmarkAnnotationDatasetEntry(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const status = normalizeBenchmarkReviewStatus(source.status)
  const reportStatus = normalizeBenchmarkReportReviewStatus(source.reportStatus)
  const note = normalizeBenchmarkReviewNote(source.note)

  if (!(status || reportStatus || note)) {
    return null
  }

  return {
    hash: normalizeRehearsalBenchmarkHash(source.hash),
    epoch: normalizeBenchmarkEpoch(source.epoch),
    validationStart: normalizeBenchmarkValidationStart(source.validationStart),
    sessionType: normalizeBenchmarkSessionType(source.sessionType),
    expectedAnswer: normalizeExpectedAnswer(source.expectedAnswer),
    expectedStrength: normalizeExpectedStrength(source.expectedStrength),
    consensusAnswer: normalizeExpectedAnswer(source.consensusAnswer),
    consensusStrength: normalizeExpectedStrength(source.consensusStrength),
    consensusVotes: normalizeConsensusVotes(source.consensusVotes),
    selectedAnswer: normalizeExpectedAnswer(source.selectedAnswer),
    reported: source.reported === true,
    best: source.best === true,
    status,
    reportStatus,
    note,
    updatedAt: String(source.updatedAt || '').trim() || null,
  }
}

export function normalizeRehearsalBenchmarkAnnotationDataset(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const annotationsSource =
    source.annotationsByHash &&
    typeof source.annotationsByHash === 'object' &&
    !Array.isArray(source.annotationsByHash)
      ? source.annotationsByHash
      : {}

  return {
    version: REHEARSAL_BENCHMARK_ANNOTATION_DATASET_VERSION,
    updatedAt: String(source.updatedAt || '').trim() || null,
    annotationsByHash: Object.entries(annotationsSource).reduce(
      (result, [hash, annotation]) => {
        const normalizedHash = normalizeRehearsalBenchmarkHash(hash)
        const nextAnnotation =
          normalizeRehearsalBenchmarkAnnotationDatasetEntry({
            ...(annotation &&
            typeof annotation === 'object' &&
            !Array.isArray(annotation)
              ? annotation
              : {}),
            hash: normalizedHash,
          })

        if (normalizedHash && nextAnnotation) {
          result[normalizedHash] = nextAnnotation
        }

        return result
      },
      {}
    ),
  }
}

export function loadRehearsalBenchmarkAnnotationDataset() {
  return normalizeRehearsalBenchmarkAnnotationDataset(
    loadPersistentStateValue(
      'validationResults',
      REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY
    )
  )
}

export function persistRehearsalBenchmarkAnnotationDataset({
  scope = {},
  items = [],
  reviewState = {},
} = {}) {
  const annotations =
    normalizeRehearsalBenchmarkReviewState(reviewState).annotationsByHash || {}
  const currentDataset = loadRehearsalBenchmarkAnnotationDataset()
  const nextAnnotationsByHash = {
    ...(currentDataset.annotationsByHash || {}),
  }
  let hasChanges = false

  ;(Array.isArray(items) ? items : []).forEach((item) => {
    const hash = String(item?.hash || '').trim()
    const annotation = annotations[hash]

    if (!hash || !hasMeaningfulRehearsalBenchmarkAnnotation(annotation)) {
      return
    }

    const nextEntry = normalizeRehearsalBenchmarkAnnotationDatasetEntry({
      hash,
      epoch: scope.epoch,
      validationStart: scope.validationStart,
      sessionType: item?.sessionType,
      expectedAnswer: item?.expectedAnswer,
      expectedStrength: item?.expectedStrength,
      consensusAnswer: item?.consensusAnswer,
      consensusStrength: item?.consensusStrength,
      consensusVotes: item?.consensusVotes,
      selectedAnswer: item?.selectedAnswer,
      reported: item?.reported,
      best: item?.best,
      status: annotation.status,
      reportStatus: annotation.reportStatus,
      note: annotation.note,
      updatedAt: annotation.updatedAt || new Date().toISOString(),
    })

    if (!nextEntry) {
      return
    }

    nextAnnotationsByHash[hash] = nextEntry
    hasChanges = true
  })

  if (!hasChanges) {
    return false
  }

  persistItem(
    'validationResults',
    REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY,
    normalizeRehearsalBenchmarkAnnotationDataset({
      ...currentDataset,
      updatedAt: new Date().toISOString(),
      annotationsByHash: nextAnnotationsByHash,
    })
  )

  return true
}

export function buildRehearsalBenchmarkReviewStorageKey(scope = {}) {
  const scopeKey = buildValidationSessionScopeKey(scope)
  return scopeKey
    ? `${scopeKey}:${REHEARSAL_BENCHMARK_REVIEW_STORAGE_SUFFIX}`
    : ''
}

export function loadRehearsalBenchmarkReview(scope = {}) {
  const key = buildRehearsalBenchmarkReviewStorageKey(scope)

  if (!key) {
    return normalizeRehearsalBenchmarkReviewState()
  }

  return normalizeRehearsalBenchmarkReviewState(
    loadPersistentStateValue('validationResults', key)
  )
}

export function persistRehearsalBenchmarkReview(scope = {}, reviewState = {}) {
  const key = buildRehearsalBenchmarkReviewStorageKey(scope)

  if (!key) {
    return false
  }

  persistItem(
    'validationResults',
    key,
    normalizeRehearsalBenchmarkReviewState({
      ...reviewState,
      updatedAt: new Date().toISOString(),
    })
  )

  return true
}

export function countReviewedRehearsalBenchmarkItems(
  reviewState = {},
  items = []
) {
  const annotations =
    normalizeRehearsalBenchmarkReviewState(reviewState).annotationsByHash || {}
  const hashes = Array.isArray(items)
    ? items.map(({hash}) => String(hash || '').trim()).filter(Boolean)
    : []

  return hashes.filter((hash) => {
    const annotation = annotations[hash]
    return Boolean(
      annotation &&
        (annotation.status || annotation.reportStatus || annotation.note)
    )
  }).length
}

export function getRehearsalBenchmarkAuditStatus(reviewState = {}, items = []) {
  const normalizedReviewState =
    normalizeRehearsalBenchmarkReviewState(reviewState)
  const total = Array.isArray(items) ? items.length : 0

  if (total < 1) {
    return 'unavailable'
  }

  const reviewedCount = countReviewedRehearsalBenchmarkItems(
    normalizedReviewState,
    items
  )

  if (reviewedCount >= total) {
    return 'completed'
  }

  if (reviewedCount > 0) {
    return 'in_progress'
  }

  if (normalizedReviewState.auditStatus === 'skipped') {
    return 'skipped'
  }

  return 'pending'
}
