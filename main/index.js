const {join, resolve} = require('path')
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
const isDev = require('electron-is-dev')
const prepareNext = require('electron-next')
const fs = require('fs-extra')
const i18next = require('i18next')
const {image_search: imageSearch} = require('duckduckgo-images-api')
const macosVersion = require('macos-version')
const semver = require('semver')
const axios = require('axios')
const {zoomIn, zoomOut, resetZoom} = require('./utils')
const loadRoute = require('./utils/routes')
const {getI18nConfig} = require('./language')
const appDataPath = require('./app-data-path')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

app.allowRendererProcessReuse = true

if (process.env.NODE_ENV === 'e2e') {
  app.setPath('userData', join(app.getPath('userData'), 'tests'))
  fs.removeSync(app.getPath('userData'))
}

if (isWin) {
  app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
}

const appVersion = global.appVersion || app.getVersion()

const logger = require('./logger')

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
const {createAiProviderBridge} = require('./ai-providers')
const {createAiTestUnitBridge} = require('./ai-test-unit')
const {prepareDb} = require('./stores/setup')
const {createLocalAiFederated} = require('./local-ai/federated')
const {createLocalAiManager} = require('./local-ai/manager')
const {
  ensureLocalAiEnabled,
  isLocalAiEnabled,
} = require('./local-ai/enablement')
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

const NodeUpdater = require('./node-updater')

const aiProviderBridge = createAiProviderBridge(logger)
const aiTestUnitBridge = createAiTestUnitBridge({
  logger,
  aiProviderBridge,
})
const localAiManager = createLocalAiManager({
  logger,
  isDev,
})
const localAiFederated = createLocalAiFederated({
  logger,
  isDev,
})

const IMAGE_SEARCH_SOURCE_TIMEOUT_MS = 8000

let mainWindow
let node
let nodeDownloadPromise = null
let tray

const nodeUpdater = new NodeUpdater(logger)

let dnaUrl

function loadMainSettings() {
  try {
    return prepareDb('settings').getState() || {}
  } catch {
    return {}
  }
}

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

function normalizeLocalAiPayload(payload = {}) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : {}
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

function getMainLocalAiSettings(payload = {}) {
  const settings = loadMainSettings()
  const nextPayload = normalizeLocalAiPayload(payload)
  const localAi =
    settings && settings.localAi && typeof settings.localAi === 'object'
      ? settings.localAi
      : {}

  return {
    enabled: localAi.enabled === true,
    mode: pickTrimmedString([localAi.runtimeMode, nextPayload.mode], 'sidecar'),
    runtimeType: pickTrimmedString(
      [localAi.runtimeType, nextPayload.runtimeType],
      'ollama'
    ),
    baseUrl: pickTrimmedString(
      [
        localAi.endpoint,
        localAi.baseUrl,
        nextPayload.endpoint,
        nextPayload.baseUrl,
      ],
      'http://127.0.0.1:11434'
    ),
    model: pickTrimmedString([localAi.model, nextPayload.model], ''),
    visionModel: pickTrimmedString(
      [localAi.visionModel, nextPayload.visionModel],
      'moondream'
    ),
  }
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

function withLocalAiEnabled(action, handler) {
  return async (...args) => {
    assertLocalAiEnabled(action)
    return handler(...args)
  }
}

function buildDisabledLocalAiStatus(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    enabled: false,
    status: 'disabled',
    runtime: localAi.runtimeType,
    runtimeType: localAi.runtimeType,
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
          result.runtimeType ||
          'ollama'
      ).trim() || 'ollama',
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
    runtimeType: localAi.runtimeType,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    model: localAi.model,
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
    runtimeType: localAi.runtimeType,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    visionModel: localAi.visionModel,
    text: null,
    error: 'local_ai_disabled',
    lastError: 'Local AI is disabled',
  }
}

function buildDisabledLocalAiCheckFlipSequenceResponse(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)

  return {
    ok: false,
    enabled: false,
    status: 'disabled',
    provider: 'local-ai',
    runtimeType: localAi.runtimeType,
    mode: localAi.mode,
    baseUrl: localAi.baseUrl,
    model: localAi.model,
    visionModel: localAi.visionModel,
    classification: null,
    confidence: null,
    reason: null,
    sequenceText: null,
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
    runtimeType: localAi.runtimeType,
    baseUrl: localAi.baseUrl,
    endpoint: localAi.baseUrl,
    model: localAi.model,
  }
}

function buildLocalAiFlipToTextPayload(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)
  const nextPayload = normalizeLocalAiPayload(payload)

  return {
    ...nextPayload,
    mode: localAi.mode,
    runtimeType: localAi.runtimeType,
    baseUrl: localAi.baseUrl,
    endpoint: localAi.baseUrl,
    model: localAi.model,
    visionModel: localAi.visionModel,
    input: pickLocalAiInput(nextPayload),
  }
}

function buildLocalAiCheckFlipSequencePayload(payload = {}) {
  const localAi = getMainLocalAiSettings(payload)
  const nextPayload = normalizeLocalAiPayload(payload)

  return {
    ...nextPayload,
    mode: localAi.mode,
    runtimeType: localAi.runtimeType,
    baseUrl: localAi.baseUrl,
    endpoint: localAi.baseUrl,
    model: localAi.model,
    visionModel: localAi.visionModel,
    input: pickLocalAiInput(nextPayload),
  }
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
      preload: join(__dirname, 'preload.js'),
    },
    icon: resolve(__dirname, 'static', 'icon-128@2x.png'),
    show: false,
  })

  loadRoute(mainWindow, 'home')

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
    label: 'idena-desktop',
    submenu: [
      {
        label: i18next.t('About idena-desktop'),
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
    tray.setImage(resolve(__dirname, 'static', 'tray', trayIcon()))
  })
}

const createTray = () => {
  tray = new Tray(resolve(__dirname, 'static', 'tray', trayIcon()))

  if (isWin) {
    tray.on('click', showMainWindow)
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: i18next.t('Open idena-desktop'),
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

// Prepare the renderer once the app is ready
app.on('ready', async () => {
  await prepareNext('./renderer')
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

app.on('before-quit', (e) => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }

  if (didConfirmQuit || isDev) {
    mainWindow.forceClose = true
  } else {
    e.preventDefault()
    sendMainWindowMsg('confirm-quit')
  }
})

ipcMain.on('confirm-quit', () => {
  didConfirmQuit = true
  app.quit()
})

app.on('activate', showMainWindow)

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

ipcMain.handleOnce('CHECK_DNA_LINK', () => dnaUrl)

ipcMain.on(NODE_COMMAND, async (_event, command, data) => {
  logger.info(`new node command`, command, data)
  switch (command) {
    case 'init-local-node': {
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
      startNode(
        data.rpcPort,
        data.tcpPort,
        data.ipfsPort,
        data.apiKey,
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

ipcMain.on(AUTO_UPDATE_COMMAND, async (event, command, data) => {
  logger.info(`new autoupdate command`, command, data)
  switch (command) {
    case 'start-checking': {
      nodeUpdater.checkForUpdates(data.nodeCurrentVersion, data.isInternalNode)
      break
    }
    case 'update-ui': {
      if (isWin) {
        didConfirmQuit = true
        autoUpdater.quitAndInstall()
      } else {
        shell.openExternal('https://www.idena.io/download')
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

const RELEASE_URL =
  'https://api.github.com/repos/idena-network/idena-desktop/releases/latest'

function checkForUpdates() {
  if (isDev) {
    return
  }

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
ipcMain.on('node-log', ({sender}, message) => {
  sender.send('node-log', message)
})

ipcMain.on('reload', () => {
  loadRoute(mainWindow, 'home')
})

ipcMain.on('showMainWindow', () => {
  showMainWindow()
})

ipcMain.on(APP_INFO_COMMAND, (event) => {
  event.returnValue = {
    locale: app.getLocale(),
    version: app.getVersion(),
  }
})

ipcMain.on(APP_PATH_COMMAND, (event, folder) => {
  event.returnValue = appDataPath(folder)
})

ipcMain.handle(WINDOW_COMMAND, (event, command) => {
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

ipcMain.handle('search-image', async (_, query) => searchImages(query))

ipcMain.handle(AI_SOLVER_COMMAND, async (_event, command, payload) => {
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

ipcMain.handle(AI_TEST_UNIT_COMMAND, async (event, command, payload) => {
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

ipcMain.handle('localAi.status', async (_event, payload) => {
  if (!isLocalAiEnabled(loadMainSettings())) {
    return buildDisabledLocalAiStatus(payload)
  }

  return buildLocalAiStatusResponse(await localAiManager.status(payload))
})

ipcMain.handle(
  'localAi.start',
  withLocalAiEnabled('start', async (_event, payload) =>
    localAiManager.start(payload)
  )
)

ipcMain.handle(
  'localAi.stop',
  withLocalAiEnabled('stop', async () => localAiManager.stop())
)

ipcMain.handle(
  'localAi.listModels',
  withLocalAiEnabled('listModels', async (_event, payload) =>
    localAiManager.listModels(payload)
  )
)

ipcMain.handle('localAi.chat', async (_event, payload) => {
  if (!isLocalAiEnabled(loadMainSettings())) {
    return buildDisabledLocalAiChatResponse(payload)
  }

  return {
    ...(await localAiManager.chat(buildLocalAiChatPayload(payload))),
    enabled: true,
  }
})

ipcMain.handle('localAi.checkFlipSequence', async (_event, payload) => {
  if (!isLocalAiEnabled(loadMainSettings())) {
    return buildDisabledLocalAiCheckFlipSequenceResponse(payload)
  }

  return {
    ...(await localAiManager.checkFlipSequence(
      buildLocalAiCheckFlipSequencePayload(payload)
    )),
    enabled: true,
  }
})

ipcMain.handle('localAi.flipToText', async (_event, payload) => {
  if (!isLocalAiEnabled(loadMainSettings())) {
    return buildDisabledLocalAiFlipToTextResponse(payload)
  }

  return {
    ...(await localAiManager.flipToText(
      buildLocalAiFlipToTextPayload(payload)
    )),
    enabled: true,
  }
})

ipcMain.handle(
  'localAi.captionFlip',
  withLocalAiEnabled('captionFlip', async (_event, payload) =>
    localAiManager.captionFlip(payload)
  )
)

ipcMain.handle(
  'localAi.ocrImage',
  withLocalAiEnabled('ocrImage', async (_event, payload) =>
    localAiManager.ocrImage(payload)
  )
)

ipcMain.handle(
  'localAi.trainEpoch',
  withLocalAiEnabled('trainEpoch', async (_event, payload) =>
    localAiManager.trainEpoch(payload)
  )
)

ipcMain.handle(
  'localAi.buildManifest',
  withLocalAiEnabled('buildManifest', async (_event, epoch) =>
    localAiManager.buildManifest(epoch)
  )
)

ipcMain.handle(
  'localAi.loadTrainingCandidatePackage',
  withLocalAiEnabled('loadTrainingCandidatePackage', async (_event, payload) =>
    localAiManager.loadTrainingCandidatePackage(payload)
  )
)

ipcMain.handle(
  'localAi.buildTrainingCandidatePackage',
  withLocalAiEnabled('buildTrainingCandidatePackage', async (_event, payload) =>
    localAiManager.buildTrainingCandidatePackage(payload)
  )
)

ipcMain.handle(
  'localAi.updateTrainingCandidatePackageReview',
  withLocalAiEnabled(
    'updateTrainingCandidatePackageReview',
    async (_event, payload) =>
      localAiManager.updateTrainingCandidatePackageReview(payload)
  )
)

ipcMain.handle(
  'localAi.buildBundle',
  withLocalAiEnabled('buildBundle', async (_event, epoch) =>
    localAiFederated.buildUpdateBundle(epoch)
  )
)

ipcMain.handle(
  'localAi.importBundle',
  withLocalAiEnabled('importBundle', async (_event, filePath) =>
    localAiFederated.importUpdateBundle(filePath)
  )
)

ipcMain.handle(
  'localAi.aggregate',
  withLocalAiEnabled('aggregate', async () =>
    localAiFederated.aggregateAcceptedBundles()
  )
)

ipcMain.on('localAi.captureFlip', (_event, payload) => {
  try {
    assertLocalAiEnabled('captureFlip')
  } catch {
    return
  }

  Promise.resolve(localAiManager.captureFlip(payload)).catch((error) => {
    logger.error('Local AI capture failed', {
      error: error.toString(),
    })
  })
})

const KEY_VALUE = {}

ipcMain.handle('get-data', async (_, key) => KEY_VALUE[key])
ipcMain.on('set-data', (_, key, value) => (KEY_VALUE[key] = value))
