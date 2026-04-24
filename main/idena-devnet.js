/* eslint-disable no-console */
const path = require('path')
const os = require('os')
const net = require('net')
const fs = require('fs-extra')
const {spawn} = require('child_process')
const {randomBytes} = require('crypto')
const {encode: rlpEncode} = require('rlp')
const axios = require('axios')
const kill = require('tree-kill')
const {privateKeyToAddress} = require('idena-sdk-js')
const appDataPath = require('./app-data-path')
const {
  getNodeFile,
  getCurrentVersion,
  downloadNode,
  updateNode,
} = require('./idena-node')

const VALIDATION_DEVNET_NODE_COUNT = 9
const VALIDATION_DEVNET_MAX_LOG_LINES = 400
const VALIDATION_DEVNET_RPC_BASE_PORT = 22300
const VALIDATION_DEVNET_TCP_BASE_PORT = 22400
const VALIDATION_DEVNET_IPFS_BASE_PORT = 22500
const VALIDATION_DEVNET_LOOPBACK_HOST = '127.0.0.1'
const VALIDATION_DEVNET_DEFAULT_FLIPS_PER_IDENTITY = 3
const VALIDATION_DEVNET_LONG_SESSION_TESTERS = 10
const VALIDATION_DEVNET_DEFAULT_FLIP_LOTTERY_SECONDS = 5 * 60
const VALIDATION_DEVNET_DEFAULT_SHORT_SESSION_SECONDS = 2 * 60
const VALIDATION_DEVNET_DEFAULT_AFTER_LONG_SESSION_SECONDS = 60
const VALIDATION_DEVNET_DEFAULT_VALIDATION_PADDING_SECONDS = 5 * 60
const VALIDATION_DEVNET_DEFAULT_LEAD_SECONDS = 8 * 60
const VALIDATION_DEVNET_MIN_LEAD_SECONDS = 20
const VALIDATION_DEVNET_DEFAULT_NETWORK_BASE = 33000
const VALIDATION_DEVNET_DEFAULT_INITIAL_EPOCH = 1
const VALIDATION_DEVNET_MAX_SEED_FLIP_COUNT = 96
const VALIDATION_DEVNET_DEFAULT_SEED_POOL_TARGET = 500
const VALIDATION_DEVNET_DNA_BASE = 10n ** 18n
const VALIDATION_DEVNET_BALANCE = (
  1000n * VALIDATION_DEVNET_DNA_BASE
).toString()
const VALIDATION_DEVNET_STAKE = (25n * VALIDATION_DEVNET_DNA_BASE).toString()
const VALIDATION_DEVNET_RETRY_INTERVAL_MS = 750
const VALIDATION_DEVNET_NODE_READY_TIMEOUT_MS = 25 * 1000
const VALIDATION_DEVNET_PEER_STABILIZE_TIMEOUT_MS = 30 * 1000
const VALIDATION_DEVNET_VALIDATOR_ONLINE_TIMEOUT_MS = 3 * 60 * 1000
const VALIDATION_DEVNET_SEED_CONFIRM_TIMEOUT_MS = 2 * 60 * 1000
const VALIDATION_DEVNET_PRIMARY_SEED_VISIBILITY_TIMEOUT_MS = 2 * 60 * 1000
const VALIDATION_DEVNET_MIN_PRIMARY_PEERS = 3
const REHEARSAL_BENCHMARK_REVIEW_STORAGE_SUFFIX = 'rehearsal-benchmark-review'
const REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY =
  'rehearsal-benchmark-annotations'
const VALIDATION_DEVNET_ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  'gu'
)
const VALIDATION_DEVNET_DEFAULT_SEED_FILES = [
  path.join(
    __dirname,
    '..',
    'samples',
    'flips',
    'flip-challenge-human-teacher-500-balanced.json'
  ),
  path.join(
    __dirname,
    '..',
    'samples',
    'flips',
    'flip-challenge-test-20-decoded-labeled.json'
  ),
  path.join(
    __dirname,
    '..',
    'samples',
    'flips',
    'flip-challenge-test-5-decoded-labeled.json'
  ),
]
const VALIDATION_DEVNET_MIN_CONSENSUS_BACKED_COVERAGE = 1 / 3
const VALIDATION_DEVNET_LOCAL_FALLBACK_SEED_FILES = [
  path.join(
    __dirname,
    '..',
    '.tmp',
    'flip-train',
    'pilot-train-500',
    'train.jsonl'
  ),
  path.join(
    __dirname,
    '..',
    '.tmp',
    'flip-train',
    'pilot-val-200',
    'train.jsonl'
  ),
]
const VALIDATION_DEVNET_SEED_IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function buildValidationDevnetSeedAssignments(nodes, requestedSeedFlipCount) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return {}
  }

  const totalRequested = Math.max(
    nodes.length,
    normalizeSeedFlipCount(requestedSeedFlipCount)
  )
  const assignments = {}

  nodes.forEach((node) => {
    assignments[node.name] = 0
  })

  for (let index = 0; index < totalRequested; index += 1) {
    const node = nodes[index % nodes.length]
    assignments[node.name] += 1
  }

  return assignments
}

function countValidationDevnetAssignedSeedFlips(seedAssignments = {}) {
  return Object.values(seedAssignments).reduce(
    (total, value) =>
      total + (Number.isInteger(value) && value > 0 ? value : 0),
    0
  )
}
const VALIDATION_DEVNET_PHASE = {
  IDLE: 'idle',
  PREPARING_BINARY: 'preparing_binary',
  DOWNLOADING_BINARY: 'downloading_binary',
  PREPARING_CONFIG: 'preparing_config',
  STARTING_BOOTSTRAP: 'starting_bootstrap',
  STARTING_VALIDATORS: 'starting_validators',
  WAITING_FOR_PEERS: 'waiting_for_peers',
  SEEDING_FLIPS: 'seeding_flips',
  RUNNING: 'running',
  STOPPING: 'stopping',
  FAILED: 'failed',
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function uniqStrings(values) {
  return [...new Set((values || []).filter(Boolean))]
}

const UNSAFE_VALIDATION_DEVNET_OBJECT_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

function normalizeValidationDevnetSeedHash(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^_flip_/u, '')

  return UNSAFE_VALIDATION_DEVNET_OBJECT_KEYS.has(normalized) ? '' : normalized
}

function normalizeValidationDevnetSubmittedFlipHash(result) {
  if (typeof result === 'string') {
    return normalizeValidationDevnetSeedHash(result)
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return ''
  }

  return normalizeValidationDevnetSeedHash(
    result.hash || result.flipHash || result.result || ''
  )
}

function hasMeaningfulRehearsalBenchmarkAnnotation(value = {}) {
  const annotation =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  return Boolean(
    annotation.status || annotation.reportStatus || annotation.note
  )
}

function collectAnnotatedValidationDevnetSeedFlipHashes(source = {}) {
  const state =
    source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  const annotatedFlipHashes = new Set()
  const globalDataset =
    state[REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY] &&
    typeof state[REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY] ===
      'object' &&
    !Array.isArray(state[REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY])
      ? state[REHEARSAL_BENCHMARK_ANNOTATION_DATASET_STORAGE_KEY]
      : null
  const datasetAnnotations =
    globalDataset &&
    globalDataset.annotationsByHash &&
    typeof globalDataset.annotationsByHash === 'object' &&
    !Array.isArray(globalDataset.annotationsByHash)
      ? globalDataset.annotationsByHash
      : {}

  Object.entries(datasetAnnotations).forEach(([hash, annotation]) => {
    const normalizedHash = normalizeValidationDevnetSeedHash(hash)

    if (
      normalizedHash &&
      hasMeaningfulRehearsalBenchmarkAnnotation(annotation)
    ) {
      annotatedFlipHashes.add(normalizedHash)
    }
  })

  Object.entries(state).forEach(([key, value]) => {
    if (
      !String(key || '').endsWith(
        `:${REHEARSAL_BENCHMARK_REVIEW_STORAGE_SUFFIX}`
      )
    ) {
      return
    }

    const annotationsByHash =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.annotationsByHash &&
      typeof value.annotationsByHash === 'object' &&
      !Array.isArray(value.annotationsByHash)
        ? value.annotationsByHash
        : {}

    Object.entries(annotationsByHash).forEach(([hash, annotation]) => {
      const normalizedHash = normalizeValidationDevnetSeedHash(hash)

      if (
        normalizedHash &&
        hasMeaningfulRehearsalBenchmarkAnnotation(annotation)
      ) {
        annotatedFlipHashes.add(normalizedHash)
      }
    })
  })

  return annotatedFlipHashes
}

async function loadAnnotatedValidationDevnetSeedFlipHashes({
  annotatedFlipHashes,
  validationResultsPath,
} = {}) {
  if (annotatedFlipHashes instanceof Set) {
    return new Set(
      uniqStrings(
        Array.from(annotatedFlipHashes)
          .map(normalizeValidationDevnetSeedHash)
          .filter(Boolean)
      )
    )
  }

  if (Array.isArray(annotatedFlipHashes)) {
    return new Set(
      uniqStrings(
        annotatedFlipHashes
          .map(normalizeValidationDevnetSeedHash)
          .filter(Boolean)
      )
    )
  }

  const explicitPath = String(validationResultsPath || '').trim()
  const defaultPath = (() => {
    try {
      return path.join(appDataPath('userData'), 'validationResults.json')
    } catch {
      return ''
    }
  })()
  const nextValidationResultsPath = explicitPath || defaultPath

  if (!nextValidationResultsPath) {
    return new Set()
  }

  try {
    return collectAnnotatedValidationDevnetSeedFlipHashes(
      await fs.readJson(nextValidationResultsPath)
    )
  } catch {
    return new Set()
  }
}

function trimLogLine(value) {
  return String(value || '').trimEnd()
}

function getValidationDevnetPublishedFlipCount(identity) {
  if (!identity || typeof identity !== 'object') {
    return 0
  }

  if (Array.isArray(identity.flips)) {
    return identity.flips.length
  }

  return Number.parseInt(identity.madeFlips, 10) || 0
}

function pickStatusText(overrideValue, persistedValue) {
  return overrideValue || persistedValue || null
}

function pickStatusCount(overrideValue, persistedValue) {
  if (typeof overrideValue === 'number') {
    return overrideValue
  }

  if (typeof persistedValue === 'number') {
    return persistedValue
  }

  return null
}

function pickPendingNodeNames(overrideValue, persistedValue) {
  if (Array.isArray(overrideValue)) {
    return overrideValue
  }

  if (Array.isArray(persistedValue)) {
    return persistedValue
  }

  return []
}

function normalizeValidationDevnetSeedWord(entry) {
  if (typeof entry === 'string') {
    const stringName = String(entry || '').trim()
    return stringName ? {name: stringName, desc: ''} : null
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null
  }

  const objectName = String(
    entry.name || entry.keyword || entry.word || entry.label || ''
  ).trim()
  const desc = String(entry.desc || entry.description || '').trim()

  if (!(objectName || desc)) {
    return null
  }

  return {
    name: objectName,
    desc,
  }
}

function normalizeValidationDevnetSeedWords(value, extras = {}) {
  const directWords = Array.isArray(value) ? value : []
  const extraWords = [
    extras.keywordA,
    extras.keywordB,
    extras.keyword1,
    extras.keyword2,
  ]
  const normalized = directWords
    .concat(extraWords)
    .map(normalizeValidationDevnetSeedWord)
    .filter(Boolean)

  if (!normalized.length) {
    return []
  }

  const seen = new Set()

  return normalized
    .filter((word) => {
      const dedupeKey = `${word.name}\u0000${word.desc}`.trim()
      if (!dedupeKey || seen.has(dedupeKey)) {
        return false
      }
      seen.add(dedupeKey)
      return true
    })
    .slice(0, 2)
}

function normalizeValidationDevnetSeedAnswer(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['left', 'right', 'skip'].includes(next) ? next : null
}

function normalizeValidationDevnetSeedStrength(value) {
  const next = String(value || '').trim()
  return next || null
}

function normalizeValidationDevnetSeedVotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const left = Number.parseInt(value.Left ?? value.left, 10)
  const right = Number.parseInt(value.Right ?? value.right, 10)
  const reported = Number.parseInt(
    value.Reported ?? value.reported ?? value.skip ?? value.inappropriate,
    10
  )
  const normalized = {
    left: Number.isFinite(left) && left >= 0 ? left : 0,
    right: Number.isFinite(right) && right >= 0 ? right : 0,
    reported: Number.isFinite(reported) && reported >= 0 ? reported : 0,
  }
  const total = normalized.left + normalized.right + normalized.reported

  return total > 0
    ? {
        ...normalized,
        total,
      }
    : null
}

function hasValidationDevnetSeedConsensusVotes(flip) {
  return Boolean(
    normalizeValidationDevnetSeedVotes(flip?.consensusVotes || flip?.votes)
  )
}

function hasValidationDevnetSeedWords(flip) {
  return (
    normalizeValidationDevnetSeedWords(flip?.words || flip?.keywords, {
      keywordA: flip?.keywordA || flip?.keyword_a,
      keywordB: flip?.keywordB || flip?.keyword_b,
      keyword1: flip?.keyword1 || flip?.keyword_1,
      keyword2: flip?.keyword2 || flip?.keyword_2,
    }).length >= 2
  )
}

function shuffleValidationDevnetSeedFlips(flips = []) {
  const nextFlips = Array.isArray(flips) ? flips.slice() : []

  for (let index = nextFlips.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = nextFlips[index]
    nextFlips[index] = nextFlips[swapIndex]
    nextFlips[swapIndex] = current
  }

  return nextFlips
}

function prioritizeValidationDevnetSeedFlips(flips = []) {
  const keywordAndConsensus = []
  const keywordOnly = []
  const consensusOnly = []
  const benchmarkOnly = []

  ;(Array.isArray(flips) ? flips : []).forEach((flip) => {
    const hasConsensus = hasValidationDevnetSeedConsensusVotes(flip)
    const hasWords = hasValidationDevnetSeedWords(flip)

    if (hasWords && hasConsensus) {
      keywordAndConsensus.push(flip)
    } else if (hasWords) {
      keywordOnly.push(flip)
    } else if (hasConsensus) {
      consensusOnly.push(flip)
    } else {
      benchmarkOnly.push(flip)
    }
  })

  return shuffleValidationDevnetSeedFlips(keywordAndConsensus)
    .concat(shuffleValidationDevnetSeedFlips(keywordOnly))
    .concat(shuffleValidationDevnetSeedFlips(consensusOnly))
    .concat(shuffleValidationDevnetSeedFlips(benchmarkOnly))
}

function normalizeValidationDevnetSeedSourceStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const normalized = {
    epoch: normalizePositiveInteger(value.epoch, null),
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

function buildValidationDevnetSeedFlipMetaByHash(flips = []) {
  return (Array.isArray(flips) ? flips : []).reduce((result, flip) => {
    const hash = normalizeValidationDevnetSeedHash(flip?.hash || '')
    const expectedAnswer =
      normalizeValidationDevnetSeedAnswer(flip?.expectedAnswer) ||
      normalizeValidationDevnetSeedAnswer(flip?.consensusAnswer) ||
      normalizeValidationDevnetSeedAnswer(
        Array.isArray(flip?.agreedAnswer) && flip.agreedAnswer[0]
      ) ||
      normalizeValidationDevnetSeedAnswer(
        Array.isArray(flip?.agreed_answer) && flip.agreed_answer[0]
      )
    const expectedStrength =
      normalizeValidationDevnetSeedStrength(flip?.expectedStrength) ||
      normalizeValidationDevnetSeedStrength(flip?.consensusStrength) ||
      normalizeValidationDevnetSeedStrength(
        Array.isArray(flip?.agreedAnswer) && flip.agreedAnswer[1]
      ) ||
      normalizeValidationDevnetSeedStrength(
        Array.isArray(flip?.agreed_answer) && flip.agreed_answer[1]
      )
    const consensusAnswer =
      normalizeValidationDevnetSeedAnswer(flip?.consensusAnswer) ||
      normalizeValidationDevnetSeedAnswer(
        Array.isArray(flip?.agreedAnswer) && flip.agreedAnswer[0]
      ) ||
      normalizeValidationDevnetSeedAnswer(
        Array.isArray(flip?.agreed_answer) && flip.agreed_answer[0]
      ) ||
      expectedAnswer
    const consensusStrength =
      normalizeValidationDevnetSeedStrength(flip?.consensusStrength) ||
      normalizeValidationDevnetSeedStrength(
        Array.isArray(flip?.agreedAnswer) && flip.agreedAnswer[1]
      ) ||
      normalizeValidationDevnetSeedStrength(
        Array.isArray(flip?.agreed_answer) && flip.agreed_answer[1]
      ) ||
      expectedStrength
    const consensusVotes = normalizeValidationDevnetSeedVotes(
      flip?.consensusVotes || flip?.votes
    )
    const words = normalizeValidationDevnetSeedWords(
      flip?.words || flip?.keywords,
      {
        keywordA: flip?.keywordA || flip?.keyword_a,
        keywordB: flip?.keywordB || flip?.keyword_b,
        keyword1: flip?.keyword1 || flip?.keyword_1,
        keyword2: flip?.keyword2 || flip?.keyword_2,
      }
    )

    if (hash && (expectedAnswer || words.length > 0 || consensusVotes)) {
      result[hash] = {
        expectedAnswer: expectedAnswer || null,
        expectedStrength,
        consensusAnswer,
        consensusStrength,
        consensusVotes,
        words,
        sourceStats: normalizeValidationDevnetSeedSourceStats(
          flip?.sourceStats || flip?.stats
        ),
        sourceDataset: String(
          flip?.sourceDataset || flip?.source_dataset || ''
        ).trim(),
        sourceSplit: String(
          flip?.sourceSplit || flip?.source_split || ''
        ).trim(),
      }
    }

    return result
  }, {})
}

function serializeValidationDevnetConfig(config) {
  const rawNumberTokens = []
  let rawNumberIndex = 0

  const preparedConfig = JSON.parse(
    JSON.stringify(config, (key, value) => {
      if (
        (key === 'Balance' || key === 'Stake') &&
        typeof value === 'string' &&
        /^\d+$/u.test(value)
      ) {
        const token = `__RAW_VALIDATION_DEVNET_NUMBER_${rawNumberIndex}__`
        rawNumberTokens.push({token, value})
        rawNumberIndex += 1
        return token
      }

      return value
    })
  )

  let serialized = JSON.stringify(preparedConfig, null, 2)

  rawNumberTokens.forEach(({token, value}) => {
    serialized = serialized.replace(`"${token}"`, value)
  })

  return serialized
}

function getValidationDevnetDefaultSeedFlipCount(nodeCount) {
  return Math.max(
    normalizePositiveInteger(nodeCount, VALIDATION_DEVNET_NODE_COUNT),
    normalizePositiveInteger(nodeCount, VALIDATION_DEVNET_NODE_COUNT) *
      VALIDATION_DEVNET_DEFAULT_FLIPS_PER_IDENTITY
  )
}

function getValidationDevnetRequiredFlips(nodeCount) {
  const normalizedNodeCount = normalizePositiveInteger(
    nodeCount,
    VALIDATION_DEVNET_NODE_COUNT
  )

  return normalizedNodeCount > 0
    ? VALIDATION_DEVNET_DEFAULT_FLIPS_PER_IDENTITY
    : 0
}

function normalizeSeedFlipCount(
  value,
  fallback = getValidationDevnetDefaultSeedFlipCount(
    VALIDATION_DEVNET_NODE_COUNT
  )
) {
  const nextCount = normalizePositiveInteger(value, fallback)

  return Math.min(VALIDATION_DEVNET_MAX_SEED_FLIP_COUNT, nextCount)
}

function getValidationDevnetLongSessionSeconds(nodeCount) {
  const normalizedNodeCount = normalizePositiveInteger(
    nodeCount,
    VALIDATION_DEVNET_NODE_COUNT
  )
  const totalFlips =
    VALIDATION_DEVNET_DEFAULT_FLIPS_PER_IDENTITY * normalizedNodeCount
  const maxLongFlips =
    VALIDATION_DEVNET_DEFAULT_FLIPS_PER_IDENTITY *
    VALIDATION_DEVNET_LONG_SESSION_TESTERS
  const longSessionMinutes = Math.max(5, Math.min(totalFlips, maxLongFlips))

  return longSessionMinutes * 60
}

function decodeSeedImageDataUrl(value) {
  const match = /^data:[^;]+;base64,(.+)$/u.exec(String(value || '').trim())

  if (!match) {
    throw new Error('Seed flip image must be a base64 data URL')
  }

  return Buffer.from(match[1], 'base64')
}

function normalizeSeedFlipOrder(order) {
  if (!Array.isArray(order) || order.length !== 4) {
    throw new Error('Seed flip order must contain four panel indices')
  }

  return order.map((value) => {
    const index = Number.parseInt(value, 10)

    if (!Number.isInteger(index) || index < 0 || index > 3) {
      throw new Error('Seed flip order contains an invalid panel index')
    }

    return index
  })
}

function buildValidationDevnetSeedFlipSubmitArgs(flip, pairId = 0) {
  const images = Array.isArray(flip && flip.images)
    ? flip.images.slice(0, 4)
    : []
  const orders = Array.isArray(flip && flip.orders)
    ? flip.orders.slice(0, 2)
    : []

  if (images.length !== 4) {
    throw new Error('Seed flip must contain exactly four images')
  }

  if (orders.length !== 2) {
    throw new Error('Seed flip must contain two panel orders')
  }

  const imageBytes = images.map(decodeSeedImageDataUrl)
  const normalizedOrders = orders.map(normalizeSeedFlipOrder)
  const publicHex = Buffer.from(
    rlpEncode([imageBytes.slice(0, 2).map((item) => Uint8Array.from(item))])
  ).toString('hex')
  const privateHex = Buffer.from(
    rlpEncode([
      imageBytes.slice(2).map((item) => Uint8Array.from(item)),
      normalizedOrders,
    ])
  ).toString('hex')

  return {
    publicHex: `0x${publicHex}`,
    privateHex: `0x${privateHex}`,
    pairId: Number.parseInt(pairId, 10) || 0,
  }
}

function isValidSeedFlipCandidate(flip) {
  if (
    !flip ||
    !Array.isArray(flip.images) ||
    flip.images.length < 4 ||
    !Array.isArray(flip.orders) ||
    flip.orders.length < 2
  ) {
    return false
  }

  try {
    flip.orders.slice(0, 2).forEach(normalizeSeedFlipOrder)
    return true
  } catch {
    return false
  }
}

function cloneValidationDevnetSeedFlip(flip, duplicateIndex = 0) {
  return {
    ...flip,
    hash: `${
      String(flip && flip.hash ? flip.hash : 'seed').trim() || 'seed'
    }__duplicate_${duplicateIndex}`,
    images: Array.isArray(flip && flip.images) ? flip.images.slice(0, 4) : [],
    orders: Array.isArray(flip && flip.orders)
      ? flip.orders.slice(0, 2).map((order) => order.slice(0, 4))
      : [],
  }
}

function normalizeValidationDevnetSeedImageSource(value) {
  const source = String(value || '').trim()

  return /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/iu.test(
    source
  )
    ? source
    : ''
}

function buildValidationDevnetSeedFlipReviewPayload(flip) {
  const hash = normalizeValidationDevnetSeedHash(flip?.hash || '')
  const images = Array.isArray(flip?.images)
    ? flip.images
        .map(normalizeValidationDevnetSeedImageSource)
        .filter(Boolean)
        .slice(0, 4)
    : []
  const orders = Array.isArray(flip?.orders)
    ? flip.orders
        .slice(0, 2)
        .map((order) => {
          try {
            return normalizeSeedFlipOrder(order)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    : []

  if (!hash || images.length !== 4 || orders.length !== 2) {
    return null
  }

  return {
    hash,
    sourceHash: normalizeValidationDevnetSeedHash(flip?.sourceHash || ''),
    images,
    orders,
  }
}

function buildValidationDevnetSeedFlipReviewPayloadByHash(flips = []) {
  return (Array.isArray(flips) ? flips : []).reduce((result, flip) => {
    const payload = buildValidationDevnetSeedFlipReviewPayload(flip)

    if (!payload) {
      return result
    }

    result[payload.hash] = payload

    if (payload.sourceHash) {
      result[payload.sourceHash] = {
        ...payload,
        hash: payload.sourceHash,
      }
    }

    return result
  }, {})
}

function collectSeedFlipCandidate(
  flip,
  candidatePath,
  collectedFlips,
  seenHashes,
  annotatedFlipHashes = new Set()
) {
  const flipHash = normalizeValidationDevnetSeedHash(
    flip && flip.hash ? flip.hash : ''
  )

  if (flipHash && annotatedFlipHashes.has(flipHash)) {
    return false
  }

  const dedupeKey =
    flipHash ||
    `${candidatePath}:${collectedFlips.length}:${flip?.images?.[0] || ''}`

  if (seenHashes.has(dedupeKey)) {
    if (flipHash) {
      const existingIndex = collectedFlips.findIndex(
        (candidate) =>
          normalizeValidationDevnetSeedHash(candidate?.hash || '') === flipHash
      )

      if (existingIndex >= 0) {
        const existingFlip = collectedFlips[existingIndex]
        collectedFlips[existingIndex] = {
          ...existingFlip,
          expectedAnswer: existingFlip.expectedAnswer || flip.expectedAnswer,
          expectedStrength:
            existingFlip.expectedStrength || flip.expectedStrength,
          consensusAnswer: existingFlip.consensusAnswer || flip.consensusAnswer,
          consensusStrength:
            existingFlip.consensusStrength || flip.consensusStrength,
          consensusVotes: existingFlip.consensusVotes || flip.consensusVotes,
          words:
            Array.isArray(existingFlip.words) && existingFlip.words.length > 0
              ? existingFlip.words
              : flip.words,
          sourceStats: existingFlip.sourceStats || flip.sourceStats,
          sourceDataset: existingFlip.sourceDataset || flip.sourceDataset,
          sourceSplit: existingFlip.sourceSplit || flip.sourceSplit,
        }
      }
    }

    return false
  }

  seenHashes.add(dedupeKey)
  collectedFlips.push(flip)
  return true
}

async function encodeValidationDevnetSeedImageAsDataUrl(imagePath) {
  const resolvedPath = path.resolve(imagePath)
  const extension = path.extname(resolvedPath).toLowerCase()
  const mimeType = VALIDATION_DEVNET_SEED_IMAGE_MIME_TYPES[extension]

  if (!mimeType) {
    throw new Error(`Unsupported seed image format: ${extension}`)
  }

  const imageBytes = await fs.readFile(resolvedPath)
  return `data:${mimeType};base64,${imageBytes.toString('base64')}`
}

async function collectValidationDevnetPreparedSeedFlips(
  candidatePath,
  desiredCount,
  collectedFlips,
  seenHashes,
  annotatedFlipHashes = new Set()
) {
  const text = await fs.readFile(candidatePath, 'utf8')
  const lines = String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  let addedCount = 0

  for (const line of lines) {
    let record = null

    try {
      record = JSON.parse(line)
    } catch {
      record = null
    }

    const panelImages = Array.isArray(record?.panel_images)
      ? record.panel_images.slice(0, 4)
      : []
    const orders = [record?.left_order, record?.right_order]

    if (
      record &&
      panelImages.length >= 4 &&
      Array.isArray(orders[0]) &&
      Array.isArray(orders[1])
    ) {
      const flipHash = String(record?.flip_hash || record?.hash || '').trim()
      const dedupeKey = flipHash || `${candidatePath}:${addedCount}`

      if (!seenHashes.has(dedupeKey)) {
        let encodedImages = null

        try {
          encodedImages = await Promise.all(
            panelImages.map((imagePath) =>
              encodeValidationDevnetSeedImageAsDataUrl(imagePath)
            )
          )
        } catch {
          encodedImages = null
        }

        if (encodedImages) {
          const words = normalizeValidationDevnetSeedWords(
            record?.words || record?.keywords,
            {
              keywordA: record?.keywordA || record?.keyword_a,
              keywordB: record?.keywordB || record?.keyword_b,
              keyword1: record?.keyword1 || record?.keyword_1,
              keyword2: record?.keyword2 || record?.keyword_2,
            }
          )
          const flip = {
            hash: flipHash,
            images: encodedImages,
            orders: orders.slice(0, 2),
            expectedAnswer: String(record?.expected_answer || '').trim(),
            expectedStrength: String(record?.expected_strength || '').trim(),
            agreedAnswer: record?.agreed_answer || record?.agreedAnswer,
            consensusAnswer: String(
              record?.consensus_answer || record?.consensusAnswer || ''
            ).trim(),
            consensusStrength: String(
              record?.consensus_strength || record?.consensusStrength || ''
            ).trim(),
            consensusVotes:
              record?.consensus_votes ||
              record?.consensusVotes ||
              record?.votes,
            words,
            sourceStats: record?.source_stats || record?.sourceStats || null,
            sourceDataset: String(
              record?.source_dataset || record?.sourceDataset || ''
            ).trim(),
            sourceSplit: String(
              record?.source_split || record?.sourceSplit || ''
            ).trim(),
          }

          if (isValidSeedFlipCandidate(flip)) {
            if (
              collectSeedFlipCandidate(
                flip,
                candidatePath,
                collectedFlips,
                seenHashes,
                annotatedFlipHashes
              )
            ) {
              addedCount += 1
            }

            if (collectedFlips.length >= desiredCount) {
              break
            }
          }
        }
      }
    }
  }

  return {
    addedCount,
    source: 'aplesner-eth/FLIP-Challenge',
  }
}

async function loadValidationDevnetSeedPayload(candidatePath, visitedPaths) {
  const resolvedPath = path.resolve(candidatePath)
  const nextVisitedPaths = new Set(visitedPaths || [])

  if (nextVisitedPaths.has(resolvedPath)) {
    throw new Error(`Circular seed payload manifest detected: ${resolvedPath}`)
  }

  nextVisitedPaths.add(resolvedPath)

  const payload = await fs.readJson(resolvedPath)

  if (!payload || Array.isArray(payload) || !Array.isArray(payload.parts)) {
    return payload
  }

  const flips = []

  for (const part of payload.parts) {
    const relativePartPath = String(
      (part && typeof part === 'object' ? part.file || part.path : part) || ''
    ).trim()

    if (relativePartPath) {
      // eslint-disable-next-line no-await-in-loop
      const partPayload = await loadValidationDevnetSeedPayload(
        path.resolve(path.dirname(resolvedPath), relativePartPath),
        nextVisitedPaths
      )
      let partFlips = []

      if (Array.isArray(partPayload)) {
        partFlips = partPayload
      } else if (Array.isArray(partPayload?.flips)) {
        partFlips = partPayload.flips
      }

      flips.push(...partFlips)
    }
  }

  return {
    ...payload,
    flips,
    count: flips.length,
  }
}

async function loadValidationDevnetSeedFlips({
  seedFile,
  seedFlipCount,
  annotatedFlipHashes,
  validationResultsPath,
} = {}) {
  const desiredCount = normalizeSeedFlipCount(seedFlipCount)
  const desiredPoolCount = Math.max(
    desiredCount,
    VALIDATION_DEVNET_DEFAULT_SEED_POOL_TARGET
  )
  const candidates = uniqStrings([
    seedFile,
    ...VALIDATION_DEVNET_DEFAULT_SEED_FILES,
    ...VALIDATION_DEVNET_LOCAL_FALLBACK_SEED_FILES,
  ])
  const collectedFlips = []
  const seenHashes = new Set()
  const reviewedFlipHashes = await loadAnnotatedValidationDevnetSeedFlipHashes({
    annotatedFlipHashes,
    validationResultsPath,
  })
  const minimumConsensusBackedCount = Math.max(
    1,
    Math.ceil(desiredCount * VALIDATION_DEVNET_MIN_CONSENSUS_BACKED_COVERAGE)
  )
  let resolvedSource = 'aplesner-eth/FLIP-Challenge'
  let resolvedSourceFile = null

  for (const candidatePath of candidates) {
    try {
      if (/\.jsonl$/iu.test(candidatePath)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await collectValidationDevnetPreparedSeedFlips(
          candidatePath,
          desiredPoolCount,
          collectedFlips,
          seenHashes,
          reviewedFlipHashes
        )

        if (result.addedCount > 0) {
          resolvedSource = result.source || resolvedSource
          resolvedSourceFile = resolvedSourceFile || candidatePath
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const payload = await loadValidationDevnetSeedPayload(candidatePath)
        let flips = []

        if (Array.isArray(payload)) {
          flips = payload.filter(isValidSeedFlipCandidate)
        } else if (payload && Array.isArray(payload.flips)) {
          flips = payload.flips.filter(isValidSeedFlipCandidate)
        }

        if (flips.length > 0) {
          resolvedSource =
            (payload &&
              typeof payload === 'object' &&
              typeof payload.source === 'string' &&
              payload.source) ||
            resolvedSource
          resolvedSourceFile = resolvedSourceFile || candidatePath

          for (const flip of flips) {
            collectSeedFlipCandidate(
              flip,
              candidatePath,
              collectedFlips,
              seenHashes,
              reviewedFlipHashes
            )

            if (
              collectedFlips.length >= desiredPoolCount &&
              prioritizeValidationDevnetSeedFlips(collectedFlips).filter(
                hasValidationDevnetSeedConsensusVotes
              ).length >= minimumConsensusBackedCount
            ) {
              break
            }
          }
        }
      }

      const prioritizedFlips =
        prioritizeValidationDevnetSeedFlips(collectedFlips)

      if (
        prioritizedFlips.length >= desiredCount &&
        prioritizedFlips.filter(hasValidationDevnetSeedConsensusVotes).length >=
          minimumConsensusBackedCount
      ) {
        return {
          source: resolvedSource,
          sourceFile: resolvedSourceFile,
          flips: prioritizedFlips.slice(0, desiredCount),
        }
      }
    } catch {
      // try the next bundled candidate
    }
  }

  if (collectedFlips.length > 0) {
    const reusableFlips = prioritizeValidationDevnetSeedFlips(collectedFlips)
    const finalizedFlips = reusableFlips.slice()
    let duplicateIndex = 0

    while (finalizedFlips.length < desiredCount) {
      const baseFlip = reusableFlips[duplicateIndex % reusableFlips.length]
      duplicateIndex += 1
      finalizedFlips.push(
        cloneValidationDevnetSeedFlip(baseFlip, duplicateIndex)
      )
    }

    return {
      source: resolvedSource,
      sourceFile: resolvedSourceFile,
      flips: finalizedFlips.slice(0, desiredCount),
    }
  }

  throw new Error('Unable to load bundled FLIP-Challenge seed flips')
}

function buildValidationDurations({
  nodeCount = VALIDATION_DEVNET_NODE_COUNT,
  validationIntervalSeconds,
  flipLotterySeconds = VALIDATION_DEVNET_DEFAULT_FLIP_LOTTERY_SECONDS,
  shortSessionSeconds = VALIDATION_DEVNET_DEFAULT_SHORT_SESSION_SECONDS,
  longSessionSeconds,
  afterLongSessionSeconds = VALIDATION_DEVNET_DEFAULT_AFTER_LONG_SESSION_SECONDS,
  validationPaddingSeconds = VALIDATION_DEVNET_DEFAULT_VALIDATION_PADDING_SECONDS,
} = {}) {
  const resolvedLongSessionSeconds =
    normalizePositiveInteger(longSessionSeconds, 0) ||
    getValidationDevnetLongSessionSeconds(nodeCount)
  const minimumValidationIntervalSeconds =
    flipLotterySeconds +
    shortSessionSeconds +
    resolvedLongSessionSeconds +
    Math.max(0, Number(afterLongSessionSeconds) || 0) +
    Math.max(0, Number(validationPaddingSeconds) || 0)
  const resolvedValidationIntervalSeconds = Math.max(
    minimumValidationIntervalSeconds,
    normalizePositiveInteger(validationIntervalSeconds, 30 * 60)
  )
  const toNs = (seconds) => Number(seconds) * 1000 * 1000 * 1000

  return {
    ValidationInterval: toNs(resolvedValidationIntervalSeconds),
    FlipLotteryDuration: toNs(flipLotterySeconds),
    ShortSessionDuration: toNs(shortSessionSeconds),
    LongSessionDuration: toNs(resolvedLongSessionSeconds),
  }
}

function buildNodeRole(index) {
  return index === 0 ? 'bootstrap' : 'validator'
}

function createNodeKeyHex() {
  return randomBytes(32).toString('hex')
}

function deriveAddressFromNodeKeyHex(nodeKeyHex) {
  return privateKeyToAddress(`0x${nodeKeyHex}`)
}

function normalizePositiveInteger(value, fallback) {
  const nextValue = Number.parseInt(value, 10)

  return Number.isInteger(nextValue) && nextValue > 0 ? nextValue : fallback
}

function getValidationDevnetPrimaryPeerTarget(nodeCount) {
  const normalizedNodeCount = normalizePositiveInteger(
    nodeCount,
    VALIDATION_DEVNET_NODE_COUNT
  )

  return Math.max(
    1,
    Math.min(VALIDATION_DEVNET_MIN_PRIMARY_PEERS, normalizedNodeCount - 1)
  )
}

function summarizeValidationDevnetNode(node) {
  return {
    name: node.name,
    role: node.role,
    address: node.address,
    rpcPort: node.rpcPort,
    tcpPort: node.tcpPort,
    ipfsPort: node.ipfsPort,
    pid: node.process && node.process.pid ? node.process.pid : null,
    rpcReady: Boolean(node.rpcReady),
    peerCount:
      typeof node.peerCount === 'number' && node.peerCount >= 0
        ? node.peerCount
        : null,
    syncing: Boolean(node.syncing),
    online: Boolean(node.online),
    identityState: node.identityState || null,
    currentPeriod: node.currentPeriod || null,
    nextValidation: node.nextValidation || null,
  }
}

function normalizeValidationHashItems(result) {
  if (!Array.isArray(result)) {
    return []
  }

  return result.filter(
    (item) => item && typeof item === 'object' && String(item.hash || '').trim()
  )
}

function countReadyValidationHashItems(result) {
  return normalizeValidationHashItems(result).filter(
    ({ready}) => ready === true
  ).length
}

function getValidationHashQueryCapabilities(currentPeriod) {
  const normalizedPeriod = String(currentPeriod || '').trim()

  return {
    short:
      normalizedPeriod === 'FlipLottery' || normalizedPeriod === 'ShortSession',
    long: normalizedPeriod === 'LongSession',
  }
}

function shouldSuppressValidationDevnetLogLine(line) {
  const normalizedLine = String(line || '')
    .replace(VALIDATION_DEVNET_ANSI_ESCAPE_PATTERN, '')
    .trim()

  return /\b(short|long) hashes (request|response)\b/u.test(normalizedLine)
}

function canConnectValidationDevnetStatus(status = {}) {
  if (!status || !status.primaryRpcUrl) {
    return false
  }

  return status.stage === VALIDATION_DEVNET_PHASE.RUNNING
}

function shouldConnectValidationDevnetStatus(
  status = {},
  {connectCountdownSeconds = null} = {}
) {
  if (!canConnectValidationDevnetStatus(status)) {
    return false
  }

  if (!Number.isFinite(connectCountdownSeconds)) {
    return true
  }

  return (
    typeof status.countdownSeconds === 'number' &&
    status.countdownSeconds <= connectCountdownSeconds
  )
}

function buildValidationDevnetPlan({
  baseDir,
  nodeCount = VALIDATION_DEVNET_NODE_COUNT,
  seedFlipCount,
  firstCeremonyLeadSeconds = VALIDATION_DEVNET_DEFAULT_LEAD_SECONDS,
  firstCeremonyUnix,
  initialEpoch = VALIDATION_DEVNET_DEFAULT_INITIAL_EPOCH,
  networkId,
  afterLongSessionSeconds,
  validationPaddingSeconds,
  now = () => Date.now(),
} = {}) {
  const nextNodeCount = Math.max(3, normalizePositiveInteger(nodeCount, 5))
  const nowUnix = Math.floor(now() / 1000)
  const nextFirstCeremonyUnix =
    normalizePositiveInteger(firstCeremonyUnix, 0) ||
    nowUnix +
      Math.max(
        VALIDATION_DEVNET_MIN_LEAD_SECONDS,
        normalizePositiveInteger(
          firstCeremonyLeadSeconds,
          VALIDATION_DEVNET_DEFAULT_LEAD_SECONDS
        )
      )
  const nextNetworkId =
    normalizePositiveInteger(networkId, 0) ||
    VALIDATION_DEVNET_DEFAULT_NETWORK_BASE +
      Math.floor(nowUnix % 1000) +
      Math.floor(Math.random() * 100)
  const sharedSwarmKey = randomBytes(32).toString('hex')
  const nodes = Array.from({length: nextNodeCount}).map((_, index) => {
    const nodeKeyHex = createNodeKeyHex()
    const address = deriveAddressFromNodeKeyHex(nodeKeyHex)
    const name = `node-${index + 1}`
    const nodeDir = path.join(baseDir, name)
    const dataDir = path.join(nodeDir, 'datadir')

    return {
      index,
      name,
      role: buildNodeRole(index),
      address,
      nodeKeyHex,
      apiKey: `validation-devnet-${randomBytes(8).toString('hex')}`,
      rpcPort: VALIDATION_DEVNET_RPC_BASE_PORT + index,
      tcpPort: VALIDATION_DEVNET_TCP_BASE_PORT + index,
      ipfsPort: VALIDATION_DEVNET_IPFS_BASE_PORT + index,
      nodeDir,
      dataDir,
      configFile: path.join(nodeDir, 'config.json'),
      logFile: path.join(nodeDir, 'logs', 'stdout.log'),
      errorFile: path.join(nodeDir, 'logs', 'stderr.log'),
    }
  })
  const nextSeedFlipCount = normalizeSeedFlipCount(
    Math.max(
      normalizePositiveInteger(seedFlipCount, 0),
      getValidationDevnetDefaultSeedFlipCount(nextNodeCount)
    ),
    getValidationDevnetDefaultSeedFlipCount(nextNodeCount)
  )
  const nextInitialEpoch = normalizePositiveInteger(
    initialEpoch,
    VALIDATION_DEVNET_DEFAULT_INITIAL_EPOCH
  )
  const requiredFlipsPerIdentity =
    getValidationDevnetRequiredFlips(nextNodeCount)
  const seedAssignments = buildValidationDevnetSeedAssignments(
    nodes,
    nextSeedFlipCount
  )
  const alloc = nodes.reduce((result, node) => {
    result[node.address] = {
      Balance: VALIDATION_DEVNET_BALANCE,
      Stake: VALIDATION_DEVNET_STAKE,
      State: 3,
      RequiredFlips: requiredFlipsPerIdentity,
    }
    return result
  }, {})

  return {
    createdAt: new Date(now()).toISOString(),
    networkId: nextNetworkId,
    firstCeremonyUnix: nextFirstCeremonyUnix,
    initialEpoch: nextInitialEpoch,
    requiredFlipsPerIdentity,
    swarmKey: sharedSwarmKey,
    durations: buildValidationDurations({
      nodeCount: nextNodeCount,
      afterLongSessionSeconds,
      validationPaddingSeconds,
    }),
    godAddress: nodes[0].address,
    nodes,
    alloc,
    primaryNodeName: nodes[Math.min(1, nodes.length - 1)].name,
    seedAssignments,
  }
}

function buildValidationDevnetNodeConfig({
  plan,
  node,
  bootNodes = [],
  profile = 'server',
} = {}) {
  return {
    Network: plan.networkId,
    RPC: {
      HTTPHost: 'localhost',
      HTTPPort: node.rpcPort,
    },
    GenesisConf: {
      GodAddress: plan.godAddress,
      FirstCeremonyTime: plan.firstCeremonyUnix,
      InitialEpoch: plan.initialEpoch,
      Alloc: plan.alloc,
    },
    IpfsConf: {
      BootNodes: uniqStrings(bootNodes),
      Profile: profile,
      IpfsPort: node.ipfsPort,
      StaticPort: true,
      SwarmListenHost: VALIDATION_DEVNET_LOOPBACK_HOST,
      SwarmKey: plan.swarmKey,
    },
    Consensus: {
      Automine: false,
    },
    Validation: {
      ...plan.durations,
      UseSharedFlipKeys: true,
    },
    Sync: {
      FastSync: false,
      ForceFullSync: 0,
    },
  }
}

async function waitForCondition(condition, timeoutMs, intervalMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const result = await condition()

    if (result) {
      return result
    }

    // eslint-disable-next-line no-await-in-loop
    await delay(intervalMs)
  }

  return null
}

function createDefaultValidationDevnetController(options = {}) {
  return createValidationDevnetController({
    baseDir:
      options.baseDir ||
      path.join(appDataPath('userData'), 'validation-devnet'),
    nodeBinaryPath: options.nodeBinaryPath || getNodeFile(),
    logger: options.logger,
    ensureNodeBinary: options.ensureNodeBinary,
    now: options.now,
  })
}

function createValidationDevnetController({
  baseDir,
  nodeBinaryPath,
  logger = console,
  now = () => Date.now(),
  ensureNodeBinary,
} = {}) {
  const state = {
    run: null,
    logs: [],
    statusTicker: null,
    statusRefreshInFlight: false,
    statusRefreshPromise: null,
    status: {
      active: false,
      stage: VALIDATION_DEVNET_PHASE.IDLE,
      message: 'Validation rehearsal network is stopped.',
    },
  }
  let seedFlipReviewPayloadCache = null

  const emitters = {
    onStatus: null,
    onLog: null,
  }

  function setEmitters({onStatus, onLog} = {}) {
    if (typeof onStatus === 'function') {
      emitters.onStatus = onStatus
    }

    if (typeof onLog === 'function') {
      emitters.onLog = onLog
    }
  }

  function appendLog(line) {
    const nextLine = trimLogLine(line)
    if (!nextLine) {
      return
    }

    if (shouldSuppressValidationDevnetLogLine(nextLine)) {
      return
    }

    state.logs = [...state.logs, nextLine].slice(
      -VALIDATION_DEVNET_MAX_LOG_LINES
    )

    if (emitters.onLog) {
      emitters.onLog(nextLine)
    }
  }

  function stopStatusTicker() {
    if (state.statusTicker) {
      clearInterval(state.statusTicker)
      state.statusTicker = null
    }
  }

  function ensureStatusTicker() {
    if (state.statusTicker || !state.run) {
      return
    }

    state.statusTicker = setInterval(async () => {
      if (
        !state.run ||
        state.status.stage !== VALIDATION_DEVNET_PHASE.RUNNING
      ) {
        stopStatusTicker()
        return
      }

      if (state.statusRefreshInFlight) {
        return
      }

      try {
        await refreshRunRuntimeSerialized()
      } catch {
        publishStatus()
      }
    }, 1000)
  }

  function buildStatus(overrides = {}) {
    const {run} = state
    const firstCeremonyUnix =
      overrides.firstCeremonyUnix ||
      (run && run.plan && run.plan.firstCeremonyUnix) ||
      null
    const primaryNode =
      (run &&
        run.nodes &&
        run.nodes.find(({name}) => name === run.plan.primaryNodeName)) ||
      null

    return {
      ...state.status,
      ...overrides,
      active: Boolean(run),
      firstCeremonyUnix,
      firstCeremonyAt: firstCeremonyUnix
        ? new Date(firstCeremonyUnix * 1000).toISOString()
        : null,
      countdownSeconds:
        typeof firstCeremonyUnix === 'number'
          ? Math.max(0, firstCeremonyUnix - Math.floor(now() / 1000))
          : null,
      networkId: run && run.plan ? run.plan.networkId : null,
      nodeCount: run && run.nodes ? run.nodes.length : 0,
      primaryRpcUrl:
        primaryNode && primaryNode.rpcReady
          ? `http://127.0.0.1:${primaryNode.rpcPort}`
          : null,
      primaryValidationAssigned:
        primaryNode && primaryNode.validationAssigned === true,
      primaryShortHashCount:
        primaryNode && typeof primaryNode.shortHashCount === 'number'
          ? primaryNode.shortHashCount
          : null,
      primaryShortHashReadyCount:
        primaryNode && typeof primaryNode.shortHashReadyCount === 'number'
          ? primaryNode.shortHashReadyCount
          : null,
      primaryLongHashCount:
        primaryNode && typeof primaryNode.longHashCount === 'number'
          ? primaryNode.longHashCount
          : null,
      primaryLongHashReadyCount:
        primaryNode && typeof primaryNode.longHashReadyCount === 'number'
          ? primaryNode.longHashReadyCount
          : null,
      seedSource: pickStatusText(
        overrides.seedSource,
        run && run.seed && run.seed.source
      ),
      seedSourceFile: pickStatusText(
        overrides.seedSourceFile,
        run && run.seed && run.seed.sourceFile
      ),
      seedRequestedCount: pickStatusCount(
        overrides.seedRequestedCount,
        run && run.seed && run.seed.requested
      ),
      seedSubmittedCount: pickStatusCount(
        overrides.seedSubmittedCount,
        run && run.seed && run.seed.submitted
      ),
      seedConfirmedCount: pickStatusCount(
        overrides.seedConfirmedCount,
        run && run.seed && run.seed.confirmed
      ),
      seedConfirmedNodeCount: pickStatusCount(
        overrides.seedConfirmedNodeCount,
        run && run.seed && run.seed.confirmedNodeCount
      ),
      seedExpectedNodeCount: pickStatusCount(
        overrides.seedExpectedNodeCount,
        run && run.seed && run.seed.expectedNodeCount
      ),
      seedPrimaryVisibleNodeCount: pickStatusCount(
        overrides.seedPrimaryVisibleNodeCount,
        run && run.seed && run.seed.primaryVisibleNodeCount
      ),
      seedPrimaryExpectedNodeCount: pickStatusCount(
        overrides.seedPrimaryExpectedNodeCount,
        run && run.seed && run.seed.primaryExpectedNodeCount
      ),
      seedPendingNodeNames: pickPendingNodeNames(
        overrides.seedPendingNodeNames,
        run && run.seed && run.seed.pendingNodeNames
      ),
      seedPrimaryPendingNodeNames: pickPendingNodeNames(
        overrides.seedPrimaryPendingNodeNames,
        run && run.seed && run.seed.primaryPendingNodeNames
      ),
      seedFlipMetaByHash:
        (overrides.seedFlipMetaByHash &&
        typeof overrides.seedFlipMetaByHash === 'object' &&
        !Array.isArray(overrides.seedFlipMetaByHash)
          ? overrides.seedFlipMetaByHash
          : null) ||
        (run && run.seed && run.seed.flipMetaByHash) ||
        {},
      nodes:
        run && run.nodes ? run.nodes.map(summarizeValidationDevnetNode) : [],
      logsAvailable: state.logs.length > 0,
    }
  }

  function publishStatus(overrides = {}) {
    state.status = buildStatus(overrides)

    if (state.run && state.status.stage === VALIDATION_DEVNET_PHASE.RUNNING) {
      ensureStatusTicker()
    } else {
      stopStatusTicker()
    }

    if (emitters.onStatus) {
      emitters.onStatus(state.status)
    }

    return state.status
  }

  async function defaultEnsureNodeBinary(onProgress) {
    try {
      return await getCurrentVersion(false)
    } catch (error) {
      appendLog(
        `[devnet] bundled node binary not ready, downloading latest pinned build`
      )

      if (onProgress) {
        onProgress({
          stage: VALIDATION_DEVNET_PHASE.DOWNLOADING_BINARY,
          message:
            'Downloading bundled Idena node binary for the rehearsal network.',
          progress: null,
        })
      }

      await downloadNode((progress) => {
        if (onProgress) {
          onProgress({
            stage: VALIDATION_DEVNET_PHASE.DOWNLOADING_BINARY,
            message:
              'Downloading bundled Idena node binary for the rehearsal network.',
            progress,
          })
        }
      })
      await updateNode()

      return getCurrentVersion(false)
    }
  }

  function createRpcClient(node) {
    return axios.create({
      baseURL: `http://127.0.0.1:${node.rpcPort}`,
      timeout: 2500,
      validateStatus: (status) => status >= 200 && status < 500,
      headers: {'Content-Type': 'application/json'},
    })
  }

  async function callNodeRpc(node, method, params = []) {
    const rpcClient = createRpcClient(node)
    const {data} = await rpcClient.post('/', {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
      key: node.apiKey,
    })

    if (data && data.error) {
      throw new Error(data.error.message || `rpc error for ${method}`)
    }

    return data ? data.result : undefined
  }

  async function ensureRunDirectories(run) {
    await fs.remove(baseDir)
    await fs.ensureDir(baseDir)

    await Promise.all(
      run.nodes.map(async (node) => {
        await fs.ensureDir(path.join(node.dataDir, 'keystore'))
        await fs.ensureDir(path.dirname(node.logFile))
        await fs.writeFile(
          path.join(node.dataDir, 'keystore', 'nodekey'),
          node.nodeKeyHex
        )
      })
    )
  }

  function checkPortAvailability(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
      const server = net.createServer()

      server.unref()
      server.once('error', () => resolve(false))
      server.listen({port, host, exclusive: true}, () => {
        server.close(() => resolve(true))
      })
    })
  }

  async function allocatePortBlock(preferredStart, count, reservedPorts) {
    let candidateStart = preferredStart

    while (candidateStart + count < 65535) {
      const nextPorts = []
      let collisionPort = null

      for (let index = 0; index < count; index += 1) {
        const candidatePort = candidateStart + index

        // eslint-disable-next-line no-await-in-loop
        const isAvailable =
          !reservedPorts.has(candidatePort) &&
          (await checkPortAvailability(candidatePort))

        if (!isAvailable) {
          collisionPort = candidatePort
          break
        }

        nextPorts.push(candidatePort)
      }

      if (!collisionPort) {
        nextPorts.forEach((port) => reservedPorts.add(port))
        return nextPorts
      }

      candidateStart = collisionPort + 1
    }

    throw new Error(
      `Unable to allocate ${count} consecutive rehearsal-network ports near ${preferredStart}`
    )
  }

  async function assignAvailablePorts(run) {
    const reservedPorts = new Set()
    const nodeCount = run.nodes.length
    const rpcPorts = await allocatePortBlock(
      VALIDATION_DEVNET_RPC_BASE_PORT,
      nodeCount,
      reservedPorts
    )
    const tcpPorts = await allocatePortBlock(
      VALIDATION_DEVNET_TCP_BASE_PORT,
      nodeCount,
      reservedPorts
    )
    const ipfsPorts = await allocatePortBlock(
      VALIDATION_DEVNET_IPFS_BASE_PORT,
      nodeCount,
      reservedPorts
    )

    run.nodes.forEach((node, index) => {
      node.rpcPort = rpcPorts[index]
      node.tcpPort = tcpPorts[index]
      node.ipfsPort = ipfsPorts[index]
    })
  }

  async function writeNodeConfig(plan, node, bootNodes = []) {
    const config = buildValidationDevnetNodeConfig({
      plan,
      node,
      bootNodes,
    })

    await fs.writeFile(node.configFile, serializeValidationDevnetConfig(config))
    node.config = config
  }

  function streamNodeOutput(node, stream, sink) {
    if (!stream) {
      return
    }

    stream.on('data', (chunk) => {
      const text = String(chunk || '')
      const lines = text
        .split(/\r?\n/u)
        .map((line) => trimLogLine(line))
        .filter(Boolean)

      if (lines.length === 0) {
        return
      }

      lines.forEach((line) => {
        appendLog(`[${node.name}] ${line}`)
      })

      if (sink) {
        fs.appendFile(sink, `${lines.join(os.EOL)}${os.EOL}`).catch(() => {})
      }
    })
  }

  async function waitForNodeRpc(node) {
    const rpcReady = await waitForCondition(
      async () => {
        try {
          await callNodeRpc(node, 'bcn_syncing')
          return true
        } catch {
          return false
        }
      },
      VALIDATION_DEVNET_NODE_READY_TIMEOUT_MS,
      VALIDATION_DEVNET_RETRY_INTERVAL_MS
    )

    if (!rpcReady) {
      throw new Error(`${node.name} did not become RPC-ready in time`)
    }

    node.rpcReady = true
  }

  async function refreshNodeRuntime(node) {
    if (!node.process || node.process.exitCode != null) {
      node.rpcReady = false
      node.peerCount = 0
      node.syncing = false
      node.online = false
      node.identityState = null
      node.currentPeriod = null
      node.nextValidation = null
      return summarizeValidationDevnetNode(node)
    }

    try {
      const [syncStatus, peers, epoch, identity] = await Promise.all([
        callNodeRpc(node, 'bcn_syncing').catch(() => null),
        callNodeRpc(node, 'net_peers').catch(() => []),
        callNodeRpc(node, 'dna_epoch').catch(() => null),
        callNodeRpc(node, 'dna_identity', [node.address]).catch(() => null),
      ])

      node.rpcReady = true
      node.syncing = Boolean(syncStatus && syncStatus.syncing)
      node.peerCount = Array.isArray(peers) ? peers.length : 0
      node.online = Boolean(identity && identity.online)
      node.identityState =
        identity && typeof identity.state === 'string' ? identity.state : null
      node.currentPeriod =
        epoch && epoch.currentPeriod ? epoch.currentPeriod : null
      node.nextValidation =
        epoch && epoch.nextValidation ? epoch.nextValidation : null
    } catch {
      node.rpcReady = false
      node.peerCount = 0
      node.syncing = false
      node.online = false
      node.identityState = null
      node.currentPeriod = null
      node.nextValidation = null
    }

    return summarizeValidationDevnetNode(node)
  }

  async function refreshPrimaryValidationAssignment(run) {
    const primaryNode = run.nodes.find(
      ({name}) => name === run.plan.primaryNodeName
    )

    if (!primaryNode) {
      return
    }

    primaryNode.shortHashCount = null
    primaryNode.shortHashReadyCount = null
    primaryNode.longHashCount = null
    primaryNode.longHashReadyCount = null
    primaryNode.validationAssigned = false

    if (
      !primaryNode.process ||
      primaryNode.process.exitCode != null ||
      !primaryNode.rpcReady ||
      primaryNode.syncing
    ) {
      return
    }

    const currentPeriod = String(primaryNode.currentPeriod || '').trim()
    const {short: canQueryShortHashes, long: canQueryLongHashes} =
      getValidationHashQueryCapabilities(currentPeriod)

    if (!canQueryShortHashes && !canQueryLongHashes) {
      return
    }

    let shortHashes = []
    let longHashes = []

    if (canQueryShortHashes) {
      try {
        shortHashes = normalizeValidationHashItems(
          await callNodeRpc(primaryNode, 'flip_shortHashes')
        )
      } catch {
        shortHashes = []
      }
    }

    if (canQueryLongHashes) {
      try {
        longHashes = normalizeValidationHashItems(
          await callNodeRpc(primaryNode, 'flip_longHashes')
        )
      } catch {
        longHashes = []
      }
    }

    primaryNode.shortHashCount = canQueryShortHashes ? shortHashes.length : null
    primaryNode.shortHashReadyCount = canQueryShortHashes
      ? countReadyValidationHashItems(shortHashes)
      : null
    primaryNode.longHashCount = canQueryLongHashes ? longHashes.length : null
    primaryNode.longHashReadyCount = canQueryLongHashes
      ? countReadyValidationHashItems(longHashes)
      : null
    primaryNode.validationAssigned =
      (primaryNode.shortHashCount || 0) > 0 ||
      (primaryNode.longHashCount || 0) > 0
  }

  async function refreshRunRuntime() {
    if (!state.run) {
      return buildStatus({
        active: false,
        stage: VALIDATION_DEVNET_PHASE.IDLE,
        message: 'Validation rehearsal network is stopped.',
      })
    }

    await Promise.all(state.run.nodes.map((node) => refreshNodeRuntime(node)))
    await refreshPrimaryValidationAssignment(state.run)

    const primaryNode = state.run.nodes.find(
      ({name}) => name === state.run.plan.primaryNodeName
    )

    if (
      primaryNode &&
      state.status.stage === VALIDATION_DEVNET_PHASE.RUNNING &&
      (!primaryNode.process ||
        primaryNode.process.exitCode != null ||
        !primaryNode.rpcReady)
    ) {
      appendLog(
        '[devnet] primary rehearsal node became unavailable while the rehearsal network was running'
      )

      return publishStatus({
        stage: VALIDATION_DEVNET_PHASE.FAILED,
        error: 'Primary rehearsal node became unavailable.',
        message: 'Validation rehearsal network failed while running.',
      })
    }

    return publishStatus()
  }

  async function refreshRunRuntimeSerialized() {
    if (state.statusRefreshPromise) {
      return state.statusRefreshPromise
    }

    state.statusRefreshInFlight = true
    state.statusRefreshPromise = (async () => {
      try {
        return await refreshRunRuntime()
      } finally {
        state.statusRefreshPromise = null
        state.statusRefreshInFlight = false
      }
    })()

    return state.statusRefreshPromise
  }

  function spawnNodeProcess(node) {
    const parameters = [
      '--datadir',
      node.dataDir,
      '--rpcport',
      String(node.rpcPort),
      '--port',
      String(node.tcpPort),
      '--ipfsport',
      String(node.ipfsPort),
      '--apikey',
      node.apiKey,
      '--autoonline',
      '--verbosity',
      '4',
      '--config',
      node.configFile,
    ]

    const child = spawn(nodeBinaryPath, parameters, {
      cwd: node.nodeDir,
      env: process.env,
    })

    node.process = child
    node.rpcReady = false
    node.peerCount = 0
    node.syncing = true
    node.currentPeriod = null
    node.nextValidation = null

    streamNodeOutput(node, child.stdout, node.logFile)
    streamNodeOutput(node, child.stderr, node.errorFile)

    child.on('error', (error) => {
      appendLog(`[${node.name}] process error: ${error.message}`)
      if (state.run && state.run.nodes.includes(node)) {
        publishStatus({
          stage: VALIDATION_DEVNET_PHASE.FAILED,
          error: `${node.name} failed to start: ${error.message}`,
          message: 'Validation rehearsal network failed to start.',
        })
      }
    })

    child.on('exit', (code) => {
      node.rpcReady = false
      appendLog(`[${node.name}] exited with code ${code}`)

      if (state.run && state.run.nodes.includes(node)) {
        publishStatus()
      }
    })

    return child
  }

  async function waitForPrimaryPeers(run) {
    const primaryNode = run.nodes.find(
      ({name}) => name === run.plan.primaryNodeName
    )

    if (!primaryNode) {
      return
    }

    const requiredPeerCount = getValidationDevnetPrimaryPeerTarget(
      run.nodes.length
    )

    const stabilized = await waitForCondition(
      async () => {
        try {
          await refreshNodeRuntime(primaryNode)
          publishStatus({
            stage: VALIDATION_DEVNET_PHASE.WAITING_FOR_PEERS,
            message: `Waiting for the rehearsal nodes to discover each other (${
              primaryNode.peerCount || 0
            }/${requiredPeerCount} primary peers).`,
          })
          return (primaryNode.peerCount || 0) >= requiredPeerCount
        } catch {
          return false
        }
      },
      VALIDATION_DEVNET_PEER_STABILIZE_TIMEOUT_MS,
      VALIDATION_DEVNET_RETRY_INTERVAL_MS
    )

    if (!stabilized) {
      throw new Error(
        `Primary rehearsal node did not reach ${requiredPeerCount} peers in time`
      )
    }
  }

  async function waitForValidatorOnline(run) {
    const expectedOnlineNodeCount = run.nodes.length

    const validatorsOnline = await waitForCondition(
      async () => {
        await Promise.all(run.nodes.map((node) => refreshNodeRuntime(node)))
        const onlineNodeCount = run.nodes.filter((node) => node.online).length

        publishStatus({
          stage: VALIDATION_DEVNET_PHASE.WAITING_FOR_PEERS,
          message: `Waiting for rehearsal validators to come online (${onlineNodeCount}/${expectedOnlineNodeCount} online).`,
        })

        return onlineNodeCount >= expectedOnlineNodeCount
      },
      VALIDATION_DEVNET_VALIDATOR_ONLINE_TIMEOUT_MS,
      VALIDATION_DEVNET_RETRY_INTERVAL_MS
    )

    if (!validatorsOnline) {
      throw new Error(
        'Rehearsal validators did not all reach online status in time'
      )
    }
  }

  async function seedValidationFlips(run, payload = {}) {
    const assignedSeedFlipCount = countValidationDevnetAssignedSeedFlips(
      run.plan.seedAssignments
    )
    const seedSet = await loadValidationDevnetSeedFlips({
      seedFile: payload.seedFile,
      seedFlipCount: assignedSeedFlipCount,
    })
    const requestedCount = seedSet.flips.length
    const seedAuthorNames = run.nodes
      .filter((node) => (run.plan.seedAssignments[node.name] || 0) > 0)
      .map(({name}) => name)

    if (seedAuthorNames.length === 0) {
      throw new Error('No rehearsal nodes are configured to publish seed flips')
    }

    const flipSubmitCounts = {}
    const baseFlipCounts = {}
    const {primaryNodeName} = run.plan

    for (const node of run.nodes) {
      flipSubmitCounts[node.name] = 0
      // eslint-disable-next-line no-await-in-loop
      const identity = await callNodeRpc(node, 'dna_identity', [
        node.address,
      ]).catch(() => null)
      baseFlipCounts[node.name] =
        getValidationDevnetPublishedFlipCount(identity)
    }
    const initialPrimaryConfirmedCount = baseFlipCounts[primaryNodeName] || 0

    publishStatus({
      stage: VALIDATION_DEVNET_PHASE.SEEDING_FLIPS,
      message: `Publishing ${requestedCount} FLIP-Challenge seed flips on the rehearsal network.`,
      seedSource: seedSet.source,
      seedSourceFile: seedSet.sourceFile,
      seedRequestedCount: requestedCount,
      seedSubmittedCount: 0,
      seedConfirmedCount: initialPrimaryConfirmedCount,
    })

    let submittedCount = 0
    const submittedSeedFlips = []

    for (const [index, flip] of seedSet.flips.entries()) {
      const authorName = seedAuthorNames[index % seedAuthorNames.length]
      const authorNode = run.nodes.find(({name}) => name === authorName)

      if (!authorNode) {
        throw new Error(`Seed author node ${authorName} is unavailable`)
      }

      const pairId = flipSubmitCounts[authorNode.name]
      const submitArgs = buildValidationDevnetSeedFlipSubmitArgs(flip, pairId)

      // eslint-disable-next-line no-await-in-loop
      const result = await callNodeRpc(authorNode, 'flip_submit', [submitArgs])
      const submittedHash = normalizeValidationDevnetSubmittedFlipHash(result)
      flipSubmitCounts[authorNode.name] += 1
      submittedCount += 1
      submittedSeedFlips.push({
        ...flip,
        hash: submittedHash || flip.hash,
        sourceHash: flip.hash,
      })

      appendLog(
        `[devnet] seeded FLIP-Challenge flip ${submittedCount}/${requestedCount} via ${
          authorNode.name
        }: ${flip.hash || `seed-${submittedCount}`} -> ${
          submittedHash || 'submitted'
        }`
      )
      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.SEEDING_FLIPS,
        message: `Publishing ${requestedCount} FLIP-Challenge seed flips on the rehearsal network.`,
        seedSource: seedSet.source,
        seedSourceFile: seedSet.sourceFile,
        seedRequestedCount: requestedCount,
        seedSubmittedCount: submittedCount,
      })
    }

    const confirmationTargets = seedAuthorNames.reduce((result, nodeName) => {
      result[nodeName] =
        (baseFlipCounts[nodeName] || 0) + (flipSubmitCounts[nodeName] || 0)
      return result
    }, {})
    const primaryNode = run.nodes.find(({name}) => name === primaryNodeName)
    const primaryTargetFlipCount = confirmationTargets[primaryNodeName] || 0

    if (!primaryNode) {
      throw new Error('Primary rehearsal node is unavailable for seed checks')
    }

    const waitForNodeSeedConfirmation = async ({
      node,
      nodeName,
      targetFlipCount,
      timeoutMs = VALIDATION_DEVNET_SEED_CONFIRM_TIMEOUT_MS,
      updatePrimaryStatus = false,
    }) =>
      waitForCondition(
        async () => {
          try {
            const identity = await callNodeRpc(node, 'dna_identity', [
              node.address,
            ])
            const nextFlipCount =
              getValidationDevnetPublishedFlipCount(identity)

            if (updatePrimaryStatus) {
              publishStatus({
                stage: VALIDATION_DEVNET_PHASE.SEEDING_FLIPS,
                message: `Waiting for rehearsal flips to confirm on ${nodeName}.`,
                seedSource: seedSet.source,
                seedSourceFile: seedSet.sourceFile,
                seedRequestedCount: requestedCount,
                seedSubmittedCount: submittedCount,
                seedConfirmedCount: nextFlipCount,
              })
            }

            return nextFlipCount >= targetFlipCount ? nextFlipCount : null
          } catch {
            return null
          }
        },
        timeoutMs,
        VALIDATION_DEVNET_RETRY_INTERVAL_MS
      )

    const confirmedPrimaryFlipCount = await waitForNodeSeedConfirmation({
      node: primaryNode,
      nodeName: primaryNodeName,
      targetFlipCount: primaryTargetFlipCount,
      updatePrimaryStatus: true,
    })

    if (primaryTargetFlipCount > 0 && !confirmedPrimaryFlipCount) {
      throw new Error(
        'Primary rehearsal identity did not confirm its required seeded flips in time'
      )
    }

    const collectPrimarySeedVisibilitySnapshot = async () => {
      const identities = {}
      const pendingNodeNames = []

      for (const nodeName of seedAuthorNames) {
        const node = run.nodes.find(({name}) => name === nodeName)

        if (!node) {
          return null
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          const identity = await callNodeRpc(primaryNode, 'dna_identity', [
            node.address,
          ])
          const nextFlipCount = getValidationDevnetPublishedFlipCount(identity)

          identities[nodeName] = nextFlipCount

          if (nextFlipCount < confirmationTargets[nodeName]) {
            pendingNodeNames.push(nodeName)
          }
        } catch {
          return null
        }
      }

      return {
        identities,
        pendingNodeNames,
      }
    }

    const primarySeedVisibilitySnapshot = await waitForCondition(
      async () => {
        const snapshot = await collectPrimarySeedVisibilitySnapshot()

        if (!snapshot) {
          return null
        }

        const visibleNodeCount =
          seedAuthorNames.length - snapshot.pendingNodeNames.length

        publishStatus({
          stage: VALIDATION_DEVNET_PHASE.SEEDING_FLIPS,
          message: `Waiting for the primary rehearsal node to observe all seeded flips (${visibleNodeCount}/${seedAuthorNames.length} authors visible).`,
          seedSource: seedSet.source,
          seedSourceFile: seedSet.sourceFile,
          seedRequestedCount: requestedCount,
          seedSubmittedCount: submittedCount,
          seedConfirmedCount: confirmedPrimaryFlipCount,
          seedPrimaryVisibleNodeCount: visibleNodeCount,
          seedPrimaryExpectedNodeCount: seedAuthorNames.length,
          seedPrimaryPendingNodeNames: snapshot.pendingNodeNames,
        })

        return snapshot.pendingNodeNames.length === 0 ? snapshot : null
      },
      VALIDATION_DEVNET_PRIMARY_SEED_VISIBILITY_TIMEOUT_MS,
      VALIDATION_DEVNET_RETRY_INTERVAL_MS
    )

    if (!primarySeedVisibilitySnapshot) {
      throw new Error(
        'Primary rehearsal node did not observe all seeded flips in time'
      )
    }

    const collectSeedConfirmationSnapshot = async () => {
      const identities = {}
      const pendingNodeNames = []
      let nextPrimaryConfirmedCount =
        confirmedPrimaryFlipCount || initialPrimaryConfirmedCount || 0

      for (const nodeName of seedAuthorNames) {
        const node = run.nodes.find(({name}) => name === nodeName)

        if (!node) {
          return null
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          const identity = await callNodeRpc(node, 'dna_identity', [
            node.address,
          ])
          const nextFlipCount = getValidationDevnetPublishedFlipCount(identity)

          identities[nodeName] = nextFlipCount

          if (nodeName === primaryNodeName) {
            nextPrimaryConfirmedCount = nextFlipCount
          }

          if (nextFlipCount < confirmationTargets[nodeName]) {
            pendingNodeNames.push(nodeName)
          }
        } catch {
          return null
        }
      }

      return {
        identities,
        pendingNodeNames,
        primaryConfirmedCount: nextPrimaryConfirmedCount,
      }
    }

    const initialSeedState = {
      source: seedSet.source,
      sourceFile: seedSet.sourceFile,
      flipMetaByHash: buildValidationDevnetSeedFlipMetaByHash([
        ...seedSet.flips,
        ...submittedSeedFlips,
      ]),
      flipReviewPayloadByHash: buildValidationDevnetSeedFlipReviewPayloadByHash(
        [...seedSet.flips, ...submittedSeedFlips]
      ),
      requested: requestedCount,
      submitted: submittedCount,
      confirmed: confirmedPrimaryFlipCount || initialPrimaryConfirmedCount || 0,
      confirmedNodeCount: 1,
      expectedNodeCount: seedAuthorNames.length,
      pendingNodeNames: seedAuthorNames.filter(
        (nodeName) => nodeName !== primaryNodeName
      ),
      primaryVisibleNodeCount: seedAuthorNames.length,
      primaryExpectedNodeCount: seedAuthorNames.length,
      primaryPendingNodeNames: [],
      authors: seedAuthorNames,
    }

    run.seed = initialSeedState
    ;(async () => {
      try {
        const confirmedSnapshot = await waitForCondition(
          async () => {
            if (!state.run || state.run !== run) {
              return null
            }

            const snapshot = await collectSeedConfirmationSnapshot()

            if (!snapshot) {
              return null
            }

            if (snapshot.pendingNodeNames.length > 0) {
              const runningInBackground =
                state.status.stage === VALIDATION_DEVNET_PHASE.RUNNING
              publishStatus({
                stage: runningInBackground
                  ? VALIDATION_DEVNET_PHASE.RUNNING
                  : VALIDATION_DEVNET_PHASE.SEEDING_FLIPS,
                message: runningInBackground
                  ? 'Validation rehearsal network is running while some validator seed flips continue confirming in the background.'
                  : 'Waiting for rehearsal seed flips to confirm across validator identities.',
                seedSource: seedSet.source,
                seedSourceFile: seedSet.sourceFile,
                seedRequestedCount: requestedCount,
                seedSubmittedCount: submittedCount,
                seedConfirmedCount: snapshot.primaryConfirmedCount,
                seedConfirmedNodeCount:
                  seedAuthorNames.length - snapshot.pendingNodeNames.length,
                seedExpectedNodeCount: seedAuthorNames.length,
                seedPendingNodeNames: snapshot.pendingNodeNames,
              })
              return null
            }

            return snapshot
          },
          VALIDATION_DEVNET_SEED_CONFIRM_TIMEOUT_MS,
          VALIDATION_DEVNET_RETRY_INTERVAL_MS
        )

        if (!state.run || state.run !== run) {
          return
        }

        if (confirmedSnapshot) {
          run.seed = {
            ...run.seed,
            confirmed:
              confirmedSnapshot.identities[primaryNodeName] ||
              confirmedSnapshot.primaryConfirmedCount ||
              run.seed.confirmed,
            confirmedNodeCount: seedAuthorNames.length,
            expectedNodeCount: seedAuthorNames.length,
            pendingNodeNames: [],
          }
          appendLog(
            '[devnet] rehearsal seed flips confirmed across all validator identities'
          )
        } else {
          const latestSnapshot = await collectSeedConfirmationSnapshot().catch(
            () => null
          )
          const pendingNodeNames =
            latestSnapshot && Array.isArray(latestSnapshot.pendingNodeNames)
              ? latestSnapshot.pendingNodeNames
              : run.seed.pendingNodeNames || []
          const confirmedNodeCount =
            latestSnapshot && Array.isArray(latestSnapshot.pendingNodeNames)
              ? seedAuthorNames.length - latestSnapshot.pendingNodeNames.length
              : Math.max(1, run.seed.confirmedNodeCount || 1)

          run.seed = {
            ...run.seed,
            confirmed:
              (latestSnapshot && latestSnapshot.primaryConfirmedCount) ||
              run.seed.confirmed,
            confirmedNodeCount,
            expectedNodeCount: seedAuthorNames.length,
            pendingNodeNames,
          }

          appendLog(
            `[devnet] continuing rehearsal startup while seed confirmation is still pending on ${
              pendingNodeNames.length > 0
                ? pendingNodeNames.join(', ')
                : 'some validator identities'
            }`
          )
        }

        await refreshRunRuntimeSerialized()
      } catch (error) {
        if (state.run && state.run === run) {
          appendLog(
            `[devnet] background seed confirmation failed: ${
              error && error.message ? error.message : error
            }`
          )
          publishStatus()
        }
      }
    })()

    return {
      seed: initialSeedState,
    }
  }

  async function getSeedFlip(hash) {
    const normalizedHash = normalizeValidationDevnetSeedHash(hash)

    if (!normalizedHash) {
      return null
    }

    const activePayload =
      state.run &&
      state.run.seed &&
      state.run.seed.flipReviewPayloadByHash &&
      state.run.seed.flipReviewPayloadByHash[normalizedHash]

    if (activePayload) {
      return activePayload
    }

    if (!seedFlipReviewPayloadCache) {
      const seedSet = await loadValidationDevnetSeedFlips({
        seedFlipCount: VALIDATION_DEVNET_MAX_SEED_FLIP_COUNT,
      })
      seedFlipReviewPayloadCache =
        buildValidationDevnetSeedFlipReviewPayloadByHash(seedSet.flips)
    }

    return seedFlipReviewPayloadCache[normalizedHash] || null
  }

  function getConnectionDetails() {
    if (!state.run) {
      throw new Error('Validation rehearsal network is not running.')
    }

    const primaryNode = state.run.nodes.find(
      ({name}) => name === state.run.plan.primaryNodeName
    )

    if (!primaryNode) {
      throw new Error('Primary rehearsal node is unavailable.')
    }

    return {
      url: `http://127.0.0.1:${primaryNode.rpcPort}`,
      apiKey: primaryNode.apiKey,
    }
  }

  async function start(payload = {}) {
    setEmitters(payload)

    if (
      state.run ||
      (state.status.stage &&
        ![
          VALIDATION_DEVNET_PHASE.IDLE,
          VALIDATION_DEVNET_PHASE.FAILED,
        ].includes(state.status.stage))
    ) {
      appendLog('[devnet] validation rehearsal network is already running')
      return buildStatus()
    }

    publishStatus({
      stage: VALIDATION_DEVNET_PHASE.PREPARING_BINARY,
      message: 'Preparing bundled Idena node binary for the rehearsal network.',
      error: null,
    })

    const ensureBinary = ensureNodeBinary || defaultEnsureNodeBinary

    try {
      await ensureBinary((progressStatus) => publishStatus(progressStatus))

      const plan = buildValidationDevnetPlan({
        baseDir,
        nodeCount: payload.nodeCount,
        seedFlipCount: payload.seedFlipCount,
        firstCeremonyLeadSeconds: payload.firstCeremonyLeadSeconds,
        firstCeremonyUnix: payload.firstCeremonyUnix,
        initialEpoch: payload.initialEpoch,
        networkId: payload.networkId,
        afterLongSessionSeconds: payload.afterLongSessionSeconds,
        validationPaddingSeconds: payload.validationPaddingSeconds,
        now,
      })

      const run = {
        plan,
        nodes: plan.nodes.map((node) => ({...node})),
        startedAt: new Date(now()).toISOString(),
        seed: null,
      }

      state.logs = []
      state.run = run

      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.PREPARING_CONFIG,
        message: 'Writing private-network configs for the rehearsal nodes.',
        error: null,
      })

      await assignAvailablePorts(run)
      await ensureRunDirectories(run)
      await Promise.all(
        run.nodes.map((node) => writeNodeConfig(run.plan, node))
      )

      const bootstrapNode = run.nodes[0]
      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.STARTING_BOOTSTRAP,
        message: 'Starting rehearsal bootstrap node.',
      })
      spawnNodeProcess(bootstrapNode)
      await waitForNodeRpc(bootstrapNode)

      const bootstrapAddr = await callNodeRpc(bootstrapNode, 'net_ipfsAddress')
      appendLog(`[devnet] bootstrap node is reachable at ${bootstrapAddr}`)

      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.STARTING_VALIDATORS,
        message: `Starting ${Math.max(
          0,
          run.nodes.length - 1
        )} rehearsal validator nodes.`,
      })

      const validatorBootNodes = [bootstrapAddr]
      for (const [index, node] of run.nodes.slice(1).entries()) {
        publishStatus({
          stage: VALIDATION_DEVNET_PHASE.STARTING_VALIDATORS,
          message: `Starting rehearsal validator ${index + 1}/${Math.max(
            0,
            run.nodes.length - 1
          )}.`,
        })

        // Use a cumulative bootnode list so later validators connect to the
        // already-running validator set instead of relying on a single
        // bootstrap edge.
        // eslint-disable-next-line no-await-in-loop
        await writeNodeConfig(run.plan, node, validatorBootNodes)
        spawnNodeProcess(node)
        // eslint-disable-next-line no-await-in-loop
        await waitForNodeRpc(node)
        // eslint-disable-next-line no-await-in-loop
        const nodeAddr = await callNodeRpc(node, 'net_ipfsAddress').catch(
          () => null
        )
        if (nodeAddr) {
          validatorBootNodes.push(nodeAddr)
        }
      }

      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.WAITING_FOR_PEERS,
        message: 'Waiting for the rehearsal nodes to discover each other.',
      })

      await waitForPrimaryPeers(run)
      await waitForValidatorOnline(run)
      if (payload.seedFlips !== false) {
        const seeded = await seedValidationFlips(run, payload)
        run.seed = seeded.seed
      }
      await refreshRunRuntimeSerialized()

      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.RUNNING,
        message:
          run.seed && run.seed.submitted > 0
            ? `Validation rehearsal network is running with ${run.seed.submitted} FLIP-Challenge seed flips.`
            : 'Validation rehearsal network is running.',
        error: null,
      })

      return refreshRunRuntimeSerialized()
    } catch (error) {
      logger.error('validation devnet failed to start', error.toString())
      appendLog(`[devnet] start failed: ${error.message}`)
      await stop({quiet: true})
      return publishStatus({
        active: false,
        stage: VALIDATION_DEVNET_PHASE.FAILED,
        error: error.message,
        message: 'Validation rehearsal network failed to start.',
      })
    }
  }

  async function stop({quiet = false} = {}) {
    if (!state.run) {
      return publishStatus({
        active: false,
        stage: VALIDATION_DEVNET_PHASE.IDLE,
        message: 'Validation rehearsal network is stopped.',
        error: null,
      })
    }

    publishStatus({
      stage: VALIDATION_DEVNET_PHASE.STOPPING,
      message: 'Stopping the validation rehearsal network.',
      error: null,
    })

    const {run} = state
    state.run = null

    await Promise.all(
      run.nodes.map(
        (node) =>
          new Promise((resolve) => {
            if (
              !node.process ||
              !Number.isInteger(node.process.pid) ||
              node.process.exitCode != null
            ) {
              resolve()
              return
            }

            kill(
              node.process.pid,
              process.platform === 'win32' ? 'SIGTERM' : 'SIGINT',
              () => resolve()
            )
          })
      )
    )

    if (!quiet) {
      appendLog('[devnet] validation rehearsal network stopped')
    }

    return publishStatus({
      active: false,
      stage: VALIDATION_DEVNET_PHASE.IDLE,
      message: 'Validation rehearsal network is stopped.',
      error: null,
    })
  }

  async function getStatus(payload = {}) {
    setEmitters(payload)

    return refreshRunRuntimeSerialized()
  }

  function getLogs(payload = {}) {
    setEmitters(payload)

    if (emitters.onLog) {
      state.logs.forEach((line) => emitters.onLog(line))
    }

    return [...state.logs]
  }

  return {
    start,
    stop,
    getStatus,
    getLogs,
    getSeedFlip,
    getConnectionDetails,
  }
}

module.exports = {
  VALIDATION_DEVNET_PHASE,
  buildValidationDevnetPlan,
  buildValidationDevnetNodeConfig,
  buildValidationDevnetSeedFlipSubmitArgs,
  getValidationDevnetPublishedFlipCount,
  loadValidationDevnetSeedFlips,
  serializeValidationDevnetConfig,
  summarizeValidationDevnetNode,
  getValidationDevnetPrimaryPeerTarget,
  countReadyValidationHashItems,
  getValidationHashQueryCapabilities,
  shouldSuppressValidationDevnetLogLine,
  canConnectValidationDevnetStatus,
  shouldConnectValidationDevnetStatus,
  buildValidationDevnetSeedFlipMetaByHash,
  buildValidationDevnetSeedFlipReviewPayloadByHash,
  loadValidationDevnetSeedPayload,
  createValidationDevnetController,
  createDefaultValidationDevnetController,
}
