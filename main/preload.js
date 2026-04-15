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
        result[key] = normalized
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

const consoleLogger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}

const bridge = {
  globals: {
    aiSolver: {
      setProviderKey: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'setProviderKey', payload),
      clearProviderKey: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'clearProviderKey', payload),
      hasProviderKey: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'hasProviderKey', payload),
      testProvider: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'testProvider', payload),
      listModels: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'listModels', payload),
      generateImageSearchResults: (payload) =>
        invokeCloneable(
          AI_SOLVER_COMMAND,
          'generateImageSearchResults',
          payload
        ),
      generateStoryOptions: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'generateStoryOptions', payload),
      generateFlipPanels: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'generateFlipPanels', payload),
      solveFlipBatch: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'solveFlipBatch', payload),
      reviewValidationReports: (payload) =>
        invokeCloneable(AI_SOLVER_COMMAND, 'reviewValidationReports', payload),
    },
    aiTestUnit: {
      addFlips: (payload) =>
        invokeCloneable(AI_TEST_UNIT_COMMAND, 'addFlips', payload),
      listFlips: (payload) =>
        invokeCloneable(AI_TEST_UNIT_COMMAND, 'listFlips', payload),
      clearFlips: (payload) =>
        invokeCloneable(AI_TEST_UNIT_COMMAND, 'clearFlips', payload),
      run: (payload) => invokeCloneable(AI_TEST_UNIT_COMMAND, 'run', payload),
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
    },
    localAi: {
      status: (payload) => invokeCloneable('localAi.status', payload),
      start: (payload) => invokeCloneable('localAi.start', payload),
      stop: () => invokeCloneable('localAi.stop'),
      listModels: (payload) => invokeCloneable('localAi.listModels', payload),
      info: (payload) => invokeCloneable('localAi.info', payload),
      chat: (payload) => invokeCloneable('localAi.chat', payload),
      flipJudge: (payload) => invokeCloneable('localAi.flipJudge', payload),
      trainHook: (payload) => invokeCloneable('localAi.trainHook', payload),
      checkFlipSequence: (payload) =>
        invokeCloneable('localAi.checkFlipSequence', payload),
      flipToText: (payload) => invokeCloneable('localAi.flipToText', payload),
      captionFlip: (payload) => invokeCloneable('localAi.captionFlip', payload),
      ocrImage: (payload) => invokeCloneable('localAi.ocrImage', payload),
      trainEpoch: (payload) => invokeCloneable('localAi.trainEpoch', payload),
      registerAdapterArtifact: (payload) =>
        invokeCloneable('localAi.registerAdapterArtifact', payload),
      loadAdapterArtifact: (payload) =>
        invokeCloneable('localAi.loadAdapterArtifact', payload),
      loadTrainingCandidatePackage: (payload) =>
        invokeCloneable('localAi.loadTrainingCandidatePackage', payload),
      buildTrainingCandidatePackage: (payload) =>
        invokeCloneable('localAi.buildTrainingCandidatePackage', payload),
      updateTrainingCandidatePackageReview: (payload) =>
        invokeCloneable(
          'localAi.updateTrainingCandidatePackageReview',
          payload
        ),
      buildBundle: (epoch) => invokeCloneable('localAi.buildBundle', epoch),
      importBundle: (filePath) =>
        invokeCloneable('localAi.importBundle', filePath),
      aggregate: () => invokeCloneable('localAi.aggregate'),
      captureFlip: (payload) =>
        ipcRenderer.send('localAi.captureFlip', toIpcCloneable(payload)),
    },
    openExternal: (url) =>
      invokeCloneable('shell.openExternal.safe', {url: String(url || '')}),
    logger: consoleLogger,
    isDev,
    isTest,
    isMac: process.platform === 'darwin',
    locale,
    appVersion: appInfo.version || '0.0.0',
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
