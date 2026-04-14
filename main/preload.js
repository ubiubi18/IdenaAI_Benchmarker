/* eslint-disable import/no-extraneous-dependencies */
const {
  contextBridge,
  ipcRenderer,
  clipboard,
  nativeImage,
  webFrame,
} = require('electron')
/* eslint-enable import/no-extraneous-dependencies */

const levelup = require('levelup')
const leveldown = require('leveldown')
const sub = require('subleveldown')

const flips = require('./stores/flips')
const invites = require('./stores/invites')
const contacts = require('./stores/contacts')
const logger = require('./logger')
const {toIpcCloneable} = require('./utils/ipc-cloneable')
const {prepareDb, dbPath} = require('./stores/setup')
const {
  APP_INFO_COMMAND,
  AI_SOLVER_COMMAND,
  AI_TEST_UNIT_COMMAND,
  AI_TEST_UNIT_EVENT,
  AUTO_UPDATE_COMMAND,
  AUTO_UPDATE_EVENT,
  NODE_COMMAND,
  NODE_EVENT,
  WINDOW_COMMAND,
} = require('./channels')

const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true

const isTest = process.env.NODE_ENV === 'e2e'

const allowedSendChannels = new Set([
  'confirm-quit',
  'reload',
  'showMainWindow',
  'localAi.captureFlip',
  NODE_COMMAND,
  AUTO_UPDATE_COMMAND,
])

const allowedInvokeChannels = new Set(['CHECK_DNA_LINK', 'search-image'])

const allowedSubscribeChannels = new Set([
  'confirm-quit',
  'DNA_LINK',
  NODE_EVENT,
  AUTO_UPDATE_EVENT,
])

const ipcListenerRegistry = new Map()
const aiTestUnitListenerRegistry = new WeakMap()
const dbRegistry = new Map()

function getAppInfo() {
  try {
    return ipcRenderer.sendSync(APP_INFO_COMMAND) || {}
  } catch (error) {
    return {}
  }
}

function getListenerStore(channel) {
  if (!ipcListenerRegistry.has(channel)) {
    ipcListenerRegistry.set(channel, new WeakMap())
  }

  return ipcListenerRegistry.get(channel)
}

function createIpcBridge() {
  return {
    send(channel, ...args) {
      if (!allowedSendChannels.has(channel)) {
        throw new Error(`Unsupported IPC send channel: ${channel}`)
      }

      ipcRenderer.send(channel, ...args.map((arg) => toIpcCloneable(arg)))
    },
    invoke(channel, ...args) {
      if (!allowedInvokeChannels.has(channel)) {
        throw new Error(`Unsupported IPC invoke channel: ${channel}`)
      }

      return ipcRenderer.invoke(
        channel,
        ...args.map((arg) => toIpcCloneable(arg))
      )
    },
    on(channel, handler) {
      if (!allowedSubscribeChannels.has(channel)) {
        throw new Error(`Unsupported IPC subscribe channel: ${channel}`)
      }

      if (typeof handler !== 'function') {
        return () => {}
      }

      const store = getListenerStore(channel)
      let wrapped = store.get(handler)

      if (!wrapped) {
        wrapped = (_event, ...args) => handler(undefined, ...args)
        store.set(handler, wrapped)
      }

      ipcRenderer.on(channel, wrapped)

      return () => ipcRenderer.removeListener(channel, wrapped)
    },
    removeListener(channel, handler) {
      const wrapped =
        typeof handler === 'function'
          ? getListenerStore(channel).get(handler)
          : undefined

      if (wrapped) {
        ipcRenderer.removeListener(channel, wrapped)
      }
    },
  }
}

function resolveDbDescriptor(descriptor = {}) {
  const nextDescriptor =
    descriptor && typeof descriptor === 'object' ? descriptor : {}
  const sublevels = Array.isArray(nextDescriptor.sublevels)
    ? nextDescriptor.sublevels
        .map((entry) => {
          const nextEntry = entry && typeof entry === 'object' ? entry : {}
          const prefix =
            typeof nextEntry.prefix === 'string' ? nextEntry.prefix.trim() : ''

          if (!prefix) {
            return null
          }

          return {
            prefix,
            options:
              nextEntry.options && typeof nextEntry.options === 'object'
                ? nextEntry.options
                : {},
          }
        })
        .filter(Boolean)
    : []

  return {
    name:
      typeof nextDescriptor.name === 'string' && nextDescriptor.name.trim()
        ? nextDescriptor.name.trim()
        : 'db',
    sublevels,
  }
}

function getDb(name = 'db') {
  if (!dbRegistry.has(name)) {
    dbRegistry.set(name, levelup(leveldown(dbPath(name))))
  }

  return dbRegistry.get(name)
}

function resolveTargetDb(descriptor = {}) {
  const nextDescriptor = resolveDbDescriptor(descriptor)

  return nextDescriptor.sublevels.reduce(
    (targetDb, {prefix, options}) => sub(targetDb, prefix, options),
    getDb(nextDescriptor.name)
  )
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
const ipcBridge = createIpcBridge()
const invokeCloneable = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args.map((arg) => toIpcCloneable(arg)))

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
    },
    ipcRenderer: ipcBridge,
    openExternal: (url) =>
      invokeCloneable('shell.openExternal.safe', {url: String(url || '')}),
    flipStore: {
      getFlips: flips.getFlips,
      getFlip: flips.getFlip,
      saveFlips: flips.saveFlips,
      addDraft: flips.addDraft,
      updateDraft: flips.updateDraft,
      deleteDraft: flips.deleteDraft,
      clear: flips.clear,
    },
    invitesDb: invites,
    contactsDb: contacts,
    logger: {
      debug: (...args) => logger.debug(...args),
      info: (...args) => logger.info(...args),
      warn: (...args) => logger.warn(...args),
      error: (...args) => logger.error(...args),
    },
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
        logger.warn('Cannot toggle fullscreen', error && error.message)
      ),
  },
  persistence: {
    loadState(dbName) {
      return prepareDb(dbName).getState()
    },
    loadValue(dbName, key) {
      const state = prepareDb(dbName).getState()
      return state ? state[key] : null
    },
    persistItem(dbName, key, value) {
      prepareDb(dbName).set(key, value).write()
      return true
    },
    persistState(dbName, state) {
      prepareDb(dbName).setState(state).write()
      return true
    },
  },
  db: {
    get(descriptor, key) {
      return resolveTargetDb(descriptor).get(key)
    },
    put(descriptor, key, value) {
      return resolveTargetDb(descriptor).put(key, value)
    },
    clear(descriptor) {
      return resolveTargetDb(descriptor).clear()
    },
    batchWrite(descriptor, operations = []) {
      let batch = resolveTargetDb(descriptor).batch()

      for (const operation of Array.isArray(operations) ? operations : []) {
        const nextOperation =
          operation && typeof operation === 'object' ? operation : {}

        if (nextOperation.type === 'put') {
          batch = batch.put(nextOperation.key, nextOperation.value)
        } else if (nextOperation.type === 'del') {
          batch = batch.del(nextOperation.key)
        }
      }

      return batch.write()
    },
  },
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
}

contextBridge.exposeInMainWorld('idena', bridge)

if (typeof window !== 'undefined') {
  window.dispatchEvent(new window.Event('idena-preload-ready'))
}
