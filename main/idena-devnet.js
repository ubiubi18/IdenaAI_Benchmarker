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

function collectSeedFlipCandidate(
  flip,
  candidatePath,
  collectedFlips,
  seenHashes
) {
  const flipHash = String(flip && flip.hash ? flip.hash : '').trim()
  const dedupeKey =
    flipHash ||
    `${candidatePath}:${collectedFlips.length}:${flip?.images?.[0] || ''}`

  if (seenHashes.has(dedupeKey)) {
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
  seenHashes
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
          const flip = {
            hash: flipHash,
            images: encodedImages,
            orders: orders.slice(0, 2),
            expectedAnswer: String(record?.expected_answer || '').trim(),
            expectedStrength: String(record?.expected_strength || '').trim(),
          }

          if (isValidSeedFlipCandidate(flip)) {
            seenHashes.add(dedupeKey)
            collectedFlips.push(flip)
            addedCount += 1

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

async function loadValidationDevnetSeedFlips({seedFile, seedFlipCount} = {}) {
  const desiredCount = normalizeSeedFlipCount(seedFlipCount)
  const candidates = uniqStrings([
    seedFile,
    ...VALIDATION_DEVNET_DEFAULT_SEED_FILES,
    ...VALIDATION_DEVNET_LOCAL_FALLBACK_SEED_FILES,
  ])
  const collectedFlips = []
  const seenHashes = new Set()
  let resolvedSource = 'aplesner-eth/FLIP-Challenge'
  let resolvedSourceFile = null

  for (const candidatePath of candidates) {
    try {
      if (/\.jsonl$/iu.test(candidatePath)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await collectValidationDevnetPreparedSeedFlips(
          candidatePath,
          desiredCount,
          collectedFlips,
          seenHashes
        )

        if (result.addedCount > 0) {
          resolvedSource = result.source || resolvedSource
          resolvedSourceFile = resolvedSourceFile || candidatePath
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const payload = await fs.readJson(candidatePath)
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
              seenHashes
            )

            if (collectedFlips.length >= desiredCount) {
              break
            }
          }
        }
      }

      if (collectedFlips.length >= desiredCount) {
        return {
          source: resolvedSource,
          sourceFile: resolvedSourceFile,
          flips: collectedFlips.slice(0, desiredCount),
        }
      }
    } catch {
      // try the next bundled candidate
    }
  }

  if (collectedFlips.length > 0) {
    const reusableFlips = collectedFlips.slice()
    let duplicateIndex = 0

    while (collectedFlips.length < desiredCount) {
      const baseFlip = reusableFlips[duplicateIndex % reusableFlips.length]
      duplicateIndex += 1
      collectedFlips.push(
        cloneValidationDevnetSeedFlip(baseFlip, duplicateIndex)
      )
    }

    return {
      source: resolvedSource,
      sourceFile: resolvedSourceFile,
      flips: collectedFlips.slice(0, desiredCount),
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
} = {}) {
  const resolvedLongSessionSeconds =
    normalizePositiveInteger(longSessionSeconds, 0) ||
    getValidationDevnetLongSessionSeconds(nodeCount)
  const minimumValidationIntervalSeconds =
    flipLotterySeconds +
    shortSessionSeconds +
    resolvedLongSessionSeconds +
    VALIDATION_DEVNET_DEFAULT_AFTER_LONG_SESSION_SECONDS +
    VALIDATION_DEVNET_DEFAULT_VALIDATION_PADDING_SECONDS
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
    durations: buildValidationDurations({nodeCount: nextNodeCount}),
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
    status: {
      active: false,
      stage: VALIDATION_DEVNET_PHASE.IDLE,
      message: 'Validation rehearsal network is stopped.',
    },
  }

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

      state.statusRefreshInFlight = true
      try {
        await refreshRunRuntime()
      } catch {
        publishStatus()
      } finally {
        state.statusRefreshInFlight = false
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
    const canQueryShortHashes =
      currentPeriod === 'FlipLottery' || currentPeriod === 'ShortSession'
    const canQueryLongHashes =
      canQueryShortHashes || currentPeriod === 'LongSession'

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
      flipSubmitCounts[authorNode.name] += 1
      submittedCount += 1

      appendLog(
        `[devnet] seeded FLIP-Challenge flip ${submittedCount}/${requestedCount} via ${
          authorNode.name
        }: ${flip.hash || `seed-${submittedCount}`} -> ${
          (result && result.hash) || 'submitted'
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

        await refreshRunRuntime()
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
      await refreshRunRuntime()

      publishStatus({
        stage: VALIDATION_DEVNET_PHASE.RUNNING,
        message:
          run.seed && run.seed.submitted > 0
            ? `Validation rehearsal network is running with ${run.seed.submitted} FLIP-Challenge seed flips.`
            : 'Validation rehearsal network is running.',
        error: null,
      })

      return refreshRunRuntime()
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

    return refreshRunRuntime()
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
  canConnectValidationDevnetStatus,
  shouldConnectValidationDevnetStatus,
  createValidationDevnetController,
  createDefaultValidationDevnetController,
}
