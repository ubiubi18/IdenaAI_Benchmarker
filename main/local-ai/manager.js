const {spawn} = require('child_process')
const fs = require('fs')
const path = require('path')

const {createLocalAiStorage} = require('./storage')
const {resolveAdapterContract} = require('./adapter-contract')
const {createLocalAiSidecar} = require('./sidecar')
const {
  DEFAULT_DEMO_SAMPLE_NAME,
  buildHumanTeacherDemoWorkspace,
  listDeveloperHumanTeacherSamples,
  listHumanTeacherDemoSamples,
  loadDeveloperHumanTeacherSample,
  loadHumanTeacherDemoSample,
  normalizeDeveloperHumanTeacherSampleName,
  normalizeDemoSampleName,
} = require('./human-teacher-demo')
const {exportHumanTeacherTasks} = require('./human-teacher-export')
const {importHumanTeacherAnnotations} = require('./human-teacher-import')
const {resolveModelReference} = require('./model-reference')
const {createModernTrainingCollector} = require('./modern-training')
const {createDeveloperTrainingRunner} = require('./developer-training-runner')
const {
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  resolveLocalAiRuntimeAdapter,
  validateLocalAiBaseUrl,
} = require('./runtime-adapter')

const CAPTURE_INDEX_VERSION = 1
const TRAINING_CANDIDATE_PACKAGE_VERSION = 1
const HUMAN_TEACHER_PACKAGE_VERSION = 1
const MAX_CAPTURE_INDEX_ITEMS = 1000
const MAX_RECENT_CAPTURES = 20
const DEFAULT_HUMAN_TEACHER_BATCH_SIZE = 30
const MAX_HUMAN_TEACHER_BATCH_SIZE = 30
const DEMO_HUMAN_TEACHER_BATCH_SIZE = 5
const DEMO_HUMAN_TEACHER_STATE_VERSION = 1
const DEVELOPER_HUMAN_TEACHER_BATCH_SIZE = 5
const DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE =
  'flip-challenge-test-20-decoded-labeled'
const DEVELOPER_HUMAN_TEACHER_STATE_VERSION = 1
const DEFAULT_RUNTIME_START_TIMEOUT_MS = 10 * 1000
const DEFAULT_RUNTIME_START_RETRY_DELAY_MS = 400
const ACTIVE_VALIDATION_PERIODS = new Set(['ShortSession', 'LongSession'])
const MAX_DEVELOPER_COMPARISON_HISTORY = 30
const EXTERNAL_DEVELOPER_TRAINING_BUNDLE_VERSION = 1
const EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL =
  'mlx-community/Qwen3.5-9B-MLX-4bit'
const EXTERNAL_DEVELOPER_STRONG_FALLBACK_TRAINING_MODEL =
  'mlx-community/Qwen2.5-VL-7B-Instruct-4bit'
const EXTERNAL_DEVELOPER_SAFE_FALLBACK_TRAINING_MODEL =
  'mlx-community/Qwen2-VL-2B-Instruct-4bit'
const EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE = 200
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
      const baseUrlValidation = validateLocalAiBaseUrl(payload.baseUrl)

      if (!baseUrlValidation.ok) {
        return {
          started: false,
          managed: false,
          error: baseUrlValidation.reason,
          lastError: baseUrlValidation.message,
          baseUrl:
            baseUrlValidation.normalizedBaseUrl ||
            String(payload.baseUrl || ''),
        }
      }

      const host = resolveOllamaHostEnv(baseUrlValidation.normalizedBaseUrl)

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

function isDeveloperHumanTeacherTrainingRequest(payload) {
  const input = pickRuntimeInput(payload)

  return Boolean(
    input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      input.developerHumanTeacher === true
  )
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

function demoHumanTeacherStatePath(
  storage,
  sampleName = DEFAULT_DEMO_SAMPLE_NAME
) {
  return path.join(humanTeacherDemoDir(storage, sampleName), 'state.json')
}

function demoHumanTeacherChunkDir(
  storage,
  sampleName = DEFAULT_DEMO_SAMPLE_NAME,
  offset = 0
) {
  const nextOffset = Math.max(0, Number.parseInt(offset, 10) || 0)
  return path.join(
    humanTeacherDemoDir(storage, sampleName),
    'chunks',
    `offset-${String(nextOffset).padStart(4, '0')}`
  )
}

function developerHumanTeacherDir(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return storage.resolveLocalAiPath(
    'human-teacher-developer',
    normalizeDeveloperHumanTeacherSampleName(sampleName)
  )
}

function developerHumanTeacherStatePath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(developerHumanTeacherDir(storage, sampleName), 'state.json')
}

function developerHumanTeacherChunkDir(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  offset = 0
) {
  const nextOffset = Math.max(0, Number.parseInt(offset, 10) || 0)
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'chunks',
    `offset-${String(nextOffset).padStart(4, '0')}`
  )
}

function developerHumanTeacherAnnotatedPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'annotations.annotated.jsonl'
  )
}

function developerHumanTeacherPendingPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'annotations.pending.jsonl'
  )
}

function developerHumanTeacherTrainedPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'annotations.trained.jsonl'
  )
}

function developerHumanTeacherComparisonPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'comparison-100flips.json'
  )
}

function developerHumanTeacherExternalBundleDir(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  bundleId = ''
) {
  const baseDir = path.join(
    developerHumanTeacherDir(storage, sampleName),
    'external-training-bundles'
  )

  if (!bundleId) {
    return baseDir
  }

  return path.join(baseDir, String(bundleId || '').trim())
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

function normalizeDeveloperHumanTeacherOffset(value) {
  const offset = Number.parseInt(value, 10)

  if (!Number.isFinite(offset) || offset < 0) {
    return 0
  }

  return offset
}

function normalizeDemoHumanTeacherOffset(value) {
  return normalizeDeveloperHumanTeacherOffset(value)
}

function clampDemoHumanTeacherOffset(offset, totalFlips) {
  const nextOffset = normalizeDemoHumanTeacherOffset(offset)
  const total = Number.parseInt(totalFlips, 10)

  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }

  const maxOffset = Math.max(
    0,
    total - Math.min(DEMO_HUMAN_TEACHER_BATCH_SIZE, total)
  )

  return Math.min(nextOffset, maxOffset)
}

function clampDeveloperHumanTeacherOffset(offset, totalFlips) {
  const nextOffset = normalizeDeveloperHumanTeacherOffset(offset)
  const total = Number.parseInt(totalFlips, 10)

  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }

  const maxOffset = Math.max(
    0,
    total - Math.min(DEVELOPER_HUMAN_TEACHER_BATCH_SIZE, total)
  )

  return Math.min(nextOffset, maxOffset)
}

function normalizeCurrentPeriod(value) {
  return String(value || '').trim()
}

function assertDeveloperHumanTeacherSessionAllowed(currentPeriod, action) {
  const nextCurrentPeriod = normalizeCurrentPeriod(currentPeriod)

  if (ACTIVE_VALIDATION_PERIODS.has(nextCurrentPeriod)) {
    throw new Error(
      `Developer human-teacher ${action} is blocked while a validation session is running`
    )
  }
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(values.map((item) => String(item || '').trim()).filter(Boolean))
  )
}

function uniqueNumbers(values = []) {
  return Array.from(
    new Set(
      values
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isFinite(item) && item >= 0)
    )
  ).sort((left, right) => left - right)
}

function mergeJsonlRowsByTaskId(rows = [], extraRows = []) {
  const nextRows = new Map()

  ;[...rows, ...extraRows].forEach((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return
    }

    const taskId = String(
      row.task_id || row.taskId || row.sample_id || row.sampleId || ''
    ).trim()

    if (!taskId) {
      return
    }

    nextRows.set(taskId, row)
  })

  return Array.from(nextRows.values())
}

function summarizeDeveloperChunkRows(rows = []) {
  const taskIds = uniqueStrings(rows.map((row) => row && row.task_id))
  return {
    taskIds,
    rowCount: rows.length,
  }
}

function normalizeAccuracyValue(value) {
  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100
  }

  return null
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeDeveloperComparisonStatus(value, fallback = 'not_loaded') {
  const status = String(value || fallback).trim()
  return status || fallback
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return null
  }

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function createDefaultDeveloperComparisonState() {
  return {
    status: 'not_loaded',
    holdoutPath: null,
    lastEvaluatedAt: null,
    lastResultPath: null,
    accuracy: null,
    correct: null,
    totalFlips: null,
    bestAccuracy: null,
    history: [],
  }
}

function normalizeDeveloperComparisonHistoryEntry(entry = {}) {
  const source =
    entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}

  return {
    status: normalizeDeveloperComparisonStatus(source.status, 'evaluated'),
    evaluatedAt: normalizeIsoDate(
      source.evaluatedAt || source.lastEvaluatedAt || source.generatedAt
    ),
    resultPath:
      String(
        source.resultPath || source.lastResultPath || source.path || ''
      ).trim() || null,
    holdoutPath: String(source.holdoutPath || '').trim() || null,
    accuracy: normalizeAccuracyValue(source.accuracy),
    correct: normalizeNonNegativeInteger(source.correct),
    totalFlips: normalizeNonNegativeInteger(
      source.totalFlips || source.total || source.flipCount
    ),
  }
}

function dedupeDeveloperComparisonHistory(entries = []) {
  const normalizedEntries = entries
    .map((entry) => normalizeDeveloperComparisonHistoryEntry(entry))
    .filter(
      (entry) =>
        entry.evaluatedAt ||
        entry.resultPath ||
        entry.accuracy !== null ||
        entry.correct !== null ||
        entry.totalFlips !== null
    )
    .sort((left, right) => {
      const leftTime = left.evaluatedAt ? Date.parse(left.evaluatedAt) : 0
      const rightTime = right.evaluatedAt ? Date.parse(right.evaluatedAt) : 0
      return rightTime - leftTime
    })

  const uniqueEntries = []
  const seenKeys = new Set()

  normalizedEntries.forEach((entry) => {
    const key = [
      entry.evaluatedAt || '',
      entry.resultPath || '',
      entry.accuracy === null ? '' : String(entry.accuracy),
      entry.correct === null ? '' : String(entry.correct),
      entry.totalFlips === null ? '' : String(entry.totalFlips),
    ].join('::')

    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueEntries.push(entry)
    }
  })

  return uniqueEntries.slice(0, MAX_DEVELOPER_COMPARISON_HISTORY)
}

function normalizeDeveloperComparisonState(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const fallback = createDefaultDeveloperComparisonState()
  const history = dedupeDeveloperComparisonHistory(source.history)
  const latestEntry =
    history[0] ||
    normalizeDeveloperComparisonHistoryEntry({
      status: source.status,
      evaluatedAt: source.lastEvaluatedAt,
      resultPath: source.lastResultPath,
      holdoutPath: source.holdoutPath,
      accuracy: source.accuracy,
      correct: source.correct,
      totalFlips: source.totalFlips,
    })
  const bestAccuracy = history.reduce((best, entry) => {
    if (entry.accuracy === null) {
      return best
    }

    return best === null ? entry.accuracy : Math.max(best, entry.accuracy)
  }, normalizeAccuracyValue(source.bestAccuracy))

  return {
    ...fallback,
    ...source,
    status: normalizeDeveloperComparisonStatus(
      latestEntry?.status || source.status,
      fallback.status
    ),
    holdoutPath:
      String(
        latestEntry?.holdoutPath || source.holdoutPath || fallback.holdoutPath
      ).trim() || null,
    lastEvaluatedAt:
      latestEntry?.evaluatedAt ||
      normalizeIsoDate(source.lastEvaluatedAt) ||
      fallback.lastEvaluatedAt,
    lastResultPath:
      String(
        latestEntry?.resultPath ||
          source.lastResultPath ||
          fallback.lastResultPath
      ).trim() || null,
    accuracy:
      latestEntry?.accuracy !== null
        ? latestEntry.accuracy
        : normalizeAccuracyValue(source.accuracy),
    correct:
      latestEntry?.correct !== null
        ? latestEntry.correct
        : normalizeNonNegativeInteger(source.correct),
    totalFlips:
      latestEntry?.totalFlips !== null
        ? latestEntry.totalFlips
        : normalizeNonNegativeInteger(source.totalFlips),
    bestAccuracy,
    history,
  }
}

function readComparisonMetric(source, candidates = []) {
  for (const pathParts of candidates) {
    let current = source

    for (const part of pathParts) {
      if (
        !current ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        typeof current[part] === 'undefined'
      ) {
        current = undefined
        break
      }

      current = current[part]
    }

    if (typeof current !== 'undefined') {
      return current
    }
  }

  return undefined
}

function extractDeveloperComparisonSnapshot(
  result,
  {resultPath = null, holdoutPath = null, fallbackStatus = 'evaluated'} = {}
) {
  const source =
    result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  const accuracy = normalizeAccuracyValue(
    readComparisonMetric(source, [
      ['accuracy'],
      ['summary', 'accuracy'],
      ['metrics', 'accuracy'],
      ['result', 'accuracy'],
      ['comparison100', 'accuracy'],
    ])
  )
  const correct = normalizeNonNegativeInteger(
    readComparisonMetric(source, [
      ['correct'],
      ['summary', 'correct'],
      ['metrics', 'correct'],
      ['result', 'correct'],
      ['comparison100', 'correct'],
    ])
  )
  const totalFlips = normalizeNonNegativeInteger(
    readComparisonMetric(source, [
      ['totalFlips'],
      ['total'],
      ['flipCount'],
      ['summary', 'totalFlips'],
      ['summary', 'total'],
      ['metrics', 'totalFlips'],
      ['result', 'totalFlips'],
      ['comparison100', 'totalFlips'],
    ])
  )

  if (accuracy === null && correct === null && totalFlips === null) {
    return null
  }

  const evaluatedAt = normalizeIsoDate(
    readComparisonMetric(source, [
      ['evaluatedAt'],
      ['lastEvaluatedAt'],
      ['generatedAt'],
      ['summary', 'evaluatedAt'],
      ['comparison100', 'lastEvaluatedAt'],
    ])
  )
  const resolvedResultPath =
    String(
      readComparisonMetric(source, [
        ['resultPath'],
        ['lastResultPath'],
        ['path'],
        ['comparison100', 'lastResultPath'],
      ]) ||
        resultPath ||
        ''
    ).trim() || null
  const resolvedHoldoutPath =
    String(
      readComparisonMetric(source, [
        ['holdoutPath'],
        ['comparison100', 'holdoutPath'],
      ]) ||
        holdoutPath ||
        ''
    ).trim() || null

  return normalizeDeveloperComparisonHistoryEntry({
    status: fallbackStatus,
    evaluatedAt: evaluatedAt || new Date().toISOString(),
    resultPath: resolvedResultPath,
    holdoutPath: resolvedHoldoutPath,
    accuracy,
    correct,
    totalFlips,
  })
}

function mergeDeveloperComparisonSnapshot(
  currentComparison,
  snapshot,
  fallbackStatus = 'evaluated'
) {
  const normalizedCurrent = normalizeDeveloperComparisonState(currentComparison)

  if (!snapshot) {
    return {
      ...normalizedCurrent,
      status: normalizeDeveloperComparisonStatus(
        normalizedCurrent.status,
        fallbackStatus
      ),
    }
  }

  return normalizeDeveloperComparisonState({
    ...normalizedCurrent,
    status: normalizeDeveloperComparisonStatus(snapshot.status, fallbackStatus),
    holdoutPath: snapshot.holdoutPath || normalizedCurrent.holdoutPath,
    lastEvaluatedAt: snapshot.evaluatedAt || normalizedCurrent.lastEvaluatedAt,
    lastResultPath: snapshot.resultPath || normalizedCurrent.lastResultPath,
    accuracy:
      snapshot.accuracy !== null
        ? snapshot.accuracy
        : normalizedCurrent.accuracy,
    correct:
      snapshot.correct !== null ? snapshot.correct : normalizedCurrent.correct,
    totalFlips:
      snapshot.totalFlips !== null
        ? snapshot.totalFlips
        : normalizedCurrent.totalFlips,
    history: [snapshot, ...normalizedCurrent.history],
  })
}

function createDefaultDemoHumanTeacherState({
  sampleName = DEFAULT_DEMO_SAMPLE_NAME,
  totalAvailableTasks = 0,
  currentOffset = 0,
} = {}) {
  return {
    schemaVersion: DEMO_HUMAN_TEACHER_STATE_VERSION,
    mode: 'demo-human-teacher',
    sampleName: normalizeDemoSampleName(sampleName),
    chunkSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: Math.max(
      0,
      Number.parseInt(totalAvailableTasks, 10) || 0
    ),
    currentOffset: normalizeDemoHumanTeacherOffset(currentOffset),
    annotatedTaskIds: [],
    trainedChunkOffsets: [],
    chunks: [],
    lastSavedAt: null,
    lastTraining: null,
  }
}

function normalizeDemoHumanTeacherState(
  state,
  {sampleName = DEFAULT_DEMO_SAMPLE_NAME, totalAvailableTasks = 0} = {}
) {
  const fallback = createDefaultDemoHumanTeacherState({
    sampleName,
    totalAvailableTasks,
  })
  const source =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const persistedTotal = Math.max(
    0,
    Number.parseInt(source.totalAvailableTasks, 10) || 0
  )
  const discoveredTotal = Math.max(
    0,
    Number.parseInt(totalAvailableTasks, 10) || 0
  )
  const total = Math.max(persistedTotal, discoveredTotal)

  return {
    ...fallback,
    ...source,
    sampleName: normalizeDemoSampleName(source.sampleName || sampleName),
    chunkSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: total,
    currentOffset: clampDemoHumanTeacherOffset(source.currentOffset, total),
    annotatedTaskIds: uniqueStrings(source.annotatedTaskIds),
    trainedChunkOffsets: uniqueNumbers(source.trainedChunkOffsets),
    chunks: Array.isArray(source.chunks)
      ? source.chunks
          .map((chunk) => {
            const raw =
              chunk && typeof chunk === 'object' && !Array.isArray(chunk)
                ? chunk
                : {}

            return {
              offset: normalizeDemoHumanTeacherOffset(raw.offset),
              taskIds: uniqueStrings(raw.taskIds),
              rowCount: Math.max(0, Number.parseInt(raw.rowCount, 10) || 0),
              committedAt: String(raw.committedAt || '').trim() || null,
              trainedAt: String(raw.trainedAt || '').trim() || null,
              trainingStatus:
                String(raw.trainingStatus || '').trim() || 'pending',
            }
          })
          .sort((left, right) => left.offset - right.offset)
      : [],
  }
}

function extractDeveloperTrainingFailureReason(result) {
  const source =
    result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  const rawError =
    source.error &&
    typeof source.error === 'object' &&
    !Array.isArray(source.error)
      ? source.error
      : null

  const candidates = [
    source.failureReason,
    source.message,
    source.reason,
    source.lastError,
    rawError?.message,
    typeof source.error === 'string' ? source.error : null,
    source.details,
    source.stderr,
    source.status,
  ]

  for (const candidate of candidates) {
    const message = String(candidate || '').trim()

    if (message) {
      return message.slice(0, 400)
    }
  }

  return null
}

function normalizeDeveloperLastTrainingState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const source = value
  const status = String(source.status || '').trim() || null
  const offset = Number.parseInt(source.offset, 10)
  const rowCount = Number.parseInt(source.rowCount, 10)

  return {
    at: String(source.at || '').trim() || null,
    status,
    offset: Number.isFinite(offset)
      ? normalizeDeveloperHumanTeacherOffset(offset)
      : null,
    rowCount: Number.isFinite(rowCount) && rowCount > 0 ? rowCount : 0,
    failureReason:
      status === 'failed'
        ? String(
            source.failureReason ||
              extractDeveloperTrainingFailureReason(source.result)
          ).trim() || null
        : null,
    result:
      source.result &&
      typeof source.result === 'object' &&
      !Array.isArray(source.result)
        ? source.result
        : null,
  }
}

function createDefaultDeveloperHumanTeacherState({
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  totalAvailableTasks = 0,
  currentOffset = 0,
} = {}) {
  return {
    schemaVersion: DEVELOPER_HUMAN_TEACHER_STATE_VERSION,
    mode: 'developer-human-teacher',
    sampleName: normalizeDeveloperHumanTeacherSampleName(sampleName),
    chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: Math.max(
      0,
      Number.parseInt(totalAvailableTasks, 10) || 0
    ),
    currentOffset: normalizeDeveloperHumanTeacherOffset(currentOffset),
    annotatedTaskIds: [],
    pendingTrainingTaskIds: [],
    trainedTaskIds: [],
    chunks: [],
    lastSavedAt: null,
    lastTraining: null,
    activeTrainingModelPath: null,
    activeTrainingBackend: null,
    activeLocalTrainingProfile: null,
    comparison100: createDefaultDeveloperComparisonState(),
  }
}

function normalizeDeveloperHumanTeacherState(
  state,
  {
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    totalAvailableTasks = 0,
  } = {}
) {
  const fallback = createDefaultDeveloperHumanTeacherState({
    sampleName,
    totalAvailableTasks,
  })
  const source =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const persistedTotal = Math.max(
    0,
    Number.parseInt(source.totalAvailableTasks, 10) || 0
  )
  const discoveredTotal = Math.max(
    0,
    Number.parseInt(totalAvailableTasks, 10) || 0
  )
  const total = Math.max(persistedTotal, discoveredTotal)

  return {
    ...fallback,
    ...source,
    sampleName: normalizeDeveloperHumanTeacherSampleName(
      source.sampleName || sampleName
    ),
    chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: total,
    currentOffset: clampDeveloperHumanTeacherOffset(
      source.currentOffset,
      total
    ),
    annotatedTaskIds: uniqueStrings(source.annotatedTaskIds),
    pendingTrainingTaskIds: uniqueStrings(source.pendingTrainingTaskIds),
    trainedTaskIds: uniqueStrings(source.trainedTaskIds),
    activeTrainingModelPath:
      String(source.activeTrainingModelPath || '').trim() || null,
    activeTrainingBackend:
      String(source.activeTrainingBackend || '').trim() || null,
    activeLocalTrainingProfile:
      String(source.activeLocalTrainingProfile || '').trim() || null,
    lastTraining: normalizeDeveloperLastTrainingState(source.lastTraining),
    chunks: Array.isArray(source.chunks)
      ? source.chunks
          .map((chunk) => {
            const raw =
              chunk && typeof chunk === 'object' && !Array.isArray(chunk)
                ? chunk
                : {}

            return {
              offset: normalizeDeveloperHumanTeacherOffset(raw.offset),
              taskIds: uniqueStrings(raw.taskIds),
              rowCount: Math.max(0, Number.parseInt(raw.rowCount, 10) || 0),
              committedAt: String(raw.committedAt || '').trim() || null,
              trainedAt: String(raw.trainedAt || '').trim() || null,
              trainingStatus:
                String(raw.trainingStatus || '').trim() || 'pending',
              normalizedPath: String(raw.normalizedPath || '').trim() || null,
              summaryPath: String(raw.summaryPath || '').trim() || null,
            }
          })
          .sort((left, right) => left.offset - right.offset)
      : [],
    comparison100: normalizeDeveloperComparisonState(source.comparison100),
  }
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
    ai_annotation: null,
    ai_annotation_feedback: '',
    panel_references: ['A', 'B', 'C'].map((code) => ({
      code,
      description: '',
      panel_index: null,
      x: null,
      y: null,
    })),
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    final_answer: '',
    why_answer: '',
    confidence: null,
  }
}

function buildDefaultHumanTeacherAiAnnotation() {
  return {
    generated_at: '',
    runtime_backend: '',
    runtime_type: '',
    model: '',
    vision_model: '',
    ordered_panel_descriptions: Array.from({length: 8}, () => ''),
    ordered_panel_text: Array.from({length: 8}, () => ''),
    option_a_story_analysis: '',
    option_b_story_analysis: '',
    final_answer: '',
    why_answer: '',
    confidence: null,
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    option_a_summary: '',
    option_b_summary: '',
    rating: '',
  }
}

function normalizeHumanTeacherAiAnnotationRating(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['good', 'bad', 'wrong'].includes(next) ? next : ''
}

function normalizeHumanTeacherDraftList(
  value,
  {maxItems = 8, maxLength = 280} = {}
) {
  let items = []

  if (Array.isArray(value)) {
    items = value
  } else if (value && typeof value === 'object') {
    items = Object.entries(value)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([_key, item]) => item)
  }

  const next = items
    .slice(0, maxItems)
    .map((item) => normalizeHumanTeacherDraftText(item, maxLength))

  while (next.length < maxItems) {
    next.push('')
  }

  return next
}

function hasHumanTeacherDraftListContent(value = []) {
  return Array.isArray(value) && value.some((item) => Boolean(item))
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

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  if (parsed <= 1) {
    return Math.min(5, Math.max(1, Math.round(parsed * 4 + 1)))
  }

  if (parsed > 5) {
    return null
  }

  return Math.round(parsed)
}

function normalizeHumanTeacherDraftCaptions(value) {
  const next = Array.isArray(value) ? value.slice(0, 4) : []

  while (next.length < 4) {
    next.push('')
  }

  return next.map((item) => normalizeHumanTeacherDraftText(item, 400))
}

function normalizeHumanTeacherDraftPanelIndex(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
    return null
  }

  return parsed
}

function normalizeHumanTeacherDraftPanelCoordinate(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizeHumanTeacherDraftPanelReferences(value) {
  let source = []

  if (Array.isArray(value)) {
    source = value
  } else if (value && typeof value === 'object') {
    source = ['A', 'B', 'C'].map((code) => {
      const raw =
        value[code] ||
        value[code.toLowerCase()] ||
        value[String(code || '').toUpperCase()] ||
        {}

      return typeof raw === 'string' ? {code, description: raw} : {code, ...raw}
    })
  }
  const byCode = new Map(
    source
      .map((entry, index) => {
        const code = String(entry?.code || ['A', 'B', 'C'][index] || '')
          .trim()
          .toUpperCase()

        return [code, entry]
      })
      .filter(([code]) => ['A', 'B', 'C'].includes(code))
  )

  return ['A', 'B', 'C'].map((code) => {
    const raw = byCode.get(code) || {}
    const panelIndex = normalizeHumanTeacherDraftPanelIndex(
      raw.panel_index ?? raw.panelIndex
    )

    return {
      code,
      description: normalizeHumanTeacherDraftText(raw.description, 160),
      panel_index: panelIndex,
      x:
        panelIndex === null
          ? null
          : normalizeHumanTeacherDraftPanelCoordinate(raw.x),
      y:
        panelIndex === null
          ? null
          : normalizeHumanTeacherDraftPanelCoordinate(raw.y),
    }
  })
}

function hasHumanTeacherAiAnnotation(annotation = null) {
  if (
    !annotation ||
    typeof annotation !== 'object' ||
    Array.isArray(annotation)
  ) {
    return false
  }

  return Boolean(
    annotation.generated_at ||
      annotation.runtime_backend ||
      annotation.runtime_type ||
      annotation.model ||
      annotation.vision_model ||
      hasHumanTeacherDraftListContent(annotation.ordered_panel_descriptions) ||
      hasHumanTeacherDraftListContent(annotation.ordered_panel_text) ||
      annotation.option_a_story_analysis ||
      annotation.option_b_story_analysis ||
      annotation.final_answer ||
      annotation.why_answer ||
      annotation.option_a_summary ||
      annotation.option_b_summary ||
      annotation.rating ||
      annotation.report_reason ||
      annotation.text_required !== null ||
      annotation.sequence_markers_present !== null ||
      annotation.report_required !== null ||
      annotation.confidence !== null
  )
}

function normalizeHumanTeacherAiAnnotation(value = null) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const finalAnswer = normalizeHumanTeacherDraftText(
    source.final_answer ?? source.finalAnswer,
    16
  ).toLowerCase()
  const next = {
    ...buildDefaultHumanTeacherAiAnnotation(),
    generated_at: normalizeHumanTeacherDraftText(
      source.generated_at ?? source.generatedAt,
      64
    ),
    runtime_backend: normalizeHumanTeacherDraftText(
      source.runtime_backend ?? source.runtimeBackend,
      64
    ),
    runtime_type: normalizeHumanTeacherDraftText(
      source.runtime_type ?? source.runtimeType,
      64
    ),
    model: normalizeHumanTeacherDraftText(source.model, 256),
    vision_model: normalizeHumanTeacherDraftText(
      source.vision_model || source.visionModel,
      256
    ),
    ordered_panel_descriptions: normalizeHumanTeacherDraftList(
      source.ordered_panel_descriptions ?? source.orderedPanelDescriptions,
      {
        maxItems: 8,
        maxLength: 280,
      }
    ),
    ordered_panel_text: normalizeHumanTeacherDraftList(
      source.ordered_panel_text ?? source.orderedPanelText,
      {
        maxItems: 8,
        maxLength: 200,
      }
    ),
    option_a_story_analysis: normalizeHumanTeacherDraftText(
      source.option_a_story_analysis ?? source.optionAStoryAnalysis,
      500
    ),
    option_b_story_analysis: normalizeHumanTeacherDraftText(
      source.option_b_story_analysis ?? source.optionBStoryAnalysis,
      500
    ),
    final_answer: ['left', 'right', 'skip'].includes(finalAnswer)
      ? finalAnswer
      : '',
    why_answer: normalizeHumanTeacherDraftText(
      source.why_answer || source.whyAnswer,
      900
    ),
    confidence: normalizeHumanTeacherDraftConfidence(source.confidence),
    text_required: normalizeHumanTeacherDraftBool(
      source.text_required ?? source.textRequired
    ),
    sequence_markers_present: normalizeHumanTeacherDraftBool(
      source.sequence_markers_present ?? source.sequenceMarkersPresent
    ),
    report_required: normalizeHumanTeacherDraftBool(
      source.report_required ?? source.reportRequired
    ),
    report_reason: normalizeHumanTeacherDraftText(
      source.report_reason ?? source.reportReason,
      400
    ),
    option_a_summary: normalizeHumanTeacherDraftText(
      source.option_a_summary ?? source.optionASummary,
      400
    ),
    option_b_summary: normalizeHumanTeacherDraftText(
      source.option_b_summary ?? source.optionBSummary,
      400
    ),
    rating: normalizeHumanTeacherAiAnnotationRating(source.rating),
  }

  return hasHumanTeacherAiAnnotation(next) ? next : null
}

function normalizeHumanTeacherAnnotationDraft(task = {}, annotation = {}) {
  const source =
    annotation && typeof annotation === 'object' && !Array.isArray(annotation)
      ? annotation
      : {}
  const finalAnswer = normalizeHumanTeacherDraftText(
    source.final_answer ?? source.finalAnswer,
    16
  ).toLowerCase()

  return {
    ...buildDefaultHumanTeacherAnnotationRow(task),
    annotator: normalizeHumanTeacherDraftText(source.annotator, 256),
    frame_captions: normalizeHumanTeacherDraftCaptions(
      source.frame_captions ?? source.frameCaptions
    ),
    option_a_summary: normalizeHumanTeacherDraftText(
      source.option_a_summary ?? source.optionASummary
    ),
    option_b_summary: normalizeHumanTeacherDraftText(
      source.option_b_summary ?? source.optionBSummary
    ),
    ai_annotation: normalizeHumanTeacherAiAnnotation(
      source.ai_annotation ?? source.aiAnnotation
    ),
    ai_annotation_feedback: normalizeHumanTeacherDraftText(
      source.ai_annotation_feedback ?? source.aiAnnotationFeedback,
      600
    ),
    panel_references: normalizeHumanTeacherDraftPanelReferences(
      source.panel_references ?? source.panelReferences
    ),
    text_required: normalizeHumanTeacherDraftBool(
      source.text_required ?? source.textRequired
    ),
    sequence_markers_present: normalizeHumanTeacherDraftBool(
      source.sequence_markers_present ?? source.sequenceMarkersPresent
    ),
    report_required: normalizeHumanTeacherDraftBool(
      source.report_required ?? source.reportRequired
    ),
    report_reason: normalizeHumanTeacherDraftText(
      source.report_reason ?? source.reportReason
    ),
    final_answer: ['left', 'right', 'skip'].includes(finalAnswer)
      ? finalAnswer
      : '',
    why_answer: normalizeHumanTeacherDraftText(
      source.why_answer ?? source.whyAnswer
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
      hasHumanTeacherAiAnnotation(next.ai_annotation) ||
      next.ai_annotation_feedback ||
      next.panel_references.some(
        (reference) => reference.description || reference.panel_index !== null
      ) ||
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
    next.final_answer &&
      next.why_answer &&
      next.confidence !== null &&
      (next.report_required !== true || next.report_reason)
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

async function ensureHumanTeacherDemoChunkWorkspace(
  storage,
  {
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    outputDir,
    batchSize = DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
    offset = 0,
    loadSample = loadHumanTeacherDemoSample,
    normalizeSampleName = normalizeDemoSampleName,
  } = {}
) {
  const nextSampleName = normalizeSampleName(sampleName)
  const nextOutputDir = String(outputDir || '').trim()

  if (!nextOutputDir) {
    throw new Error('outputDir is required')
  }

  const taskManifestPath = path.join(nextOutputDir, 'tasks.jsonl')
  const summary = (await storage.exists(taskManifestPath))
    ? {
        demo: true,
        developer: true,
        sampleName: nextSampleName,
        outputDir: nextOutputDir,
        manifestPath: taskManifestPath,
        templatePath: path.join(nextOutputDir, 'annotations.template.jsonl'),
        filledPath: path.join(nextOutputDir, 'annotations.filled.jsonl'),
        metadataPath: path.join(nextOutputDir, 'demo-metadata.json'),
      }
    : await buildHumanTeacherDemoWorkspace({
        outputDir: nextOutputDir,
        sampleName: nextSampleName,
        take: batchSize,
        offset,
        loadSample,
      })

  return {
    ...summary,
    taskManifestPath,
    annotationsPath: path.join(nextOutputDir, 'annotations.filled.jsonl'),
  }
}

async function buildWorkspaceFromOutputDir(outputDir, fallbackEpoch = null) {
  const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
  const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')
  const taskRows = await readJsonlRows(taskManifestPath, [])
  const annotationRows = await readJsonlRows(annotationsPath, [])
  const tasks = buildHumanTeacherWorkspaceTasks(
    taskRows,
    annotationRows,
    fallbackEpoch
  )

  return {
    outputDir,
    taskManifestPath,
    annotationsPath,
    taskRows,
    annotationRows,
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

function resolveOptionalConstrainedPath(baseDir, candidatePath, fallbackPath) {
  const rawCandidate = String(candidatePath || '').trim()

  if (!rawCandidate) {
    return String(fallbackPath || '').trim()
  }

  return resolveWorkspaceChildPath(baseDir, rawCandidate)
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
  developerTrainingRunner,
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
  const localAiDeveloperTrainingRunner =
    developerTrainingRunner || createDeveloperTrainingRunner({logger, isDev})
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

  function resolveInteractiveRuntimeTimeoutMs(value) {
    const parsed = Number.parseInt(value, 10)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_RUNTIME_START_TIMEOUT_MS
    }

    return Math.min(parsed, DEFAULT_RUNTIME_START_TIMEOUT_MS)
  }

  function normalizeSidecarHealthResult(rawHealth) {
    return rawHealth && typeof rawHealth === 'object'
      ? rawHealth
      : {
          ok: false,
          lastError: 'Local AI runtime health check returned no response.',
        }
  }

  function normalizeSidecarModelsResult(rawModels) {
    return rawModels && typeof rawModels === 'object'
      ? rawModels
      : {
          ok: false,
          models: [],
          total: 0,
          lastError: 'Local AI model listing returned no response.',
        }
  }

  function normalizeSidecarActionResult(rawResult, fallback) {
    return rawResult && typeof rawResult === 'object'
      ? rawResult
      : {
          ok: false,
          status: 'error',
          ...fallback,
        }
  }

  async function ensureInteractiveRuntimeReady(next) {
    if (next.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
      return null
    }

    const readinessPayload = {
      ...next,
      timeoutMs: resolveInteractiveRuntimeTimeoutMs(next.timeoutMs),
    }
    const refreshed = await refreshSidecarStatus(readinessPayload)

    if (refreshed.ok || next.allowRuntimeStart === false) {
      return refreshed
    }

    return start(readinessPayload)
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

  async function loadDeveloperHumanTeacherState(
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    totalAvailableTasks = 0
  ) {
    const nextSampleName = normalizeDeveloperHumanTeacherSampleName(sampleName)
    const statePath = developerHumanTeacherStatePath(
      localAiStorage,
      nextSampleName
    )
    const currentState = await localAiStorage.readJson(statePath, null)
    const normalizedState = normalizeDeveloperHumanTeacherState(currentState, {
      sampleName: nextSampleName,
      totalAvailableTasks,
    })
    const comparisonPath = developerHumanTeacherComparisonPath(
      localAiStorage,
      nextSampleName
    )
    let nextState = normalizedState

    if (await localAiStorage.exists(comparisonPath)) {
      const comparisonResult = await localAiStorage.readJson(
        comparisonPath,
        null
      )
      const snapshot = extractDeveloperComparisonSnapshot(comparisonResult, {
        resultPath: comparisonPath,
        holdoutPath:
          normalizedState.comparison100?.holdoutPath ||
          comparisonResult?.holdoutPath ||
          null,
      })
      const mergedComparison = snapshot
        ? mergeDeveloperComparisonSnapshot(
            normalizedState.comparison100,
            snapshot
          )
        : normalizeDeveloperComparisonState({
            ...normalizedState.comparison100,
            status:
              normalizeDeveloperComparisonStatus(
                normalizedState.comparison100?.status
              ) === 'not_loaded'
                ? 'result_available'
                : normalizedState.comparison100?.status,
            lastResultPath:
              normalizedState.comparison100?.lastResultPath || comparisonPath,
          })

      if (
        JSON.stringify(mergedComparison) !==
        JSON.stringify(normalizedState.comparison100)
      ) {
        nextState = {
          ...normalizedState,
          comparison100: mergedComparison,
        }
        await localAiStorage.writeJsonAtomic(statePath, nextState)
      }
    }

    return {
      statePath,
      state: nextState,
    }
  }

  async function loadDemoHumanTeacherState(
    sampleName = DEFAULT_DEMO_SAMPLE_NAME,
    totalAvailableTasks = 0
  ) {
    const nextSampleName = normalizeDemoSampleName(sampleName)
    const statePath = demoHumanTeacherStatePath(localAiStorage, nextSampleName)
    const currentState = await localAiStorage.readJson(statePath, null)
    const normalizedState = normalizeDemoHumanTeacherState(currentState, {
      sampleName: nextSampleName,
      totalAvailableTasks,
    })

    return {
      statePath,
      state: normalizedState,
    }
  }

  async function writeDemoHumanTeacherState(sampleName, nextState) {
    const nextSampleName = normalizeDemoSampleName(sampleName)
    const statePath = demoHumanTeacherStatePath(localAiStorage, nextSampleName)
    const normalizedState = normalizeDemoHumanTeacherState(nextState, {
      sampleName: nextSampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })

    await localAiStorage.writeJsonAtomic(statePath, normalizedState)

    return {
      statePath,
      state: normalizedState,
    }
  }

  function summarizeDemoHumanTeacherState(nextState, extra = {}) {
    const normalizedState = normalizeDemoHumanTeacherState(nextState, {
      sampleName: nextState?.sampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })

    return {
      ...normalizedState,
      annotatedCount: normalizedState.annotatedTaskIds.length,
      trainedChunkCount: normalizedState.trainedChunkOffsets.length,
      remainingTaskCount: Math.max(
        normalizedState.totalAvailableTasks -
          normalizedState.annotatedTaskIds.length,
        0
      ),
      ...extra,
    }
  }

  async function writeDeveloperHumanTeacherState(sampleName, nextState) {
    const nextSampleName = normalizeDeveloperHumanTeacherSampleName(sampleName)
    const statePath = developerHumanTeacherStatePath(
      localAiStorage,
      nextSampleName
    )
    const normalizedState = normalizeDeveloperHumanTeacherState(nextState, {
      sampleName: nextSampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })

    await localAiStorage.writeJsonAtomic(statePath, normalizedState)

    return {
      statePath,
      state: normalizedState,
    }
  }

  function summarizeDeveloperHumanTeacherState(nextState, extra = {}) {
    const normalizedState = normalizeDeveloperHumanTeacherState(nextState, {
      sampleName: nextState?.sampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })
    const supportsLocalTraining = Boolean(
      localAiDeveloperTrainingRunner &&
        typeof localAiDeveloperTrainingRunner.runEpoch === 'function'
    )

    return {
      ...normalizedState,
      supportsLocalTraining,
      localTrainingMode: supportsLocalTraining ? 'mlx-fallback' : 'unavailable',
      pendingTrainingCount: normalizedState.pendingTrainingTaskIds.length,
      annotatedCount: normalizedState.annotatedTaskIds.length,
      trainedCount: normalizedState.trainedTaskIds.length,
      remainingTaskCount: Math.max(
        normalizedState.totalAvailableTasks -
          normalizedState.annotatedTaskIds.length,
        0
      ),
      ...extra,
    }
  }

  function buildDeveloperExternalBundleId(
    createdAt = new Date().toISOString()
  ) {
    return `bundle-${String(createdAt)
      .trim()
      .replace(/[:.]/g, '-')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')}`
  }

  function buildDeveloperExternalTrainingBundleReadme({
    bundleId,
    createdAt,
    sampleName,
    annotatedCount,
    pendingCount,
    trainedCount,
    runtimeBackend,
    runtimeModel,
    runtimeVisionModel,
    developerPromptActive,
  }) {
    return [
      '# idena.vibe external training bundle',
      '',
      'This folder is the provider-neutral export for external GPU training.',
      'Upload only this folder to the machine or provider you want to use.',
      '',
      `Bundle id: ${bundleId}`,
      `Created at: ${createdAt}`,
      `Developer sample: ${sampleName}`,
      '',
      'What is inside:',
      '- annotations.normalized.jsonl: all annotated developer human-teacher rows currently saved on this desktop profile',
      '- annotations.pending.jsonl: rows that are annotated but not yet inside the active local model',
      '- annotations.trained.jsonl: rows that were already used by the local training path',
      '- training-bundle-manifest.json: machine-readable metadata for reproducible training and evaluation',
      '- README.md: this short guide',
      '',
      'Simple path for normal users:',
      '1. Rent one GPU computer from any managed jobs provider, GPU pod provider, or cloud VM.',
      '2. Upload this whole folder to that machine.',
      '3. Start with a benchmark-only smoke run before doing a longer training run.',
      `4. For serious training, use the recommended MLX base ${EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL}.`,
      `5. If that is too heavy, fall back to ${EXTERNAL_DEVELOPER_STRONG_FALLBACK_TRAINING_MODEL} or ${EXTERNAL_DEVELOPER_SAFE_FALLBACK_TRAINING_MODEL}.`,
      `6. After training, run the fixed held-out comparison on ${EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE} unseen flips and keep the result JSON plus the adapter artifact together.`,
      '7. Import only the result files you intend to trust back into idena.vibe later.',
      '',
      'Safety notes:',
      '- this bundle should contain training data only, not wallet secrets or your whole desktop profile',
      '- do not upload unrelated local folders',
      '- benchmark candidates on unseen flips and publish predictions, not only a final score',
      '',
      'Current local context:',
      `- runtime backend: ${runtimeBackend || 'unknown'}`,
      `- runtime text model: ${runtimeModel || 'unknown'}`,
      `- runtime vision model: ${runtimeVisionModel || 'unknown'}`,
      `- annotated rows exported: ${annotatedCount}`,
      `- pending rows exported: ${pendingCount}`,
      `- already trained rows exported: ${trainedCount}`,
      `- custom developer prompt active: ${
        developerPromptActive ? 'yes' : 'no'
      }`,
      '',
    ].join('\n')
  }

  async function loadDeveloperHumanTeacherChunkWorkspace({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
  } = {}) {
    const nextSampleName = normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(nextSampleName)
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      offset,
      sample.totalFlips
    )
    const outputDir = developerHumanTeacherChunkDir(
      localAiStorage,
      nextSampleName,
      effectiveOffset
    )

    const summary = await ensureHumanTeacherDemoChunkWorkspace(localAiStorage, {
      sampleName: nextSampleName,
      outputDir,
      batchSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      loadSample: loadDeveloperHumanTeacherSample,
      normalizeSampleName: normalizeDeveloperHumanTeacherSampleName,
    })
    const nextWorkspace = await buildWorkspaceFromOutputDir(outputDir, null)
    const {statePath, state: developerState} =
      await loadDeveloperHumanTeacherState(nextSampleName, sample.totalFlips)

    return {
      sample,
      outputDir,
      offset: effectiveOffset,
      statePath,
      state: developerState,
      summary: {
        ...summary,
        tasks: nextWorkspace.taskRows.length,
        totalFlips: sample.totalFlips,
        offset: effectiveOffset,
      },
      workspace: nextWorkspace.workspace,
      taskRows: nextWorkspace.taskRows,
      annotationsPath: nextWorkspace.annotationsPath,
      taskManifestPath: nextWorkspace.taskManifestPath,
    }
  }

  async function loadDemoHumanTeacherChunkWorkspace({
    sampleName = DEFAULT_DEMO_SAMPLE_NAME,
    offset = 0,
  } = {}) {
    const nextSampleName = normalizeDemoSampleName(sampleName)
    const sample = await loadHumanTeacherDemoSample(nextSampleName)
    const effectiveOffset = clampDemoHumanTeacherOffset(
      offset,
      sample.totalFlips
    )
    const outputDir = demoHumanTeacherChunkDir(
      localAiStorage,
      nextSampleName,
      effectiveOffset
    )

    const summary = await ensureHumanTeacherDemoChunkWorkspace(localAiStorage, {
      sampleName: nextSampleName,
      outputDir,
      batchSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      loadSample: loadHumanTeacherDemoSample,
      normalizeSampleName: normalizeDemoSampleName,
    })
    const nextWorkspace = await buildWorkspaceFromOutputDir(outputDir, null)
    const {statePath, state: demoState} = await loadDemoHumanTeacherState(
      nextSampleName,
      sample.totalFlips
    )

    return {
      sample,
      outputDir,
      offset: effectiveOffset,
      statePath,
      state: demoState,
      summary: {
        ...summary,
        demo: true,
        developer: false,
        tasks: nextWorkspace.taskRows.length,
        totalFlips: sample.totalFlips,
        offset: effectiveOffset,
      },
      workspace: nextWorkspace.workspace,
      taskRows: nextWorkspace.taskRows,
      annotationsPath: nextWorkspace.annotationsPath,
      taskManifestPath: nextWorkspace.taskManifestPath,
    }
  }

  async function loadDeveloperHumanTeacherTaskFromChunk({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
    taskId,
  } = {}) {
    const taskDetailId = String(taskId || '').trim()

    if (!taskDetailId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName,
      offset,
    })
    const taskRow = chunk.taskRows.find(
      (row) =>
        String(row && row.task_id ? row.task_id : '').trim() === taskDetailId
    )

    if (!taskRow) {
      throw new Error('Human teacher developer task is unavailable')
    }

    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
    const annotationRow = annotationRows.find(
      (row) =>
        String(row && row.task_id ? row.task_id : '').trim() === taskDetailId
    )
    const panels = await Promise.all(
      (Array.isArray(taskRow.panels) ? taskRow.panels : []).map(
        async (panelRelativePath, index) => {
          const panelPath = resolveWorkspaceChildPath(
            chunk.outputDir,
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
      developer: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      task: {
        taskId: taskDetailId,
        sampleId: taskRow.sample_id || taskDetailId,
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

  async function saveDeveloperHumanTeacherDraftToChunk({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
    taskId,
    annotation,
  } = {}) {
    const nextTaskId = String(taskId || '').trim()

    if (!nextTaskId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName,
      offset,
    })
    const taskRow = chunk.taskRows.find(
      (row) =>
        String(row && row.task_id ? row.task_id : '').trim() === nextTaskId
    )

    if (!taskRow) {
      throw new Error('Human teacher developer task is unavailable')
    }

    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
    const nextAnnotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      annotation
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(nextAnnotation)
    const nextAnnotationRows = annotationRows
      .filter(
        (row) =>
          String(row && row.task_id ? row.task_id : '').trim() !== nextTaskId
      )
      .concat(nextAnnotation)

    await writeJsonlRows(chunk.annotationsPath, nextAnnotationRows)

    return {
      demo: true,
      developer: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      task: {
        taskId: nextTaskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath: chunk.annotationsPath,
      },
    }
  }

  async function commitDeveloperHumanTeacherChunk({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
    trainNow = false,
    advance = false,
    trainingModelPath = null,
    localTrainingProfile = null,
  } = {}) {
    const chunk = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName,
      offset,
    })

    if (
      Number(chunk.workspace.taskCount) > 0 &&
      Number(chunk.workspace.completedCount) < Number(chunk.workspace.taskCount)
    ) {
      throw new Error(
        'Complete all 5 developer training flips before committing this chunk'
      )
    }

    const normalizedPath = path.join(
      chunk.outputDir,
      'annotations.normalized.jsonl'
    )
    const summaryPath = path.join(
      chunk.outputDir,
      'annotations.import-summary.json'
    )
    const importSummary = await importHumanTeacherAnnotations({
      taskManifestPath: chunk.taskManifestPath,
      annotationsJsonlPath: chunk.annotationsPath,
      outputJsonlPath: normalizedPath,
      summaryPath,
    })
    const annotatedPath = developerHumanTeacherAnnotatedPath(
      localAiStorage,
      chunk.sample.sampleName
    )
    const pendingPath = developerHumanTeacherPendingPath(
      localAiStorage,
      chunk.sample.sampleName
    )
    const trainedPath = developerHumanTeacherTrainedPath(
      localAiStorage,
      chunk.sample.sampleName
    )
    const existingAnnotatedRows = await readJsonlRows(annotatedPath, [])
    let pendingRows = await readJsonlRows(pendingPath, [])
    let trainedRows = await readJsonlRows(trainedPath, [])
    const committedAt = new Date().toISOString()
    const existingState = chunk.state
    const normalizedRows = Array.isArray(importSummary.rows)
      ? importSummary.rows
      : []
    const normalizedSummary = summarizeDeveloperChunkRows(normalizedRows)

    const nextAnnotatedRows = mergeJsonlRowsByTaskId(
      existingAnnotatedRows,
      normalizedRows
    )
    pendingRows = mergeJsonlRowsByTaskId(pendingRows, normalizedRows)

    await writeJsonlRows(annotatedPath, nextAnnotatedRows)
    await writeJsonlRows(pendingPath, pendingRows)

    let trainingResult = null
    let trainingStatus = 'pending'
    let trainedTaskIds = uniqueStrings(existingState.trainedTaskIds)
    let pendingTaskIds = uniqueStrings(
      mergeJsonlRowsByTaskId([], pendingRows).map((row) => row && row.task_id)
    )
    let nextComparison = normalizeDeveloperComparisonState(
      existingState.comparison100
    )

    if (trainNow) {
      const comparisonPath = developerHumanTeacherComparisonPath(
        localAiStorage,
        chunk.sample.sampleName
      )
      trainingResult = await trainEpoch({
        input: {
          developerHumanTeacher: true,
          sampleName: chunk.sample.sampleName,
          trainingModelPath:
            String(trainingModelPath || '').trim() || undefined,
          localTrainingProfile:
            String(localTrainingProfile || '').trim() || undefined,
          offset: chunk.offset,
          chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
          normalizedAnnotationsPath: normalizedPath,
          pendingAnnotationsPath: pendingPath,
          annotatedAnnotationsPath: annotatedPath,
          trainedAnnotationsPath: trainedPath,
          developerStatePath: chunk.statePath,
          comparisonPath,
        },
      })

      if (trainingResult && trainingResult.ok) {
        trainedRows = mergeJsonlRowsByTaskId(trainedRows, pendingRows)
        await writeJsonlRows(trainedPath, trainedRows)
        pendingRows = []
        await writeJsonlRows(pendingPath, pendingRows)
        trainedTaskIds = uniqueStrings(
          trainedRows.map((row) => row && row.task_id)
        )
        pendingTaskIds = []
        trainingStatus = 'trained'
        nextComparison = mergeDeveloperComparisonSnapshot(
          nextComparison,
          extractDeveloperComparisonSnapshot(trainingResult, {
            resultPath: comparisonPath,
          }),
          'trained'
        )
      } else {
        trainingStatus = 'failed'
      }

      if (await localAiStorage.exists(comparisonPath)) {
        const comparisonResult = await localAiStorage.readJson(
          comparisonPath,
          null
        )
        nextComparison = mergeDeveloperComparisonSnapshot(
          nextComparison,
          extractDeveloperComparisonSnapshot(comparisonResult, {
            resultPath: comparisonPath,
            holdoutPath:
              nextComparison.holdoutPath ||
              comparisonResult?.holdoutPath ||
              null,
          }),
          trainingResult && trainingResult.ok ? 'evaluated' : 'result_available'
        )
      } else if (trainingResult && trainingResult.ok) {
        nextComparison = normalizeDeveloperComparisonState({
          ...nextComparison,
          status: 'trained_pending_evaluation',
          lastResultPath: nextComparison.lastResultPath || comparisonPath,
        })
      }
    }

    const nextOffset = advance
      ? clampDeveloperHumanTeacherOffset(
          chunk.offset + DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
          chunk.sample.totalFlips
        )
      : chunk.offset
    const chunkEntries = Array.isArray(existingState.chunks)
      ? existingState.chunks.filter((entry) => entry.offset !== chunk.offset)
      : []
    chunkEntries.push({
      offset: chunk.offset,
      taskIds: normalizedSummary.taskIds,
      rowCount: normalizedSummary.rowCount,
      committedAt,
      trainedAt: trainingStatus === 'trained' ? new Date().toISOString() : null,
      trainingStatus,
      normalizedPath,
      summaryPath,
    })

    const nextState = {
      ...existingState,
      currentOffset: nextOffset,
      annotatedTaskIds: uniqueStrings(
        nextAnnotatedRows.map((row) => row && row.task_id)
      ),
      pendingTrainingTaskIds: pendingTaskIds,
      trainedTaskIds,
      activeTrainingModelPath:
        trainingStatus === 'trained'
          ? String(trainingResult?.modelPath || '').trim() || null
          : existingState.activeTrainingModelPath || null,
      activeTrainingBackend:
        trainingStatus === 'trained'
          ? String(trainingResult?.trainingBackend || '').trim() || null
          : existingState.activeTrainingBackend || null,
      activeLocalTrainingProfile:
        trainingStatus === 'trained'
          ? String(trainingResult?.localTrainingProfile || '').trim() || null
          : existingState.activeLocalTrainingProfile || null,
      chunks: chunkEntries,
      lastSavedAt: committedAt,
      comparison100: nextComparison,
      lastTraining: trainNow
        ? {
            at: new Date().toISOString(),
            status: trainingStatus,
            offset: chunk.offset,
            rowCount: normalizedSummary.rowCount,
            failureReason:
              trainingStatus === 'failed'
                ? extractDeveloperTrainingFailureReason(trainingResult)
                : null,
            result:
              trainingResult &&
              typeof trainingResult === 'object' &&
              !Array.isArray(trainingResult)
                ? trainingResult
                : null,
          }
        : existingState.lastTraining,
    }
    const persistedState = await writeDeveloperHumanTeacherState(
      chunk.sample.sampleName,
      {
        ...nextState,
        totalAvailableTasks: chunk.sample.totalFlips,
      }
    )

    return {
      demo: true,
      developer: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      nextOffset,
      taskCount: normalizedSummary.rowCount,
      import: {
        normalizedPath,
        summaryPath,
        annotationsPath: chunk.annotationsPath,
        normalizedRows: Number(importSummary.normalizedRows) || 0,
        missingAnnotations: Number(importSummary.missingAnnotations) || 0,
        unmatchedAnnotations: Number(importSummary.unmatchedAnnotations) || 0,
        invalidAnnotations: Number(importSummary.invalidAnnotations) || 0,
      },
      training: trainingResult,
      statePath: persistedState.statePath,
      state: summarizeDeveloperHumanTeacherState(persistedState.state),
    }
  }

  async function refreshSidecarStatus(payload = {}) {
    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const rawHealth = await localAiSidecar.getHealth({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      timeoutMs: next.timeoutMs,
    })
    const health = normalizeSidecarHealthResult(rawHealth)
    let models = normalizeSidecarModelsResult(null)
    models.lastError = null

    if (health.ok) {
      const rawModels = await localAiSidecar.listModels({
        baseUrl: state.baseUrl,
        runtimeBackend: next.runtimeBackend,
        runtimeType: next.runtimeType,
        timeoutMs: next.timeoutMs,
      })
      models = normalizeSidecarModelsResult(rawModels)
    }

    updateSidecarState({
      reachable: Boolean(health.ok),
      models: models.ok ? models.models : [],
      checkedAt: new Date().toISOString(),
      lastError: health.ok ? models.lastError : health.lastError,
    })

    return {
      ok: Boolean(health.ok),
      status:
        String(health.status || (health.ok ? 'ok' : 'error')).trim() ||
        (health.ok ? 'ok' : 'error'),
      error: health.ok ? models.error || null : health.error || null,
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
      initialStatus.status === 'config_error' ||
      next.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    ) {
      state.runtimeManaged = false
      state.running = Boolean(initialStatus.ok)
      return {
        ...initialStatus,
        ...currentStatus(),
      }
    }

    try {
      const runtimeStart = await localAiRuntimeController.start(next)
      state.runtimeManaged = Boolean(runtimeStart && runtimeStart.managed)

      const readyStatus = await waitForRuntimeReady(next)
      state.running = Boolean(
        readyStatus.ok || (runtimeStart && runtimeStart.started)
      )

      if (!readyStatus.ok && runtimeStart && runtimeStart.started) {
        return {
          ...readyStatus,
          ...currentStatus(),
          error: readyStatus.error || 'runtime_start_timeout',
          lastError:
            readyStatus.lastError ||
            'Ollama was started but is not responding yet.',
        }
      }

      return {
        ...readyStatus,
        ...currentStatus(),
      }
    } catch (error) {
      state.running = false
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

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        models: [],
        total: 0,
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.listModels({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      timeoutMs: next.timeoutMs,
    })
    const result = normalizeSidecarModelsResult(rawResult)

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

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        status: 'error',
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        content: null,
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.chat({
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
      modelFallbacks: next.modelFallbacks,
      visionModelFallbacks: next.visionModelFallbacks,
    })
    const result = normalizeSidecarActionResult(rawResult, {
      error: 'chat_unavailable',
      lastError: 'Local AI chat returned no response.',
      content: null,
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

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        status: 'error',
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        text: null,
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.flipToText({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
      timeoutMs: next.timeoutMs,
    })
    const result = normalizeSidecarActionResult(rawResult, {
      error: 'flip_to_text_unavailable',
      lastError: 'Local AI flip text returned no response.',
      text: null,
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

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        status: 'error',
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        classification: null,
        confidence: null,
        reason: null,
        sequenceText: null,
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.checkFlipSequence({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
      timeoutMs: next.timeoutMs,
    })
    const result = normalizeSidecarActionResult(rawResult, {
      error: 'flip_check_unavailable',
      lastError: 'Local AI flip checker returned no response.',
      classification: null,
      confidence: null,
      reason: null,
      sequenceText: null,
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
    const developerHumanTeacher = isDeveloperHumanTeacherTrainingRequest(next)

    applyRuntimeState(next)

    let result = await localAiSidecar.trainEpoch({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    if (
      developerHumanTeacher &&
      result &&
      result.ok !== true &&
      result.status === 'not_implemented' &&
      localAiDeveloperTrainingRunner &&
      typeof localAiDeveloperTrainingRunner.runEpoch === 'function'
    ) {
      result = await localAiDeveloperTrainingRunner.runEpoch({
        ...next,
        baseUrl: state.baseUrl,
      })

      updateSidecarState({
        reachable: state.sidecarReachable,
        checkedAt: new Date().toISOString(),
        lastError:
          result && result.ok === true
            ? null
            : extractDeveloperTrainingFailureReason(result),
      })
    }

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
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {statePath, state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const session = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })

    return {
      demo: true,
      sampleName: sample.sampleName,
      samples: listHumanTeacherDemoSamples(),
      chunkSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      outputDir: session.outputDir,
      statePath,
      state: summarizeDemoHumanTeacherState(demoState, {
        currentOffset: effectiveOffset,
      }),
      summary: session.summary,
      workspace: session.workspace,
    }
  }

  async function loadHumanTeacherDeveloperSession(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'session start'
    )
    const sampleName = normalizeDemoSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const normalizedSampleName =
      normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(normalizedSampleName)
    const {statePath, state: developerState} =
      await loadDeveloperHumanTeacherState(sample.sampleName, sample.totalFlips)
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )
    const session = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })

    return {
      demo: true,
      developer: true,
      sampleName: sample.sampleName,
      samples: listDeveloperHumanTeacherSamples(),
      chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      outputDir: session.outputDir,
      statePath,
      state: summarizeDeveloperHumanTeacherState(developerState, {
        currentOffset: effectiveOffset,
      }),
      summary: session.summary,
      workspace: session.workspace,
      comparison100: {
        status: String(
          developerState.comparison100?.status || 'not_loaded'
        ).trim(),
        holdoutPath: developerState.comparison100?.holdoutPath || null,
        lastEvaluatedAt: developerState.comparison100?.lastEvaluatedAt || null,
        lastResultPath: developerState.comparison100?.lastResultPath || null,
        accuracy: developerState.comparison100?.accuracy ?? null,
        correct: developerState.comparison100?.correct ?? null,
        totalFlips: developerState.comparison100?.totalFlips ?? null,
        bestAccuracy: developerState.comparison100?.bestAccuracy ?? null,
        history: Array.isArray(developerState.comparison100?.history)
          ? developerState.comparison100.history
          : [],
        expectedPath: developerHumanTeacherComparisonPath(
          localAiStorage,
          sample.sampleName
        ),
      },
    }
  }

  async function exportHumanTeacherDeveloperBundle(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const annotatedSourcePath = developerHumanTeacherAnnotatedPath(
      localAiStorage,
      sample.sampleName
    )
    const pendingSourcePath = developerHumanTeacherPendingPath(
      localAiStorage,
      sample.sampleName
    )
    const trainedSourcePath = developerHumanTeacherTrainedPath(
      localAiStorage,
      sample.sampleName
    )
    const annotatedRows = await readJsonlRows(annotatedSourcePath, [])
    const pendingRows = await readJsonlRows(pendingSourcePath, [])
    const trainedRows = await readJsonlRows(trainedSourcePath, [])

    if (!annotatedRows.length) {
      throw new Error(
        'Annotate at least one completed developer flip before exporting an external training bundle'
      )
    }

    const createdAt = new Date().toISOString()
    const bundleId = buildDeveloperExternalBundleId(createdAt)
    const outputDir = developerHumanTeacherExternalBundleDir(
      localAiStorage,
      sample.sampleName,
      bundleId
    )
    const annotationsPath = path.join(outputDir, 'annotations.normalized.jsonl')
    const pendingPath = path.join(outputDir, 'annotations.pending.jsonl')
    const trainedPath = path.join(outputDir, 'annotations.trained.jsonl')
    const bundleManifestPath = path.join(
      outputDir,
      'training-bundle-manifest.json'
    )
    const readmePath = path.join(outputDir, 'README.md')
    const developerPrompt = String(
      next.developerHumanTeacherSystemPrompt || ''
    ).trim()

    await localAiStorage.ensureDir(outputDir)
    await writeJsonlRows(annotationsPath, annotatedRows)
    await writeJsonlRows(pendingPath, pendingRows)
    await writeJsonlRows(trainedPath, trainedRows)

    const annotationSha256 = await localAiStorage.sha256File(annotationsPath)
    const pendingSha256 = await localAiStorage.sha256File(pendingPath)
    const trainedSha256 = await localAiStorage.sha256File(trainedPath)
    const manifest = {
      version: EXTERNAL_DEVELOPER_TRAINING_BUNDLE_VERSION,
      bundleType: 'idenaai-human-teacher-external-training',
      bundleId,
      createdAt,
      developerSession: {
        sampleName: sample.sampleName,
        sampleLabel: sample.label,
        totalAvailableTasks: sample.totalFlips,
        chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
        annotatedTaskIds: developerState.annotatedTaskIds,
        pendingTrainingTaskIds: developerState.pendingTrainingTaskIds,
        trainedTaskIds: developerState.trainedTaskIds,
      },
      runtime: {
        runtimeBackend: String(next.runtimeBackend || '').trim() || null,
        runtimeType: String(next.runtimeType || '').trim() || null,
        baseUrl: String(next.baseUrl || '').trim() || null,
        model: String(next.model || '').trim() || null,
        visionModel: String(next.visionModel || '').trim() || null,
      },
      training: {
        recommendedModel: EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL,
        strongerFallbackModel:
          EXTERNAL_DEVELOPER_STRONG_FALLBACK_TRAINING_MODEL,
        safeFallbackModel: EXTERNAL_DEVELOPER_SAFE_FALLBACK_TRAINING_MODEL,
        humanTeacherSystemPrompt: developerPrompt || null,
      },
      benchmark: {
        recommendedHoldoutFlips: EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE,
        policy:
          'benchmark on unseen flips and publish per-flip predictions, not only a final score',
      },
      files: {
        annotations: {
          path: annotationsPath,
          rowCount: annotatedRows.length,
          sha256: annotationSha256,
        },
        pending: {
          path: pendingPath,
          rowCount: pendingRows.length,
          sha256: pendingSha256,
        },
        trained: {
          path: trainedPath,
          rowCount: trainedRows.length,
          sha256: trainedSha256,
        },
      },
    }

    await localAiStorage.writeJsonAtomic(bundleManifestPath, manifest)
    await localAiStorage.writeBuffer(
      readmePath,
      Buffer.from(
        buildDeveloperExternalTrainingBundleReadme({
          bundleId,
          createdAt,
          sampleName: sample.sampleName,
          annotatedCount: annotatedRows.length,
          pendingCount: pendingRows.length,
          trainedCount: trainedRows.length,
          runtimeBackend: manifest.runtime.runtimeBackend,
          runtimeModel: manifest.runtime.model,
          runtimeVisionModel: manifest.runtime.visionModel,
          developerPromptActive: Boolean(developerPrompt),
        }),
        'utf8'
      )
    )

    return {
      developer: true,
      bundleId,
      outputDir,
      manifestPath: bundleManifestPath,
      readmePath,
      annotationsPath,
      pendingPath,
      trainedPath,
      sampleName: sample.sampleName,
      annotatedCount: annotatedRows.length,
      pendingCount: pendingRows.length,
      trainedCount: trainedRows.length,
      recommendedTrainingModel: EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL,
      strongerFallbackTrainingModel:
        EXTERNAL_DEVELOPER_STRONG_FALLBACK_TRAINING_MODEL,
      safeFallbackTrainingModel:
        EXTERNAL_DEVELOPER_SAFE_FALLBACK_TRAINING_MODEL,
      recommendedBenchmarkFlips: EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE,
      supportsLocalTraining:
        summarizeDeveloperHumanTeacherState(developerState)
          .supportsLocalTraining,
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
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const taskId = String(next.taskId || '').trim()

    if (!taskId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })
    const taskRows = await readJsonlRows(chunk.taskManifestPath, [])
    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
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
            chunk.outputDir,
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
      sampleName: sample.sampleName,
      offset: effectiveOffset,
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

  async function loadHumanTeacherDeveloperTask(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(next.currentPeriod, 'task open')
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return loadDeveloperHumanTeacherTaskFromChunk({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      taskId: next.taskId,
    })
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
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const taskId = String(next.taskId || '').trim()

    if (!taskId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })
    const taskRows = await readJsonlRows(chunk.taskManifestPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher demo task is unavailable')
    }

    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
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

    await writeJsonlRows(chunk.annotationsPath, nextAnnotationRows)
    await writeDemoHumanTeacherState(sample.sampleName, {
      ...demoState,
      totalAvailableTasks: sample.totalFlips,
      currentOffset: effectiveOffset,
      lastSavedAt: new Date().toISOString(),
    })

    return {
      demo: true,
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      task: {
        taskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath: chunk.annotationsPath,
      },
    }
  }

  async function finalizeHumanTeacherDemoChunk(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    if (next.trainNow === true && next.advance === true) {
      throw new Error(
        'Demo chunk finalization must choose either training now or advancing to the next chunk, not both'
      )
    }

    const sampleName = normalizeDemoSampleName(next.sampleName)
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const chunk = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })
    const taskCount = Number(chunk.workspace.taskCount) || 0

    if (taskCount <= 0) {
      throw new Error('Demo chunk is unavailable')
    }

    if (Number(chunk.workspace.completedCount) < taskCount) {
      throw new Error('Complete all 5 demo flips before finishing this chunk')
    }

    const chunkTaskIds = uniqueStrings(
      chunk.taskRows.map((row) => row && row.task_id)
    )
    const committedAt = new Date().toISOString()
    const shouldAdvance = next.advance === true || next.trainNow === true
    const nextOffset = shouldAdvance
      ? clampDemoHumanTeacherOffset(
          chunk.offset + DEMO_HUMAN_TEACHER_BATCH_SIZE,
          chunk.sample.totalFlips
        )
      : chunk.offset
    const chunkEntries = Array.isArray(demoState.chunks)
      ? demoState.chunks.filter((entry) => entry.offset !== chunk.offset)
      : []
    chunkEntries.push({
      offset: chunk.offset,
      taskIds: chunkTaskIds,
      rowCount: chunkTaskIds.length,
      committedAt,
      trainedAt: next.trainNow === true ? committedAt : null,
      trainingStatus: next.trainNow === true ? 'demo_trained' : 'saved',
    })

    const persistedState = await writeDemoHumanTeacherState(
      chunk.sample.sampleName,
      {
        ...demoState,
        totalAvailableTasks: chunk.sample.totalFlips,
        currentOffset: nextOffset,
        annotatedTaskIds: uniqueStrings([
          ...demoState.annotatedTaskIds,
          ...chunkTaskIds,
        ]),
        trainedChunkOffsets:
          next.trainNow === true
            ? uniqueNumbers([...demoState.trainedChunkOffsets, chunk.offset])
            : uniqueNumbers(demoState.trainedChunkOffsets),
        chunks: chunkEntries,
        lastSavedAt: committedAt,
        lastTraining:
          next.trainNow === true
            ? {
                at: committedAt,
                status: 'demo_trained',
                offset: chunk.offset,
                rowCount: chunkTaskIds.length,
              }
            : demoState.lastTraining,
      }
    )

    return {
      demo: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      nextOffset,
      taskCount: chunkTaskIds.length,
      training:
        next.trainNow === true
          ? {
              ok: true,
              status: 'demo_simulated',
              simulated: true,
            }
          : null,
      statePath: persistedState.statePath,
      state: summarizeDemoHumanTeacherState(persistedState.state),
    }
  }

  async function saveHumanTeacherDeveloperDraft(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return saveDeveloperHumanTeacherDraftToChunk({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      taskId: next.taskId,
      annotation: next.annotation,
    })
  }

  async function finalizeHumanTeacherDeveloperChunk(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'training commit'
    )
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return commitDeveloperHumanTeacherChunk({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      trainNow: next.trainNow === true,
      advance: next.advance === true,
      trainingModelPath:
        String(next.trainingModelPath || next.modelPath || '').trim() || null,
      localTrainingProfile:
        String(next.localTrainingProfile || '')
          .trim()
          .toLowerCase() || null,
    })
  }

  async function runHumanTeacherDeveloperComparison(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'comparison run'
    )
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {statePath, state: existingState} =
      await loadDeveloperHumanTeacherState(sample.sampleName, sample.totalFlips)

    if (
      existingState.trainedTaskIds.length === 0 &&
      existingState.pendingTrainingTaskIds.length === 0
    ) {
      throw new Error(
        'Annotate and train at least one 5-flip chunk before running the 100-flip comparison'
      )
    }

    const annotatedPath = developerHumanTeacherAnnotatedPath(
      localAiStorage,
      sample.sampleName
    )
    const pendingPath = developerHumanTeacherPendingPath(
      localAiStorage,
      sample.sampleName
    )
    const trainedPath = developerHumanTeacherTrainedPath(
      localAiStorage,
      sample.sampleName
    )
    const comparisonPath = developerHumanTeacherComparisonPath(
      localAiStorage,
      sample.sampleName
    )

    const runningState = await writeDeveloperHumanTeacherState(
      sample.sampleName,
      {
        ...existingState,
        totalAvailableTasks: sample.totalFlips,
        comparison100: normalizeDeveloperComparisonState({
          ...existingState.comparison100,
          status: 'running',
          lastResultPath:
            existingState.comparison100?.lastResultPath || comparisonPath,
        }),
      }
    )

    const comparisonResult = await trainEpoch({
      input: {
        developerHumanTeacher: true,
        sampleName: sample.sampleName,
        comparisonOnly: true,
        compareOnly: true,
        evaluationFlips: 100,
        annotatedAnnotationsPath: annotatedPath,
        pendingAnnotationsPath: pendingPath,
        trainedAnnotationsPath: trainedPath,
        developerStatePath: statePath,
        comparisonPath,
      },
    })

    let nextComparison = normalizeDeveloperComparisonState(
      runningState.state.comparison100
    )

    if (await localAiStorage.exists(comparisonPath)) {
      const persistedComparison = await localAiStorage.readJson(
        comparisonPath,
        null
      )
      nextComparison = mergeDeveloperComparisonSnapshot(
        nextComparison,
        extractDeveloperComparisonSnapshot(persistedComparison, {
          resultPath: comparisonPath,
          holdoutPath:
            nextComparison.holdoutPath ||
            persistedComparison?.holdoutPath ||
            null,
        }),
        comparisonResult && comparisonResult.ok
          ? 'evaluated'
          : 'result_available'
      )
    } else if (comparisonResult && comparisonResult.ok) {
      nextComparison = mergeDeveloperComparisonSnapshot(
        nextComparison,
        extractDeveloperComparisonSnapshot(comparisonResult, {
          resultPath: comparisonPath,
        }),
        'evaluated'
      )
    } else {
      nextComparison = normalizeDeveloperComparisonState({
        ...nextComparison,
        status: 'failed',
        lastResultPath: nextComparison.lastResultPath || comparisonPath,
      })
    }

    const persistedState = await writeDeveloperHumanTeacherState(
      sample.sampleName,
      {
        ...existingState,
        totalAvailableTasks: sample.totalFlips,
        activeTrainingModelPath:
          comparisonResult?.ok === true
            ? String(
                comparisonResult?.modelPath ||
                  existingState.activeTrainingModelPath ||
                  ''
              ).trim() || null
            : existingState.activeTrainingModelPath || null,
        activeTrainingBackend:
          comparisonResult?.ok === true
            ? String(
                comparisonResult?.trainingBackend ||
                  existingState.activeTrainingBackend ||
                  ''
              ).trim() || null
            : existingState.activeTrainingBackend || null,
        activeLocalTrainingProfile:
          comparisonResult?.ok === true
            ? String(
                comparisonResult?.localTrainingProfile ||
                  existingState.activeLocalTrainingProfile ||
                  ''
              ).trim() || null
            : existingState.activeLocalTrainingProfile || null,
        comparison100: nextComparison,
      }
    )

    return {
      developer: true,
      sampleName: sample.sampleName,
      comparison100: {
        expectedPath: comparisonPath,
      },
      statePath: persistedState.statePath,
      state: summarizeDeveloperHumanTeacherState(persistedState.state),
      comparison: comparisonResult,
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
    const defaultAnnotationsPath = path.join(
      outputDir,
      'annotations.filled.jsonl'
    )
    const defaultNormalizedPath = humanTeacherNormalizedAnnotationsPath(
      localAiStorage,
      epoch
    )
    const defaultSummaryPath = humanTeacherImportSummaryPath(
      localAiStorage,
      epoch
    )
    const annotationsPath = resolveOptionalConstrainedPath(
      outputDir,
      next.annotationsPath,
      defaultAnnotationsPath
    )
    const normalizedPath = resolveOptionalConstrainedPath(
      path.dirname(defaultNormalizedPath),
      next.outputJsonlPath,
      defaultNormalizedPath
    )
    const summaryPath = resolveOptionalConstrainedPath(
      path.dirname(defaultSummaryPath),
      next.summaryPath,
      defaultSummaryPath
    )

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
    loadHumanTeacherDeveloperSession,
    loadHumanTeacherDeveloperTask,
    exportHumanTeacherDeveloperBundle,
    updateTrainingCandidatePackageReview,
    updateHumanTeacherPackageReview,
    exportHumanTeacherTasks: exportHumanTeacherTasksWorkspace,
    saveHumanTeacherAnnotationDraft,
    saveHumanTeacherDemoDraft,
    saveHumanTeacherDeveloperDraft,
    finalizeHumanTeacherDemoChunk,
    finalizeHumanTeacherDeveloperChunk,
    runHumanTeacherDeveloperComparison,
    importHumanTeacherAnnotations: importHumanTeacherAnnotationsWorkspace,
  }
}

module.exports = {
  createLocalAiManager,
  defaultCaptureIndex,
}
