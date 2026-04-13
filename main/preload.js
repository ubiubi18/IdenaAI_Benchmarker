// eslint-disable-next-line import/no-extraneous-dependencies
const electron = require('electron')

const {clipboard, nativeImage, ipcRenderer, shell, webFrame} = electron
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
  AI_SOLVER_COMMAND,
  AI_TEST_UNIT_COMMAND,
  AI_TEST_UNIT_EVENT,
  WINDOW_COMMAND,
} = require('./channels')

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

function exposePreloadGlobals() {
  const appInfo = getAppInfo()
  if (typeof window !== 'undefined' && !window.global) {
    window.global = window
  }

  setSharedGlobal('ipcRenderer', ipcRenderer)
  setSharedGlobal('openExternal', shell.openExternal)
  setSharedGlobal('aiSolver', {
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
  })
  setSharedGlobal('aiTestUnit', {
    addFlips: (payload) =>
      ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'addFlips', payload),
    listFlips: (payload) =>
      ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'listFlips', payload),
    clearFlips: (payload) =>
      ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'clearFlips', payload),
    run: (payload) => ipcRenderer.invoke(AI_TEST_UNIT_COMMAND, 'run', payload),
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
  })
  setSharedGlobal('localAi', {
    status: (payload) => ipcRenderer.invoke('localAi.status', payload),
    start: (payload) => ipcRenderer.invoke('localAi.start', payload),
    stop: () => ipcRenderer.invoke('localAi.stop'),
    listModels: (payload) => ipcRenderer.invoke('localAi.listModels', payload),
    info: (payload) => ipcRenderer.invoke('localAi.info', payload),
    chat: (payload) => ipcRenderer.invoke('localAi.chat', payload),
    flipJudge: (payload) => ipcRenderer.invoke('localAi.flipJudge', payload),
    trainHook: (payload) => ipcRenderer.invoke('localAi.trainHook', payload),
    checkFlipSequence: (payload) =>
      ipcRenderer.invoke('localAi.checkFlipSequence', payload),
    flipToText: (payload) => ipcRenderer.invoke('localAi.flipToText', payload),
    captionFlip: (payload) =>
      ipcRenderer.invoke('localAi.captionFlip', payload),
    ocrImage: (payload) => ipcRenderer.invoke('localAi.ocrImage', payload),
    trainEpoch: (payload) => ipcRenderer.invoke('localAi.trainEpoch', payload),
    loadTrainingCandidatePackage: (payload) =>
      ipcRenderer.invoke('localAi.loadTrainingCandidatePackage', payload),
    buildTrainingCandidatePackage: (payload) =>
      ipcRenderer.invoke('localAi.buildTrainingCandidatePackage', payload),
    updateTrainingCandidatePackageReview: (payload) =>
      ipcRenderer.invoke(
        'localAi.updateTrainingCandidatePackageReview',
        payload
      ),
  })

  setSharedGlobal('flipStore', flips)
  setSharedGlobal('invitesDb', invites)
  setSharedGlobal('contactsDb', contacts)

  setSharedGlobal('logger', logger)

  setSharedGlobal('isDev', isDev)
  setSharedGlobal('isTest', process.env.NODE_ENV === 'e2e')

  setSharedGlobal('prepareDb', prepareDb)
  setSharedGlobal('isMac', process.platform === 'darwin')

  setSharedGlobal('clipboard', clipboard)
  setSharedGlobal('nativeImage', nativeImage)
  const [locale] = String(appInfo.locale || 'en').split('-')
  setSharedGlobal('locale', locale)

  setSharedGlobal('getZoomLevel', () => webFrame.getZoomLevel())
  setSharedGlobal('setZoomLevel', (level) => webFrame.setZoomLevel(level))

  setSharedGlobal('appVersion', appInfo.version || '0.0.0')

  setSharedGlobal('env', {
    NODE_ENV: process.env.NODE_ENV,
    NODE_MOCK: process.env.NODE_MOCK,
    BUMP_EXTRA_FLIPS: process.env.BUMP_EXTRA_FLIPS,
    FINALIZE_FLIPS: process.env.FINALIZE_FLIPS,
    INDEXER_URL: process.env.INDEXER_URL,
  })

  setSharedGlobal('toggleFullScreen', () => {
    ipcRenderer
      .invoke(WINDOW_COMMAND, 'toggleFullScreen')
      .catch((error) =>
        logger.warn('Cannot toggle fullscreen', error && error.message)
      )
  })

  setSharedGlobal('levelup', levelup)
  setSharedGlobal('leveldown', leveldown)
  setSharedGlobal('dbPath', dbPath)
  setSharedGlobal('sub', sub)

  // eslint-disable-next-line global-require
  setSharedGlobal('Buffer', require('buffer').Buffer)

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
