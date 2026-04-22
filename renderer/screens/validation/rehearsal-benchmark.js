import {loadPersistentStateValue, persistItem} from '../../shared/utils/persist'
import {AnswerType, RelevanceType} from '../../shared/types'
import {buildValidationSessionScopeKey, filterRegularFlips} from './utils'

export const REHEARSAL_BENCHMARK_REVIEW_VERSION = 1
export const REHEARSAL_BENCHMARK_REVIEW_STORAGE_SUFFIX =
  'rehearsal-benchmark-review'
export const REHEARSAL_BENCHMARK_ANNOTATION_DATASET_VERSION = 1
export const REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY =
  'rehearsal-benchmark-annotations'

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

export function normalizeRehearsalSeedFlipMeta(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const expectedAnswer = normalizeExpectedAnswer(value.expectedAnswer)

  if (!expectedAnswer) {
    return null
  }

  return {
    expectedAnswer,
    expectedStrength: normalizeExpectedStrength(value.expectedStrength),
  }
}

export function normalizeRehearsalSeedFlipMetaByHash(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value).reduce((result, [hash, meta]) => {
    const normalizedHash = String(hash || '').trim()
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
    const meta = normalizedMetaByHash[String(flip?.hash || '').trim()]

    if (!meta) {
      return flip
    }

    if (
      flip.expectedAnswer === meta.expectedAnswer &&
      (flip.expectedStrength || null) === meta.expectedStrength
    ) {
      return flip
    }

    hasChanges = true

    return {
      ...flip,
      expectedAnswer: meta.expectedAnswer,
      expectedStrength: meta.expectedStrength,
    }
  })

  return hasChanges ? mergedFlips : nextFlips
}

export function hasMissingRehearsalSeedMeta(flips, metaByHash = {}) {
  const nextFlips = Array.isArray(flips) ? flips : []
  const normalizedMetaByHash = normalizeRehearsalSeedFlipMetaByHash(metaByHash)

  return nextFlips.some((flip) => {
    const hash = String(flip?.hash || '').trim()
    return (
      hash &&
      normalizedMetaByHash[hash] &&
      normalizeExpectedAnswer(flip?.expectedAnswer) === null
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

export function computeRehearsalBenchmarkSummary(validationState) {
  const items = buildRehearsalBenchmarkItems(validationState)
  const short = computeBenchmarkStats(
    items.filter(({sessionType}) => sessionType === 'short')
  )
  const long = computeBenchmarkStats(
    items.filter(({sessionType}) => sessionType === 'long')
  )

  return {
    available: items.length > 0,
    sourceLabel: 'FLIP-Challenge seed benchmark',
    note: 'Bundled FLIP-Challenge seed labels are available for this rehearsal run. They are benchmark labels, not live network consensus.',
    items,
    sessions: {
      short,
      long,
    },
    ...computeBenchmarkStats(items),
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
        const normalizedHash = String(hash || '').trim()
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
    hash: String(source.hash || '').trim() || null,
    epoch: normalizeBenchmarkEpoch(source.epoch),
    validationStart: normalizeBenchmarkValidationStart(source.validationStart),
    sessionType: normalizeBenchmarkSessionType(source.sessionType),
    expectedAnswer: normalizeExpectedAnswer(source.expectedAnswer),
    expectedStrength: normalizeExpectedStrength(source.expectedStrength),
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
        const normalizedHash = String(hash || '').trim()
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
