// eslint-disable-next-line import/no-extraneous-dependencies
const electron = require('electron')

const {clipboard, nativeImage, ipcRenderer, shell, webFrame} = electron

const isDev = require('electron-is-dev')

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

process.once('loaded', () => {
  const appInfo = getAppInfo()
  global.ipcRenderer = ipcRenderer
  global.openExternal = shell.openExternal
  global.aiSolver = {
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
  }
  global.aiTestUnit = {
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
  }
  global.localAi = {
    status: (payload) => ipcRenderer.invoke('localAi.status', payload),
    start: (payload) => ipcRenderer.invoke('localAi.start', payload),
    stop: () => ipcRenderer.invoke('localAi.stop'),
    listModels: (payload) => ipcRenderer.invoke('localAi.listModels', payload),
    chat: (payload) => ipcRenderer.invoke('localAi.chat', payload),
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
  }

  global.flipStore = flips
  global.invitesDb = invites
  global.contactsDb = contacts

  global.logger = logger

  global.isDev = isDev
  global.isTest = process.env.NODE_ENV === 'e2e'

  global.prepareDb = prepareDb
  global.isMac = process.platform === 'darwin'

  global.clipboard = clipboard
  global.nativeImage = nativeImage
  ;[global.locale] = String(appInfo.locale || 'en').split('-')

  global.getZoomLevel = () => webFrame.getZoomLevel()
  global.setZoomLevel = (level) => webFrame.setZoomLevel(level)

  global.appVersion = appInfo.version || '0.0.0'

  global.env = {
    NODE_ENV: process.env.NODE_ENV,
    NODE_MOCK: process.env.NODE_MOCK,
    BUMP_EXTRA_FLIPS: process.env.BUMP_EXTRA_FLIPS,
    FINALIZE_FLIPS: process.env.FINALIZE_FLIPS,
    INDEXER_URL: process.env.INDEXER_URL,
  }

  global.toggleFullScreen = () => {
    ipcRenderer
      .invoke(WINDOW_COMMAND, 'toggleFullScreen')
      .catch((error) =>
        logger.warn('Cannot toggle fullscreen', error && error.message)
      )
  }

  global.levelup = levelup
  global.leveldown = leveldown
  global.dbPath = dbPath
  global.sub = sub

  // eslint-disable-next-line global-require
  global.Buffer = require('buffer').Buffer
})
