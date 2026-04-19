const os = require('os')
const path = require('path')
const Module = require('module')
const fs = require('fs-extra')

// Next can bundle API routes, but this bridge needs to load the existing
// desktop-side Node modules directly from disk in dev mode.
const nodeRequire = Module.createRequire(
  path.join(process.cwd(), 'renderer/server/local-ai-dev-bridge.js')
)

const GLOBAL_MANAGER_KEY = '__idenaBrowserDevLocalAiManager'
const DEV_LOCAL_AI_BRIDGE_HEADER = 'x-idena-local-ai-dev-bridge'
const DEV_LOCAL_AI_BRIDGE_HEADER_VALUE = '1'
const DEV_LOCAL_AI_MANAGED_WORKSPACE_LABEL = 'managed local workspace'
const DEV_LOCAL_AI_RESULT_PATH_KEYS = new Set([
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
])

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
const DEV_LOCAL_AI_ENABLED_METHODS = new Set([
  'start',
  'stop',
  'listModels',
  'chat',
  'checkFlipSequence',
  'flipToText',
  'captionFlip',
  'ocrImage',
  'loadAdapterArtifact',
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
  'updateHumanTeacherPackageReview',
  'exportHumanTeacherTasks',
  'saveHumanTeacherAnnotationDraft',
  'saveHumanTeacherDemoDraft',
  'saveHumanTeacherDeveloperDraft',
  'finalizeHumanTeacherDemoChunk',
  'finalizeHumanTeacherDeveloperChunk',
  'importHumanTeacherAnnotations',
])
const DEV_LOCAL_AI_TRAINING_METHODS = new Set([
  'trainEpoch',
  'importAdapterArtifact',
  'registerAdapterArtifact',
  'buildManifest',
  'buildTrainingCandidatePackage',
  'runHumanTeacherDeveloperComparison',
  'updateTrainingCandidatePackageReview',
])
const DEV_LOCAL_AI_CAPTURE_METHODS = new Set(['captureFlip'])

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

function settingsPath() {
  return path.join(resolveDesktopUserDataDir(), 'settings.json')
}

function loadDesktopSettings() {
  try {
    return fs.readJsonSync(settingsPath())
  } catch {
    return {}
  }
}

function getLocalAiFeatureFlags() {
  try {
    const localAi = loadDesktopSettings().localAi || {}
    const localAiEnabled = localAi.enabled === true

    return {
      enabled: localAiEnabled,
      captureEnabled: localAi.captureEnabled === true,
      trainEnabled: localAiEnabled,
    }
  } catch {
    return {
      enabled: false,
      captureEnabled: false,
      trainEnabled: false,
    }
  }
}

function assertDevBridgeMethodAllowed(method) {
  const flags = getLocalAiFeatureFlags()

  if (DEV_LOCAL_AI_ENABLED_METHODS.has(method) && !flags.enabled) {
    throw new Error('Local AI is disabled')
  }

  if (DEV_LOCAL_AI_CAPTURE_METHODS.has(method) && !flags.captureEnabled) {
    throw new Error('Local AI capture is disabled')
  }

  if (DEV_LOCAL_AI_TRAINING_METHODS.has(method) && !flags.trainEnabled) {
    throw new Error('Local AI training is disabled')
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

function isTrustedDevBridgeRequest(req) {
  if (!isDevBrowserRequest(req)) {
    return false
  }

  const devBridgeHeader = String(
    req?.headers?.[DEV_LOCAL_AI_BRIDGE_HEADER] || ''
  ).trim()

  if (devBridgeHeader !== DEV_LOCAL_AI_BRIDGE_HEADER_VALUE) {
    return false
  }

  const host = String(req?.headers?.host || '')
    .trim()
    .toLowerCase()
  const origin = String(req?.headers?.origin || '')
    .trim()
    .toLowerCase()
  const referer = String(req?.headers?.referer || '')
    .trim()
    .toLowerCase()

  const matchesHost = (value) => {
    if (!value) {
      return false
    }

    try {
      return new URL(value).host.toLowerCase() === host
    } catch {
      return false
    }
  }

  return matchesHost(origin) || matchesHost(referer)
}

function normalizeDangerousObjectKey(key) {
  const nextKey = String(key || '')
  return ['__proto__', 'constructor', 'prototype'].includes(nextKey)
    ? `safe_${nextKey}`
    : nextKey
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

function sanitizeBridgeValue(value, depth = 0, parentKey = '') {
  if (depth > 6) {
    return null
  }

  if (
    value === null ||
    typeof value === 'undefined' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'string') {
    if (DEV_LOCAL_AI_RESULT_PATH_KEYS.has(parentKey)) {
      return sanitizePathDisplayName(
        value,
        parentKey === 'outputDir'
          ? DEV_LOCAL_AI_MANAGED_WORKSPACE_LABEL
          : undefined
      )
    }

    return value
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 400)
      .map((item) => sanitizeBridgeValue(item, depth + 1, parentKey))
  }

  if (typeof value === 'object') {
    return Object.entries(value).reduce((next, [key, nestedValue]) => {
      const safeKey = normalizeDangerousObjectKey(key)
      next[safeKey] = sanitizeBridgeValue(nestedValue, depth + 1, safeKey)
      return next
    }, Object.create(null))
  }

  return null
}

module.exports = {
  DEV_LOCAL_AI_ALLOWED_METHODS,
  DEV_LOCAL_AI_BRIDGE_HEADER,
  DEV_LOCAL_AI_BRIDGE_HEADER_VALUE,
  assertDevBridgeMethodAllowed,
  getDevLocalAiManager,
  isDevBrowserRequest,
  isTrustedDevBridgeRequest,
  sanitizeBridgeValue,
}
