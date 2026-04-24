/* eslint-disable import/no-extraneous-dependencies */
const {
  contextBridge,
  ipcRenderer,
  clipboard,
  nativeImage,
  webFrame,
} = require('electron')
/* eslint-enable import/no-extraneous-dependencies */

const APP_INFO_COMMAND = 'app-info/command'
const AI_SOLVER_COMMAND = 'ai-solver/command'
const AI_TEST_UNIT_COMMAND = 'ai-test-unit/command'
const AI_TEST_UNIT_EVENT = 'ai-test-unit/event'
const AUTO_UPDATE_COMMAND = 'auto-update/command'
const AUTO_UPDATE_EVENT = 'auto-update/event'
const NODE_COMMAND = 'node/command'
const NODE_EVENT = 'node/event'
const WINDOW_COMMAND = 'window/command'
const FLIPS_SYNC_COMMAND = 'flips-sync/command'
const INVITES_SYNC_COMMAND = 'invites-sync/command'
const PERSISTENCE_SYNC_COMMAND = 'persistence-sync/command'
const STORAGE_COMMAND = 'storage/command'

const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true

const isTest = process.env.NODE_ENV === 'e2e'

const aiTestUnitListenerRegistry = new WeakMap()
const appListenerRegistry = new WeakMap()
const nodeEventListenerRegistry = new WeakMap()
const updateEventListenerRegistry = new WeakMap()
const dnaLinkListenerRegistry = new WeakMap()
const persistenceStoreNames = {
  settings: 'settings',
  flipFilter: 'flipFilter',
  validationSession: 'validation2',
  validationResults: 'validationResults',
  flipArchive: 'flipArchive',
  validationNotification: 'validationNotification',
}

const HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL = 'managed local workspace'
const HUMAN_TEACHER_MANAGED_BUNDLE_LABEL = 'managed local bundle'
const HUMAN_TEACHER_RESULT_PATH_KEYS = new Set([
  'bundlePath',
  'packagePath',
  'payloadPath',
  'outputDir',
  'outputPath',
  'storedPath',
  'taskManifestPath',
  'annotationsPath',
  'manifestPath',
  'templatePath',
  'filledPath',
  'metadataPath',
  'normalizedPath',
  'summaryPath',
  'readmePath',
  'pendingPath',
  'trainedPath',
  'sourceAnnotationsPath',
  'sourcePath',
  'statePath',
  'comparisonPath',
  'holdoutPath',
  'adapterPath',
  'adapterManifestPath',
  'artifactPath',
  'trainingSummaryPath',
  'preparedDatasetPath',
  'preparedManifestPath',
  'localIndexPath',
  'fallbackIndexPath',
  'sourcePath',
])

function normalizeSafeBridgeObjectKey(key) {
  const normalizedKey = String(key || '').slice(0, 128)

  return normalizedKey === '__proto__' ||
    normalizedKey === 'prototype' ||
    normalizedKey === 'constructor'
    ? `_${normalizedKey}`
    : normalizedKey
}

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function toIpcCloneable(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'undefined') {
    return value
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }

  if (value instanceof Error) {
    return {
      name: String(value.name || 'Error'),
      message: String(value.message || ''),
      stack: String(value.stack || ''),
    }
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('base64')
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value)
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return null
    }

    seen.add(value)

    const normalizedArray = value.map((item) => {
      const normalized = toIpcCloneable(item, seen)
      return typeof normalized === 'undefined' ? null : normalized
    })

    seen.delete(value)

    return normalizedArray
  }

  if (!isPlainObject(value)) {
    return undefined
  }

  if (seen.has(value)) {
    return null
  }

  seen.add(value)

  const normalizedObject = Object.entries(value).reduce(
    (result, [key, entryValue]) => {
      const normalized = toIpcCloneable(entryValue, seen)

      if (typeof normalized !== 'undefined') {
        result[normalizeSafeBridgeObjectKey(key)] = normalized
      }

      return result
    },
    {}
  )

  seen.delete(value)

  return normalizedObject
}

function createIpcError(error = {}) {
  const nextError = new Error(String(error.message || 'IPC bridge error'))
  nextError.name = String(error.name || 'Error')

  if (error.notFound) {
    nextError.notFound = true
  }

  if (typeof error.code !== 'undefined') {
    nextError.code = error.code
  }

  return nextError
}

function unwrapIpcResponse(response) {
  if (!response || typeof response !== 'object') {
    return response
  }

  if (response.ok) {
    return response.value
  }

  throw createIpcError(response.error)
}

function sendSyncCloneable(channel, action, payload) {
  const response = ipcRenderer.sendSync(
    channel,
    action,
    toIpcCloneable(payload)
  )

  return unwrapIpcResponse(response)
}

async function invokeCloneable(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args.map((arg) => toIpcCloneable(arg)))
}

async function invokeStorage(payload) {
  const response = await ipcRenderer.invoke(
    STORAGE_COMMAND,
    toIpcCloneable(payload)
  )

  return unwrapIpcResponse(response)
}

function getAppInfo() {
  try {
    return ipcRenderer.sendSync(APP_INFO_COMMAND) || {}
  } catch {
    return {}
  }
}

function subscribeToChannel(channel, handler, registry, projector) {
  if (typeof handler !== 'function') {
    return () => {}
  }

  let wrapped = registry.get(handler)

  if (!wrapped) {
    wrapped = (_event, ...args) => projector(...args)
    registry.set(handler, wrapped)
  }

  ipcRenderer.on(channel, wrapped)

  return () => ipcRenderer.removeListener(channel, wrapped)
}

function createAppBridge() {
  return {
    reload() {
      ipcRenderer.send('reload')
    },
    requestConfirmQuit() {
      ipcRenderer.send('confirm-quit')
    },
    showMainWindow() {
      ipcRenderer.send('showMainWindow')
    },
    onConfirmQuit(handler) {
      return subscribeToChannel(
        'confirm-quit',
        handler,
        appListenerRegistry,
        () => handler()
      )
    },
  }
}

function createNodeBridge() {
  return {
    onEvent(handler) {
      return subscribeToChannel(
        NODE_EVENT,
        handler,
        nodeEventListenerRegistry,
        (event, data) => handler(event, data)
      )
    },
    getLastLogs() {
      ipcRenderer.send(NODE_COMMAND, 'get-last-logs')
    },
    restartNode() {
      ipcRenderer.send(NODE_COMMAND, 'restart-node')
    },
    startLocalNode(payload) {
      ipcRenderer.send(
        NODE_COMMAND,
        'start-local-node',
        toIpcCloneable(payload)
      )
    },
    initLocalNode() {
      ipcRenderer.send(NODE_COMMAND, 'init-local-node')
    },
    startValidationDevnet(payload) {
      ipcRenderer.send(
        NODE_COMMAND,
        'start-validation-devnet',
        toIpcCloneable(payload)
      )
    },
    restartValidationDevnet(payload) {
      ipcRenderer.send(
        NODE_COMMAND,
        'restart-validation-devnet',
        toIpcCloneable(payload)
      )
    },
    stopValidationDevnet() {
      ipcRenderer.send(NODE_COMMAND, 'stop-validation-devnet')
    },
    getValidationDevnetStatus() {
      ipcRenderer.send(NODE_COMMAND, 'get-validation-devnet-status')
    },
    getValidationDevnetLogs() {
      ipcRenderer.send(NODE_COMMAND, 'get-validation-devnet-logs')
    },
    getValidationDevnetSeedFlip(hash) {
      return ipcRenderer.invoke(
        'validation-devnet.seed-flip',
        String(hash || '')
      )
    },
    connectValidationDevnet() {
      ipcRenderer.send(NODE_COMMAND, 'connect-validation-devnet')
    },
    clearExternalNodeOverride() {
      ipcRenderer.send(NODE_COMMAND, 'clear-external-node-override')
    },
    stopLocalNode() {
      ipcRenderer.send(NODE_COMMAND, 'stop-local-node')
    },
    cleanState() {
      ipcRenderer.send(NODE_COMMAND, 'clean-state')
    },
    troubleshootingRestartNode() {
      ipcRenderer.send(NODE_COMMAND, 'troubleshooting-restart-node')
    },
    troubleshootingUpdateNode() {
      ipcRenderer.send(NODE_COMMAND, 'troubleshooting-update-node')
    },
    troubleshootingResetNode() {
      ipcRenderer.send(NODE_COMMAND, 'troubleshooting-reset-node')
    },
  }
}

function createAutoUpdateBridge() {
  return {
    onEvent(handler) {
      return subscribeToChannel(
        AUTO_UPDATE_EVENT,
        handler,
        updateEventListenerRegistry,
        (event, data) => handler(event, data)
      )
    },
    startChecking(payload) {
      ipcRenderer.send(
        AUTO_UPDATE_COMMAND,
        'start-checking',
        toIpcCloneable(payload)
      )
    },
    updateUi() {
      ipcRenderer.send(AUTO_UPDATE_COMMAND, 'update-ui')
    },
    updateNode() {
      ipcRenderer.send(AUTO_UPDATE_COMMAND, 'update-node')
    },
  }
}

function createDnaBridge() {
  return {
    checkLink() {
      return ipcRenderer.invoke('CHECK_DNA_LINK')
    },
    onLink(handler) {
      return subscribeToChannel(
        'DNA_LINK',
        handler,
        dnaLinkListenerRegistry,
        (url) => handler(url)
      )
    },
  }
}

function createImageSearchBridge() {
  return {
    search(query) {
      return ipcRenderer.invoke('search-image', String(query || ''))
    },
  }
}

function createPersistenceStore(storeName) {
  return {
    loadState() {
      return (
        sendSyncCloneable(PERSISTENCE_SYNC_COMMAND, 'loadState', {storeName}) ||
        {}
      )
    },
    loadValue(key) {
      return sendSyncCloneable(PERSISTENCE_SYNC_COMMAND, 'loadValue', {
        storeName,
        key,
      })
    },
    persistItem(key, value) {
      return sendSyncCloneable(PERSISTENCE_SYNC_COMMAND, 'persistItem', {
        storeName,
        key,
        value,
      })
    },
    persistState(state) {
      return sendSyncCloneable(PERSISTENCE_SYNC_COMMAND, 'persistState', {
        storeName,
        state,
      })
    },
  }
}

function createStorageNamespaceBridge(namespace, options = {}) {
  const payload = {
    namespace,
    valueEncoding: options.valueEncoding,
    epoch: options.epoch,
  }

  return {
    get(key) {
      return invokeStorage({...payload, action: 'get', key})
    },
    put(key, value) {
      return invokeStorage({...payload, action: 'put', key, value})
    },
    clear() {
      return invokeStorage({...payload, action: 'clear'})
    },
    batchWrite(operations = []) {
      return invokeStorage({
        ...payload,
        action: 'batchWrite',
        operations: Array.isArray(operations) ? operations : [],
      })
    },
  }
}

function createVotingsBridge() {
  return {
    ...createStorageNamespaceBridge('votings'),
    epoch(epoch) {
      const numericEpoch = Number(epoch)
      const normalizedEpoch = Number.isFinite(numericEpoch)
        ? Math.trunc(numericEpoch)
        : -1

      return createStorageNamespaceBridge('votings', {
        valueEncoding: 'json',
        epoch: normalizedEpoch,
      })
    },
    json: createStorageNamespaceBridge('votings', {valueEncoding: 'json'}),
  }
}

function createStorageBridge() {
  return {
    settings: createPersistenceStore(persistenceStoreNames.settings),
    flipFilter: createPersistenceStore(persistenceStoreNames.flipFilter),
    validationSession: createPersistenceStore(
      persistenceStoreNames.validationSession
    ),
    validationResults: createPersistenceStore(
      persistenceStoreNames.validationResults
    ),
    flipArchive: createPersistenceStore(persistenceStoreNames.flipArchive),
    validationNotification: createPersistenceStore(
      persistenceStoreNames.validationNotification
    ),
    flips: createStorageNamespaceBridge('flips'),
    votings: createVotingsBridge(),
    updates: createStorageNamespaceBridge('updates'),
    profile: createStorageNamespaceBridge('profile'),
    onboarding: createStorageNamespaceBridge('onboarding', {
      valueEncoding: 'json',
    }),
  }
}

function createFlipsBridge() {
  return {
    getFlips() {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'getFlips')
    },
    getFlip(id) {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'getFlip', {id})
    },
    saveFlips(flips) {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'saveFlips', {flips})
    },
    addDraft(draft) {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'addDraft', {draft})
    },
    updateDraft(draft) {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'updateDraft', {draft})
    },
    deleteDraft(id) {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'deleteDraft', {id})
    },
    clear() {
      return sendSyncCloneable(FLIPS_SYNC_COMMAND, 'clear')
    },
  }
}

function createInvitesBridge() {
  return {
    getInvites() {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'getInvites')
    },
    getInvite(id) {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'getInvite', {id})
    },
    addInvite(invite) {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'addInvite', {invite})
    },
    updateInvite(id, invite) {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'updateInvite', {
        id,
        invite,
      })
    },
    removeInvite(invite) {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'removeInvite', {invite})
    },
    clearInvites() {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'clearInvites')
    },
    getActivationTx() {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'getActivationTx')
    },
    setActivationTx(hash) {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'setActivationTx', {hash})
    },
    clearActivationTx() {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'clearActivationTx')
    },
    getActivationCode() {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'getActivationCode')
    },
    setActivationCode(code) {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'setActivationCode', {
        code,
      })
    },
    clearActivationCode() {
      return sendSyncCloneable(INVITES_SYNC_COMMAND, 'clearActivationCode')
    },
  }
}

function sanitizeImageSize(value, fallback) {
  const nextValue = Number(value)
  return Number.isFinite(nextValue) && nextValue > 0
    ? Math.round(nextValue)
    : fallback
}

function sanitizeBoundedString(value, fallback = '', maxLength = 4096) {
  if (typeof value !== 'string') {
    return fallback
  }

  return value.slice(0, maxLength)
}

function sanitizeOptionalBoundedString(value, maxLength = 4096) {
  if (typeof value !== 'string') {
    return undefined
  }

  const next = value.slice(0, maxLength)
  return next || undefined
}

function sanitizePathDisplayName(value, fallback = undefined, maxLength = 256) {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  const leaf = normalized[normalized.length - 1]

  if (!leaf) {
    return fallback
  }

  return leaf.slice(0, maxLength)
}

function sanitizeHumanTeacherExportResult(value) {
  const source = isPlainObject(value) ? value : {}

  return {
    ...source,
    packagePath: sanitizePathDisplayName(source.packagePath),
    outputDir: sanitizePathDisplayName(
      source.outputDir,
      HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL
    ),
    export: isPlainObject(source.export)
      ? {
          ...source.export,
          outputDir: sanitizePathDisplayName(
            source.export.outputDir,
            HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL
          ),
          manifestPath: sanitizePathDisplayName(source.export.manifestPath),
          templatePath: sanitizePathDisplayName(source.export.templatePath),
          filledPath: sanitizePathDisplayName(source.export.filledPath),
          metadataPath: sanitizePathDisplayName(source.export.metadataPath),
        }
      : source.export,
  }
}

function sanitizeHumanTeacherWorkspaceResult(value) {
  const source = isPlainObject(value) ? value : {}
  const workspace = isPlainObject(source.workspace) ? source.workspace : null

  return {
    ...source,
    packagePath: sanitizePathDisplayName(source.packagePath),
    outputDir: sanitizePathDisplayName(
      source.outputDir,
      HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL
    ),
    workspace: workspace
      ? {
          ...workspace,
          outputDir: sanitizePathDisplayName(
            workspace.outputDir,
            HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL
          ),
          taskManifestPath: sanitizePathDisplayName(workspace.taskManifestPath),
          annotationsPath: sanitizePathDisplayName(workspace.annotationsPath),
        }
      : source.workspace,
  }
}

function sanitizeHumanTeacherImportResult(value) {
  const source = isPlainObject(value) ? value : {}

  return {
    ...source,
    packagePath: sanitizePathDisplayName(source.packagePath),
    outputDir: sanitizePathDisplayName(
      source.outputDir,
      HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL
    ),
    import: isPlainObject(source.import)
      ? {
          ...source.import,
          normalizedPath: sanitizePathDisplayName(source.import.normalizedPath),
          summaryPath: sanitizePathDisplayName(source.import.summaryPath),
          annotationsPath: sanitizePathDisplayName(
            source.import.annotationsPath
          ),
        }
      : source.import,
  }
}

function sanitizeHumanTeacherDeveloperBundleResult(value) {
  const source = isPlainObject(value) ? value : {}

  return {
    ...source,
    outputDir: sanitizePathDisplayName(
      source.outputDir,
      HUMAN_TEACHER_MANAGED_BUNDLE_LABEL
    ),
    manifestPath: sanitizePathDisplayName(source.manifestPath),
    readmePath: sanitizePathDisplayName(source.readmePath),
    annotationsPath: sanitizePathDisplayName(source.annotationsPath),
    pendingPath: sanitizePathDisplayName(source.pendingPath),
    trainedPath: sanitizePathDisplayName(source.trainedPath),
  }
}

function sanitizeHumanTeacherBridgeResult(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      sanitizeHumanTeacherBridgeResult(entry, parentKey)
    )
  }

  if (!isPlainObject(value)) {
    if (
      typeof value === 'string' &&
      HUMAN_TEACHER_RESULT_PATH_KEYS.has(parentKey)
    ) {
      if (parentKey === 'outputDir') {
        return sanitizePathDisplayName(
          value,
          HUMAN_TEACHER_MANAGED_WORKSPACE_LABEL
        )
      }

      return sanitizePathDisplayName(value)
    }

    return value
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    result[normalizeSafeBridgeObjectKey(key)] =
      sanitizeHumanTeacherBridgeResult(entryValue, key)
    return result
  }, {})
}

function sanitizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeInteger(
  value,
  fallback,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
) {
  const next = Number.parseInt(value, 10)

  if (!Number.isFinite(next)) {
    return fallback
  }

  return Math.max(min, Math.min(max, next))
}

function sanitizeFiniteNumber(value, fallback, min = 0, max = 1) {
  const next = Number(value)

  if (!Number.isFinite(next)) {
    return fallback
  }

  return Math.max(min, Math.min(max, next))
}

function sanitizeDataImageList(value, maxItems = 8) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .slice(0, maxItems)
    .map((item) =>
      typeof item === 'string' && item.startsWith('data:image/')
        ? item.slice(0, 8 * 1024 * 1024)
        : null
    )
    .filter(Boolean)
}

function sanitizeLocalAiMessages(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.slice(0, 24).map((message) => ({
    role: ['system', 'user', 'assistant'].includes(
      String(message && message.role)
        .trim()
        .toLowerCase()
    )
      ? String(message.role).trim().toLowerCase()
      : 'user',
    content: sanitizeBoundedString(message && message.content, '', 10000),
    images: sanitizeDataImageList(message && message.images, 8),
  }))
}

function sanitizeLocalAiGenerationOptions(value) {
  const source = isPlainObject(value) ? value : {}

  return {
    temperature: sanitizeFiniteNumber(source.temperature, 0, 0, 2),
    num_ctx: sanitizeInteger(source.num_ctx, 0, 0, 32768),
    num_predict: sanitizeInteger(source.num_predict, 256, 1, 2048),
  }
}

function sanitizeLocalAiResponseFormat(value) {
  if (typeof value === 'string') {
    return sanitizeOptionalBoundedString(value, 32)
  }

  if (!isPlainObject(value)) {
    return null
  }

  return sanitizeBoundedCloneable(value, {
    maxDepth: 6,
    maxArrayLength: 64,
    maxObjectKeys: 64,
    maxStringLength: 512,
    maxDataUrlLength: 2048,
  })
}

function sanitizeLocalAiRuntimePayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {}
  const rawInput = source.input
  const sanitizedInput =
    typeof rawInput === 'string'
      ? sanitizeOptionalBoundedString(rawInput, 10000)
      : {
          images: sanitizeDataImageList(
            rawInput && rawInput.images ? rawInput.images : source.images,
            8
          ),
        }

  return {
    enabled: sanitizeBoolean(source.enabled, false),
    refresh: sanitizeBoolean(source.refresh, false),
    mode: sanitizeOptionalBoundedString(source.mode, 64),
    model: sanitizeOptionalBoundedString(source.model, 256),
    visionModel: sanitizeOptionalBoundedString(source.visionModel, 256),
    allowRuntimeStart: sanitizeBoolean(source.allowRuntimeStart, true),
    runtimeBackend: sanitizeOptionalBoundedString(source.runtimeBackend, 64),
    runtimeType: sanitizeOptionalBoundedString(source.runtimeType, 64),
    runtimeFamily: sanitizeOptionalBoundedString(source.runtimeFamily, 128),
    reasonerBackend: sanitizeOptionalBoundedString(source.reasonerBackend, 64),
    visionBackend: sanitizeOptionalBoundedString(source.visionBackend, 64),
    publicModelId: sanitizeOptionalBoundedString(source.publicModelId, 256),
    publicVisionId: sanitizeOptionalBoundedString(source.publicVisionId, 256),
    contractVersion: sanitizeOptionalBoundedString(source.contractVersion, 64),
    adapterStrategy: sanitizeOptionalBoundedString(source.adapterStrategy, 64),
    trainingPolicy: sanitizeOptionalBoundedString(source.trainingPolicy, 64),
    rankingPolicy: isPlainObject(source.rankingPolicy)
      ? sanitizeBoundedCloneable(source.rankingPolicy, {
          maxDepth: 4,
          maxArrayLength: 32,
          maxObjectKeys: 64,
          maxStringLength: 256,
          maxDataUrlLength: 0,
        })
      : null,
    managedRuntimeTrustVersion: sanitizeInteger(
      source.managedRuntimeTrustVersion,
      0,
      0,
      999999
    ),
    managedRuntimePythonPath: sanitizeOptionalBoundedString(
      source.managedRuntimePythonPath,
      2048
    ),
    ollamaCommandPath: sanitizeOptionalBoundedString(
      source.ollamaCommandPath,
      2048
    ),
    endpoint: sanitizeOptionalBoundedString(source.endpoint, 2048),
    baseUrl: sanitizeOptionalBoundedString(source.baseUrl, 2048),
    timeoutMs: sanitizeInteger(source.timeoutMs, 15000, 1000, 120000),
    responseFormat: sanitizeLocalAiResponseFormat(source.responseFormat),
    prompt: sanitizeOptionalBoundedString(source.prompt, 10000),
    message: sanitizeOptionalBoundedString(source.message, 10000),
    messages: sanitizeLocalAiMessages(source.messages),
    generationOptions: sanitizeLocalAiGenerationOptions(
      source.generationOptions
    ),
    developerHumanTeacherSystemPrompt: sanitizeOptionalBoundedString(
      source.developerHumanTeacherSystemPrompt,
      8000
    ),
    input: sanitizedInput,
  }
}

function sanitizeLocalAiEpochPayload(payload = {}) {
  if (typeof payload === 'number' || typeof payload === 'string') {
    return sanitizeInteger(payload, null, 0)
  }

  const source = isPlainObject(payload) ? payload : {}
  return {
    epoch: sanitizeInteger(source.epoch, null, 0),
    currentEpoch: sanitizeInteger(source.currentEpoch, null, 0),
    currentPeriod: sanitizeOptionalBoundedString(source.currentPeriod, 64),
    stopMode: sanitizeOptionalBoundedString(source.stopMode, 32),
    offset: sanitizeInteger(source.offset, 0, 0),
    sampleName: sanitizeOptionalBoundedString(source.sampleName, 128),
    batchSize: sanitizeInteger(source.batchSize, null, 1, 50),
    localTrainingThermalMode: sanitizeOptionalBoundedString(
      source.localTrainingThermalMode,
      32
    ),
    localBenchmarkThermalMode: sanitizeOptionalBoundedString(
      source.localBenchmarkThermalMode,
      32
    ),
    localTrainingEpochs: sanitizeInteger(
      source.localTrainingEpochs,
      null,
      1,
      6
    ),
    localTrainingBatchSize: sanitizeInteger(
      source.localTrainingBatchSize,
      null,
      1,
      4
    ),
    localTrainingLoraRank: sanitizeInteger(
      source.localTrainingLoraRank,
      null,
      4,
      16
    ),
    evaluationFlips: sanitizeInteger(source.evaluationFlips, null, 50, 200),
    includePackage: sanitizeBoolean(source.includePackage, false),
    trainNow: sanitizeBoolean(source.trainNow, false),
    advance: sanitizeBoolean(source.advance, false),
    allowSystemPressureOverride: sanitizeBoolean(
      source.allowSystemPressureOverride,
      false
    ),
    refreshPublicFallback: sanitizeBoolean(source.refreshPublicFallback, false),
    fetchFlipPayloads: sanitizeBoolean(source.fetchFlipPayloads, false),
    requireFlipPayloads: sanitizeBoolean(source.requireFlipPayloads, false),
    allowPublicIndexerFallback: sanitizeBoolean(
      source.allowPublicIndexerFallback,
      true
    ),
    rankingPolicy: sanitizeBoundedCloneable(source.rankingPolicy, {
      maxDepth: 4,
      maxArrayLength: 16,
      maxObjectKeys: 32,
      maxStringLength: 1024,
      maxDataUrlLength: 2048,
    }),
    rpcUrl: sanitizeOptionalBoundedString(source.rpcUrl, 2048),
    rpcKey: sanitizeOptionalBoundedString(source.rpcKey, 512),
    annotationsPath: sanitizeOptionalBoundedString(
      source.annotationsPath,
      4096
    ),
    outputJsonlPath: sanitizeOptionalBoundedString(
      source.outputJsonlPath,
      4096
    ),
    summaryPath: sanitizeOptionalBoundedString(source.summaryPath, 4096),
    adapterStrategy: sanitizeOptionalBoundedString(source.adapterStrategy, 64),
    trainingPolicy: sanitizeOptionalBoundedString(source.trainingPolicy, 64),
    developerHumanTeacherSystemPrompt: sanitizeOptionalBoundedString(
      source.developerHumanTeacherSystemPrompt,
      8000
    ),
  }
}

function sanitizeLocalAiAnnotationPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {}

  return {
    ...sanitizeLocalAiEpochPayload(source),
    taskId: sanitizeOptionalBoundedString(source.taskId, 512),
    annotation: sanitizeBoundedCloneable(source.annotation, {
      maxDepth: 4,
      maxArrayLength: 16,
      maxObjectKeys: 32,
      maxStringLength: 4000,
      maxDataUrlLength: 2048,
    }),
  }
}

function sanitizeLocalAiRegisterAdapterPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {}
  const adapterArtifact = isPlainObject(source.adapterArtifact)
    ? source.adapterArtifact
    : {}

  return {
    epoch: sanitizeInteger(source.epoch, null, 0),
    artifactToken: sanitizeOptionalBoundedString(
      source.artifactToken ||
        source.importedArtifactToken ||
        adapterArtifact.artifactToken ||
        adapterArtifact.importedArtifactToken ||
        adapterArtifact.token,
      256
    ),
    publicModelId: sanitizeOptionalBoundedString(source.publicModelId, 256),
    publicVisionId: sanitizeOptionalBoundedString(source.publicVisionId, 256),
    runtimeBackend: sanitizeOptionalBoundedString(source.runtimeBackend, 64),
    reasonerBackend: sanitizeOptionalBoundedString(source.reasonerBackend, 64),
    visionBackend: sanitizeOptionalBoundedString(source.visionBackend, 64),
    contractVersion: sanitizeOptionalBoundedString(source.contractVersion, 64),
    baseModelId: sanitizeOptionalBoundedString(source.baseModelId, 256),
    baseModelHash: sanitizeOptionalBoundedString(source.baseModelHash, 256),
    trainingConfigHash: sanitizeOptionalBoundedString(
      source.trainingConfigHash,
      256
    ),
  }
}

function sanitizeLocalAiImportAdapterPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {}
  const adapterArtifact = isPlainObject(source.adapterArtifact)
    ? source.adapterArtifact
    : {}

  return {
    epoch: sanitizeInteger(source.epoch, null, 0),
    artifactFileName: sanitizeOptionalBoundedString(
      source.artifactFileName ||
        source.fileName ||
        source.name ||
        adapterArtifact.file ||
        adapterArtifact.fileName ||
        adapterArtifact.name,
      512
    ),
    artifactBase64: sanitizeOptionalBoundedString(
      source.artifactBase64 ||
        source.base64 ||
        source.dataUrl ||
        adapterArtifact.artifactBase64 ||
        adapterArtifact.base64 ||
        adapterArtifact.dataUrl,
      128 * 1024 * 1024
    ),
    publicModelId: sanitizeOptionalBoundedString(source.publicModelId, 256),
    publicVisionId: sanitizeOptionalBoundedString(source.publicVisionId, 256),
    runtimeBackend: sanitizeOptionalBoundedString(source.runtimeBackend, 64),
    reasonerBackend: sanitizeOptionalBoundedString(source.reasonerBackend, 64),
    visionBackend: sanitizeOptionalBoundedString(source.visionBackend, 64),
    contractVersion: sanitizeOptionalBoundedString(source.contractVersion, 64),
    baseModelId: sanitizeOptionalBoundedString(source.baseModelId, 256),
    baseModelHash: sanitizeOptionalBoundedString(source.baseModelHash, 256),
    trainingConfigHash: sanitizeOptionalBoundedString(
      source.trainingConfigHash,
      256
    ),
  }
}

function sanitizeLocalAiCapturePayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {}

  return {
    flipHash: sanitizeOptionalBoundedString(source.flipHash, 512),
    epoch: sanitizeInteger(source.epoch, null, 0),
    sessionType: sanitizeOptionalBoundedString(source.sessionType, 64),
    images: sanitizeDataImageList(source.images, 8),
    panelCount: sanitizeInteger(source.panelCount, 0, 0, 16),
    orders: Array.isArray(source.orders)
      ? source.orders
          .slice(0, 4)
          .map((order) =>
            Array.isArray(order)
              ? order.slice(0, 4).map((item) => sanitizeInteger(item, 0, 0, 16))
              : []
          )
      : [],
    words: Array.isArray(source.words)
      ? source.words.slice(0, 2).map((entry) => ({
          name: sanitizeOptionalBoundedString(entry && entry.name, 256),
          desc: sanitizeOptionalBoundedString(entry && entry.desc, 512),
        }))
      : [],
    selectedOrder: Array.isArray(source.selectedOrder)
      ? source.selectedOrder
          .slice(0, 4)
          .map((item) => sanitizeInteger(item, 0, 0, 16))
      : [],
    relevance: sanitizeOptionalBoundedString(source.relevance, 64),
    best: sanitizeBoolean(source.best, false),
    consensus: isPlainObject(source.consensus)
      ? {
          finalAnswer: sanitizeOptionalBoundedString(
            source.consensus.finalAnswer,
            64
          ),
          reported: sanitizeBoolean(source.consensus.reported, false),
          strength: sanitizeOptionalBoundedString(
            source.consensus.strength,
            64
          ),
        }
      : undefined,
  }
}

function sanitizeBoundedCloneable(
  value,
  {
    maxDepth = 6,
    maxArrayLength = 64,
    maxObjectKeys = 64,
    maxStringLength = 20000,
    maxDataUrlLength = 8 * 1024 * 1024,
  } = {},
  depth = 0,
  seen = new WeakSet()
) {
  if (value === null || typeof value === 'undefined') {
    return value
  }

  if (typeof value === 'string') {
    return value.startsWith('data:image/')
      ? value.slice(0, maxDataUrlLength)
      : value.slice(0, maxStringLength)
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

  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (depth >= maxDepth) {
    if (Array.isArray(value)) {
      return []
    }

    if (isPlainObject(value)) {
      return {}
    }

    return null
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }

  if (value instanceof Error) {
    return {
      name: sanitizeBoundedString(value.name, 'Error', 128),
      message: sanitizeBoundedString(value.message, '', 2000),
      stack: sanitizeOptionalBoundedString(value.stack, 4000),
    }
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('base64').slice(0, maxDataUrlLength)
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value).slice(0, maxArrayLength)
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value)).slice(0, maxArrayLength)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return []
    }

    seen.add(value)
    const next = value
      .slice(0, maxArrayLength)
      .map((item) =>
        sanitizeBoundedCloneable(
          item,
          {
            maxDepth,
            maxArrayLength,
            maxObjectKeys,
            maxStringLength,
            maxDataUrlLength,
          },
          depth + 1,
          seen
        )
      )
      .filter((item) => typeof item !== 'undefined')
    seen.delete(value)
    return next
  }

  if (!isPlainObject(value)) {
    return undefined
  }

  if (seen.has(value)) {
    return {}
  }

  seen.add(value)

  const next = Object.entries(value)
    .slice(0, maxObjectKeys)
    .reduce((result, [key, entryValue]) => {
      const normalizedKey = sanitizeBoundedString(key, '', 128)

      if (!normalizedKey) {
        return result
      }

      const normalizedValue = sanitizeBoundedCloneable(
        entryValue,
        {
          maxDepth,
          maxArrayLength,
          maxObjectKeys,
          maxStringLength,
          maxDataUrlLength,
        },
        depth + 1,
        seen
      )

      if (typeof normalizedValue !== 'undefined') {
        result[normalizedKey] = normalizedValue
      }

      return result
    }, {})

  seen.delete(value)
  return next
}

function sanitizeAiSolverPayload(payload = {}) {
  return sanitizeBoundedCloneable(payload, {
    maxDepth: 7,
    maxArrayLength: 64,
    maxObjectKeys: 96,
    maxStringLength: 20000,
    maxDataUrlLength: 8 * 1024 * 1024,
  })
}

function resizeImageDataUrl(
  dataUrl,
  {maxWidth = 400, maxHeight = 300, softResize = true} = {}
) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return null
  }

  const image = nativeImage.createFromDataURL(dataUrl)

  if (!image || image.isEmpty()) {
    return null
  }

  const {width, height} = image.getSize()
  const nextMaxWidth = sanitizeImageSize(maxWidth, 400)
  const nextMaxHeight = sanitizeImageSize(maxHeight, 300)

  let resizedImage = image

  if (width > nextMaxWidth || height > nextMaxHeight || softResize === false) {
    const ratio = height > 0 ? width / height : 1
    const newWidth =
      width > height ? nextMaxWidth : Math.round(nextMaxHeight * ratio)
    const newHeight =
      width < height ? nextMaxHeight : Math.round(nextMaxWidth / ratio)

    resizedImage = image.resize({
      width: Math.max(1, newWidth),
      height: Math.max(1, newHeight),
    })
  }

  return resizedImage.toDataURL()
}

const appInfo = getAppInfo()
const [locale] = String(appInfo.locale || 'en').split('-')
const appBridge = createAppBridge()
const nodeBridge = createNodeBridge()
const autoUpdateBridge = createAutoUpdateBridge()
const dnaBridge = createDnaBridge()
const imageSearchBridge = createImageSearchBridge()
const storageBridge = createStorageBridge()
const flipsBridge = createFlipsBridge()
const invitesBridge = createInvitesBridge()
const aiTestUnitBridge = Object.freeze({
  addFlips: (payload) =>
    invokeCloneable(
      AI_TEST_UNIT_COMMAND,
      'addFlips',
      sanitizeBoundedCloneable(payload, {
        maxDepth: 7,
        maxArrayLength: 64,
        maxObjectKeys: 96,
        maxStringLength: 20000,
        maxDataUrlLength: 8 * 1024 * 1024,
      })
    ),
  listFlips: (payload) =>
    invokeCloneable(
      AI_TEST_UNIT_COMMAND,
      'listFlips',
      sanitizeBoundedCloneable(payload, {
        maxDepth: 4,
        maxArrayLength: 32,
        maxObjectKeys: 32,
        maxStringLength: 2000,
        maxDataUrlLength: 8 * 1024 * 1024,
      })
    ),
  clearFlips: (payload) =>
    invokeCloneable(
      AI_TEST_UNIT_COMMAND,
      'clearFlips',
      sanitizeBoundedCloneable(payload, {
        maxDepth: 4,
        maxArrayLength: 32,
        maxObjectKeys: 32,
        maxStringLength: 2000,
        maxDataUrlLength: 8 * 1024 * 1024,
      })
    ),
  run: (payload) =>
    invokeCloneable(
      AI_TEST_UNIT_COMMAND,
      'run',
      sanitizeBoundedCloneable(payload, {
        maxDepth: 7,
        maxArrayLength: 64,
        maxObjectKeys: 96,
        maxStringLength: 20000,
        maxDataUrlLength: 8 * 1024 * 1024,
      })
    ),
  onEvent(handler) {
    if (typeof handler !== 'function') {
      return () => {}
    }

    let wrapped = aiTestUnitListenerRegistry.get(handler)

    if (!wrapped) {
      wrapped = (_event, first, second) =>
        handler(typeof second === 'undefined' ? first : second)
      aiTestUnitListenerRegistry.set(handler, wrapped)
    }

    ipcRenderer.on(AI_TEST_UNIT_EVENT, wrapped)

    return () => ipcRenderer.removeListener(AI_TEST_UNIT_EVENT, wrapped)
  },
  offEvent(handler) {
    const wrapped =
      typeof handler === 'function'
        ? aiTestUnitListenerRegistry.get(handler)
        : undefined

    if (wrapped) {
      ipcRenderer.removeListener(AI_TEST_UNIT_EVENT, wrapped)
    }
  },
})
const aiSolverBridge = Object.freeze({
  setProviderKey: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'setProviderKey',
      sanitizeAiSolverPayload(payload)
    ),
  clearProviderKey: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'clearProviderKey',
      sanitizeAiSolverPayload(payload)
    ),
  hasProviderKey: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'hasProviderKey',
      sanitizeAiSolverPayload(payload)
    ),
  testProvider: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'testProvider',
      sanitizeAiSolverPayload(payload)
    ),
  listModels: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'listModels',
      sanitizeAiSolverPayload(payload)
    ),
  generateImageSearchResults: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'generateImageSearchResults',
      sanitizeAiSolverPayload(payload)
    ),
  generateStoryOptions: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'generateStoryOptions',
      sanitizeAiSolverPayload(payload)
    ),
  generateFlipPanels: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'generateFlipPanels',
      sanitizeAiSolverPayload(payload)
    ),
  solveFlipBatch: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'solveFlipBatch',
      sanitizeAiSolverPayload(payload)
    ),
  reviewValidationReports: (payload) =>
    invokeCloneable(
      AI_SOLVER_COMMAND,
      'reviewValidationReports',
      sanitizeAiSolverPayload(payload)
    ),
})

const localAiBridge = Object.freeze({
  bridgeMode: 'electron',
  status: (payload) =>
    invokeCloneable('localAi.status', sanitizeLocalAiRuntimePayload(payload)),
  getDeveloperTelemetry: () => invokeCloneable('localAi.getDeveloperTelemetry'),
  start: (payload) =>
    invokeCloneable('localAi.start', sanitizeLocalAiRuntimePayload(payload)),
  stop: () => invokeCloneable('localAi.stop'),
  listModels: (payload) =>
    invokeCloneable(
      'localAi.listModels',
      sanitizeLocalAiRuntimePayload(payload)
    ),
  chat: (payload) =>
    invokeCloneable('localAi.chat', sanitizeLocalAiRuntimePayload(payload)),
  checkFlipSequence: (payload) =>
    invokeCloneable(
      'localAi.checkFlipSequence',
      sanitizeLocalAiRuntimePayload(payload)
    ),
  flipToText: (payload) =>
    invokeCloneable(
      'localAi.flipToText',
      sanitizeLocalAiRuntimePayload(payload)
    ),
  importAdapterArtifact: (payload) =>
    invokeCloneable(
      'localAi.importAdapterArtifact',
      sanitizeLocalAiImportAdapterPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  registerAdapterArtifact: (payload) =>
    invokeCloneable(
      'localAi.registerAdapterArtifact',
      sanitizeLocalAiRegisterAdapterPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  loadAdapterArtifact: (payload) =>
    invokeCloneable(
      'localAi.loadAdapterArtifact',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  loadTrainingCandidatePackage: (payload) =>
    invokeCloneable(
      'localAi.loadTrainingCandidatePackage',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  loadHumanTeacherPackage: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherPackage',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  buildTrainingCandidatePackage: (payload) =>
    invokeCloneable(
      'localAi.buildTrainingCandidatePackage',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  buildHumanTeacherPackage: (payload) =>
    invokeCloneable(
      'localAi.buildHumanTeacherPackage',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  loadHumanTeacherDemoWorkspace: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherDemoWorkspace',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  loadHumanTeacherDeveloperSession: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherDeveloperSession',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  loadHumanTeacherDeveloperSessionState: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherDeveloperSessionState',
      sanitizeLocalAiEpochPayload(payload)
    ),
  stopHumanTeacherDeveloperRun: (payload) =>
    invokeCloneable(
      'localAi.stopHumanTeacherDeveloperRun',
      sanitizeLocalAiEpochPayload(payload)
    ),
  updateHumanTeacherDeveloperRunControls: (payload) =>
    invokeCloneable(
      'localAi.updateHumanTeacherDeveloperRunControls',
      sanitizeLocalAiEpochPayload(payload)
    ),
  loadHumanTeacherDeveloperComparisonExamples: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherDeveloperComparisonExamples',
      sanitizeLocalAiEpochPayload(payload)
    ),
  exportHumanTeacherDeveloperBundle: (payload) =>
    invokeCloneable(
      'localAi.exportHumanTeacherDeveloperBundle',
      sanitizeLocalAiEpochPayload(payload)
    ).then((result) =>
      sanitizeHumanTeacherBridgeResult(
        sanitizeHumanTeacherDeveloperBundleResult(result)
      )
    ),
  loadHumanTeacherDemoTask: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherDemoTask',
      sanitizeLocalAiAnnotationPayload(payload)
    ),
  loadHumanTeacherDeveloperTask: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherDeveloperTask',
      sanitizeLocalAiAnnotationPayload(payload)
    ),
  loadHumanTeacherAnnotationWorkspace: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherAnnotationWorkspace',
      sanitizeLocalAiEpochPayload(payload)
    ).then((result) =>
      sanitizeHumanTeacherBridgeResult(
        sanitizeHumanTeacherWorkspaceResult(result)
      )
    ),
  loadHumanTeacherAnnotationTask: (payload) =>
    invokeCloneable(
      'localAi.loadHumanTeacherAnnotationTask',
      sanitizeLocalAiAnnotationPayload(payload)
    ),
  exportHumanTeacherTasks: (payload) =>
    invokeCloneable(
      'localAi.exportHumanTeacherTasks',
      sanitizeLocalAiEpochPayload(payload)
    ).then((result) =>
      sanitizeHumanTeacherBridgeResult(sanitizeHumanTeacherExportResult(result))
    ),
  saveHumanTeacherAnnotationDraft: (payload) =>
    invokeCloneable(
      'localAi.saveHumanTeacherAnnotationDraft',
      sanitizeLocalAiAnnotationPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  saveHumanTeacherDemoDraft: (payload) =>
    invokeCloneable(
      'localAi.saveHumanTeacherDemoDraft',
      sanitizeLocalAiAnnotationPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  saveHumanTeacherDeveloperDraft: (payload) =>
    invokeCloneable(
      'localAi.saveHumanTeacherDeveloperDraft',
      sanitizeLocalAiAnnotationPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  finalizeHumanTeacherDemoChunk: (payload) =>
    invokeCloneable(
      'localAi.finalizeHumanTeacherDemoChunk',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  finalizeHumanTeacherDeveloperChunk: (payload) =>
    invokeCloneable(
      'localAi.finalizeHumanTeacherDeveloperChunk',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  runHumanTeacherDeveloperComparison: (payload) =>
    invokeCloneable(
      'localAi.runHumanTeacherDeveloperComparison',
      sanitizeLocalAiEpochPayload(payload)
    ).then(sanitizeHumanTeacherBridgeResult),
  importHumanTeacherAnnotations: (payload) =>
    invokeCloneable(
      'localAi.importHumanTeacherAnnotations',
      sanitizeLocalAiEpochPayload(payload)
    ).then((result) =>
      sanitizeHumanTeacherBridgeResult(sanitizeHumanTeacherImportResult(result))
    ),
  updateTrainingCandidatePackageReview: (payload) =>
    invokeCloneable('localAi.updateTrainingCandidatePackageReview', {
      epoch: sanitizeInteger(payload && payload.epoch, null, 0),
      reviewStatus: sanitizeOptionalBoundedString(
        payload && payload.reviewStatus,
        64
      ),
    }).then(sanitizeHumanTeacherBridgeResult),
  updateHumanTeacherPackageReview: (payload) =>
    invokeCloneable('localAi.updateHumanTeacherPackageReview', {
      epoch: sanitizeInteger(payload && payload.epoch, null, 0),
      currentEpoch: sanitizeInteger(payload && payload.currentEpoch, null, 0),
      reviewStatus: sanitizeOptionalBoundedString(
        payload && payload.reviewStatus,
        64
      ),
    }).then(sanitizeHumanTeacherBridgeResult),
  buildBundle: (epoch) =>
    invokeCloneable(
      'localAi.buildBundle',
      sanitizeInteger(epoch, null, 0)
    ).then(sanitizeHumanTeacherBridgeResult),
  importBundle: (filePath) =>
    invokeCloneable(
      'localAi.importBundle',
      sanitizeBoundedString(filePath, '', 4096)
    ).then(sanitizeHumanTeacherBridgeResult),
  aggregate: () =>
    invokeCloneable('localAi.aggregate').then(sanitizeHumanTeacherBridgeResult),
  captureFlip: (payload) =>
    ipcRenderer.send(
      'localAi.captureFlip',
      toIpcCloneable(sanitizeLocalAiCapturePayload(payload))
    ),
})

const consoleLogger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}

const bridge = {
  globals: {
    aiSolver: aiSolverBridge,
    aiTestUnit: aiTestUnitBridge,
    localAi: localAiBridge,
    openExternal: (url) =>
      invokeCloneable('shell.openExternal.safe', {url: String(url || '')}),
    logger: consoleLogger,
    isDev,
    isTest,
    isMac: process.platform === 'darwin',
    locale,
    appVersion: appInfo.version || '0.0.0',
    totalSystemMemoryBytes:
      Number(appInfo.totalSystemMemoryBytes) > 0
        ? Number(appInfo.totalSystemMemoryBytes)
        : 0,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      NODE_MOCK: process.env.NODE_MOCK,
      BUMP_EXTRA_FLIPS: process.env.BUMP_EXTRA_FLIPS,
      FINALIZE_FLIPS: process.env.FINALIZE_FLIPS,
      INDEXER_URL: process.env.INDEXER_URL,
    },
    getZoomLevel: () => webFrame.getZoomLevel(),
    setZoomLevel: (level) => webFrame.setZoomLevel(level),
    toggleFullScreen: () =>
      invokeCloneable(WINDOW_COMMAND, 'toggleFullScreen').catch((error) =>
        console.warn('Cannot toggle fullscreen', error && error.message)
      ),
  },
  app: appBridge,
  node: nodeBridge,
  updates: autoUpdateBridge,
  dna: dnaBridge,
  imageSearch: imageSearchBridge,
  storage: storageBridge,
  clipboard: {
    readText: () => clipboard.readText(),
    readImageDataUrl(options) {
      const image = clipboard.readImage()

      if (!image || image.isEmpty()) {
        return null
      }

      return resizeImageDataUrl(image.toDataURL(), options)
    },
    writeImageDataUrl(dataUrl) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return false
      }

      const image = nativeImage.createFromDataURL(dataUrl)

      if (!image || image.isEmpty()) {
        return false
      }

      clipboard.writeImage(image)
      return true
    },
  },
  image: {
    resizeDataUrl: (dataUrl, options) => resizeImageDataUrl(dataUrl, options),
    createBlankDataUrl({width = 1, height = 1} = {}) {
      return nativeImage
        .createFromDataURL(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQYlWP4//8/AAX+Av5e8BQ1AAAAAElFTkSuQmCC'
        )
        .resize({
          width: sanitizeImageSize(width, 1),
          height: sanitizeImageSize(height, 1),
        })
        .toDataURL()
    },
  },
  home: {
    getIdenaBotState: () => invokeCloneable('home.idenaBot.get'),
    skipIdenaBot: () => ipcRenderer.send('home.idenaBot.skip'),
  },
  social: {
    rpc: (payload) => invokeCloneable('social.rpc', payload),
  },
  rpc: {
    call: (payload) => invokeCloneable('rpc.call', payload),
  },
  flips: flipsBridge,
  invites: invitesBridge,
}

contextBridge.exposeInMainWorld('idena', bridge)

if (typeof window !== 'undefined') {
  window.dispatchEvent(new window.Event('idena-preload-ready'))
}
