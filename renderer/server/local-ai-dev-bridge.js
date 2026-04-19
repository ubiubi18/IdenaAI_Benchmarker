const os = require('os')
const path = require('path')
const Module = require('module')

// Next can bundle API routes, but this bridge needs to load the existing
// desktop-side Node modules directly from disk in dev mode.
const nodeRequire = Module.createRequire(
  path.join(process.cwd(), 'renderer/server/local-ai-dev-bridge.js')
)

const GLOBAL_MANAGER_KEY = '__idenaBrowserDevLocalAiManager'

const DEV_LOCAL_AI_ALLOWED_METHODS = new Set([
  'status',
  'getDeveloperTelemetry',
  'start',
  'stop',
  'listModels',
  'chat',
  'checkFlipSequence',
  'flipToText',
  'captionFlip',
  'ocrImage',
  'trainEpoch',
  'captureFlip',
  'importAdapterArtifact',
  'registerAdapterArtifact',
  'loadAdapterArtifact',
  'buildManifest',
  'buildTrainingCandidatePackage',
  'buildHumanTeacherPackage',
  'loadTrainingCandidatePackage',
  'loadHumanTeacherPackage',
  'loadHumanTeacherAnnotationWorkspace',
  'loadHumanTeacherAnnotationTask',
  'loadHumanTeacherDemoWorkspace',
  'loadHumanTeacherDemoTask',
  'loadHumanTeacherDeveloperSession',
  'loadHumanTeacherDeveloperSessionState',
  'stopHumanTeacherDeveloperRun',
  'updateHumanTeacherDeveloperRunControls',
  'loadHumanTeacherDeveloperComparisonExamples',
  'loadHumanTeacherDeveloperTask',
  'exportHumanTeacherDeveloperBundle',
  'updateTrainingCandidatePackageReview',
  'updateHumanTeacherPackageReview',
  'exportHumanTeacherTasks',
  'saveHumanTeacherAnnotationDraft',
  'saveHumanTeacherDemoDraft',
  'saveHumanTeacherDeveloperDraft',
  'finalizeHumanTeacherDemoChunk',
  'finalizeHumanTeacherDeveloperChunk',
  'runHumanTeacherDeveloperComparison',
  'importHumanTeacherAnnotations',
])

function resolveDesktopUserDataDir() {
  const {
    productName: PRODUCT_NAME = 'IdenaAI',
    name: PACKAGE_NAME = 'idena-ai',
  } = nodeRequire(path.join(process.cwd(), 'package.json'))
  const explicitBaseDir = String(
    process.env.IDENA_DESKTOP_LOCAL_AI_DEV_BASE_DIR || ''
  ).trim()

  if (explicitBaseDir) {
    return explicitBaseDir
  }

  const appFolder = String(PRODUCT_NAME || PACKAGE_NAME || 'IdenaAI').trim()
  const homeDir = os.homedir()

  switch (process.platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', appFolder)
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
        appFolder
      )
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'),
        appFolder
      )
  }
}

function createDevLogger() {
  return {
    info(message, meta = {}) {
      // eslint-disable-next-line no-console
      console.info('[local-ai-dev-bridge]', message, meta)
    },
    warn(message, meta = {}) {
      // eslint-disable-next-line no-console
      console.warn('[local-ai-dev-bridge]', message, meta)
    },
    error(message, meta = {}) {
      // eslint-disable-next-line no-console
      console.error('[local-ai-dev-bridge]', message, meta)
    },
    debug(message, meta = {}) {
      if (process.env.DEBUG || process.env.IDENA_LOCAL_AI_DEV_DEBUG === '1') {
        // eslint-disable-next-line no-console
        console.debug('[local-ai-dev-bridge]', message, meta)
      }
    },
  }
}

function getDevLocalAiManager() {
  if (!global[GLOBAL_MANAGER_KEY]) {
    const {createLocalAiManager} = nodeRequire(
      path.join(process.cwd(), 'main/local-ai/manager')
    )
    const {createLocalAiStorage} = nodeRequire(
      path.join(process.cwd(), 'main/local-ai/storage')
    )
    const baseDir = path.join(resolveDesktopUserDataDir(), 'local-ai')
    const storage = createLocalAiStorage({baseDir})
    global[GLOBAL_MANAGER_KEY] = createLocalAiManager({
      logger: createDevLogger(),
      isDev: true,
      storage,
    })
  }

  return global[GLOBAL_MANAGER_KEY]
}

function isDevBrowserRequest(req) {
  const host = String(req?.headers?.host || '')
    .trim()
    .toLowerCase()
  return (
    process.env.NODE_ENV !== 'production' &&
    (host.startsWith('127.0.0.1:') || host.startsWith('localhost:'))
  )
}

function normalizeDangerousObjectKey(key) {
  const nextKey = String(key || '')
  return ['__proto__', 'constructor', 'prototype'].includes(nextKey)
    ? `safe_${nextKey}`
    : nextKey
}

function sanitizeBridgeValue(value, depth = 0) {
  if (depth > 6) {
    return null
  }

  if (
    value === null ||
    typeof value === 'undefined' ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 400)
      .map((item) => sanitizeBridgeValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    return Object.entries(value).reduce((next, [key, nestedValue]) => {
      next[normalizeDangerousObjectKey(key)] = sanitizeBridgeValue(
        nestedValue,
        depth + 1
      )
      return next
    }, {})
  }

  return null
}

module.exports = {
  DEV_LOCAL_AI_ALLOWED_METHODS,
  getDevLocalAiManager,
  isDevBrowserRequest,
  sanitizeBridgeValue,
}
