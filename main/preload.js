// eslint-disable-next-line import/no-extraneous-dependencies
const electron = require('electron')

const {clipboard, contextBridge, nativeImage, ipcRenderer, shell, webFrame} =
  electron
const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true

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
  AUTO_UPDATE_COMMAND,
  AUTO_UPDATE_EVENT,
  AI_SOLVER_COMMAND,
  AI_TEST_UNIT_COMMAND,
  AI_TEST_UNIT_EVENT,
  NODE_COMMAND,
  NODE_EVENT,
  WINDOW_COMMAND,
} = require('./channels')

const DNA_LINK_EVENT = 'DNA_LINK'
const CHECK_DNA_LINK_COMMAND = 'CHECK_DNA_LINK'
const IDENA_CONTEXT_BRIDGE_KEY = '__idenaBridge'
let didExposeContextBridge = false
let didExposeLegacyContextBridge = false

function getAppInfo() {
  try {
    return ipcRenderer.sendSync(APP_INFO_COMMAND) || {}
  } catch (error) {
    return {}
  }
}

function setSharedGlobal(key, value) {
  if (typeof global !== 'undefined') {
    global[key] = value
  }
  if (typeof window !== 'undefined') {
    window[key] = value
  }
}

function createEventBridge(channel, commandChannel) {
  return {
    onEvent: (handler) => {
      if (typeof handler !== 'function') {
        return () => {}
      }

      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    offEvent: (handler) => {
      if (typeof handler === 'function') {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    sendCommand: (command, payload) =>
      ipcRenderer.send(commandChannel, command, payload),
  }
}

function createLoggerBridge() {
  return {
    debug: (...args) => logger.debug(...args),
    info: (...args) => logger.info(...args),
    warn: (...args) => logger.warn(...args),
    error: (...args) => logger.error(...args),
  }
}

function createIpcRendererBridge() {
  return {
    on: (channel, handler) => {
      if (typeof handler !== 'function') {
        return
      }
      ipcRenderer.on(channel, handler)
    },
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    removeListener: (channel, handler) => {
      if (typeof handler === 'function') {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }
}

function createNativeImageBridge() {
  const wrapNativeImage = (image) => ({
    isEmpty: () => image.isEmpty(),
    getSize: () => image.getSize(),
    resize: (options) => wrapNativeImage(image.resize(options)),
    toDataURL: () => image.toDataURL(),
  })

  return {
    createFromDataURL: (dataUrl) =>
      wrapNativeImage(nativeImage.createFromDataURL(dataUrl)),
  }
}

function createClipboardBridge(nativeImageBridge) {
  return {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(String(text || '')),
    readImage: () => {
      const image = clipboard.readImage()
      return {
        isEmpty: () => image.isEmpty(),
        getSize: () => image.getSize(),
        resize: (options) => ({
          isEmpty: () => image.resize(options).isEmpty(),
          getSize: () => image.resize(options).getSize(),
          resize: (nextOptions) =>
            nativeImageBridge.createFromDataURL(
              image.resize(options).resize(nextOptions).toDataURL()
            ),
          toDataURL: () => image.resize(options).toDataURL(),
        }),
        toDataURL: () => image.toDataURL(),
      }
    },
    writeImage: (image) => {
      if (image && typeof image.toDataURL === 'function') {
        clipboard.writeImage(nativeImage.createFromDataURL(image.toDataURL()))
      }
    },
  }
}

function exposeContextBridgeValue(bridge) {
  if (didExposeContextBridge) {
    return
  }

  contextBridge.exposeInMainWorld(IDENA_CONTEXT_BRIDGE_KEY, bridge)
  didExposeContextBridge = true
}

function exposeLegacyContextBridgeValues(bridge) {
  if (didExposeLegacyContextBridge) {
    return
  }

  ;[
    'appVersion',
    'env',
    'isDev',
    'isTest',
    'isMac',
    'ipcRenderer',
    'logger',
    'openExternal',
    'getZoomLevel',
    'setZoomLevel',
    'toggleFullScreen',
    'aiSolver',
    'aiTestUnit',
    'localAi',
    'flipStore',
    'invitesDb',
    'contactsDb',
    'prepareDb',
    'dbPath',
    'levelup',
    'leveldown',
    'sub',
    'search',
    'dna',
    'node',
    'updates',
    'clipboard',
    'nativeImage',
    'locale',
  ].forEach((key) => {
    if (typeof bridge[key] !== 'undefined') {
      contextBridge.exposeInMainWorld(key, bridge[key])
    }
  })

  didExposeLegacyContextBridge = true
}

function exposePreloadGlobals() {
  const appInfo = getAppInfo()
  const nativeImageBridge = createNativeImageBridge()
  const [locale] = String(appInfo.locale || 'en').split('-')
  const bridge = {
    appVersion: appInfo.version || '0.0.0',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      NODE_MOCK: process.env.NODE_MOCK,
      BUMP_EXTRA_FLIPS: process.env.BUMP_EXTRA_FLIPS,
      FINALIZE_FLIPS: process.env.FINALIZE_FLIPS,
      INDEXER_URL: process.env.INDEXER_URL,
    },
    isDev,
    isTest: process.env.NODE_ENV === 'e2e',
    isMac: process.platform === 'darwin',
    ipcRenderer: createIpcRendererBridge(),
    logger: createLoggerBridge(),
    openExternal: (url) => shell.openExternal(url),
    getZoomLevel: () => webFrame.getZoomLevel(),
    setZoomLevel: (level) => webFrame.setZoomLevel(level),
    toggleFullScreen: () =>
      ipcRenderer
        .invoke(WINDOW_COMMAND, 'toggleFullScreen')
        .catch((error) =>
          logger.warn('Cannot toggle fullscreen', error && error.message)
        ),
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
      onEvent: (handler) => {
        if (typeof handler !== 'function') {
          return () => {}
        }
        const listener = (_event, first, second) =>
          handler(typeof second === 'undefined' ? first : second)
        ipcRenderer.on(AI_TEST_UNIT_EVENT, listener)
        return () => ipcRenderer.removeListener(AI_TEST_UNIT_EVENT, listener)
      },
      offEvent: (handler) => {
        if (typeof handler === 'function') {
          ipcRenderer.removeListener(AI_TEST_UNIT_EVENT, handler)
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
    flipStore: flips,
    invitesDb: invites,
    contactsDb: contacts,
    prepareDb,
    dbPath,
    levelup,
    leveldown,
    sub,
    clipboard: createClipboardBridge(nativeImageBridge),
    nativeImage: nativeImageBridge,
    locale,
    search: {
      searchImage: (query) => ipcRenderer.invoke('search-image', query),
    },
    dna: {
      getPendingLink: () =>
        ipcRenderer.invoke(CHECK_DNA_LINK_COMMAND).catch(() => undefined),
      onLink: (handler) => {
        if (typeof handler !== 'function') {
          return () => {}
        }

        ipcRenderer.on(DNA_LINK_EVENT, handler)
        return () => ipcRenderer.removeListener(DNA_LINK_EVENT, handler)
      },
      offLink: (handler) => {
        if (typeof handler === 'function') {
          ipcRenderer.removeListener(DNA_LINK_EVENT, handler)
        }
      },
    },
    node: createEventBridge(NODE_EVENT, NODE_COMMAND),
    updates: createEventBridge(AUTO_UPDATE_EVENT, AUTO_UPDATE_COMMAND),
  }

  exposeContextBridgeValue(bridge)
  exposeLegacyContextBridgeValues(bridge)
  if (typeof window !== 'undefined' && !window.global) {
    window.global = window
  }

  setSharedGlobal('ipcRenderer', bridge.ipcRenderer)
  setSharedGlobal('openExternal', bridge.openExternal)
  setSharedGlobal('aiSolver', bridge.aiSolver)
  setSharedGlobal('aiTestUnit', bridge.aiTestUnit)
  setSharedGlobal('localAi', bridge.localAi)
  setSharedGlobal('flipStore', bridge.flipStore)
  setSharedGlobal('invitesDb', bridge.invitesDb)
  setSharedGlobal('contactsDb', bridge.contactsDb)
  setSharedGlobal('logger', bridge.logger)
  setSharedGlobal('isDev', bridge.isDev)
  setSharedGlobal('isTest', bridge.isTest)
  setSharedGlobal('prepareDb', bridge.prepareDb)
  setSharedGlobal('isMac', bridge.isMac)

  setSharedGlobal('clipboard', bridge.clipboard)
  setSharedGlobal('nativeImage', bridge.nativeImage)
  setSharedGlobal('locale', bridge.locale)

  setSharedGlobal('getZoomLevel', bridge.getZoomLevel)
  setSharedGlobal('setZoomLevel', bridge.setZoomLevel)

  setSharedGlobal('appVersion', bridge.appVersion)

  setSharedGlobal('env', bridge.env)

  setSharedGlobal('toggleFullScreen', bridge.toggleFullScreen)

  setSharedGlobal('levelup', bridge.levelup)
  setSharedGlobal('leveldown', bridge.leveldown)
  setSharedGlobal('dbPath', bridge.dbPath)
  setSharedGlobal('sub', bridge.sub)
  setSharedGlobal('search', bridge.search)
  setSharedGlobal('dna', bridge.dna)
  setSharedGlobal('node', bridge.node)
  setSharedGlobal('updates', bridge.updates)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new window.Event('idena-preload-ready'))
  }
}

exposePreloadGlobals()
process.once('loaded', exposePreloadGlobals)
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', exposePreloadGlobals, {
    once: true,
  })
}
