const {spawn} = require('child_process')
const fs = require('fs')
const path = require('path')

const {createLocalAiStorage} = require('./storage')
const {resolveAdapterContract} = require('./adapter-contract')
const {createLocalAiSidecar} = require('./sidecar')
const {
  DEFAULT_DEMO_SAMPLE_NAME,
  buildHumanTeacherDemoWorkspace,
  listHumanTeacherDemoSamples,
  normalizeDemoSampleName,
} = require('./human-teacher-demo')
const {exportHumanTeacherTasks} = require('./human-teacher-export')
const {importHumanTeacherAnnotations} = require('./human-teacher-import')
const {resolveModelReference} = require('./model-reference')
const {createModernTrainingCollector} = require('./modern-training')
const {
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  resolveLocalAiRuntimeAdapter,
} = require('./runtime-adapter')

const CAPTURE_INDEX_VERSION = 1
const TRAINING_CANDIDATE_PACKAGE_VERSION = 1
const HUMAN_TEACHER_PACKAGE_VERSION = 1
const MAX_CAPTURE_INDEX_ITEMS = 1000
const MAX_RECENT_CAPTURES = 20
const DEFAULT_HUMAN_TEACHER_BATCH_SIZE = 30
const MAX_HUMAN_TEACHER_BATCH_SIZE = 50
const DEFAULT_RUNTIME_START_TIMEOUT_MS = 10 * 1000
const DEFAULT_RUNTIME_START_RETRY_DELAY_MS = 400
const OLLAMA_COMMAND_CANDIDATES = [
  '/opt/homebrew/bin/ollama',
  '/usr/local/bin/ollama',
  'ollama',
]
const ELIGIBLE_CONSENSUS_ANSWERS = new Set(['left', 'right'])

function normalizeMode(value, fallback = 'sidecar') {
  const mode = String(value || fallback).trim()
  return mode || fallback
}

function normalizeBaseUrl(value, fallback = 'http://localhost:5000') {
  const baseUrl = String(value || fallback).trim()
  return baseUrl || fallback
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function resolveOllamaCommand() {
  const explicit = String(process.env.OLLAMA_PATH || '').trim()

  if (explicit) {
    return explicit
  }

  return (
    OLLAMA_COMMAND_CANDIDATES.find(
      (candidate) => candidate === 'ollama' || fs.existsSync(candidate)
    ) || 'ollama'
  )
}

function resolveOllamaHostEnv(baseUrl) {
  const nextBaseUrl = normalizeBaseUrl(baseUrl, '')

  if (!nextBaseUrl) {
    return null
  }

  try {
    const parsed = new URL(nextBaseUrl)
    return parsed.host || null
  } catch {
    return null
  }
}

function createDefaultRuntimeController({logger, isDev = false} = {}) {
  let managedProcess = null

  return {
    async start(payload = {}) {
      if (payload.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
        return {started: false, managed: false}
      }

      if (
        managedProcess &&
        managedProcess.exitCode == null &&
        !managedProcess.killed
      ) {
        return {
          started: false,
          managed: true,
          pid: managedProcess.pid,
        }
      }

      const command = resolveOllamaCommand()
      const env = {...process.env}
      const host = resolveOllamaHostEnv(payload.baseUrl)

      if (host) {
        env.OLLAMA_HOST = host
      }

      const child = await new Promise((resolve, reject) => {
        const nextChild = spawn(command, ['serve'], {
          detached: true,
          stdio: 'ignore',
          env,
        })

        nextChild.once('error', reject)
        nextChild.once('spawn', () => resolve(nextChild))
      })

      child.unref()
      managedProcess = child
      child.once('exit', () => {
        if (managedProcess === child) {
          managedProcess = null
        }
      })

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Managed Local AI runtime spawned', {
          command,
          host,
          pid: child.pid,
        })
      }

      return {
        started: true,
        managed: true,
        pid: child.pid,
        command,
        host,
      }
    },

    async stop(payload = {}) {
      if (
        payload.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND ||
        !managedProcess ||
        managedProcess.exitCode != null ||
        managedProcess.killed
      ) {
        return {stopped: false, managed: false}
      }

      const {pid} = managedProcess

      try {
        process.kill(pid, 'SIGTERM')
      } finally {
        managedProcess = null
      }

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Managed Local AI runtime stopped', {
          pid,
        })
      }

      return {
        stopped: true,
        managed: true,
        pid,
      }
    },
  }
}

function normalizeRuntimePayload(payload, fallbackRuntime = {}) {
  const nextPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}
  const runtime = resolveLocalAiRuntimeAdapter(nextPayload, fallbackRuntime)

  return {
    ...nextPayload,
    runtime: runtime.runtime,
    runtimeBackend: runtime.runtimeBackend,
    runtimeType: runtime.runtimeType,
    baseUrl: normalizeBaseUrl(
      nextPayload.baseUrl || nextPayload.endpoint,
      runtime.defaultBaseUrl
    ),
  }
}

function pickRuntimeInput(payload) {
  if (typeof payload.input !== 'undefined') {
    return payload.input
  }

  if (typeof payload.payload !== 'undefined') {
    return payload.payload
  }

  return payload
}

function normalizeEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) ? epoch : null
}

function normalizeOptionalEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) ? epoch : null
}

function normalizeFilePath(value) {
  const filePath = String(value || '').trim()
  return filePath ? path.resolve(filePath) : null
}

function normalizeSessionType(value) {
  const sessionType = String(value || '').trim()
  return sessionType || null
}

function normalizePanelCount(value) {
  const panelCount = Number.parseInt(value, 10)
  return Number.isFinite(panelCount) && panelCount > 0 ? panelCount : 0
}

function normalizeConsensus(consensus) {
  if (!consensus || typeof consensus !== 'object' || Array.isArray(consensus)) {
    return null
  }

  const finalAnswer = String(
    consensus.finalAnswer || consensus.finalAnswerAfterRemap || ''
  )
    .trim()
    .toLowerCase()

  const reported = Boolean(consensus.reported)

  if (!finalAnswer && !reported) {
    return null
  }

  return {
    finalAnswer: finalAnswer || null,
    reported,
    strength: String(consensus.strength || '').trim() || null,
  }
}

function hasExplicitConsensus(payload) {
  return Boolean(
    payload &&
      payload.consensus &&
      typeof payload.consensus === 'object' &&
      !Array.isArray(payload.consensus)
  )
}

function hasEligibleConsensusAnswer(consensus) {
  return Boolean(
    consensus &&
      consensus.finalAnswer &&
      ELIGIBLE_CONSENSUS_ANSWERS.has(String(consensus.finalAnswer).trim())
  )
}

function normalizeOrders(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((order) =>
      Array.isArray(order)
        ? order
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isFinite(item) && item >= 0)
        : []
    )
    .filter((order) => order.length > 0)
    .slice(0, 2)
}

function normalizeWords(words) {
  if (!Array.isArray(words)) {
    return []
  }

  return words
    .map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? {
            id: Number.isFinite(Number(item.id)) ? Number(item.id) : null,
            name: String(item.name || '').trim() || null,
            desc: String(item.desc || item.description || '').trim() || null,
          }
        : null
    )
    .filter(Boolean)
}

function normalizeSelectedOrder(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()
  return nextValue === 'left' || nextValue === 'right' ? nextValue : null
}

function normalizeRelevance(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()
  return nextValue || null
}

function normalizeAuthor(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()
  return nextValue || null
}

function toCaptureMeta(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const flipHash = String(payload.flipHash || payload.hash || '').trim()

  if (!flipHash) {
    return null
  }

  const images = Array.isArray(payload.images) ? payload.images : []
  const explicitPanelCount = normalizePanelCount(payload.panelCount)
  const panelCount = explicitPanelCount || images.length

  return {
    flipHash,
    epoch: normalizeEpoch(payload.epoch),
    sessionType: normalizeSessionType(payload.sessionType),
    panelCount,
    timestamp: Date.now(),
    capturedAt: new Date().toISOString(),
    consensus: normalizeConsensus(payload.consensus),
    author: normalizeAuthor(payload.author),
    orders: normalizeOrders(payload.orders),
    words: normalizeWords(payload.words),
    selectedOrder: normalizeSelectedOrder(payload.selectedOrder),
    relevance: normalizeRelevance(payload.relevance),
    best: payload.best === true,
  }
}

function normalizeCapture(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  const flipHash = String(item.flipHash || item.hash || '').trim()

  if (!flipHash) {
    return null
  }

  return {
    flipHash,
    epoch: normalizeEpoch(item.epoch),
    sessionType: normalizeSessionType(item.sessionType),
    panelCount: normalizePanelCount(item.panelCount),
    timestamp: Number.isFinite(Number(item.timestamp))
      ? Number(item.timestamp)
      : Date.now(),
    capturedAt:
      String(item.capturedAt || '').trim() || new Date().toISOString(),
    consensus: normalizeConsensus(item.consensus),
    author: normalizeAuthor(item.author),
    orders: normalizeOrders(item.orders),
    words: normalizeWords(item.words),
    selectedOrder: normalizeSelectedOrder(item.selectedOrder),
    relevance: normalizeRelevance(item.relevance),
    best: item.best === true,
  }
}

function mergeConsensus(previousConsensus, nextConsensus) {
  if (!previousConsensus && !nextConsensus) {
    return null
  }

  return {
    finalAnswer:
      (nextConsensus && nextConsensus.finalAnswer) ||
      (previousConsensus && previousConsensus.finalAnswer) ||
      null,
    reported:
      (nextConsensus && nextConsensus.reported) ||
      (previousConsensus && previousConsensus.reported) ||
      false,
    strength:
      (nextConsensus && nextConsensus.strength) ||
      (previousConsensus && previousConsensus.strength) ||
      null,
  }
}

function mergeCaptureMeta(previousCapture, nextCapture) {
  const previous = previousCapture || {}
  const next = nextCapture || {}
  const nextOrders =
    Array.isArray(next.orders) && next.orders.length ? next.orders : null
  const previousOrders = Array.isArray(previous.orders) ? previous.orders : []
  const nextWords =
    Array.isArray(next.words) && next.words.length ? next.words : null
  const previousWords = Array.isArray(previous.words) ? previous.words : []

  return {
    flipHash: next.flipHash || previous.flipHash || null,
    epoch: next.epoch ?? previous.epoch ?? null,
    sessionType: next.sessionType || previous.sessionType || null,
    panelCount: next.panelCount || previous.panelCount || 0,
    timestamp: Number(next.timestamp || previous.timestamp || Date.now()),
    capturedAt:
      next.capturedAt || previous.capturedAt || new Date().toISOString(),
    consensus: mergeConsensus(previous.consensus, next.consensus),
    author: next.author || previous.author || null,
    orders: nextOrders || previousOrders,
    words: nextWords || previousWords,
    selectedOrder: next.selectedOrder || previous.selectedOrder || null,
    relevance: next.relevance || previous.relevance || null,
    best: next.best === true || previous.best === true,
  }
}

function normalizeCaptureIndex(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const captures = Array.isArray(source.captures)
    ? source.captures
        .map(normalizeCapture)
        .filter(Boolean)
        .slice(-MAX_CAPTURE_INDEX_ITEMS)
    : []
  const capturedCount = Number.parseInt(source.capturedCount, 10)

  return {
    version: CAPTURE_INDEX_VERSION,
    capturedCount: Number.isFinite(capturedCount)
      ? Math.max(capturedCount, captures.length)
      : captures.length,
    captures,
    updatedAt: String(source.updatedAt || '').trim() || null,
  }
}

function defaultCaptureIndex() {
  return {
    version: CAPTURE_INDEX_VERSION,
    capturedCount: 0,
    captures: [],
    updatedAt: null,
  }
}

function captureIndexPath(storage) {
  return storage.resolveLocalAiPath('captures', 'index.json')
}

function manifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('manifests', `epoch-${epoch}-manifest.json`)
}

function adapterArtifactManifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('adapters', `epoch-${epoch}.json`)
}

function trainingCandidatePackagePath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'training-candidates',
    `epoch-${epoch}-candidates.json`
  )
}

function humanTeacherPackagePath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher',
    `epoch-${epoch}-tasks.json`
  )
}

function humanTeacherExportDir(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher-exports',
    `epoch-${epoch}-tasks`
  )
}

function humanTeacherDemoDir(storage, sampleName = DEFAULT_DEMO_SAMPLE_NAME) {
  return storage.resolveLocalAiPath(
    'human-teacher-demo',
    normalizeDemoSampleName(sampleName)
  )
}

function humanTeacherNormalizedAnnotationsPath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher-exports',
    `epoch-${epoch}-tasks`,
    'annotations.normalized.jsonl'
  )
}

function humanTeacherImportSummaryPath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher-exports',
    `epoch-${epoch}-tasks`,
    'annotations.import-summary.json'
  )
}

function normalizeHumanTeacherBatchSize(value) {
  const batchSize = Number.parseInt(value, 10)

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    return DEFAULT_HUMAN_TEACHER_BATCH_SIZE
  }

  return Math.min(batchSize, MAX_HUMAN_TEACHER_BATCH_SIZE)
}

function assertPastHumanTeacherEpoch(epoch, currentEpoch, action) {
  if (currentEpoch === null) {
    return
  }

  if (epoch >= currentEpoch) {
    throw new Error(
      `Human-teacher ${action} is only available after the session finishes and consensus exists for a past epoch`
    )
  }
}

function reduceLatestCaptures(captures) {
  const uniqueCaptures = new Map()

  captures.forEach((capture) => {
    uniqueCaptures.set(capture.flipHash, capture)
  })

  return Array.from(uniqueCaptures.values())
}

function getExclusionReasons(capture, epoch) {
  const reasons = []

  if (!capture.flipHash) {
    reasons.push('missing_flip_hash')
  }

  if (capture.epoch === null) {
    reasons.push('missing_epoch')
  } else if (capture.epoch !== epoch) {
    reasons.push('epoch_mismatch')
  }

  if (!capture.consensus || !capture.consensus.finalAnswer) {
    reasons.push('missing_consensus')
  } else if (!hasEligibleConsensusAnswer(capture.consensus)) {
    reasons.push('invalid_consensus')
  }

  if (capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (!capture.panelCount) {
    reasons.push('missing_local_metadata')
  }

  return reasons
}

function getCaptureSkipReasons(payload, capture) {
  const reasons = []
  const explicitConsensus = hasExplicitConsensus(payload)

  if (capture && capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (capture && capture.consensus && capture.consensus.finalAnswer) {
    if (!hasEligibleConsensusAnswer(capture.consensus)) {
      reasons.push('invalid_consensus')
    }
  } else if (explicitConsensus) {
    reasons.push('missing_consensus')
  }

  return reasons
}

function collectInconsistencyFlags(excluded) {
  const flags = new Set()

  excluded.forEach(({reasons}) => {
    if (reasons.includes('missing_consensus')) {
      flags.add('contains_unresolved_captures')
    }

    if (reasons.includes('reported')) {
      flags.add('contains_reported_captures')
    }

    if (reasons.includes('invalid_consensus')) {
      flags.add('contains_invalid_consensus')
    }

    if (reasons.includes('epoch_mismatch')) {
      flags.add('contains_other_epoch_captures')
    }

    if (reasons.includes('missing_local_metadata')) {
      flags.add('contains_incomplete_metadata')
    }
  })

  return Array.from(flags)
}

function normalizePackagedCapturedAt(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    throw new Error('captured_at_required')
  }

  const nextDate = new Date(raw)

  if (!Number.isFinite(nextDate.getTime())) {
    throw new Error('captured_at_invalid')
  }

  return nextDate.toISOString()
}

function buildTrainingCandidateItem(capture) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error('invalid_capture')
  }

  if (!capture.consensus || !hasEligibleConsensusAnswer(capture.consensus)) {
    throw new Error('final_consensus_required')
  }

  return {
    flipHash: capture.flipHash,
    epoch: capture.epoch,
    sessionType: capture.sessionType,
    panelCount: capture.panelCount,
    timestamp: Number(capture.timestamp),
    capturedAt: normalizePackagedCapturedAt(capture.capturedAt),
    finalAnswer: capture.consensus.finalAnswer,
    orders: Array.isArray(capture.orders) ? capture.orders : [],
    words: Array.isArray(capture.words) ? capture.words : [],
    selectedOrder: capture.selectedOrder || null,
    relevance: capture.relevance || null,
    best: capture.best === true,
    author: capture.author || null,
  }
}

function sortHumanTeacherItems(items) {
  return items.slice().sort((left, right) => {
    const leftBest = left.best === true ? 1 : 0
    const rightBest = right.best === true ? 1 : 0

    if (leftBest !== rightBest) {
      return rightBest - leftBest
    }

    const leftWeight = Number(left.trainingWeight) || 0
    const rightWeight = Number(right.trainingWeight) || 0

    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight
    }

    const leftTimestamp = Number(left.timestamp) || 0
    const rightTimestamp = Number(right.timestamp) || 0

    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp
    }

    return String(left.flipHash || '').localeCompare(
      String(right.flipHash || '')
    )
  })
}

function buildHumanTeacherItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('invalid_item')
  }

  const flipHash = String(item.flipHash || item.cid || '').trim()

  if (!flipHash) {
    throw new Error('flip_hash_required')
  }

  const finalAnswer = String(
    item.finalAnswer || item.consensusLabel || ''
  ).trim()

  if (!hasEligibleConsensusAnswer({finalAnswer})) {
    throw new Error('final_consensus_required')
  }

  const payloadPath = normalizeFilePath(item.payloadPath)

  if (!payloadPath) {
    throw new Error('payload_path_required')
  }

  return {
    taskId: `${flipHash}::human-teacher`,
    sampleId: `${flipHash}::human-teacher`,
    flipHash,
    epoch: normalizeEpoch(item.epoch),
    sessionType: normalizeSessionType(item.sessionType),
    panelCount: normalizePanelCount(item.panelCount),
    timestamp: Number(item.timestamp),
    capturedAt: normalizePackagedCapturedAt(item.capturedAt),
    finalAnswer,
    consensusStrength: String(item.consensusStrength || '').trim() || null,
    orders: Array.isArray(item.orders) ? item.orders : [],
    selectedOrder: item.selectedOrder || null,
    relevance: item.relevance || null,
    best: item.best === true,
    author:
      normalizeAuthor(item.author) ||
      normalizeAuthor(item.audit && item.audit.author) ||
      null,
    payloadPath,
    trainingWeight:
      Number.isFinite(Number(item.trainingWeight)) &&
      Number(item.trainingWeight) > 0
        ? Number(item.trainingWeight)
        : null,
    rankingSource: String(item.rankingSource || '').trim() || null,
    source:
      item.source &&
      typeof item.source === 'object' &&
      !Array.isArray(item.source)
        ? item.source
        : null,
    words:
      item.words && typeof item.words === 'object' && !Array.isArray(item.words)
        ? item.words
        : {
            localNode: {},
            publicIndexer: {},
          },
    audit:
      item.audit && typeof item.audit === 'object' && !Array.isArray(item.audit)
        ? item.audit
        : null,
    annotationStatus: 'pending',
    annotationHints: {
      requiresFrameCaptions: true,
      requiresTextCheck: true,
      requiresChronologyExplanation: true,
      requiresReportabilityCheck: true,
    },
  }
}

function buildDefaultHumanTeacherAnnotationRow(task = {}) {
  return {
    task_id: String(task.task_id || task.taskId || '').trim(),
    annotator: '',
    frame_captions: ['', '', '', ''],
    option_a_summary: '',
    option_b_summary: '',
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    final_answer: '',
    why_answer: '',
    confidence: null,
  }
}

function normalizeHumanTeacherDraftText(value, maxLength = 2000) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

function normalizeHumanTeacherDraftBool(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  const raw = String(value).trim().toLowerCase()

  if (['true', 'yes', '1'].includes(raw)) {
    return true
  }

  if (['false', 'no', '0'].includes(raw)) {
    return false
  }

  return null
}

function normalizeHumanTeacherDraftConfidence(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.min(Math.max(parsed, 0), 1)
}

function normalizeHumanTeacherDraftCaptions(value) {
  const next = Array.isArray(value) ? value.slice(0, 4) : []

  while (next.length < 4) {
    next.push('')
  }

  return next.map((item) => normalizeHumanTeacherDraftText(item, 400))
}

function normalizeHumanTeacherAnnotationDraft(task = {}, annotation = {}) {
  const source =
    annotation && typeof annotation === 'object' && !Array.isArray(annotation)
      ? annotation
      : {}
  const finalAnswer = normalizeHumanTeacherDraftText(
    source.final_answer || source.finalAnswer,
    16
  ).toLowerCase()

  return {
    ...buildDefaultHumanTeacherAnnotationRow(task),
    annotator: normalizeHumanTeacherDraftText(source.annotator, 256),
    frame_captions: normalizeHumanTeacherDraftCaptions(
      source.frame_captions || source.frameCaptions
    ),
    option_a_summary: normalizeHumanTeacherDraftText(
      source.option_a_summary || source.optionASummary
    ),
    option_b_summary: normalizeHumanTeacherDraftText(
      source.option_b_summary || source.optionBSummary
    ),
    text_required: normalizeHumanTeacherDraftBool(
      source.text_required || source.textRequired
    ),
    sequence_markers_present: normalizeHumanTeacherDraftBool(
      source.sequence_markers_present || source.sequenceMarkersPresent
    ),
    report_required: normalizeHumanTeacherDraftBool(
      source.report_required || source.reportRequired
    ),
    report_reason: normalizeHumanTeacherDraftText(
      source.report_reason || source.reportReason
    ),
    final_answer: ['left', 'right', 'skip'].includes(finalAnswer)
      ? finalAnswer
      : '',
    why_answer: normalizeHumanTeacherDraftText(
      source.why_answer || source.whyAnswer
    ),
    confidence: normalizeHumanTeacherDraftConfidence(source.confidence),
  }
}

function hasHumanTeacherAnnotationDraft(annotation = {}) {
  const next = normalizeHumanTeacherAnnotationDraft({}, annotation)

  return Boolean(
    next.annotator ||
      next.frame_captions.some(Boolean) ||
      next.option_a_summary ||
      next.option_b_summary ||
      next.report_reason ||
      next.final_answer ||
      next.why_answer ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.confidence !== null
  )
}

function isHumanTeacherAnnotationComplete(annotation = {}) {
  const next = normalizeHumanTeacherAnnotationDraft({}, annotation)

  return Boolean(
    next.frame_captions.length === 4 &&
      next.frame_captions.every(Boolean) &&
      next.option_a_summary &&
      next.option_b_summary &&
      next.final_answer &&
      next.why_answer
  )
}

async function readJsonlRows(filePath, fallbackValue = []) {
  const targetPath = String(filePath || '').trim()

  if (!targetPath) {
    throw new Error('filePath is required')
  }

  try {
    const rawBuffer = await fs.promises.readFile(targetPath)
    const raw = rawBuffer.toString('utf8')

    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue
    }

    throw error
  }
}

async function writeJsonlRows(filePath, rows) {
  const targetPath = String(filePath || '').trim()

  if (!targetPath) {
    throw new Error('filePath is required')
  }

  await fs.promises.mkdir(path.dirname(targetPath), {recursive: true})
  await fs.promises.writeFile(
    targetPath,
    rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
    'utf8'
  )

  return targetPath
}

function resolveWorkspaceChildPath(baseDir, relativePath) {
  const resolvedBaseDir = path.resolve(String(baseDir || '').trim())
  const resolvedPath = path.resolve(resolvedBaseDir, String(relativePath || ''))

  if (
    resolvedPath !== resolvedBaseDir &&
    !resolvedPath.startsWith(`${resolvedBaseDir}${path.sep}`)
  ) {
    throw new Error('Invalid human-teacher workspace path')
  }

  return resolvedPath
}

function getHumanTeacherAnnotationStatus(annotation = {}) {
  const hasDraft = hasHumanTeacherAnnotationDraft(annotation)

  if (!hasDraft) {
    return 'pending'
  }

  return isHumanTeacherAnnotationComplete(annotation) ? 'complete' : 'drafted'
}

function buildHumanTeacherWorkspaceTasks(
  taskRows,
  annotationRows,
  fallbackEpoch
) {
  const annotationsByTaskId = new Map(
    annotationRows
      .map((row) => [String(row && row.task_id ? row.task_id : '').trim(), row])
      .filter(([taskId]) => taskId)
  )

  return taskRows.map((taskRow) => {
    const taskId = String(
      taskRow && taskRow.task_id ? taskRow.task_id : ''
    ).trim()
    const annotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      annotationsByTaskId.get(taskId)
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(annotation)

    return {
      taskId,
      sampleId: taskRow.sample_id || taskId,
      flipHash: taskRow.flip_hash || null,
      epoch:
        taskRow.epoch === null || typeof taskRow.epoch === 'undefined'
          ? fallbackEpoch
          : taskRow.epoch,
      consensusAnswer: taskRow.final_answer || null,
      consensusStrength: taskRow.consensus_strength || null,
      leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
      rightOrder: Array.isArray(taskRow.right_order) ? taskRow.right_order : [],
      hasDraft: hasHumanTeacherAnnotationDraft(annotation),
      isComplete: isHumanTeacherAnnotationComplete(annotation),
      annotationStatus,
      demo:
        taskRow.demo &&
        typeof taskRow.demo === 'object' &&
        !Array.isArray(taskRow.demo)
          ? taskRow.demo
          : null,
    }
  })
}

function createLocalAiManager({
  logger,
  isDev = false,
  storage,
  sidecar,
  getModelReference,
  runtimeController,
  modernTrainingCollector,
} = {}) {
  const localAiStorage = storage || createLocalAiStorage()
  const localAiSidecar =
    sidecar ||
    createLocalAiSidecar({
      logger,
      isDev,
    })
  const localAiRuntimeController =
    runtimeController || createDefaultRuntimeController({logger, isDev})
  const localAiModernTrainingCollector =
    modernTrainingCollector ||
    createModernTrainingCollector({
      logger,
      storage: localAiStorage,
    })
  const initialRuntime = resolveLocalAiRuntimeAdapter()
  const state = {
    available: true,
    running: false,
    runtimeManaged: false,
    mode: 'sidecar',
    runtime: initialRuntime.runtime,
    runtimeBackend: initialRuntime.runtimeBackend,
    runtimeType: initialRuntime.runtimeType,
    baseUrl: initialRuntime.baseUrl,
    capturedCount: 0,
    lastError: null,
    sidecarReachable: null,
    sidecarCheckedAt: null,
    sidecarModels: [],
    captureIndex: [],
    recentCaptures: [],
    loadError: null,
    hydrated: false,
  }

  let hydrationPromise = null
  let persistQueue = Promise.resolve()

  function currentStatus() {
    return {
      available: state.available,
      running: state.running,
      runtimeManaged: state.runtimeManaged,
      mode: state.mode,
      runtime: state.runtime,
      runtimeBackend: state.runtimeBackend,
      runtimeType: state.runtimeType,
      baseUrl: state.baseUrl,
      capturedCount: state.capturedCount,
      lastError: state.lastError,
      sidecarReachable: state.sidecarReachable,
      sidecarCheckedAt: state.sidecarCheckedAt,
      sidecarModelCount: state.sidecarModels.length,
    }
  }

  function updateSidecarState({reachable, models, checkedAt, lastError}) {
    state.sidecarReachable =
      typeof reachable === 'boolean' ? reachable : state.sidecarReachable
    state.sidecarCheckedAt = checkedAt || new Date().toISOString()
    state.sidecarModels = Array.isArray(models) ? models : state.sidecarModels
    state.lastError = lastError || null
  }

  function applyRuntimeState(next) {
    state.mode = normalizeMode(next.mode, state.mode)
    state.runtime = next.runtime || state.runtime
    state.runtimeBackend = next.runtimeBackend || state.runtimeBackend
    state.runtimeType = next.runtimeType || state.runtimeType
    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)
  }

  async function waitForRuntimeReady(payload) {
    const startedAt = Date.now()
    let result = await refreshSidecarStatus(payload)

    while (
      !result.ok &&
      Date.now() - startedAt < DEFAULT_RUNTIME_START_TIMEOUT_MS
    ) {
      await delay(DEFAULT_RUNTIME_START_RETRY_DELAY_MS)
      result = await refreshSidecarStatus(payload)
    }

    return result
  }

  async function hydrate() {
    if (state.hydrated) {
      return
    }

    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        try {
          const persisted = normalizeCaptureIndex(
            await localAiStorage.readJson(captureIndexPath(localAiStorage), {
              version: CAPTURE_INDEX_VERSION,
              capturedCount: 0,
              captures: [],
              updatedAt: null,
            })
          )

          state.captureIndex = persisted.captures
          state.recentCaptures = persisted.captures.slice(-MAX_RECENT_CAPTURES)
          state.capturedCount = persisted.capturedCount
          state.loadError = null
        } catch (error) {
          state.captureIndex = []
          state.recentCaptures = []
          state.capturedCount = 0
          state.loadError = error
          state.lastError = 'Unable to load local AI capture index'

          if (logger && typeof logger.error === 'function') {
            logger.error('Unable to load local AI capture index', {
              error: error.toString(),
            })
          }
        } finally {
          state.hydrated = true
        }
      })()
    }

    await hydrationPromise
  }

  async function persistCaptureIndex() {
    const nextIndex = {
      version: CAPTURE_INDEX_VERSION,
      capturedCount: state.capturedCount,
      captures: state.captureIndex,
      updatedAt: new Date().toISOString(),
    }

    persistQueue = persistQueue
      .catch(() => {})
      .then(() =>
        localAiStorage.writeJsonAtomic(
          captureIndexPath(localAiStorage),
          nextIndex
        )
      )

    return persistQueue
  }

  async function refreshSidecarStatus(payload = {}) {
    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const health = await localAiSidecar.getHealth({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      timeoutMs: next.timeoutMs,
    })
    let models = {
      ok: false,
      models: [],
      total: 0,
      lastError: null,
    }

    if (health.ok) {
      models = await localAiSidecar.listModels({
        baseUrl: state.baseUrl,
        runtimeBackend: next.runtimeBackend,
        runtimeType: next.runtimeType,
        timeoutMs: next.timeoutMs,
      })
    }

    updateSidecarState({
      reachable: Boolean(health.ok),
      models: models.ok ? models.models : [],
      checkedAt: new Date().toISOString(),
      lastError: health.ok ? models.lastError : health.lastError,
    })

    return {
      ok: Boolean(health.ok),
      health,
      models,
      ...currentStatus(),
    }
  }

  async function status(payload = {}) {
    await hydrate()

    if (payload && payload.refresh) {
      return refreshSidecarStatus(payload)
    }

    return currentStatus()
  }

  async function start(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)
    state.running = true
    state.lastError = null

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI runtime marked as started', {
        mode: state.mode,
        runtimeBackend: state.runtimeBackend,
        capturedCount: state.capturedCount,
      })
    }

    const initialStatus = await refreshSidecarStatus(next)

    if (
      initialStatus.ok ||
      next.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    ) {
      state.runtimeManaged = false
      return initialStatus
    }

    try {
      const runtimeStart = await localAiRuntimeController.start(next)
      state.runtimeManaged = Boolean(runtimeStart && runtimeStart.managed)

      const readyStatus = await waitForRuntimeReady(next)

      if (!readyStatus.ok && runtimeStart && runtimeStart.started) {
        return {
          ...readyStatus,
          error: readyStatus.error || 'runtime_start_timeout',
          lastError:
            readyStatus.lastError ||
            'Ollama was started but is not responding yet.',
        }
      }

      return readyStatus
    } catch (error) {
      state.runtimeManaged = false
      state.lastError = String((error && error.message) || error || '').trim()
      state.sidecarReachable = false
      state.sidecarCheckedAt = new Date().toISOString()
      state.sidecarModels = []

      return {
        ok: false,
        status: 'error',
        error: 'runtime_start_failed',
        lastError:
          state.lastError || 'Unable to start the configured Local AI runtime.',
        ...currentStatus(),
      }
    }
  }

  async function stop() {
    await hydrate()

    try {
      await localAiRuntimeController.stop({
        runtimeBackend: state.runtimeBackend,
      })
    } catch (error) {
      state.lastError = String((error && error.message) || error || '').trim()
    }

    state.running = false
    state.runtimeManaged = false
    state.lastError = null
    state.sidecarReachable = null
    state.sidecarCheckedAt = new Date().toISOString()
    state.sidecarModels = []

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI runtime marked as stopped', {
        capturedCount: state.capturedCount,
      })
    }

    return currentStatus()
  }

  async function listModels(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.listModels({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      timeoutMs: next.timeoutMs,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      models: result.ok ? result.models : [],
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function chat(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.chat({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      model: next.model,
      visionModel: next.visionModel,
      messages: next.messages,
      message: next.message,
      prompt: next.prompt,
      input: next.input,
      timeoutMs: next.timeoutMs,
      responseFormat: next.responseFormat,
      generationOptions: next.generationOptions,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function flipToText(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.flipToText({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
      timeoutMs: next.timeoutMs,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function checkFlipSequence(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.checkFlipSequence({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
      timeoutMs: next.timeoutMs,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function captionFlip(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.captionFlip({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function ocrImage(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.ocrImage({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function trainEpoch(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.trainEpoch({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function captureFlip(payload) {
    await hydrate()

    const nextCapture = toCaptureMeta(payload)

    if (!nextCapture) {
      state.lastError = 'Invalid local AI capture payload'

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Ignoring invalid local AI capture payload')
      }

      return {
        ok: false,
        error: state.lastError,
        ...currentStatus(),
      }
    }

    const existingCapture = reduceLatestCaptures(state.captureIndex).find(
      ({flipHash}) => flipHash === nextCapture.flipHash
    )
    const capture = mergeCaptureMeta(existingCapture, nextCapture)

    // Decoded flips often arrive before final consensus, so only explicit
    // disqualifiers are blocked here. Unknown cases still rely on manifest-time
    // post-consensus filtering.
    const skipReasons = getCaptureSkipReasons(payload, capture)

    if (skipReasons.length) {
      state.lastError = null

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Skipping ineligible local AI capture', {
          flipHash: capture.flipHash,
          reasons: skipReasons,
        })
      }

      return {
        ok: false,
        skipped: true,
        reasons: skipReasons,
        ...currentStatus(),
      }
    }

    state.capturedCount += existingCapture ? 0 : 1
    state.lastError = null
    state.captureIndex = state.captureIndex
      .filter(({flipHash}) => flipHash !== capture.flipHash)
      .concat(capture)
      .slice(-MAX_CAPTURE_INDEX_ITEMS)
    state.recentCaptures = state.captureIndex.slice(-MAX_RECENT_CAPTURES)

    try {
      await persistCaptureIndex()
      state.loadError = null
    } catch (error) {
      state.lastError = 'Unable to persist local AI capture index'

      if (logger && typeof logger.error === 'function') {
        logger.error('Unable to persist local AI capture index', {
          error: error.toString(),
        })
      }

      return {
        ok: false,
        error: state.lastError,
        ...currentStatus(),
      }
    }

    // MVP boundary: record metadata only, never retain decoded image bytes.
    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI flip captured', {
        flipHash: capture.flipHash,
        epoch: capture.epoch,
        sessionType: capture.sessionType,
        panelCount: capture.panelCount,
        capturedCount: state.capturedCount,
      })
    }

    return {
      ok: true,
      capture,
      ...currentStatus(),
    }
  }

  async function buildManifest(epochValue) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(epochValue)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : epochValue
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {...next, epoch},
      modelReference
    )

    const eligibleFlipHashes = []
    const excluded = []

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      eligibleFlipHashes.push(capture.flipHash)
    })

    const inconsistencyFlags = collectInconsistencyFlags(excluded)

    const manifest = {
      epoch,
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterStrategy: String(next.adapterStrategy || '').trim() || null,
      trainingPolicy: String(next.trainingPolicy || '').trim() || null,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      adapterArtifact: adapterContract.adapterArtifact || null,
      trainingConfigHash: adapterContract.trainingConfigHash,
      eligibleFlipHashes,
      flipCount: eligibleFlipHashes.length,
      excluded,
      skippedCount: excluded.length,
      inconsistencyFlags,
      generatedAt: new Date().toISOString(),
    }
    const nextManifestPath = manifestPath(localAiStorage, epoch)

    await localAiStorage.writeJsonAtomic(nextManifestPath, manifest)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI manifest built', {
        epoch,
        eligibleCount: eligibleFlipHashes.length,
        excludedCount: excluded.length,
        manifestPath: nextManifestPath,
      })
    }

    return {
      epoch,
      eligibleCount: eligibleFlipHashes.length,
      excludedCount: excluded.length,
      manifestPath: nextManifestPath,
    }
  }

  async function registerAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const sourcePath = normalizeFilePath(
      next.sourcePath ||
        next.artifactPath ||
        (next.adapterArtifact &&
        typeof next.adapterArtifact === 'object' &&
        !Array.isArray(next.adapterArtifact)
          ? next.adapterArtifact.sourcePath ||
            next.adapterArtifact.path ||
            next.adapterArtifact.filePath
          : '')
    )

    if (!sourcePath) {
      throw new Error('Adapter source path is required')
    }

    if (!(await localAiStorage.exists(sourcePath))) {
      throw new Error('Adapter source file is unavailable')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterFile = path.basename(sourcePath)
    const sizeBytes = await localAiStorage.fileSize(sourcePath)
    const adapterSha256 = await localAiStorage.sha256File(sourcePath)
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {
        ...next,
        epoch,
        deltaType: 'lora_adapter',
        adapterSha256,
        adapterArtifact: {
          file: adapterFile,
          sourcePath,
          sizeBytes,
        },
      },
      modelReference
    )
    const adapterManifest = {
      epoch,
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      trainingConfigHash: adapterContract.trainingConfigHash,
      adapterArtifact: {
        file: adapterFile,
        sourcePath,
        sizeBytes,
      },
      registeredAt: new Date().toISOString(),
    }
    const nextManifestPath = adapterArtifactManifestPath(localAiStorage, epoch)

    await localAiStorage.writeJsonAtomic(nextManifestPath, adapterManifest)

    return {
      epoch,
      adapterManifestPath: nextManifestPath,
      ...adapterManifest,
    }
  }

  async function loadAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextManifestPath = adapterArtifactManifestPath(localAiStorage, epoch)
    const adapterManifest = await localAiStorage.readJson(
      nextManifestPath,
      null
    )

    if (!adapterManifest) {
      throw new Error('Adapter artifact is unavailable')
    }

    return {
      epoch,
      adapterManifestPath: nextManifestPath,
      ...adapterManifest,
    }
  }

  async function buildTrainingCandidatePackage(payload) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {...next, epoch},
      modelReference
    )

    const items = []
    const excluded = []
    const packagedCandidates = []

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      try {
        const item = buildTrainingCandidateItem(capture)
        items.push(item)
        packagedCandidates.push({
          capture,
          item,
        })
      } catch (error) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons: ['packaging_failed'],
        })

        if (logger && typeof logger.error === 'function') {
          logger.error('Unable to package local AI training candidate', {
            flipHash: capture.flipHash || null,
            epoch,
            error: error.toString(),
          })
        }
      }
    })

    let finalItems = items
    let finalExcluded = excluded
    let rankingMetadata = {}

    if (
      next.rankingPolicy &&
      String(next.rankingPolicy.sourcePriority || '').trim() ===
        'local-node-first'
    ) {
      const ranked = await localAiModernTrainingCollector.buildCandidatePackage(
        {
          epoch,
          candidates: packagedCandidates,
          rankingPolicy: next.rankingPolicy,
          allowPublicIndexerFallback: next.allowPublicIndexerFallback,
          fetchFlipPayloads: next.fetchFlipPayloads === true,
          requireFlipPayloads: next.requireFlipPayloads === true,
          rpcUrl: next.rpcUrl,
          rpcKey: next.rpcKey,
          refreshPublicFallback: next.refreshPublicFallback === true,
        }
      )

      finalItems = ranked.items
      finalExcluded = excluded.concat(ranked.excluded || [])
      rankingMetadata = {
        sourcePriority: ranked.sourcePriority,
        rankingPolicy: ranked.rankingPolicy,
        localIndexPath: ranked.localIndexPath,
        fallbackIndexPath: ranked.fallbackIndexPath,
        fallbackUsed: ranked.fallbackUsed,
      }
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    const inconsistencyFlags = collectInconsistencyFlags(finalExcluded)
    const candidatePackage = {
      schemaVersion: TRAINING_CANDIDATE_PACKAGE_VERSION,
      packageType: 'local-ai-training-candidates',
      epoch,
      createdAt: new Date().toISOString(),
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterStrategy: String(next.adapterStrategy || '').trim() || null,
      trainingPolicy: String(next.trainingPolicy || '').trim() || null,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      adapterArtifact: adapterContract.adapterArtifact || null,
      trainingConfigHash: adapterContract.trainingConfigHash,
      reviewStatus: 'draft',
      reviewedAt: null,
      federatedReady: false,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      inconsistencyFlags,
      items: finalItems,
      excluded: finalExcluded,
      ...rankingMetadata,
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, candidatePackage)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI training candidate package built', {
        epoch,
        eligibleCount: finalItems.length,
        excludedCount: finalExcluded.length,
        packagePath: nextPackagePath,
      })
    }

    return {
      epoch,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      packagePath: nextPackagePath,
      package: next.includePackage ? candidatePackage : undefined,
    }
  }

  async function buildHumanTeacherPackage(payload) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'packaging')

    const batchSize = normalizeHumanTeacherBatchSize(next.batchSize)
    const excluded = []
    const packagedCandidates = []
    const captureByFlipHash = new Map()

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      try {
        const item = buildTrainingCandidateItem(capture)
        captureByFlipHash.set(capture.flipHash, capture)
        packagedCandidates.push({
          capture,
          item,
        })
      } catch (error) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons: ['packaging_failed'],
        })

        if (logger && typeof logger.error === 'function') {
          logger.error('Unable to package local AI human-teacher candidate', {
            flipHash: capture.flipHash || null,
            epoch,
            error: error.toString(),
          })
        }
      }
    })

    const ranked = await localAiModernTrainingCollector.buildCandidatePackage({
      epoch,
      candidates: packagedCandidates,
      rankingPolicy: next.rankingPolicy || {
        sourcePriority: 'local-node-first',
      },
      allowPublicIndexerFallback:
        typeof next.allowPublicIndexerFallback === 'boolean'
          ? next.allowPublicIndexerFallback
          : true,
      fetchFlipPayloads:
        typeof next.fetchFlipPayloads === 'boolean'
          ? next.fetchFlipPayloads
          : true,
      requireFlipPayloads:
        typeof next.requireFlipPayloads === 'boolean'
          ? next.requireFlipPayloads
          : true,
      rpcUrl: next.rpcUrl,
      rpcKey: next.rpcKey,
      refreshPublicFallback: next.refreshPublicFallback === true,
    })

    const finalExcluded = excluded.concat(ranked.excluded || [])
    const finalItems = []

    sortHumanTeacherItems(ranked.items || [])
      .slice(0, batchSize)
      .forEach((item) => {
        try {
          const originalCapture = captureByFlipHash.get(item.flipHash) || {}
          finalItems.push(
            buildHumanTeacherItem({
              ...originalCapture,
              ...item,
              orders: Array.isArray(originalCapture.orders)
                ? originalCapture.orders
                : [],
              selectedOrder: originalCapture.selectedOrder || null,
              relevance: originalCapture.relevance || null,
              best: originalCapture.best === true || item.best === true,
              author:
                item.author ||
                originalCapture.author ||
                (item.audit && item.audit.author) ||
                null,
            })
          )
        } catch (error) {
          finalExcluded.push({
            flipHash: item && item.flipHash ? item.flipHash : null,
            reasons: ['annotation_packaging_failed'],
          })

          if (logger && typeof logger.error === 'function') {
            logger.error('Unable to build local AI human-teacher task', {
              flipHash: item && item.flipHash ? item.flipHash : null,
              epoch,
              error: error.toString(),
            })
          }
        }
      })

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = {
      schemaVersion: HUMAN_TEACHER_PACKAGE_VERSION,
      packageType: 'local-ai-human-teacher-tasks',
      epoch,
      createdAt: new Date().toISOString(),
      batchSize,
      candidatePoolSize: Array.isArray(ranked.items) ? ranked.items.length : 0,
      reviewStatus: 'draft',
      reviewedAt: null,
      annotationReady: false,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      inconsistencyFlags: collectInconsistencyFlags(finalExcluded),
      sourcePriority: ranked.sourcePriority,
      rankingPolicy: ranked.rankingPolicy,
      localIndexPath: ranked.localIndexPath,
      fallbackIndexPath: ranked.fallbackIndexPath,
      fallbackUsed: ranked.fallbackUsed,
      items: finalItems,
      excluded: finalExcluded,
      annotationInstructions: {
        batchGoal: 'human_explanation_for_consensus_flip',
        requiredFields: [
          'frameCaptions',
          'optionASummary',
          'optionBSummary',
          'textRequired',
          'sequenceMarkersPresent',
          'reportRequired',
          'finalAnswer',
          'whyAnswer',
        ],
      },
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, taskPackage)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI human-teacher package built', {
        epoch,
        eligibleCount: finalItems.length,
        excludedCount: finalExcluded.length,
        batchSize,
        packagePath: nextPackagePath,
      })
    }

    return {
      epoch,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      packagePath: nextPackagePath,
      package: next.includePackage ? taskPackage : undefined,
    }
  }

  async function loadTrainingCandidatePackage(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    const candidatePackage = await localAiStorage.readTrainingCandidatePackage(
      nextPackagePath,
      null
    )

    if (!candidatePackage) {
      throw new Error('Training candidate package is unavailable')
    }

    return {
      epoch,
      eligibleCount: Number(candidatePackage.eligibleCount) || 0,
      excludedCount: Number(candidatePackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: candidatePackage,
    }
  }

  async function updateTrainingCandidatePackageReview(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    let candidatePackage

    try {
      candidatePackage =
        await localAiStorage.updateTrainingCandidatePackageReview(
          nextPackagePath,
          {
            reviewStatus: next.reviewStatus,
          }
        )
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('Training candidate package is unavailable')
      }

      throw error
    }

    return {
      epoch,
      eligibleCount: Number(candidatePackage.eligibleCount) || 0,
      excludedCount: Number(candidatePackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: candidatePackage,
    }
  }

  async function loadHumanTeacherPackage(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
    }
  }

  async function updateHumanTeacherPackageReview(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'review')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    let taskPackage

    try {
      taskPackage = await localAiStorage.updateHumanTeacherPackageReview(
        nextPackagePath,
        {
          reviewStatus: next.reviewStatus,
        }
      )
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('Human teacher package is unavailable')
      }

      throw error
    }

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
    }
  }

  async function exportHumanTeacherTasksWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'export')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if ((Number(taskPackage.eligibleCount) || 0) <= 0) {
      throw new Error(
        'Human teacher package does not contain any eligible tasks'
      )
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotation tasks can be exported'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const exportSummary = await exportHumanTeacherTasks({
      packagePath: nextPackagePath,
      outputDir,
      take: next.batchSize,
    })

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
      outputDir,
      export: exportSummary,
    }
  }

  async function loadHumanTeacherAnnotationWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation workspace')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before the annotation workspace can be opened'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')

    if (!(await localAiStorage.exists(taskManifestPath))) {
      throw new Error(
        'Human teacher task manifest is unavailable; export annotation tasks first'
      )
    }

    const taskRows = await readJsonlRows(taskManifestPath, [])
    const annotationRows = await readJsonlRows(annotationsPath, [])
    const tasks = buildHumanTeacherWorkspaceTasks(
      taskRows,
      annotationRows,
      epoch
    )

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
      outputDir,
      workspace: {
        outputDir,
        taskManifestPath,
        annotationsPath,
        taskCount: tasks.length,
        draftedCount: tasks.filter((task) => task.hasDraft).length,
        completedCount: tasks.filter((task) => task.isComplete).length,
        tasks,
      },
    }
  }

  async function loadHumanTeacherDemoWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDemoSampleName(next.sampleName)
    const outputDir = humanTeacherDemoDir(localAiStorage, sampleName)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')

    const summary = (await localAiStorage.exists(taskManifestPath))
      ? {
          demo: true,
          sampleName,
          sampleLabel:
            listHumanTeacherDemoSamples().find(
              (item) => item.sampleName === sampleName
            )?.label || sampleName,
          outputDir,
          tasks: 0,
          manifestPath: taskManifestPath,
          templatePath: path.join(outputDir, 'annotations.template.jsonl'),
          filledPath: annotationsPath,
          metadataPath: path.join(outputDir, 'demo-metadata.json'),
        }
      : await buildHumanTeacherDemoWorkspace({
          outputDir,
          sampleName,
          take: next.batchSize,
        })

    const taskRows = await readJsonlRows(taskManifestPath, [])
    const annotationRows = await readJsonlRows(annotationsPath, [])
    const tasks = buildHumanTeacherWorkspaceTasks(
      taskRows,
      annotationRows,
      null
    )

    return {
      demo: true,
      sampleName,
      samples: listHumanTeacherDemoSamples(),
      outputDir,
      summary: {
        ...summary,
        tasks: taskRows.length,
      },
      workspace: {
        outputDir,
        taskManifestPath,
        annotationsPath,
        taskCount: tasks.length,
        draftedCount: tasks.filter((task) => task.hasDraft).length,
        completedCount: tasks.filter((task) => task.isComplete).length,
        tasks,
      },
    }
  }

  async function loadHumanTeacherAnnotationTask(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)
    const taskId = String(next.taskId || '').trim()

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    if (!taskId) {
      throw new Error('taskId is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation task')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotation tasks can be opened'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')
    const taskRows = await readJsonlRows(taskManifestPath, [])
    const annotationRows = await readJsonlRows(annotationsPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher task is unavailable')
    }

    const annotationRow = annotationRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )
    const panels = await Promise.all(
      (Array.isArray(taskRow.panels) ? taskRow.panels : []).map(
        async (panelRelativePath, index) => {
          const panelPath = resolveWorkspaceChildPath(
            outputDir,
            panelRelativePath
          )
          const panelBuffer = await localAiStorage.readBuffer(panelPath)

          return {
            id: `panel-${index + 1}`,
            index,
            path: panelPath,
            dataUrl: `data:image/png;base64,${panelBuffer.toString('base64')}`,
          }
        }
      )
    )

    return {
      epoch,
      task: {
        taskId,
        sampleId: taskRow.sample_id || taskId,
        flipHash: taskRow.flip_hash || null,
        epoch: taskRow.epoch ?? epoch,
        consensusAnswer: taskRow.final_answer || null,
        consensusStrength: taskRow.consensus_strength || null,
        leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
        rightOrder: Array.isArray(taskRow.right_order)
          ? taskRow.right_order
          : [],
        words:
          taskRow.words &&
          typeof taskRow.words === 'object' &&
          !Array.isArray(taskRow.words)
            ? taskRow.words
            : {},
        panels,
        annotation: normalizeHumanTeacherAnnotationDraft(
          taskRow,
          annotationRow
        ),
      },
    }
  }

  async function loadHumanTeacherDemoTask(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDemoSampleName(next.sampleName)
    const taskId = String(next.taskId || '').trim()

    if (!taskId) {
      throw new Error('taskId is required')
    }

    const outputDir = humanTeacherDemoDir(localAiStorage, sampleName)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')

    if (!(await localAiStorage.exists(taskManifestPath))) {
      await buildHumanTeacherDemoWorkspace({
        outputDir,
        sampleName,
        take: next.batchSize,
      })
    }

    const taskRows = await readJsonlRows(taskManifestPath, [])
    const annotationRows = await readJsonlRows(annotationsPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher demo task is unavailable')
    }

    const annotationRow = annotationRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )
    const panels = await Promise.all(
      (Array.isArray(taskRow.panels) ? taskRow.panels : []).map(
        async (panelRelativePath, index) => {
          const panelPath = resolveWorkspaceChildPath(
            outputDir,
            panelRelativePath
          )
          const panelBuffer = await localAiStorage.readBuffer(panelPath)

          return {
            id: `panel-${index + 1}`,
            index,
            path: panelPath,
            dataUrl: `data:image/png;base64,${panelBuffer.toString('base64')}`,
          }
        }
      )
    )

    return {
      demo: true,
      sampleName,
      task: {
        taskId,
        sampleId: taskRow.sample_id || taskId,
        flipHash: taskRow.flip_hash || null,
        epoch: null,
        consensusAnswer: taskRow.final_answer || null,
        consensusStrength: taskRow.consensus_strength || null,
        leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
        rightOrder: Array.isArray(taskRow.right_order)
          ? taskRow.right_order
          : [],
        words:
          taskRow.words &&
          typeof taskRow.words === 'object' &&
          !Array.isArray(taskRow.words)
            ? taskRow.words
            : {},
        demo:
          taskRow.demo &&
          typeof taskRow.demo === 'object' &&
          !Array.isArray(taskRow.demo)
            ? taskRow.demo
            : null,
        panels,
        annotation: normalizeHumanTeacherAnnotationDraft(
          taskRow,
          annotationRow
        ),
      },
    }
  }

  async function saveHumanTeacherAnnotationDraft(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)
    const taskId = String(next.taskId || '').trim()

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    if (!taskId) {
      throw new Error('taskId is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation draft save')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotation drafts can be saved'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')
    const taskRows = await readJsonlRows(taskManifestPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher task is unavailable')
    }

    const annotationRows = await readJsonlRows(annotationsPath, [])
    const nextAnnotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      next.annotation
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(nextAnnotation)
    const nextAnnotationRows = annotationRows
      .filter(
        (row) => String(row && row.task_id ? row.task_id : '').trim() !== taskId
      )
      .concat(nextAnnotation)

    await writeJsonlRows(annotationsPath, nextAnnotationRows)

    const nextTaskPackage = {
      ...taskPackage,
      items: Array.isArray(taskPackage.items)
        ? taskPackage.items.map((item) => {
            const itemTaskId = String(
              item && item.taskId ? item.taskId : ''
            ).trim()

            if (itemTaskId !== taskId) {
              return item
            }

            return {
              ...item,
              annotationStatus,
            }
          })
        : [],
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, nextTaskPackage)

    return {
      epoch,
      packagePath: nextPackagePath,
      package: nextTaskPackage,
      task: {
        taskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath,
      },
    }
  }

  async function saveHumanTeacherDemoDraft(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDemoSampleName(next.sampleName)
    const taskId = String(next.taskId || '').trim()

    if (!taskId) {
      throw new Error('taskId is required')
    }

    const outputDir = humanTeacherDemoDir(localAiStorage, sampleName)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')

    if (!(await localAiStorage.exists(taskManifestPath))) {
      await buildHumanTeacherDemoWorkspace({
        outputDir,
        sampleName,
        take: next.batchSize,
      })
    }

    const taskRows = await readJsonlRows(taskManifestPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher demo task is unavailable')
    }

    const annotationRows = await readJsonlRows(annotationsPath, [])
    const nextAnnotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      next.annotation
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(nextAnnotation)
    const nextAnnotationRows = annotationRows
      .filter(
        (row) => String(row && row.task_id ? row.task_id : '').trim() !== taskId
      )
      .concat(nextAnnotation)

    await writeJsonlRows(annotationsPath, nextAnnotationRows)

    return {
      demo: true,
      sampleName,
      task: {
        taskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath,
      },
    }
  }

  async function importHumanTeacherAnnotationsWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation import')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotations can be imported'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath =
      normalizeFilePath(next.annotationsPath) ||
      path.join(outputDir, 'annotations.filled.jsonl')
    const normalizedPath =
      normalizeFilePath(next.outputJsonlPath) ||
      humanTeacherNormalizedAnnotationsPath(localAiStorage, epoch)
    const summaryPath =
      normalizeFilePath(next.summaryPath) ||
      humanTeacherImportSummaryPath(localAiStorage, epoch)

    if (!(await localAiStorage.exists(taskManifestPath))) {
      throw new Error(
        'Human teacher task manifest is unavailable; export annotation tasks first'
      )
    }

    if (!(await localAiStorage.exists(annotationsPath))) {
      throw new Error(
        'Filled annotation file is unavailable; complete annotations.filled.jsonl first'
      )
    }

    const importSummary = await importHumanTeacherAnnotations({
      taskManifestPath,
      annotationsJsonlPath: annotationsPath,
      outputJsonlPath: normalizedPath,
      summaryPath,
    })
    const importedTaskIds = new Set(
      (importSummary.rows || []).map((row) => String(row.task_id || '').trim())
    )
    const nextTaskPackage = {
      ...taskPackage,
      importedAnnotations: {
        importedAt: new Date().toISOString(),
        normalizedPath,
        summaryPath,
        sourceAnnotationsPath: annotationsPath,
        taskManifestPath,
        normalizedRows: Number(importSummary.normalizedRows) || 0,
        missingAnnotations: Number(importSummary.missingAnnotations) || 0,
        unmatchedAnnotations: Number(importSummary.unmatchedAnnotations) || 0,
        invalidAnnotations: Number(importSummary.invalidAnnotations) || 0,
      },
      items: Array.isArray(taskPackage.items)
        ? taskPackage.items.map((item) => {
            const taskId = String(item && item.taskId ? item.taskId : '').trim()

            return importedTaskIds.has(taskId)
              ? {
                  ...item,
                  annotationStatus: 'annotated',
                }
              : item
          })
        : [],
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, nextTaskPackage)

    return {
      epoch,
      eligibleCount: Number(nextTaskPackage.eligibleCount) || 0,
      excludedCount: Number(nextTaskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: nextTaskPackage,
      outputDir,
      import: {
        normalizedPath,
        summaryPath,
        annotationsPath,
        normalizedRows: Number(importSummary.normalizedRows) || 0,
        missingAnnotations: Number(importSummary.missingAnnotations) || 0,
        unmatchedAnnotations: Number(importSummary.unmatchedAnnotations) || 0,
        invalidAnnotations: Number(importSummary.invalidAnnotations) || 0,
      },
    }
  }

  return {
    status,
    start,
    stop,
    listModels,
    chat,
    checkFlipSequence,
    flipToText,
    captionFlip,
    ocrImage,
    trainEpoch,
    captureFlip,
    registerAdapterArtifact,
    loadAdapterArtifact,
    buildManifest,
    buildTrainingCandidatePackage,
    buildHumanTeacherPackage,
    loadTrainingCandidatePackage,
    loadHumanTeacherPackage,
    loadHumanTeacherAnnotationWorkspace,
    loadHumanTeacherAnnotationTask,
    loadHumanTeacherDemoWorkspace,
    loadHumanTeacherDemoTask,
    updateTrainingCandidatePackageReview,
    updateHumanTeacherPackageReview,
    exportHumanTeacherTasks: exportHumanTeacherTasksWorkspace,
    saveHumanTeacherAnnotationDraft,
    saveHumanTeacherDemoDraft,
    importHumanTeacherAnnotations: importHumanTeacherAnnotationsWorkspace,
  }
}

module.exports = {
  createLocalAiManager,
  defaultCaptureIndex,
}
