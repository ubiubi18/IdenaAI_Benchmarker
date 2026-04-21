const {join, resolve} = require('path')
const os = require('os')
const {
  BrowserWindow,
  app,
  ipcMain,
  Tray,
  Menu,
  nativeTheme,
  screen,
  shell,
  // eslint-disable-next-line import/no-extraneous-dependencies
} = require('electron')
const {autoUpdater} = require('electron-updater')
const fs = require('fs-extra')
const i18next = require('i18next')
const {image_search: imageSearch} = require('duckduckgo-images-api')
const macosVersion = require('macos-version')
const semver = require('semver')
const axios = require('axios')
const {zoomIn, zoomOut, resetZoom} = require('./utils')
const loadRoute = require('./utils/routes')

const {DEV_SERVER_ORIGIN} = loadRoute

const {getI18nConfig} = require('./language')
const appDataPath = require('./app-data-path')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const isDev = !app.isPackaged
const RUNTIME_APP_NAME = 'IdenaAI'
const RUNTIME_STORAGE_NAME = 'IdenaAI'
const RUNTIME_APP_ID = 'io.idena.ai'

app.setName(RUNTIME_APP_NAME)

if (isWin && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId(RUNTIME_APP_ID)
}

const runtimeUserDataPath = join(app.getPath('appData'), RUNTIME_STORAGE_NAME)
app.commandLine.appendSwitch(
  'disk-cache-dir',
  join(runtimeUserDataPath, 'Cache')
)

if (process.env.NODE_ENV === 'e2e') {
  app.setPath('userData', join(app.getPath('userData'), 'tests'))
  fs.removeSync(app.getPath('userData'))
} else {
  app.setPath('userData', runtimeUserDataPath)
}

if (isWin) {
  app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
}

const appVersion = global.appVersion || app.getVersion()

const logger = require('./logger')
const {toIpcCloneable} = require('./utils/ipc-cloneable')

logger.info('idena started', appVersion)

const {
  AUTO_UPDATE_EVENT,
  AUTO_UPDATE_COMMAND,
  NODE_COMMAND,
  NODE_EVENT,
  APP_INFO_COMMAND,
  APP_PATH_COMMAND,
  AI_SOLVER_COMMAND,
  AI_TEST_UNIT_COMMAND,
  AI_TEST_UNIT_EVENT,
  WINDOW_COMMAND,
} = require('./channels')
const {registerRendererDataBridge} = require('./renderer-data-bridge')
const {createAiProviderBridge} = require('./ai-providers')
const {createAiTestUnitBridge} = require('./ai-test-unit')
const {prepareDb} = require('./stores/setup')
const {createLocalAiFederated} = require('./local-ai/federated')
const {createLocalAiManager} = require('./local-ai/manager')
const {resolveLocalAiRuntimeAdapter} = require('./local-ai/runtime-adapter')
const {ensureLocalAiEnabled} = require('./local-ai/enablement')
const {
  LOCAL_AI_RUNTIME_MODE,
  LOCAL_AI_RUNTIME,
  LOCAL_AI_RUNTIME_BACKEND,
  LOCAL_AI_REASONER_BACKEND,
  LOCAL_AI_VISION_BACKEND,
  LOCAL_AI_RUNTIME_FAMILY,
  LOCAL_AI_DEFAULT_MODEL,
  LOCAL_AI_DEFAULT_VISION_MODEL,
  LOCAL_AI_PUBLIC_MODEL_ID,
  LOCAL_AI_PUBLIC_VISION_ID,
  LOCAL_AI_ADAPTER_STRATEGY,
  LOCAL_AI_TRAINING_POLICY,
  LOCAL_AI_CONTRACT_VERSION,
} = require('./local-ai/constants')
const {
  startNode,
  stopNode,
  downloadNode,
  updateNode,
  getCurrentVersion,
  cleanNodeState,
  getLastLogs,
  getNodeChainDbFolder,
  getNodeFile,
  getNodeIpfsDir,
  tryStopNode,
} = require('./idena-node')
const {
  createDefaultValidationDevnetController,
  shouldConnectValidationDevnetStatus,
} = require('./idena-devnet')

const NodeUpdater = require('./node-updater')

const localAiManager = createLocalAiManager({
  logger,
  isDev,
  getModelReference: getMainLocalAiSettings,
})
const aiProviderBridge = createAiProviderBridge(logger, {
  localAiManager,
  getLocalAiPayload: buildLocalAiFlipJudgePayload,
})
const aiTestUnitBridge = createAiTestUnitBridge({
  logger,
  aiProviderBridge,
})
const localAiFederated = createLocalAiFederated({
  logger,
  isDev,
  getBaseModelReference: getMainLocalAiSettings,
})

const IMAGE_SEARCH_SOURCE_TIMEOUT_MS = 8000
const BASE_INTERNAL_API_PORT = 9119
const BASE_EXTERNAL_API_URL = 'http://localhost:9009'
const RPC_MAX_METHOD_LENGTH = 128
const SOCIAL_RPC_MAX_REQUEST_ID_LENGTH = 128
const SOCIAL_RPC_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const SOCIAL_ALLOWED_RPC_METHODS = new Set([
  'bcn_block',
  'bcn_blockAt',
  'bcn_getRawTx',
  'bcn_lastBlock',
  'bcn_syncing',
  'bcn_transaction',
  'bcn_txReceipt',
  'contract_call',
  'dna_epoch',
  'dna_getBalance',
  'dna_getCoinbaseAddr',
  'dna_identity',
  'dna_storeToIpfs',
  'ipfs_add',
  'ipfs_get',
])

let mainWindow
let node
let nodeDownloadPromise = null
let tray
const validationDevnet = createDefaultValidationDevnetController({logger})

const nodeUpdater = new NodeUpdater(logger)

let dnaUrl
let isCheckingForUpdates = false

const RELEASE_REPOSITORY = {
  owner: 'ubiubi18',
  repo: 'IdenaAI',
}

const RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}/releases/latest`

let runtimeExternalNodeOverride = null

function normalizeRuntimeExternalNodeOverride(value = null) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const url = pickTrimmedString([value.url], '')
  const key = pickTrimmedString([value.key, value.apiKey], '')

  if (!url || !key) {
    return null
  }

  return {url, key}
}

function loadMainSettings() {
  try {
    return prepareDb('settings').getState() || {}
  } catch {
    return {}
  }
}

function isTrustedRendererUrl(url) {
  if (!url) {
    return false
  }

  if (app.isPackaged) {
    return url.startsWith('file://')
  }

  try {
    return new URL(url).origin === DEV_SERVER_ORIGIN
  } catch {
    return false
  }
}

function assertTrustedSender(event) {
  const senderUrl = String(
    (event && event.senderFrame && event.senderFrame.url) ||
      (event && event.sender && typeof event.sender.getURL === 'function'
        ? event.sender.getURL()
        : '') ||
      ''
  ).trim()

  const isBootFrame =
    (senderUrl === '' || senderUrl === 'about:blank') &&
    mainWindow &&
    event &&
    event.sender === mainWindow.webContents

  if (isBootFrame || isTrustedRendererUrl(senderUrl)) {
    return
  }

  throw new Error(`Blocked IPC sender: ${senderUrl || 'unknown'}`)
}

function handleTrusted(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    return toIpcCloneable(await listener(event, ...args))
  })
}

function handleOnceTrusted(channel, listener) {
  ipcMain.handleOnce(channel, async (event, ...args) => {
    assertTrustedSender(event)
    return toIpcCloneable(await listener(event, ...args))
  })
}

function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedSender(event)
    return listener(event, ...args)
  })
}

registerRendererDataBridge({onTrusted, handleTrusted})

function normalizeExternalUrl(value) {
  try {
    const nextUrl = new URL(String(value || '').trim())

    if (
      nextUrl.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(nextUrl.hostname)
    ) {
      return nextUrl.toString()
    }

    if (['https:', 'mailto:', 'dna:'].includes(nextUrl.protocol)) {
      return nextUrl.toString()
    }
  } catch {
    return null
  }

  return null
}

async function openExternalSafely(url) {
  const safeUrl = normalizeExternalUrl(url)

  if (!safeUrl) {
    throw new Error('Unsupported external URL')
  }

  return shell.openExternal(safeUrl)
}

onTrusted(APP_INFO_COMMAND, (event) => {
  event.returnValue = {
    version: appVersion,
    locale: app.getLocale(),
    totalSystemMemoryBytes: os.totalmem(),
  }
})

onTrusted(APP_PATH_COMMAND, (event, folder) => {
  event.returnValue = appDataPath(folder)
})

function pickTrimmedString(values, fallback = '') {
  for (const value of values) {
    if (typeof value === 'string') {
      const text = value.trim()

      if (text) {
        return text
      }
    }
  }

  return fallback
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isShortString(value, maxLength = 512) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  )
}

function estimatePayloadBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validateSocialRpcRequest(payload = {}) {
  const requestId = payload && payload.requestId
  const method = payload && payload.method
  const params = payload && payload.params

  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > SOCIAL_RPC_MAX_REQUEST_ID_LENGTH
  ) {
    return 'invalid_rpc_request_id'
  }

  if (!SOCIAL_ALLOWED_RPC_METHODS.has(method)) {
    return 'unsupported_rpc_method'
  }

  if (!Array.isArray(params)) {
    return 'invalid_rpc_params'
  }

  if (estimatePayloadBytes(params) > SOCIAL_RPC_MAX_PAYLOAD_BYTES) {
    return 'rpc_payload_too_large'
  }

  switch (method) {
    case 'bcn_syncing':
    case 'bcn_lastBlock':
    case 'dna_epoch':
    case 'dna_getCoinbaseAddr':
      return params.length === 0 ? null : 'invalid_rpc_params'

    case 'bcn_blockAt':
      return params.length === 1 && isFiniteNonNegativeInteger(params[0])
        ? null
        : 'invalid_rpc_params'

    case 'bcn_block':
    case 'bcn_transaction':
    case 'bcn_txReceipt':
    case 'dna_getBalance':
    case 'dna_identity':
    case 'ipfs_get':
      return params.length === 1 && isShortString(params[0], 256)
        ? null
        : 'invalid_rpc_params'

    case 'ipfs_add':
      return params.length === 2 &&
        isShortString(params[0], SOCIAL_RPC_MAX_PAYLOAD_BYTES) &&
        typeof params[1] === 'boolean'
        ? null
        : 'invalid_rpc_params'

    case 'dna_storeToIpfs':
      return params.length === 1 &&
        isPlainObject(params[0]) &&
        isShortString(params[0].cid, 256) &&
        isFiniteNonNegativeInteger(params[0].nonce) &&
        isFiniteNonNegativeInteger(params[0].epoch)
        ? null
        : 'invalid_rpc_params'

    case 'bcn_getRawTx':
      return params.length === 1 && isPlainObject(params[0])
        ? null
        : 'invalid_rpc_params'

    case 'contract_call':
      return params.length === 1 &&
        isPlainObject(params[0]) &&
        isShortString(params[0].from, 128) &&
        isShortString(params[0].contract, 128) &&
        isShortString(params[0].method, 128) &&
        Array.isArray(params[0].args)
        ? null
        : 'invalid_rpc_params'

    default:
      return 'unsupported_rpc_method'
  }
}

function validateNodeRpcPayload(payload = {}) {
  const method = payload && payload.method
  const params = payload && payload.params

  if (
    typeof method !== 'string' ||
    method.trim().length < 1 ||
    method.trim().length > RPC_MAX_METHOD_LENGTH
  ) {
    return 'invalid_rpc_method'
  }

  if (!Array.isArray(params)) {
    return 'invalid_rpc_params'
  }

  if (estimatePayloadBytes(payload) > SOCIAL_RPC_MAX_PAYLOAD_BYTES) {
    return 'rpc_payload_too_large'
  }

  return null
}

function getNodeRpcConnection() {
  const runtimeOverride = normalizeRuntimeExternalNodeOverride(
    runtimeExternalNodeOverride
  )

  if (runtimeOverride) {
    return runtimeOverride
  }

  const settings = loadMainSettings()
  const internalPort = Number(settings && settings.internalPort)

  if (settings && settings.useExternalNode) {
    return {
      url: pickTrimmedString([settings.url], BASE_EXTERNAL_API_URL),
      key: pickTrimmedString([settings.externalApiKey], ''),
    }
  }

  return {
    url: `http://127.0.0.1:${
      Number.isFinite(internalPort) && internalPort > 0
        ? Math.round(internalPort)
        : BASE_INTERNAL_API_PORT
    }`,
    key: pickTrimmedString([settings && settings.internalApiKey], ''),
  }
}

function getInternalNodeApiKey() {
  const settings = loadMainSettings()
  return pickTrimmedString([settings && settings.internalApiKey], '')
}

function emitValidationDevnetConnectPayload() {
  try {
    const payload = validationDevnet.getConnectionDetails()

    runtimeExternalNodeOverride = normalizeRuntimeExternalNodeOverride({
      url: payload && payload.url,
      key: payload && payload.apiKey,
    })

    if (!runtimeExternalNodeOverride) {
      return false
    }

    sendMainWindowMsg(NODE_EVENT, 'validation-devnet-connect-payload', {
      ...payload,
      label: 'Validation rehearsal node',
      transient: true,
    })

    return true
  } catch (error) {
    logger.error(
      'error while emitting validation devnet connection payload',
      error.toString()
    )
    return false
  }
}

function shouldEmitValidationDevnetConnectPayload(status, options = {}) {
  return shouldConnectValidationDevnetStatus(status, {
    connectCountdownSeconds: Number.isFinite(options.connectCountdownSeconds)
      ? options.connectCountdownSeconds
      : null,
  })
}

async function performNodeRpc(payload = {}) {
  const validationError = validateNodeRpcPayload(payload)

  if (validationError) {
    return {
      error: {
        message: validationError,
      },
    }
  }

  const {url, key} = getNodeRpcConnection()
  const requestBody = {
    method: String(payload.method || '').trim(),
    params: Array.isArray(payload.params) ? payload.params : [],
    id:
      typeof payload.id === 'number' || typeof payload.id === 'string'
        ? payload.id
        : 1,
    key,
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {'Content-Type': 'application/json'},
      timeout: 15000,
    })

    return response && response.data ? response.data : {}
  } catch (error) {
    logger.warn('Node RPC proxy failed', {
      method: payload && payload.method,
      error: error.toString(),
    })

    return {
      error: {
        message: error?.message || 'rpc_proxy_failed',
      },
    }
  }
}

function normalizeLocalAiPayload(payload = {}) {
  const MAX_LOCAL_AI_PAYLOAD_DEPTH = 8
  const MAX_LOCAL_AI_OBJECT_KEYS = 128
  const MAX_LOCAL_AI_ARRAY_ITEMS = 32
  const MAX_LOCAL_AI_TEXT_CHARS = 20000
  const MAX_LOCAL_AI_DATA_URL_CHARS = 8 * 1024 * 1024
  const MAX_LOCAL_AI_BINARY_DATA_CHARS = 128 * 1024 * 1024

  function normalizeSafeLocalAiPayloadKey(key) {
    const normalizedKey = String(key || '').slice(0, 128)

    return ['__proto__', 'constructor', 'prototype'].includes(normalizedKey)
      ? `_${normalizedKey}`
      : normalizedKey
  }

  function sanitizeLocalAiValue(value, depth = 0, key = '') {
    if (depth > MAX_LOCAL_AI_PAYLOAD_DEPTH) {
      return null
    }

    if (value === null || typeof value === 'undefined') {
      return value
    }

    if (typeof value === 'string') {
      const normalizedKey = String(key || '').trim()
      let trimmed = value.slice(0, MAX_LOCAL_AI_TEXT_CHARS)

      if (
        normalizedKey === 'artifactBase64' ||
        normalizedKey === 'base64' ||
        normalizedKey === 'dataUrl'
      ) {
        trimmed = value.slice(0, MAX_LOCAL_AI_BINARY_DATA_CHARS)
      } else if (value.startsWith('data:image/')) {
        trimmed = value.slice(0, MAX_LOCAL_AI_DATA_URL_CHARS)
      }

      return trimmed
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_LOCAL_AI_ARRAY_ITEMS)
        .map((item) => sanitizeLocalAiValue(item, depth + 1, key))
    }

    if (value && typeof value === 'object') {
      return Object.entries(value)
        .slice(0, MAX_LOCAL_AI_OBJECT_KEYS)
        .reduce((result, [entryKey, entryValue]) => {
          if (typeof entryKey !== 'string') {
            return result
          }

          const safeEntryKey = normalizeSafeLocalAiPayloadKey(entryKey)

          const sanitized = sanitizeLocalAiValue(
            entryValue,
            depth + 1,
            safeEntryKey
          )

          if (typeof sanitized !== 'undefined') {
            result[safeEntryKey] = sanitized
          }

          return result
        }, Object.create(null))
    }

    return undefined
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Object.create(null)
  }

  return sanitizeLocalAiValue(payload) || Object.create(null)
}

function pickLocalAiInput(nextPayload) {
  if (typeof nextPayload.input !== 'undefined') {
    return nextPayload.input
  }

  if (typeof nextPayload.payload !== 'undefined') {
    return nextPayload.payload
  }

  return nextPayload
}

function normalizeLocalAiRankingPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    sourcePriority:
      String(source.sourcePriority || '').trim() || 'local-node-first',
    allowPublicIndexerFallback: source.allowPublicIndexerFallback !== false,
    extraFlipBaseline: Math.max(
      0,
      Number.parseInt(source.extraFlipBaseline, 10) || 3
    ),
    excludeBadAuthors: source.excludeBadAuthors === true,
    excludeRepeatReportOffenders: source.excludeRepeatReportOffenders === true,
    maxRepeatReportOffenses: Math.max(
      0,
      Number.parseInt(source.maxRepeatReportOffenses, 10) || 1
    ),
    strongConsensusBonus:
      Number.parseFloat(source.strongConsensusBonus) || 0.15,
    weakConsensusPenalty: Number.parseFloat(source.weakConsensusPenalty) || 0.1,
    reportedVotePenaltyPerVote:
      Number.parseFloat(source.reportedVotePenaltyPerVote) || 0.12,
    wrongWordsVotePenaltyPerVote:
      Number.parseFloat(source.wrongWordsVotePenaltyPerVote) || 0.2,
    extraFlipPenaltyPerExtraFlip:
      Number.parseFloat(source.extraFlipPenaltyPerExtraFlip) || 0.08,
    badAuthorPenalty: Number.parseFloat(source.badAuthorPenalty) || 0.6,
    repeatReportPenalty: Number.parseFloat(source.repeatReportPenalty) || 0.45,
    qualifiedStatusBonus: Number.parseFloat(source.qualifiedStatusBonus) || 0.2,
    weaklyQualifiedStatusBonus:
      Number.parseFloat(source.weaklyQualifiedStatusBonus) || 0.08,
    reportedStatusPenalty:
      Number.parseFloat(source.reportedStatusPenalty) || 0.5,
    minWeight: Number.parseFloat(source.minWeight) || 0.05,
    maxWeight: Number.parseFloat(source.maxWeight) || 3,
  }
}

function getMainLocalAiSettings(payload = {}) {
  const settings = loadMainSettings()
  const nextPayload = normalizeLocalAiPayload(payload)
  const localAi =
    settings && settings.localAi && typeof settings.localAi === 'object'
      ? settings.localAi
      : {}
  const runtimeAdapter = resolveLocalAiRuntimeAdapter(
    {...localAi, ...nextPayload},
    localAi
  )

  return {
    enabled:
      nextPayload.enabled === true ||
      (typeof nextPayload.enabled === 'undefined' && localAi.enabled === true),
    mode: pickTrimmedString(
      [nextPayload.mode, localAi.runtimeMode],
      LOCAL_AI_RUNTIME_MODE
    ),
    baseUrl: pickTrimmedString(
      [
        nextPayload.endpoint,
        nextPayload.baseUrl,
        localAi.endpoint,
        localAi.baseUrl,
      ],
      runtimeAdapter.defaultBaseUrl
    ),
    model: pickTrimmedString(
      [nextPayload.model, localAi.model],
      LOCAL_AI_DEFAULT_MODEL
    ),
    visionModel: pickTrimmedString(
      [nextPayload.visionModel, localAi.visionModel],
      LOCAL_AI_DEFAULT_VISION_MODEL
    ),
    runtime: pickTrimmedString(
      [
        nextPayload.runtime,
        nextPayload.runtimeBackend,
        localAi.runtime,
        localAi.runtimeBackend,
      ],
      runtimeAdapter.runtime
    ),
    runtimeBackend: pickTrimmedString(
      [nextPayload.runtimeBackend, localAi.runtimeBackend],
      runtimeAdapter.runtimeBackend
    ),
    reasonerBackend: pickTrimmedString(
      [nextPayload.reasonerBackend, localAi.reasonerBackend],
      LOCAL_AI_REASONER_BACKEND
    ),
    visionBackend: pickTrimmedString(
      [nextPayload.visionBackend, localAi.visionBackend],
      LOCAL_AI_VISION_BACKEND
    ),
    publicModelId: pickTrimmedString(
      [nextPayload.publicModelId, localAi.publicModelId],
      LOCAL_AI_PUBLIC_MODEL_ID
    ),
    publicVisionId: pickTrimmedString(
      [nextPayload.publicVisionId, localAi.publicVisionId],
      LOCAL_AI_PUBLIC_VISION_ID
    ),
    runtimeFamily: pickTrimmedString(
      [
        nextPayload.runtimeFamily,
        nextPayload.reasonerBackend,
        localAi.runtimeFamily,
        localAi.reasonerBackend,
      ],
      LOCAL_AI_RUNTIME_FAMILY
    ),
    runtimeType: pickTrimmedString(
      [nextPayload.runtimeType, localAi.runtimeType],
      runtimeAdapter.runtimeType
    ),
    adapterStrategy: pickTrimmedString(
      [nextPayload.adapterStrategy, localAi.adapterStrategy],
      LOCAL_AI_ADAPTER_STRATEGY
    ),
    trainingPolicy: pickTrimmedString(
      [nextPayload.trainingPolicy, localAi.trainingPolicy],
      LOCAL_AI_TRAINING_POLICY
    ),
    developerHumanTeacherSystemPrompt: pickTrimmedString(
      [
        nextPayload.developerHumanTeacherSystemPrompt,
        localAi.developerHumanTeacherSystemPrompt,
      ],
      ''
    ),
    rankingPolicy: normalizeLocalAiRankingPolicy({
      ...(localAi.rankingPolicy || {}),
      ...(nextPayload.rankingPolicy || {}),
    }),
    contractVersion: pickTrimmedString(
      [nextPayload.contractVersion, localAi.contractVersion],
      LOCAL_AI_CONTRACT_VERSION
    ),
  }
}

function buildLocalAiAdapterState(localAi = {}) {
  return {
    runtimeBackend: localAi.runtimeBackend,
    reasonerBackend: localAi.reasonerBackend,
    visionBackend: localAi.visionBackend,
    publicModelId: localAi.publicModelId,
    publicVisionId: localAi.publicVisionId,
    contractVersion: localAi.contractVersion,
  }
}

function isLocalAiEnabled() {
  try {
    return loadMainSettings().localAi?.enabled === true
  } catch {
    return false
  }
}

function getLocalAiFeatureFlags() {
  try {
    const localAi = loadMainSettings().localAi || {}
    const localAiEnabled = localAi.enabled === true

    return {
      captureEnabled: localAi.captureEnabled === true,
      // Local training now ships as part of the local runtime lane, so old
      // persisted defaults must not keep the backend gated off.
      trainEnabled: localAiEnabled,
      federatedEnabled: localAi.federated?.enabled === true,
    }
  } catch {
    return {
      captureEnabled: false,
      trainEnabled: false,
      federatedEnabled: false,
    }
  }
}

function assertLocalAiActionEnabled(action, enabled, message) {
  if (enabled) {
    return
  }

  if (isDev && logger && typeof logger.debug === 'function') {
    logger.debug('Local AI IPC blocked because a feature gate is disabled', {
      action,
      message,
    })
  }

  throw new Error(message)
}

function assertLocalAiEnabled(action) {
  try {
    ensureLocalAiEnabled(loadMainSettings())
  } catch (error) {
    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI IPC blocked because Local AI is disabled', {
        action,
      })
    }
    throw error
  }
}

function assertLocalAiCaptureEnabled(action) {
  assertLocalAiActionEnabled(
    action,
    getLocalAiFeatureFlags().captureEnabled,
    'Local AI capture is disabled'
  )
}

function assertLocalAiTrainingEnabled(action) {
  assertLocalAiActionEnabled(
    action,
    getLocalAiFeatureFlags().trainEnabled,
    'Local AI training is disabled'
  )
}

function assertLocalAiFederatedEnabled(action) {
  assertLocalAiActionEnabled(
    action,
    getLocalAiFeatureFlags().federatedEnabled,
    'Local AI federated updates are disabled'
  )
}

function withLocalAiEnabled(action, handler) {
  return async (event, payload, ...rest) => {
    assertLocalAiEnabled(action)
    return handler(event, payload, ...rest)
  }
}

function withLocalAiTrainingEnabled(action, handler) {
  return async (event, payload, ...rest) => {
    assertLocalAiEnabled(action)
    assertLocalAiTrainingEnabled(action)
    return handler(event, payload, ...rest)
  }
}

function withLocalAiFederatedEnabled(action, handler) {
  return async (event, payload, ...rest) => {
    assertLocalAiEnabled(action)
    assertLocalAiFederatedEnabled(action)
    return handler(event, payload, ...rest)
  }
}

function buildDisabledLocalAiStatus(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    enabled: false,
    status: 'disabled',
    runtime: localAi.runtime,
    ...buildLocalAiAdapterState(localAi),
    runtimeFamily: localAi.runtimeFamily,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    sidecarReachable: false,
    sidecarCheckedAt: null,
    sidecarModelCount: 0,
    error: null,
    lastError: null,
  }
}

function buildLocalAiStatusResponse(result = {}) {
  const reachable = result.sidecarReachable
  let status = 'checking'

  if (reachable === true) {
    status = 'ok'
  } else if (reachable === false) {
    status = 'error'
  }

  return {
    ...result,
    enabled: true,
    status,
    runtime:
      String(
        (result.health && result.health.runtime) ||
          result.runtime ||
          LOCAL_AI_RUNTIME
      ).trim() || LOCAL_AI_RUNTIME,
    runtimeBackend:
      String(
        result.runtimeBackend ||
          result.runtime ||
          result.runtimeType ||
          LOCAL_AI_RUNTIME_BACKEND
      ).trim() || LOCAL_AI_RUNTIME_BACKEND,
    reasonerBackend:
      String(
        result.reasonerBackend ||
          result.runtimeFamily ||
          LOCAL_AI_REASONER_BACKEND
      ).trim() || LOCAL_AI_REASONER_BACKEND,
    visionBackend:
      String(result.visionBackend || LOCAL_AI_VISION_BACKEND).trim() ||
      LOCAL_AI_VISION_BACKEND,
    publicModelId:
      String(result.publicModelId || LOCAL_AI_PUBLIC_MODEL_ID).trim() ||
      LOCAL_AI_PUBLIC_MODEL_ID,
    publicVisionId:
      String(result.publicVisionId || LOCAL_AI_PUBLIC_VISION_ID).trim() ||
      LOCAL_AI_PUBLIC_VISION_ID,
    runtimeFamily:
      String(result.runtimeFamily || LOCAL_AI_RUNTIME_FAMILY).trim() ||
      LOCAL_AI_RUNTIME_FAMILY,
    contractVersion:
      String(result.contractVersion || LOCAL_AI_CONTRACT_VERSION).trim() ||
      LOCAL_AI_CONTRACT_VERSION,
    error:
      status === 'error'
        ? String(result.lastError || '').trim() || 'unavailable'
        : null,
  }
}

function buildDisabledLocalAiChatResponse(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    ok: false,
    enabled: false,
    status: 'disabled',
    provider: 'local-ai',
    runtime: localAi.runtime,
    ...buildLocalAiAdapterState(localAi),
    runtimeFamily: localAi.runtimeFamily,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    model: localAi.model,
    visionModel: localAi.visionModel,
    content: null,
    error: 'local_ai_disabled',
    lastError: 'Local AI is disabled',
  }
}

function buildDisabledLocalAiFlipToTextResponse(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    ok: false,
    enabled: false,
    status: 'disabled',
    provider: 'local-ai',
    runtime: localAi.runtime,
    ...buildLocalAiAdapterState(localAi),
    runtimeFamily: localAi.runtimeFamily,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    model: localAi.model,
    visionModel: localAi.visionModel,
    text: null,
    error: 'local_ai_disabled',
    lastError: 'Local AI is disabled',
  }
}

function buildDisabledLocalAiFlipJudgeResponse(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    ok: false,
    enabled: false,
    status: 'disabled',
    provider: 'local-ai',
    runtime: localAi.runtime,
    ...buildLocalAiAdapterState(localAi),
    runtimeFamily: localAi.runtimeFamily,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    model: localAi.model,
    visionModel: localAi.visionModel,
    decision: null,
    classification: null,
    confidence: null,
    reason: null,
    ambiguityFlags: [],
    ambiguity_flags: [],
    summary: null,
    sequenceText: null,
    error: 'local_ai_disabled',
    lastError: 'Local AI is disabled',
  }
}

function buildDisabledLocalAiInfoResponse(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    ok: false,
    enabled: false,
    status: 'disabled',
    provider: 'local-ai',
    runtime: localAi.runtime,
    ...buildLocalAiAdapterState(localAi),
    runtimeFamily: localAi.runtimeFamily,
    adapterStrategy: localAi.adapterStrategy,
    trainingPolicy: localAi.trainingPolicy,
    model: localAi.model,
    visionModel: localAi.visionModel,
    models: [],
    error: 'local_ai_disabled',
    lastError: 'Local AI is disabled',
  }
}

function buildLocalAiChatPayload(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)
  const nextPayload = normalizeLocalAiPayload(payload)

  return {
    ...nextPayload,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    endpoint: localAi.baseUrl,
    runtimeType: localAi.runtimeType,
    runtimeBackend: localAi.runtimeBackend,
    reasonerBackend: localAi.reasonerBackend,
    visionBackend: localAi.visionBackend,
    publicModelId: localAi.publicModelId,
    publicVisionId: localAi.publicVisionId,
    contractVersion: localAi.contractVersion,
    model: localAi.model,
    visionModel: localAi.visionModel,
    runtimeFamily: localAi.runtimeFamily,
    adapterStrategy: localAi.adapterStrategy,
    trainingPolicy: localAi.trainingPolicy,
  }
}

function buildLocalAiInfoPayload(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)
  const nextPayload = normalizeLocalAiPayload(payload)

  return {
    ...nextPayload,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    endpoint: localAi.baseUrl,
    runtimeType: localAi.runtimeType,
    runtimeBackend: localAi.runtimeBackend,
    reasonerBackend: localAi.reasonerBackend,
    visionBackend: localAi.visionBackend,
    publicModelId: localAi.publicModelId,
    publicVisionId: localAi.publicVisionId,
    contractVersion: localAi.contractVersion,
    model: localAi.model,
    visionModel: localAi.visionModel,
    runtimeFamily: localAi.runtimeFamily,
    adapterStrategy: localAi.adapterStrategy,
    trainingPolicy: localAi.trainingPolicy,
    developerHumanTeacherSystemPrompt:
      localAi.developerHumanTeacherSystemPrompt,
    rankingPolicy: localAi.rankingPolicy,
  }
}

function buildLocalAiFlipJudgePayload(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)
  const nextPayload = normalizeLocalAiPayload(payload)

  return {
    ...nextPayload,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    endpoint: localAi.baseUrl,
    runtimeType: localAi.runtimeType,
    runtimeBackend: localAi.runtimeBackend,
    reasonerBackend: localAi.reasonerBackend,
    visionBackend: localAi.visionBackend,
    publicModelId: localAi.publicModelId,
    publicVisionId: localAi.publicVisionId,
    contractVersion: localAi.contractVersion,
    model: localAi.model,
    visionModel: localAi.visionModel,
    runtimeFamily: localAi.runtimeFamily,
    adapterStrategy: localAi.adapterStrategy,
    trainingPolicy: localAi.trainingPolicy,
    input: pickLocalAiInput(nextPayload),
  }
}

function buildLocalAiTrainHookPayload(payload = {}) {
  return buildLocalAiInfoPayload(payload)
}

function buildLocalAiEpochPayload(payload = {}) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return buildLocalAiTrainHookPayload(payload)
  }

  return buildLocalAiTrainHookPayload({epoch: payload})
}

function normalizeImageSearchResult(item) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const image =
    item.image ||
    item.url ||
    item.imageUrl ||
    item.image_url ||
    item.full ||
    item.raw ||
    null

  const thumbnail =
    item.thumbnail ||
    item.thumb ||
    item.thumbnailUrl ||
    item.thumbnail_url ||
    item.preview ||
    item.small ||
    image

  if (!image || !thumbnail) {
    return null
  }

  return {image, thumbnail}
}

function withSearchSourceTimeout(
  promise,
  label,
  timeoutMs = IMAGE_SEARCH_SOURCE_TIMEOUT_MS
) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => {
        logger.warn(`${label} timed out after ${timeoutMs}ms`)
        resolve([])
      }, timeoutMs)
    }),
  ]).catch((error) => {
    logger.warn(`${label} failed`, error.toString())
    return []
  })
}

async function searchDuckDuckGoImages(query) {
  try {
    const results = await imageSearch({
      query,
      moderate: true,
    })
    if (!Array.isArray(results)) return []
    return results.map(normalizeImageSearchResult).filter(Boolean)
  } catch (error) {
    logger.warn('duckduckgo image search failed', error.toString())
    return []
  }
}

async function searchOpenverseImages(query) {
  try {
    const {data} = await axios.get('https://api.openverse.org/v1/images/', {
      params: {
        q: query,
        page_size: 30,
      },
      timeout: 12000,
    })

    const results = Array.isArray(data && data.results) ? data.results : []

    return results
      .map((item) =>
        normalizeImageSearchResult({
          image: item && item.url,
          thumbnail:
            (item && (item.thumbnail || item.thumbnail_url)) ||
            (item && item.url),
        })
      )
      .filter(Boolean)
  } catch (error) {
    logger.warn('openverse image search failed', error.toString())
    return []
  }
}

async function searchWikimediaImages(query) {
  try {
    const {data} = await axios.get('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: query,
        gsrnamespace: 6,
        gsrlimit: 30,
        prop: 'imageinfo',
        iiprop: 'url',
        iiurlwidth: 320,
        origin: '*',
      },
      timeout: 12000,
    })

    const pages = data && data.query && data.query.pages
    const list = pages && typeof pages === 'object' ? Object.values(pages) : []

    return list
      .map((item) => {
        const imageInfo = Array.isArray(item && item.imageinfo)
          ? item.imageinfo[0]
          : null
        return normalizeImageSearchResult({
          image: imageInfo && imageInfo.url,
          thumbnail:
            (imageInfo && (imageInfo.thumburl || imageInfo.url)) || null,
        })
      })
      .filter(Boolean)
  } catch (error) {
    logger.warn('wikimedia image search failed', error.toString())
    return []
  }
}

function dedupeSearchResults(items) {
  const seen = new Set()
  const result = []

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const image = String(item.image || '').trim()
    const thumbnail = String(item.thumbnail || '').trim()
    if (!image || !thumbnail) return
    if (seen.has(image)) return
    seen.add(image)
    result.push({image, thumbnail})
  })

  return result
}

async function searchImages(query) {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return []

  const [duckResults, openverseResults, wikimediaResults] = await Promise.all([
    withSearchSourceTimeout(
      searchDuckDuckGoImages(normalizedQuery),
      'duckduckgo image search'
    ),
    withSearchSourceTimeout(
      searchOpenverseImages(normalizedQuery),
      'openverse image search'
    ),
    withSearchSourceTimeout(
      searchWikimediaImages(normalizedQuery),
      'wikimedia image search'
    ),
  ])

  const merged = dedupeSearchResults(
    duckResults.concat(openverseResults).concat(wikimediaResults)
  )

  return merged.slice(0, 64)
}

const isFirstInstance = app.requestSingleInstanceLock()

const extractDnaUrl = (argv) => argv.find((item) => item.startsWith('dna://'))

function isBenignRendererConsoleMessage(message, sourceId) {
  if (!isDev) {
    return false
  }

  const normalizedMessage = String(message || '')
  const normalizedSourceId = String(sourceId || '')

  if (normalizedMessage.includes('[Fast Refresh]')) {
    return true
  }

  if (
    normalizedMessage.includes('unreachable code after return statement') &&
    normalizedSourceId.includes('/_next/static/chunks/pages/_app.js')
  ) {
    return true
  }

  return false
}

if (isFirstInstance) {
  app.on('second-instance', (e, argv) => {
    // Protocol handler for win32 and linux
    // argv: An array of the second instance’s (command line / deep linked) arguments
    if (isWin || isLinux) {
      // Keep only command line / deep linked arguments
      handleDnaLink(extractDnaUrl(argv))
    }

    restoreWindow(mainWindow)
  })
} else {
  app.quit()
}

const createMainWindow = () => {
  const {workAreaSize} = screen.getPrimaryDisplay()
  const responsiveWidth = Math.max(
    1360,
    Math.min(1800, Math.floor(workAreaSize.width * 0.94))
  )
  const responsiveHeight = Math.max(
    900,
    Math.min(1100, Math.floor(workAreaSize.height * 0.94))
  )

  mainWindow = new BrowserWindow({
    title: app.name,
    width: responsiveWidth,
    minWidth: 1320,
    height: responsiveHeight,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, 'preload.js'),
    },
    icon: resolve(__dirname, 'static', 'icon-128@2x.png'),
    show: false,
  })

  loadRoute(mainWindow, 'home')

  mainWindow.webContents.on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      if (isBenignRendererConsoleMessage(message, sourceId)) {
        return
      }

      const entry = `[renderer:${level}] ${
        sourceId || 'unknown'
      }:${line} ${message}`
      if (level >= 2) {
        logger.error(entry)
      } else if (level === 1) {
        logger.warn(entry)
      } else {
        logger.info(entry)
      }
    }
  )

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (isTrustedRendererUrl(url)) {
      return {action: 'allow'}
    }

    Promise.resolve(openExternalSafely(url)).catch((error) => {
      logger.warn('Blocked external window open', {
        url,
        error: error.toString(),
      })
    })

    return {action: 'deny'}
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) {
      return
    }

    event.preventDefault()

    Promise.resolve(openExternalSafely(url)).catch((error) => {
      logger.warn('Blocked navigation', {
        url,
        error: error.toString(),
      })
    })
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      logger.error(
        `Renderer failed to load (${isMainFrame ? 'main' : 'sub'} frame): ` +
          `${errorCode} ${errorDescription} ${validatedUrl}`
      )
    }
  )

  // Protocol handler for win32 and linux
  // eslint-disable-next-line no-cond-assign
  if (isWin || isLinux) {
    dnaUrl = extractDnaUrl(process.argv)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (mainWindow.forceClose) {
      return
    }
    e.preventDefault()
    mainWindow.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const showMainWindow = () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function restoreWindow(window = mainWindow) {
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
}

function handleDnaLink(url) {
  if (!url) return
  sendMainWindowMsg('DNA_LINK', url)
}

const createMenu = () => {
  const application = {
    label: RUNTIME_APP_NAME,
    submenu: [
      {
        label: i18next.t(`About ${RUNTIME_APP_NAME}`),
        role: 'about',
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Toggle Developer Tools'),
        role: 'toggleDevTools',
        visible: false,
      },
      {
        label: i18next.t('Quit'),
        accelerator: 'Cmd+Q',
        role: 'quit',
      },
    ],
  }

  const edit = {
    label: i18next.t('Edit'),
    submenu: [
      {
        label: i18next.t('Undo'),
        accelerator: 'CmdOrCtrl+Z',
        role: 'undo',
      },
      {
        label: i18next.t('Redo'),
        accelerator: 'Shift+CmdOrCtrl+Z',
        role: 'redo',
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Cut'),
        accelerator: 'CmdOrCtrl+X',
        role: 'cut',
      },
      {
        label: i18next.t('Copy'),
        accelerator: 'CmdOrCtrl+C',
        role: 'copy',
      },
      {
        label: i18next.t('Paste'),
        accelerator: 'CmdOrCtrl+V',
        role: 'paste',
      },
      {
        label: i18next.t('Select All'),
        accelerator: 'CmdOrCtrl+A',
        role: 'selectAll',
      },
    ],
  }

  const view = {
    label: i18next.t('View'),
    submenu: [
      {
        label: i18next.t('Toggle Full Screen'),
        role: 'togglefullscreen',
        accelerator: isWin ? 'F11' : 'Ctrl+Command+F',
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Zoom In'),
        accelerator: 'CmdOrCtrl+=',
        click: (_, window) => {
          zoomIn(window)
        },
      },
      {
        label: i18next.t('Zoom Out'),
        accelerator: 'CmdOrCtrl+-',
        click: (_, window) => {
          zoomOut(window)
        },
      },
      {
        label: i18next.t('Actual Size'),
        accelerator: 'CmdOrCtrl+0',
        click: (_, window) => {
          resetZoom(window)
        },
      },
    ],
  }

  const help = {
    label: i18next.t('Help'),
    submenu: [
      {
        label: i18next.t('Website'),
        click: () => {
          shell.openExternal('https://idena.io/')
        },
      },
      {
        label: i18next.t('Explorer'),
        click: () => {
          shell.openExternal('https://scan.idena.io/')
        },
      },
      {
        type: 'separator',
      },
      {
        label: i18next.t('Toggle Developer Tools'),
        role: 'toggleDevTools',
      },
    ],
  }

  const template = [application, edit, view, help]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function trayIcon() {
  const icon = 'icon-16-white@2x.png'
  return isMac
    ? `icon-16${nativeTheme.shouldUseDarkColors ? '-white' : ''}@2x.png`
    : icon
}

if (isMac) {
  nativeTheme.on('updated', () => {
    if (tray) {
      tray.setImage(resolve(__dirname, 'static', 'tray', trayIcon()))
    }
  })
}

const createTray = () => {
  tray = new Tray(resolve(__dirname, 'static', 'tray', trayIcon()))

  if (isWin) {
    tray.on('click', showMainWindow)
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: i18next.t(`Open ${RUNTIME_APP_NAME}`),
      click: showMainWindow,
    },
    {
      type: 'separator',
    },
    {
      label: i18next.t('Quit'),
      accelerator: 'Cmd+Q',
      role: 'quit',
    },
  ])
  tray.setContextMenu(contextMenu)
}

async function bootstrapApp() {
  const i18nConfig = getI18nConfig()

  i18next.init(i18nConfig, (err) => {
    if (err) {
      logger.error(err)
    }

    createMainWindow()

    if (!isDev) {
      createMenu()
    }

    createTray()

    checkForUpdates()
  })
}

app
  .whenReady()
  .then(bootstrapApp)
  .catch((error) => {
    logger.error('Failed to bootstrap Electron runtime', error)
    app.exit(1)
  })

if (!app.isDefaultProtocolClient('dna')) {
  // Define custom protocol handler. Deep linking works on packaged versions of the application!
  app.setAsDefaultProtocolClient('dna')
}

app.on('will-finish-launching', () => {
  // Protocol handler for osx
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dnaUrl = url
    if (dnaUrl && mainWindow) {
      handleDnaLink(dnaUrl)
      restoreWindow(mainWindow)
    }
  })
})

let didConfirmQuit = false
let isFinalizingQuit = false
let quitCleanupPromise = null
let quitAfterCleanup = () => app.quit()

function finalizeQuitAfterCleanup() {
  if (isFinalizingQuit) {
    return
  }

  isFinalizingQuit = true
  didConfirmQuit = true

  if (mainWindow) {
    mainWindow.forceClose = true
  }

  const completeQuit = quitAfterCleanup
  quitAfterCleanup = () => app.quit()
  completeQuit()
}

app.on('before-quit', (e) => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }

  if (isFinalizingQuit) {
    if (mainWindow) {
      mainWindow.forceClose = true
    }
    return
  }

  if (!didConfirmQuit && !isDev) {
    e.preventDefault()
    sendMainWindowMsg('confirm-quit')
    return
  }

  e.preventDefault()

  if (quitCleanupPromise) {
    return
  }

  quitCleanupPromise = validationDevnet
    .stop({quiet: true})
    .catch((error) => {
      logger.error(
        'error while stopping validation rehearsal network on quit',
        error.toString()
      )
    })
    .finally(() => {
      quitCleanupPromise = null
      finalizeQuitAfterCleanup()
    })
})

onTrusted('confirm-quit', () => {
  didConfirmQuit = true
  quitAfterCleanup = () => app.quit()
  app.quit()
})

app.on('activate', () => {
  if (!mainWindow) {
    createMainWindow()
    return
  }

  showMainWindow()
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

handleOnceTrusted('CHECK_DNA_LINK', () => dnaUrl)

onTrusted(NODE_COMMAND, async (_event, command, data) => {
  logger.info(`new node command`, command, data)
  switch (command) {
    case 'init-local-node': {
      runtimeExternalNodeOverride = null
      if (macosVersion.isMacOS && macosVersion.is('<10.15')) {
        return sendMainWindowMsg(NODE_EVENT, 'unsupported-macos-version')
      }

      getCurrentVersion()
        .then((version) => {
          sendMainWindowMsg(NODE_EVENT, 'node-ready', version)
        })
        .catch((e) => {
          logger.error('error while getting current node version', e.toString())
          if (nodeDownloadPromise) {
            return
          }
          nodeDownloadPromise = downloadNode((info) => {
            sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-download-progress', info)
          })
            .then(() => {
              stopNode(node).then(async (log) => {
                logger.info(log)
                node = null
                sendMainWindowMsg(NODE_EVENT, 'node-stopped')
                await updateNode()
                sendMainWindowMsg(NODE_EVENT, 'node-ready')
              })
            })
            .catch((err) => {
              sendMainWindowMsg(NODE_EVENT, 'node-failed')
              logger.error('error while downloading node', err.toString())
            })
            .finally(() => {
              nodeDownloadPromise = null
            })
        })
      break
    }
    case 'start-local-node': {
      runtimeExternalNodeOverride = null
      if (node && node.exitCode == null) {
        logger.info(`node already managed, PID: ${node.pid || 'unknown'}`)
        sendMainWindowMsg(NODE_EVENT, 'node-started')
        break
      }

      startNode(
        data.rpcPort,
        data.tcpPort,
        data.ipfsPort,
        getInternalNodeApiKey(),
        data.autoActivateMining,
        isDev,
        (log) => {
          sendMainWindowMsg(NODE_EVENT, 'node-log', log)
        },
        (msg, code) => {
          if (code) {
            logger.error(msg)
            node = null
            sendMainWindowMsg(NODE_EVENT, 'node-failed')
          } else {
            logger.info(msg)
          }
        }
      )
        .then((n) => {
          logger.info(
            `node started, PID: ${n.pid}, previous PID: ${
              node ? node.pid : 'undefined'
            }`
          )
          node = n
          sendMainWindowMsg(NODE_EVENT, 'node-started')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while starting node', e.toString())
        })
      break
    }
    case 'stop-local-node': {
      runtimeExternalNodeOverride = null
      stopNode(node)
        .then((log) => {
          logger.info(log)
          node = null
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while stopping node', e.toString())
        })
      break
    }
    case 'clean-state': {
      runtimeExternalNodeOverride = null
      stopNode(node)
        .then((log) => {
          logger.info(log)
          node = null
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
          cleanNodeState()
          sendMainWindowMsg(NODE_EVENT, 'state-cleaned')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while stopping node', e.toString())
        })
      break
    }
    case 'restart-node': {
      runtimeExternalNodeOverride = null
      stopNode(node)
        .then((log) => {
          logger.info(log)
          node = null
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
        })
        .then(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 1000)
            })
        )
        .then(() => {
          sendMainWindowMsg(NODE_EVENT, 'restart-node')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while stopping node', e.toString())
        })

      break
    }
    case 'get-last-logs': {
      getLastLogs()
        .then((logs) => {
          sendMainWindowMsg(NODE_EVENT, 'last-node-logs', logs)
        })
        .catch((e) => {
          logger.error('error while reading logs', e.toString())
        })
      break
    }
    case 'start-validation-devnet': {
      let didEmitConnectPayload = false

      validationDevnet
        .start({
          ...(data || {}),
          onStatus(status) {
            sendMainWindowMsg(NODE_EVENT, 'validation-devnet-status', status)

            if (
              data?.connectApp &&
              !didEmitConnectPayload &&
              shouldEmitValidationDevnetConnectPayload(status, {
                connectCountdownSeconds: data?.connectCountdownSeconds,
              })
            ) {
              didEmitConnectPayload = emitValidationDevnetConnectPayload()
            }
          },
          onLog(line) {
            sendMainWindowMsg(NODE_EVENT, 'validation-devnet-log', line)
          },
        })
        .then((status) => {
          if (
            !data?.connectApp ||
            !status?.active ||
            didEmitConnectPayload ||
            !shouldEmitValidationDevnetConnectPayload(status, {
              connectCountdownSeconds: data?.connectCountdownSeconds,
            })
          ) {
            return
          }

          didEmitConnectPayload = emitValidationDevnetConnectPayload()
        })
        .catch((e) => {
          logger.error('error while starting validation devnet', e.toString())
        })
      break
    }
    case 'restart-validation-devnet': {
      runtimeExternalNodeOverride = null
      let didEmitConnectPayload = false
      validationDevnet
        .stop({quiet: true})
        .then(() =>
          validationDevnet.start({
            ...(data || {}),
            onStatus(status) {
              sendMainWindowMsg(NODE_EVENT, 'validation-devnet-status', status)

              if (
                data?.connectApp &&
                !didEmitConnectPayload &&
                shouldEmitValidationDevnetConnectPayload(status, {
                  connectCountdownSeconds: data?.connectCountdownSeconds,
                })
              ) {
                didEmitConnectPayload = emitValidationDevnetConnectPayload()
              }
            },
            onLog(line) {
              sendMainWindowMsg(NODE_EVENT, 'validation-devnet-log', line)
            },
          })
        )
        .then((status) => {
          if (
            !data?.connectApp ||
            !status?.active ||
            didEmitConnectPayload ||
            !shouldEmitValidationDevnetConnectPayload(status, {
              connectCountdownSeconds: data?.connectCountdownSeconds,
            })
          ) {
            return
          }

          didEmitConnectPayload = emitValidationDevnetConnectPayload()
        })
        .catch((e) => {
          logger.error('error while restarting validation devnet', e.toString())
        })
      break
    }
    case 'stop-validation-devnet': {
      runtimeExternalNodeOverride = null
      validationDevnet
        .stop()
        .then((status) => {
          sendMainWindowMsg(NODE_EVENT, 'validation-devnet-status', status)
        })
        .catch((e) => {
          logger.error('error while stopping validation devnet', e.toString())
        })
      break
    }
    case 'get-validation-devnet-status': {
      validationDevnet
        .getStatus({
          onStatus(status) {
            sendMainWindowMsg(NODE_EVENT, 'validation-devnet-status', status)
          },
        })
        .catch((e) => {
          logger.error(
            'error while getting validation devnet status',
            e.toString()
          )
        })
      break
    }
    case 'get-validation-devnet-logs': {
      Promise.resolve()
        .then(() =>
          validationDevnet.getLogs({
            onLog(line) {
              sendMainWindowMsg(NODE_EVENT, 'validation-devnet-log', line)
            },
          })
        )
        .then((logs) => {
          sendMainWindowMsg(NODE_EVENT, 'validation-devnet-logs', logs)
        })
        .catch((e) => {
          logger.error(
            'error while getting validation devnet logs',
            e.toString()
          )
        })
      break
    }
    case 'connect-validation-devnet': {
      validationDevnet
        .getStatus({
          onStatus(status) {
            sendMainWindowMsg(NODE_EVENT, 'validation-devnet-status', status)
          },
        })
        .then((status) => {
          if (!shouldConnectValidationDevnetStatus(status)) {
            logger.info(
              'validation rehearsal network is not ready for a manual app handoff yet'
            )
            return
          }

          emitValidationDevnetConnectPayload()
        })
        .catch((e) => {
          logger.error(
            'error while resolving validation devnet connection payload',
            e.toString()
          )
        })
      break
    }
    case 'clear-external-node-override': {
      runtimeExternalNodeOverride = null
      break
    }

    case 'troubleshooting-restart-node': {
      await tryStopNode(node, {
        onSuccess() {
          node = null
        },
      })

      return sendMainWindowMsg(NODE_EVENT, 'troubleshooting-restart-node')
    }

    case 'troubleshooting-update-node': {
      if (nodeDownloadPromise) return

      await tryStopNode(node, {
        onSuccess() {
          node = null
        },
      })

      sendMainWindowMsg(NODE_EVENT, 'troubleshooting-update-node')

      nodeDownloadPromise = downloadNode((info) => {
        sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-download-progress', info)
      })
        .then(async () => {
          await updateNode()
          sendMainWindowMsg(NODE_EVENT, 'node-ready')
        })
        .catch((err) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          logger.error('error while downloading node', err.toString())
        })
        .finally(() => {
          nodeDownloadPromise = null
        })

      break
    }

    case 'troubleshooting-reset-node': {
      await tryStopNode(node, {
        onSuccess() {
          node = null
        },
      })

      try {
        await fs.remove(getNodeFile())
        await fs.remove(getNodeChainDbFolder())
        await fs.remove(getNodeIpfsDir())

        sendMainWindowMsg(NODE_EVENT, 'troubleshooting-reset-node')
      } catch (e) {
        logger.error('error deleting idenachain.db', e.toString())
        sendMainWindowMsg(NODE_EVENT, 'node-failed')
      }

      break
    }
    default:
  }
})

nodeUpdater.on('update-available', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-update-available', info)
})

nodeUpdater.on('download-progress', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-download-progress', info)
})

nodeUpdater.on('update-downloaded', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-update-ready', info)
})

autoUpdater.on('download-progress', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'ui-download-progress', info)
})

autoUpdater.on('update-downloaded', (info) => {
  sendMainWindowMsg(AUTO_UPDATE_EVENT, 'ui-update-ready', info)
})

autoUpdater.on('error', (error) => {
  logger.error('error while checking UI update', error.toString())
})

onTrusted(AUTO_UPDATE_COMMAND, async (event, command, data) => {
  logger.info(`new autoupdate command`, command, data)
  switch (command) {
    case 'start-checking': {
      nodeUpdater.checkForUpdates(data.nodeCurrentVersion, data.isInternalNode)
      break
    }
    case 'update-ui': {
      if (isWin && app.isPackaged) {
        didConfirmQuit = true
        quitAfterCleanup = () => autoUpdater.quitAndInstall()
        app.quit()
      } else {
        shell.openExternal(
          `https://github.com/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}/releases`
        )
      }
      break
    }
    case 'update-node': {
      stopNode(node)
        .then(async () => {
          sendMainWindowMsg(NODE_EVENT, 'node-stopped')
          await updateNode()
          sendMainWindowMsg(NODE_EVENT, 'node-ready')
          sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-updated')
        })
        .catch((e) => {
          sendMainWindowMsg(NODE_EVENT, 'node-failed')
          sendMainWindowMsg(AUTO_UPDATE_EVENT, 'node-update-failed')
          logger.error('error while updating node', e.toString())
        })
      break
    }
    default:
  }
})

function checkForUpdates() {
  if (isDev || !app.isPackaged || isCheckingForUpdates) {
    return
  }

  isCheckingForUpdates = true

  async function runCheck() {
    try {
      if (isMac) {
        const {data} = await axios.get(RELEASE_URL)
        const {tag_name: tag, prerelease} = data

        if (!prerelease && semver.gt(semver.clean(tag), appVersion)) {
          setTimeout(() => {
            sendMainWindowMsg(AUTO_UPDATE_EVENT, 'ui-update-ready', {
              version: tag,
            })
          }, 30000)
        }
      } else {
        await autoUpdater.checkForUpdates()
      }
    } catch (e) {
      logger.error('error while checking UI update', e.toString())
    } finally {
      setTimeout(runCheck, 10 * 60 * 1000)
    }
  }

  runCheck()
}

// listen specific `node` messages
onTrusted('node-log', ({sender}, message) => {
  sender.send('node-log', message)
})

onTrusted('reload', () => {
  loadRoute(mainWindow, 'home')
})

onTrusted('showMainWindow', () => {
  showMainWindow()
})

handleTrusted(WINDOW_COMMAND, (event, command) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow
  if (!targetWindow) {
    throw new Error('No window is available')
  }

  switch (command) {
    case 'toggleFullScreen':
      targetWindow.setFullScreen(!targetWindow.isFullScreen())
      return {fullScreen: targetWindow.isFullScreen()}
    default:
      throw new Error(`Unknown window command: ${command}`)
  }
})

function sendMainWindowMsg(channel, message, data) {
  if (!mainWindow || !mainWindow.webContents || mainWindow.forceClose) {
    return
  }
  try {
    mainWindow.webContents.send(channel, message, data)
  } catch (e) {
    logger.error('cannot send msg to main window', e.toString())
  }
}

handleTrusted('search-image', async (_, query) => searchImages(query))

handleTrusted('rpc.call', async (_event, payload) => performNodeRpc(payload))

handleTrusted(AI_SOLVER_COMMAND, async (_event, command, payload) => {
  logger.info(`new ai solver command`, command, {
    provider: payload && payload.provider,
    model: payload && payload.model,
    benchmarkProfile: payload && payload.benchmarkProfile,
  })

  try {
    switch (command) {
      case 'setProviderKey':
        return aiProviderBridge.setProviderKey(payload)
      case 'clearProviderKey':
        return aiProviderBridge.clearProviderKey(payload)
      case 'hasProviderKey':
        return aiProviderBridge.hasProviderKey(payload)
      case 'testProvider':
        return aiProviderBridge.testProvider(payload)
      case 'listModels':
        return aiProviderBridge.listModels(payload)
      case 'generateImageSearchResults':
        return aiProviderBridge.generateImageSearchResults(payload)
      case 'generateStoryOptions':
        return aiProviderBridge.generateStoryOptions(payload)
      case 'generateFlipPanels':
        return aiProviderBridge.generateFlipPanels(payload)
      case 'solveFlipBatch':
        return aiProviderBridge.solveFlipBatch(payload)
      case 'reviewValidationReports':
        return aiProviderBridge.reviewValidationReports(payload)
      default:
        throw new Error(`Unsupported AI solver command: ${command}`)
    }
  } catch (error) {
    logger.error('AI solver command failed', {
      command,
      provider: payload && payload.provider,
      model: payload && payload.model,
      error: error.toString(),
    })
    throw error
  }
})

handleTrusted(AI_TEST_UNIT_COMMAND, async (event, command, payload) => {
  logger.info(`new ai test unit command`, command, {
    provider: payload && payload.provider,
    model: payload && payload.model,
    benchmarkProfile: payload && payload.benchmarkProfile,
    flipsCount: Array.isArray(payload && payload.flips)
      ? payload.flips.length
      : undefined,
  })

  try {
    switch (command) {
      case 'addFlips':
        return aiTestUnitBridge.addFlips(payload)
      case 'listFlips':
        return aiTestUnitBridge.listFlips(payload)
      case 'clearFlips':
        return aiTestUnitBridge.clearFlips(payload)
      case 'run':
        return aiTestUnitBridge.run(payload, {
          onProgress: (progress) => {
            try {
              // Broadcast progress to the primary renderer process.
              sendMainWindowMsg(AI_TEST_UNIT_EVENT, progress)

              // Also try the invoking renderer when available.
              if (
                event &&
                event.sender &&
                typeof event.sender.send === 'function'
              ) {
                event.sender.send(AI_TEST_UNIT_EVENT, progress)
              }
            } catch (sendError) {
              logger.error('Unable to send AI test unit progress event', {
                error: sendError.toString(),
              })
            }
          },
        })
      default:
        throw new Error(`Unsupported AI test unit command: ${command}`)
    }
  } catch (error) {
    logger.error('AI test unit command failed', {
      command,
      provider: payload && payload.provider,
      model: payload && payload.model,
      error: error.toString(),
    })
    throw error
  }
})

handleTrusted('localAi.status', async (_event, payload) => {
  if (!isLocalAiEnabled()) {
    return buildDisabledLocalAiStatus(payload)
  }

  return buildLocalAiStatusResponse(await localAiManager.status(payload))
})

handleTrusted('localAi.getDeveloperTelemetry', async () => ({
  ...(await localAiManager.getDeveloperTelemetry()),
  enabled: isLocalAiEnabled(),
}))

handleTrusted(
  'localAi.start',
  withLocalAiEnabled('start', async (_event, payload) =>
    localAiManager.start(payload)
  )
)

handleTrusted(
  'localAi.stop',
  withLocalAiEnabled('stop', async () => localAiManager.stop())
)

handleTrusted(
  'localAi.listModels',
  withLocalAiEnabled('listModels', async (_event, payload) =>
    localAiManager.listModels(payload)
  )
)

handleTrusted('localAi.info', async (_event, payload) => {
  if (!isLocalAiEnabled()) {
    return buildDisabledLocalAiInfoResponse(payload)
  }

  return {
    ...(await localAiManager.info(buildLocalAiInfoPayload(payload))),
    enabled: true,
  }
})

handleTrusted('localAi.chat', async (_event, payload) => {
  if (!isLocalAiEnabled()) {
    return buildDisabledLocalAiChatResponse(payload)
  }

  return {
    ...(await localAiManager.chat(buildLocalAiChatPayload(payload))),
    enabled: true,
  }
})

handleTrusted('localAi.flipJudge', async (_event, payload) => {
  if (!isLocalAiEnabled()) {
    return buildDisabledLocalAiFlipJudgeResponse(payload)
  }

  return {
    ...(await localAiManager.flipJudge(buildLocalAiFlipJudgePayload(payload))),
    enabled: true,
  }
})

handleTrusted('localAi.checkFlipSequence', async (_event, payload) => {
  if (!isLocalAiEnabled()) {
    return buildDisabledLocalAiFlipJudgeResponse(payload)
  }

  return {
    ...(await localAiManager.checkFlipSequence(
      buildLocalAiFlipJudgePayload(payload)
    )),
    enabled: true,
  }
})

handleTrusted('localAi.flipToText', async (_event, payload) => {
  if (!isLocalAiEnabled()) {
    return buildDisabledLocalAiFlipToTextResponse(payload)
  }

  return {
    ...(await localAiManager.flipToText(buildLocalAiFlipJudgePayload(payload))),
    enabled: true,
  }
})

handleTrusted(
  'localAi.captionFlip',
  withLocalAiEnabled('captionFlip', async (_event, payload) =>
    localAiManager.captionFlip(payload)
  )
)

handleTrusted(
  'localAi.ocrImage',
  withLocalAiEnabled('ocrImage', async (_event, payload) =>
    localAiManager.ocrImage(payload)
  )
)

handleTrusted(
  'localAi.trainHook',
  withLocalAiTrainingEnabled('trainHook', async (_event, payload) =>
    localAiManager.trainHook(buildLocalAiTrainHookPayload(payload))
  )
)

handleTrusted(
  'localAi.trainEpoch',
  withLocalAiTrainingEnabled('trainEpoch', async (_event, payload) =>
    localAiManager.trainEpoch(buildLocalAiTrainHookPayload(payload))
  )
)

handleTrusted(
  'localAi.buildManifest',
  withLocalAiTrainingEnabled('buildManifest', async (_event, payload) =>
    localAiManager.buildManifest(buildLocalAiEpochPayload(payload))
  )
)

handleTrusted(
  'localAi.importAdapterArtifact',
  withLocalAiTrainingEnabled('importAdapterArtifact', async (_event, payload) =>
    localAiManager.importAdapterArtifact(buildLocalAiTrainHookPayload(payload))
  )
)

handleTrusted(
  'localAi.registerAdapterArtifact',
  withLocalAiTrainingEnabled(
    'registerAdapterArtifact',
    async (_event, payload) =>
      localAiManager.registerAdapterArtifact(
        buildLocalAiTrainHookPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.loadAdapterArtifact',
  withLocalAiEnabled('loadAdapterArtifact', async (_event, payload) =>
    localAiManager.loadAdapterArtifact(buildLocalAiEpochPayload(payload))
  )
)

handleTrusted(
  'localAi.loadTrainingCandidatePackage',
  withLocalAiEnabled('loadTrainingCandidatePackage', async (_event, payload) =>
    localAiManager.loadTrainingCandidatePackage(payload)
  )
)

handleTrusted(
  'localAi.buildTrainingCandidatePackage',
  withLocalAiTrainingEnabled(
    'buildTrainingCandidatePackage',
    async (_event, payload) =>
      localAiManager.buildTrainingCandidatePackage(
        buildLocalAiTrainHookPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherPackage',
  withLocalAiEnabled('loadHumanTeacherPackage', async (_event, payload) =>
    localAiManager.loadHumanTeacherPackage(payload)
  )
)

handleTrusted(
  'localAi.buildHumanTeacherPackage',
  withLocalAiEnabled('buildHumanTeacherPackage', async (_event, payload) =>
    localAiManager.buildHumanTeacherPackage(
      buildLocalAiTrainHookPayload(payload)
    )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherDemoWorkspace',
  withLocalAiEnabled('loadHumanTeacherDemoWorkspace', async (_event, payload) =>
    localAiManager.loadHumanTeacherDemoWorkspace(
      buildLocalAiEpochPayload(payload)
    )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherDeveloperSession',
  withLocalAiEnabled(
    'loadHumanTeacherDeveloperSession',
    async (_event, payload) =>
      localAiManager.loadHumanTeacherDeveloperSession(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherDeveloperSessionState',
  withLocalAiEnabled(
    'loadHumanTeacherDeveloperSessionState',
    async (_event, payload) =>
      localAiManager.loadHumanTeacherDeveloperSessionState(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.stopHumanTeacherDeveloperRun',
  withLocalAiEnabled('stopHumanTeacherDeveloperRun', async (_event, payload) =>
    localAiManager.stopHumanTeacherDeveloperRun(
      buildLocalAiEpochPayload(payload)
    )
  )
)

handleTrusted(
  'localAi.updateHumanTeacherDeveloperRunControls',
  withLocalAiEnabled(
    'updateHumanTeacherDeveloperRunControls',
    async (_event, payload) =>
      localAiManager.updateHumanTeacherDeveloperRunControls(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherDeveloperComparisonExamples',
  withLocalAiEnabled(
    'loadHumanTeacherDeveloperComparisonExamples',
    async (_event, payload) =>
      localAiManager.loadHumanTeacherDeveloperComparisonExamples(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.exportHumanTeacherDeveloperBundle',
  withLocalAiEnabled(
    'exportHumanTeacherDeveloperBundle',
    async (_event, payload) =>
      localAiManager.exportHumanTeacherDeveloperBundle(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherDemoTask',
  withLocalAiEnabled('loadHumanTeacherDemoTask', async (_event, payload) =>
    localAiManager.loadHumanTeacherDemoTask(buildLocalAiEpochPayload(payload))
  )
)

handleTrusted(
  'localAi.loadHumanTeacherDeveloperTask',
  withLocalAiEnabled('loadHumanTeacherDeveloperTask', async (_event, payload) =>
    localAiManager.loadHumanTeacherDeveloperTask(
      buildLocalAiEpochPayload(payload)
    )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherAnnotationWorkspace',
  withLocalAiEnabled(
    'loadHumanTeacherAnnotationWorkspace',
    async (_event, payload) =>
      localAiManager.loadHumanTeacherAnnotationWorkspace(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.loadHumanTeacherAnnotationTask',
  withLocalAiEnabled(
    'loadHumanTeacherAnnotationTask',
    async (_event, payload) =>
      localAiManager.loadHumanTeacherAnnotationTask(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.exportHumanTeacherTasks',
  withLocalAiEnabled('exportHumanTeacherTasks', async (_event, payload) =>
    localAiManager.exportHumanTeacherTasks(buildLocalAiEpochPayload(payload))
  )
)

handleTrusted(
  'localAi.saveHumanTeacherAnnotationDraft',
  withLocalAiEnabled(
    'saveHumanTeacherAnnotationDraft',
    async (_event, payload) =>
      localAiManager.saveHumanTeacherAnnotationDraft(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.saveHumanTeacherDemoDraft',
  withLocalAiEnabled('saveHumanTeacherDemoDraft', async (_event, payload) =>
    localAiManager.saveHumanTeacherDemoDraft(buildLocalAiEpochPayload(payload))
  )
)

handleTrusted(
  'localAi.saveHumanTeacherDeveloperDraft',
  withLocalAiEnabled(
    'saveHumanTeacherDeveloperDraft',
    async (_event, payload) =>
      localAiManager.saveHumanTeacherDeveloperDraft(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.finalizeHumanTeacherDemoChunk',
  withLocalAiEnabled('finalizeHumanTeacherDemoChunk', async (_event, payload) =>
    localAiManager.finalizeHumanTeacherDemoChunk(
      buildLocalAiEpochPayload(payload)
    )
  )
)

handleTrusted(
  'localAi.finalizeHumanTeacherDeveloperChunk',
  withLocalAiEnabled(
    'finalizeHumanTeacherDeveloperChunk',
    async (_event, payload) =>
      localAiManager.finalizeHumanTeacherDeveloperChunk(
        buildLocalAiEpochPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.runHumanTeacherDeveloperComparison',
  withLocalAiTrainingEnabled(
    'runHumanTeacherDeveloperComparison',
    async (_event, payload) =>
      localAiManager.runHumanTeacherDeveloperComparison(
        buildLocalAiTrainHookPayload(payload)
      )
  )
)

handleTrusted(
  'localAi.importHumanTeacherAnnotations',
  withLocalAiEnabled('importHumanTeacherAnnotations', async (_event, payload) =>
    localAiManager.importHumanTeacherAnnotations(
      buildLocalAiEpochPayload(payload)
    )
  )
)

handleTrusted(
  'localAi.updateTrainingCandidatePackageReview',
  withLocalAiTrainingEnabled(
    'updateTrainingCandidatePackageReview',
    async (_event, payload) =>
      localAiManager.updateTrainingCandidatePackageReview(payload)
  )
)

handleTrusted(
  'localAi.updateHumanTeacherPackageReview',
  withLocalAiEnabled(
    'updateHumanTeacherPackageReview',
    async (_event, payload) =>
      localAiManager.updateHumanTeacherPackageReview(payload)
  )
)

handleTrusted(
  'localAi.buildBundle',
  withLocalAiFederatedEnabled('buildBundle', async (_event, epoch) =>
    localAiFederated.buildUpdateBundle(epoch)
  )
)

handleTrusted(
  'localAi.importBundle',
  withLocalAiFederatedEnabled('importBundle', async (_event, filePath) =>
    localAiFederated.importUpdateBundle(filePath)
  )
)

handleTrusted(
  'localAi.aggregate',
  withLocalAiFederatedEnabled('aggregate', async () =>
    localAiFederated.aggregateAcceptedBundles()
  )
)

onTrusted('localAi.captureFlip', (_event, payload) => {
  try {
    assertLocalAiEnabled('captureFlip')
    assertLocalAiCaptureEnabled('captureFlip')
  } catch {
    return
  }

  Promise.resolve(
    localAiManager.captureFlip(normalizeLocalAiPayload(payload))
  ).catch((error) => {
    logger.error('Local AI capture failed', {
      error: error.toString(),
    })
  })
})

handleTrusted('social.rpc', async (_event, payload) => {
  const validationError = validateSocialRpcRequest(payload)

  if (validationError) {
    return {
      error: {
        message: validationError,
      },
    }
  }

  return performNodeRpc(payload)
})

const KEY_VALUE = {}

handleTrusted('home.idenaBot.get', async () => KEY_VALUE['idena-bot'])
onTrusted('home.idenaBot.skip', () => {
  KEY_VALUE['idena-bot'] = true
})

handleTrusted('shell.openExternal.safe', async (_event, payload) =>
  openExternalSafely(payload && payload.url)
)
