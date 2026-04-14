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

      ipcRenderer.send(channel, ...args)
    },
    invoke(channel, ...args) {
      if (!allowedInvokeChannels.has(channel)) {
        throw new Error(`Unsupported IPC invoke channel: ${channel}`)
      }

      return ipcRenderer.invoke(channel, ...args)
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

const bridge = {
  globals: {
    aiSolver: {
      setProviderKey: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'setProviderKey', payload),
      clearProviderKey: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'clearProviderKey', payload),
      hasProviderKey: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'hasProviderKey', payload),
      testProvider: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'testProvider', payload),
      listModels: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'listModels', payload),
      generateImageSearchResults: (payload) =>
        ipcRenderer.invoke(
          AI_SOLVER_COMMAND,
          'generateImageSearchResults',
          payload
        ),
      generateStoryOptions: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'generateStoryOptions', payload),
      generateFlipPanels: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'generateFlipPanels', payload),
      solveFlipBatch: (payload) =>
        ipcRenderer.invoke(AI_SOLVER_COMMAND, 'solveFlipBatch', payload),
      reviewValidationReports: (payload) =>
        ipcRenderer.invoke(
          AI_SOLVER_COMMAND,
          'reviewValidationReports',
          payload
        ),
    },
    aiTestUnit: {
      addFlips: (payload) =>
        ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'addFlips', payload),
      listFlips: (payload) =>
        ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'listFlips', payload),
      clearFlips: (payload) =>
        ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'clearFlips', payload),
      run: (payload) =>
        ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'run', payload),
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
      status: (payload) => ipcRenderer.invoke('localAi.status', payload),
      start: (payload) => ipcRenderer.invoke('localAi.start', payload),
      stop: () => ipcRenderer.invoke('localAi.stop'),
      listModels: (payload) =>
        ipcRenderer.invoke('localAi.listModels', payload),
      info: (payload) => ipcRenderer.invoke('localAi.info', payload),
      chat: (payload) => ipcRenderer.invoke('localAi.chat', payload),
      flipJudge: (payload) => ipcRenderer.invoke('localAi.flipJudge', payload),
      trainHook: (payload) => ipcRenderer.invoke('localAi.trainHook', payload),
      checkFlipSequence: (payload) =>
        ipcRenderer.invoke('localAi.checkFlipSequence', payload),
      flipToText: (payload) =>
        ipcRenderer.invoke('localAi.flipToText', payload),
      captionFlip: (payload) =>
        ipcRenderer.invoke('localAi.captionFlip', payload),
      ocrImage: (payload) => ipcRenderer.invoke('localAi.ocrImage', payload),
      trainEpoch: (payload) =>
        ipcRenderer.invoke('localAi.trainEpoch', payload),
      loadTrainingCandidatePackage: (payload) =>
        ipcRenderer.invoke('localAi.loadTrainingCandidatePackage', payload),
      buildTrainingCandidatePackage: (payload) =>
        ipcRenderer.invoke('localAi.buildTrainingCandidatePackage', payload),
      updateTrainingCandidatePackageReview: (payload) =>
        ipcRenderer.invoke(
          'localAi.updateTrainingCandidatePackageReview',
          payload
        ),
    },
    ipcRenderer: ipcBridge,
    openExternal: (url) =>
      ipcRenderer.invoke('shell.openExternal.safe', {url: String(url || '')}),
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
      ipcRenderer
        .invoke(WINDOW_COMMAND, 'toggleFullScreen')
        .catch((error) =>
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
    getIdenaBotState: () => ipcRenderer.invoke('home.idenaBot.get'),
    skipIdenaBot: () => ipcRenderer.send('home.idenaBot.skip'),
  },
  social: {
    rpc: (payload) => ipcRenderer.invoke('social.rpc', payload),
  },
  rpc: {
    call: (payload) => ipcRenderer.invoke('rpc.call', payload),
  },
}

contextBridge.exposeInMainWorld('idena', bridge)

if (typeof window !== 'undefined') {
  window.dispatchEvent(new window.Event('idena-preload-ready'))
}
