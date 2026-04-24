const crypto = require('crypto')
const {spawn, spawnSync} = require('child_process')
const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  LOCAL_AI_SIDECAR_RUNTIME_BACKEND,
  validateLocalAiBaseUrl,
} = require('./runtime-adapter')
const managedInternVl351BManifest = require('./managed-internvl3.5-1b-manifest.json')
const managedMolmo2OManifest = require('./managed-molmo2-manifest.json')
const managedMolmo24BManifest = require('./managed-molmo2-4b-manifest.json')
const managedInternVl358BManifest = require('./managed-internvl3.5-8b-manifest.json')

function normalizeManagedManifestVerifyFiles(verifyFiles) {
  return verifyFiles &&
    typeof verifyFiles === 'object' &&
    !Array.isArray(verifyFiles)
    ? verifyFiles
    : {}
}

function buildManagedRuntimeConfig({
  runtimeFamily,
  runtimeRootName,
  displayName,
  manifest = {},
  defaultModel,
  defaultRevision,
  supportsMlx = false,
  preferredFlavor = '',
  transformersRequirements = [],
}) {
  return {
    runtimeFamily,
    runtimeRootName,
    displayName,
    modelId: trimString(manifest.modelId) || defaultModel,
    revision: trimString(manifest.revision) || defaultRevision,
    trustVersion: Number.parseInt(manifest.trustVersion, 10) || 1,
    allowPatterns: Array.isArray(manifest.allowPatterns)
      ? manifest.allowPatterns.filter(Boolean)
      : [],
    weightFiles: Array.isArray(manifest.weightFiles)
      ? manifest.weightFiles.filter(Boolean)
      : [],
    verifyFiles: normalizeManagedManifestVerifyFiles(manifest.verifyFiles),
    supportsMlx: supportsMlx === true,
    preferredFlavor: trimString(preferredFlavor).toLowerCase(),
    transformersRequirements: Array.isArray(transformersRequirements)
      ? transformersRequirements
      : [],
  }
}

const DEFAULT_MANAGED_LOCAL_RUNTIME_FAMILY = 'molmo2-o'
const MANAGED_MLX_VLM_REQUIREMENTS = [
  {name: 'mlx-vlm', version: '0.4.4'},
  {name: 'pillow', version: '12.2.0'},
]
const MANAGED_MOLMO2_TRANSFORMERS_REQUIREMENTS = [
  {name: 'transformers', version: '4.57.1'},
  {name: 'torch', version: '2.11.0'},
  {name: 'torchvision', version: '0.26.0'},
  {name: 'accelerate', version: '1.13.0'},
  {name: 'pillow', version: '12.2.0'},
  {name: 'einops', version: '0.8.2'},
  {name: 'molmo_utils', version: '0.0.1'},
  {name: 'decord2', version: '3.3.0'},
]
const MANAGED_GENERIC_TRANSFORMERS_REQUIREMENTS = [
  {name: 'transformers', version: '4.57.1'},
  {name: 'torch', version: '2.11.0'},
  {name: 'torchvision', version: '0.26.0'},
  {name: 'accelerate', version: '1.13.0'},
  {name: 'pillow', version: '12.2.0'},
  {name: 'einops', version: '0.8.2'},
]
const MANAGED_INTERNVL_TRANSFORMERS_REQUIREMENTS =
  MANAGED_GENERIC_TRANSFORMERS_REQUIREMENTS.concat({
    name: 'timm',
    version: '0.9.12',
  })
const MANAGED_LOCAL_RUNTIMES = {
  'molmo2-o': buildManagedRuntimeConfig({
    runtimeFamily: 'molmo2-o',
    runtimeRootName: 'molmo2-o',
    displayName: 'Molmo2-O',
    manifest: managedMolmo2OManifest,
    defaultModel: 'allenai/Molmo2-O-7B',
    defaultRevision: '784410650d12be9bc086118fdefa32d2c3bced86',
    supportsMlx: true,
    transformersRequirements: MANAGED_MOLMO2_TRANSFORMERS_REQUIREMENTS,
  }),
  'molmo2-4b': buildManagedRuntimeConfig({
    runtimeFamily: 'molmo2-4b',
    runtimeRootName: 'molmo2-4b',
    displayName: 'Molmo2-4B',
    manifest: managedMolmo24BManifest,
    defaultModel: 'allenai/Molmo2-4B',
    defaultRevision: '042abfa7a38879a376cec03d949eff0aefaa0600',
    supportsMlx: true,
    transformersRequirements: MANAGED_MOLMO2_TRANSFORMERS_REQUIREMENTS,
  }),
  'internvl3.5-1b': buildManagedRuntimeConfig({
    runtimeFamily: 'internvl3.5-1b',
    runtimeRootName: 'internvl3.5-1b',
    displayName: 'InternVL3.5-1B',
    manifest: managedInternVl351BManifest,
    defaultModel: 'OpenGVLab/InternVL3_5-1B-HF',
    defaultRevision: '9191dbccf312b537016f041b25d61c72e7c5c9f3',
    preferredFlavor: 'transformers',
    transformersRequirements: MANAGED_INTERNVL_TRANSFORMERS_REQUIREMENTS,
  }),
  'internvl3.5-8b': buildManagedRuntimeConfig({
    runtimeFamily: 'internvl3.5-8b',
    runtimeRootName: 'internvl3.5-8b',
    displayName: 'InternVL3.5-8B',
    manifest: managedInternVl358BManifest,
    defaultModel: 'OpenGVLab/InternVL3_5-8B-HF',
    defaultRevision: '741a7d03020411e666c6109218ab71e08151ef86',
    preferredFlavor: 'transformers',
    transformersRequirements: MANAGED_INTERNVL_TRANSFORMERS_REQUIREMENTS,
  }),
}
const DEFAULT_MANAGED_MOLMO2_RUNTIME_FAMILY =
  DEFAULT_MANAGED_LOCAL_RUNTIME_FAMILY
const MANAGED_MOLMO2_RUNTIME_FAMILY = DEFAULT_MANAGED_MOLMO2_RUNTIME_FAMILY
const MANAGED_LOCAL_RUNTIME_TRUST_VERSION = Object.values(
  MANAGED_LOCAL_RUNTIMES
).reduce(
  (maxVersion, runtimeConfig) =>
    Math.max(maxVersion, Number.parseInt(runtimeConfig.trustVersion, 10) || 0),
  1
)
const MANAGED_MOLMO2_PROGRESS_STAGE_COUNT = 7
const MANAGED_MOLMO2_RUNTIME_START_TIMEOUT_MS = 20 * 60 * 1000
const MANAGED_RUNTIME_INSTALL_TIMEOUT_MS = 45 * 60 * 1000
const MANAGED_RUNTIME_AUTH_ENV = 'IDENAAI_LOCAL_RUNTIME_TOKEN'
const BYTES_PER_GIB = 1024 * 1024 * 1024
const MANAGED_RUNTIME_TRANSFORMERS_INSTALL_OVERHEAD_BYTES = 3 * BYTES_PER_GIB
const MANAGED_RUNTIME_MLX_INSTALL_OVERHEAD_BYTES = 2 * BYTES_PER_GIB
const MANAGED_RUNTIME_INSTALL_HEADROOM_MIN_BYTES = 1 * BYTES_PER_GIB
const MANAGED_RUNTIME_INSTALL_HEADROOM_RATIO = 0.1
const OLLAMA_COMMAND_CANDIDATES = [
  '/opt/homebrew/bin/ollama',
  '/usr/local/bin/ollama',
  'ollama',
]
const DEFAULT_PYTHON_COMMAND_CANDIDATES = [
  process.platform === 'win32' ? 'py -3.11' : 'python3.11',
  process.platform === 'win32' ? 'py -3' : 'python3',
  process.platform === 'win32' ? 'python' : 'python',
]
const PYTHON_EXECUTABLE_PATTERN = /^(?:python(?:3(?:\.\d+)?)?|py)(?:\.exe)?$/iu
const OLLAMA_EXECUTABLE_PATTERN = /^ollama(?:\.exe)?$/iu
const MANAGED_RUNTIME_SNAPSHOT_DOWNLOAD_MAX_RETRIES = 4
const MANAGED_RUNTIME_SNAPSHOT_DOWNLOAD_RETRY_DELAY_MS = 2000

function trimString(value) {
  return String(value || '').trim()
}

function resolveManagedRuntimeConfig(runtimeFamily = '') {
  const key = trimString(runtimeFamily).toLowerCase()
  return key ? MANAGED_LOCAL_RUNTIMES[key] || null : null
}

function resolveManagedMolmo2RuntimeConfig(runtimeFamily = '') {
  return resolveManagedRuntimeConfig(runtimeFamily)
}

function formatApproxGiB(bytes) {
  const value = Number(bytes)

  if (!Number.isFinite(value) || value <= 0) {
    return '0 GB'
  }

  return `~${(value / BYTES_PER_GIB).toFixed(
    value >= 10 * BYTES_PER_GIB ? 0 : 1
  )} GB`
}

async function calculateDirectorySizeBytes(targetPath) {
  const normalizedPath = trimString(targetPath)

  if (!normalizedPath) {
    return 0
  }

  let stats

  try {
    stats = await fs.stat(normalizedPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 0
    }

    throw error
  }

  if (!stats.isDirectory()) {
    return stats.size
  }

  const entries = await fs.readdir(normalizedPath)
  let total = 0

  for (const entry of entries) {
    total += await calculateDirectorySizeBytes(path.join(normalizedPath, entry))
  }

  return total
}

function sumManagedRuntimeVerifyBytes(runtimeConfig = null) {
  const verifyFiles =
    runtimeConfig && typeof runtimeConfig.verifyFiles === 'object'
      ? runtimeConfig.verifyFiles
      : {}

  return Object.values(verifyFiles).reduce((total, entry) => {
    const size = Number.parseInt(entry && entry.size, 10)
    return Number.isFinite(size) && size > 0 ? total + size : total
  }, 0)
}

function estimateManagedRuntimePackageInstallBytes(flavor = '') {
  return flavor === 'mlx-vlm'
    ? MANAGED_RUNTIME_MLX_INSTALL_OVERHEAD_BYTES
    : MANAGED_RUNTIME_TRANSFORMERS_INSTALL_OVERHEAD_BYTES
}

function estimateManagedRuntimeSnapshotInstallBytes(runtimeConfig = null) {
  const snapshotBytes = sumManagedRuntimeVerifyBytes(runtimeConfig)

  if (!(snapshotBytes > 0)) {
    return 0
  }

  return (
    snapshotBytes +
    Math.max(
      MANAGED_RUNTIME_INSTALL_HEADROOM_MIN_BYTES,
      Math.ceil(snapshotBytes * MANAGED_RUNTIME_INSTALL_HEADROOM_RATIO)
    )
  )
}

function estimateManagedRuntimeInstallBytes(runtimeConfig = null, flavor = '') {
  return (
    estimateManagedRuntimePackageInstallBytes(flavor) +
    estimateManagedRuntimeSnapshotInstallBytes(runtimeConfig)
  )
}

function normalizeManagedRuntimeTrustVersion(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function hasManagedRuntimeTrustApproval(payload = {}) {
  return (
    normalizeManagedRuntimeTrustVersion(payload.managedRuntimeTrustVersion) >=
    MANAGED_LOCAL_RUNTIME_TRUST_VERSION
  )
}

function createRuntimeControllerError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isRetryableManagedSnapshotDownloadError(error) {
  const message = String((error && error.message) || error || '').toLowerCase()

  return Boolean(
    message &&
      (message.includes('remoteprotocolerror') ||
        message.includes('peer closed connection') ||
        message.includes('connection reset') ||
        message.includes('incomplete message body') ||
        message.includes('read timed out') ||
        message.includes('timed out') ||
        message.includes('temporarily unavailable') ||
        message.includes('connection aborted') ||
        message.includes('connection broken'))
  )
}

function sleep(ms) {
  const timeoutMs = Number.parseInt(ms, 10)
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0

  return new Promise((resolve) => {
    setTimeout(resolve, effectiveTimeoutMs)
  })
}

function normalizeBaseUrl(value, fallback = 'http://localhost:5000') {
  const baseUrl = trimString(value || fallback)
  return baseUrl || fallback
}

function resolveOllamaCommand(explicitOverride = '') {
  const explicit = normalizeExecutableOverride(
    explicitOverride || process.env.OLLAMA_PATH,
    {
      executablePattern: OLLAMA_EXECUTABLE_PATTERN,
      errorCode: 'invalid_ollama_command_path',
      label: 'Ollama',
    }
  )

  if (explicit) {
    return explicit
  }

  return (
    OLLAMA_COMMAND_CANDIDATES.find(
      (candidate) => candidate === 'ollama' || fs.existsSync(candidate)
    ) || 'ollama'
  )
}

function normalizeExecutableOverride(
  value,
  {executablePattern, errorCode, label}
) {
  const command = trimString(value)

  if (!command) {
    return ''
  }

  if (/[\0\r\n]/u.test(command)) {
    throw createRuntimeControllerError(
      errorCode,
      `${label} executable path must be a single command path.`
    )
  }

  const hasPathSeparator =
    command.includes('/') ||
    command.includes('\\') ||
    command.includes(path.sep)

  if (hasPathSeparator && !path.isAbsolute(command)) {
    throw createRuntimeControllerError(
      errorCode,
      `${label} executable path must be absolute, or use the command name from PATH.`
    )
  }

  if (!executablePattern.test(path.basename(command))) {
    throw createRuntimeControllerError(
      errorCode,
      `${label} executable path must point to an allowed ${label} binary.`
    )
  }

  return command
}

function resolveOllamaHostEnv(baseUrl) {
  const nextBaseUrl = normalizeBaseUrl(baseUrl, '')

  if (!nextBaseUrl) {
    return null
  }

  try {
    const parsed = new URL(nextBaseUrl)
    return parsed.host || null
  } catch {
    return null
  }
}

function managedRuntimeKindFromPayload(payload = {}) {
  const runtimeBackend = trimString(payload.runtimeBackend).toLowerCase()
  const runtimeFamily = trimString(payload.runtimeFamily).toLowerCase()

  if (runtimeBackend === LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
    return 'ollama'
  }

  if (
    runtimeBackend === LOCAL_AI_SIDECAR_RUNTIME_BACKEND &&
    resolveManagedRuntimeConfig(runtimeFamily)
  ) {
    return runtimeFamily
  }

  return null
}

function isManagedLocalHttpRuntime(payload = {}) {
  const managedKind = managedRuntimeKindFromPayload(payload)
  return Boolean(managedKind && managedKind !== 'ollama')
}

function resolveManagedLocalRuntimeFlavor(runtimeConfig = null) {
  const config =
    runtimeConfig && typeof runtimeConfig === 'object'
      ? runtimeConfig
      : resolveManagedRuntimeConfig(DEFAULT_MANAGED_LOCAL_RUNTIME_FAMILY)
  const preferredFlavor = trimString(
    config && config.preferredFlavor
  ).toLowerCase()

  if (preferredFlavor === 'mlx-vlm' || preferredFlavor === 'transformers') {
    return preferredFlavor
  }

  if (!(config && config.supportsMlx === true)) {
    return 'transformers'
  }

  if (process.platform !== 'darwin') {
    return 'transformers'
  }

  if (process.arch === 'arm64') {
    return 'mlx-vlm'
  }

  const cpuModel = String(
    (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || ''
  )

  return /apple/i.test(cpuModel) ? 'mlx-vlm' : 'transformers'
}

function resolveManagedMolmo2RuntimeFlavor(runtimeConfig = null) {
  return resolveManagedLocalRuntimeFlavor(runtimeConfig)
}

function buildPythonVariants(
  configured,
  preferArm64 = false,
  {allowArgs = false} = {}
) {
  const text = trimString(configured)
  const parts = allowArgs ? text.split(/\s+/u).filter(Boolean) : [text]

  if (!text || parts.length === 0) {
    return []
  }

  const direct = {
    command: parts[0],
    prefixArgs: parts.slice(1),
    configured: trimString(configured),
  }
  const variants = [direct]

  if (
    preferArm64 &&
    process.platform === 'darwin' &&
    process.arch === 'x64' &&
    direct.command !== 'arch'
  ) {
    variants.unshift({
      command: 'arch',
      prefixArgs: ['-arm64', direct.command].concat(direct.prefixArgs),
      configured: `arch -arm64 ${configured}`,
    })
  }

  return variants
}

function probePythonVariant(variant) {
  const probe = spawnSync(
    variant.command,
    variant.prefixArgs.concat([
      '-c',
      'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)',
    ]),
    {
      encoding: 'utf8',
    }
  )

  return probe.status === 0
}

function resolvePythonCommandParts({
  preferArm64 = false,
  configured = '',
} = {}) {
  const explicit = normalizeExecutableOverride(configured, {
    executablePattern: PYTHON_EXECUTABLE_PATTERN,
    errorCode: 'invalid_python_command_path',
    label: 'Python',
  })
  const envOverride = normalizeExecutableOverride(process.env.IDENAAI_PYTHON, {
    executablePattern: PYTHON_EXECUTABLE_PATTERN,
    errorCode: 'invalid_python_command_path',
    label: 'Python',
  })
  const candidates = [explicit, envOverride]
    .filter(Boolean)
    .map((candidate) => ({candidate, allowArgs: false}))
    .concat(
      DEFAULT_PYTHON_COMMAND_CANDIDATES.map((candidate) => ({
        candidate,
        allowArgs: true,
      }))
    )
  const seen = new Set()

  for (const {candidate, allowArgs} of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate)
      const variants = buildPythonVariants(candidate, preferArm64, {allowArgs})

      for (const variant of variants) {
        if (probePythonVariant(variant)) {
          return variant
        }
      }
    }
  }

  throw new Error(
    'Python 3.10 or newer is required for the managed Local AI runtime.'
  )
}

function getVenvPythonPath(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

function createOutputCollector(maxChars = 16000) {
  let value = ''

  return {
    append(chunk) {
      value += String(chunk || '')

      if (value.length > maxChars) {
        value = value.slice(value.length - maxChars)
      }
    },
    toString() {
      return value.trim()
    },
  }
}

function clampProgressPercent(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function emitRuntimeProgress(onProgress, patch = {}) {
  if (typeof onProgress !== 'function') {
    return null
  }

  const progress = {
    active: patch.active !== false,
    status: trimString(patch.status) || 'starting',
    stage: trimString(patch.stage) || null,
    message: trimString(patch.message) || null,
    detail: trimString(patch.detail) || null,
    progressPercent: clampProgressPercent(patch.progressPercent),
    stageIndex: Number.isFinite(Number(patch.stageIndex))
      ? Math.max(1, Number(patch.stageIndex))
      : null,
    stageCount: Number.isFinite(Number(patch.stageCount))
      ? Math.max(1, Number(patch.stageCount))
      : null,
    updatedAt: new Date().toISOString(),
  }

  try {
    onProgress(progress)
  } catch {
    // Best effort progress propagation.
  }

  return progress
}

function runCommand({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = MANAGED_RUNTIME_INSTALL_TIMEOUT_MS,
  label = 'Managed Local AI command',
  onOutput = null,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = createOutputCollector()
    const stderr = createOutputCollector()
    let settled = false
    let timeoutId = null
    let forceKillId = null

    function finalize(result) {
      if (settled) {
        return
      }

      settled = true

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (forceKillId) {
        clearTimeout(forceKillId)
      }

      resolve(result)
    }

    function fail(error) {
      if (settled) {
        return
      }

      settled = true

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (forceKillId) {
        clearTimeout(forceKillId)
      }

      reject(error)
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout.append(chunk)

        if (typeof onOutput === 'function') {
          try {
            onOutput(String(chunk || ''), 'stdout')
          } catch {
            // Best effort progress propagation.
          }
        }
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr.append(chunk)

        if (typeof onOutput === 'function') {
          try {
            onOutput(String(chunk || ''), 'stderr')
          } catch {
            // Best effort progress propagation.
          }
        }
      })
    }

    child.once('error', (error) => {
      fail(
        new Error(
          `${label} could not start: ${error.message || String(error || '')}`
        )
      )
    })

    child.once('exit', (code, signal) => {
      if (code === 0) {
        finalize({
          ok: true,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        })
        return
      }

      const detailParts = []
      const stderrText = stderr.toString()
      const stdoutText = stdout.toString()

      if (stderrText) {
        detailParts.push(stderrText)
      } else if (stdoutText) {
        detailParts.push(stdoutText)
      }

      if (signal) {
        detailParts.push(`signal ${signal}`)
      } else {
        detailParts.push(`exit code ${code}`)
      }

      fail(new Error(`${label} failed: ${detailParts.join(' | ')}`))
    })

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          // Best effort timeout cleanup.
        }

        forceKillId = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // Best effort timeout cleanup.
          }
        }, 2000)
      }, timeoutMs)
    }
  })
}

function parseLoopbackBaseUrl(baseUrl) {
  const validation = validateLocalAiBaseUrl(baseUrl)

  if (!validation.ok) {
    return {
      ok: false,
      error: validation.reason,
      lastError: validation.message,
      baseUrl: validation.normalizedBaseUrl || trimString(baseUrl),
    }
  }

  const {normalizedBaseUrl} = validation

  try {
    const parsed = new URL(normalizedBaseUrl)
    return {
      ok: true,
      baseUrl: normalizedBaseUrl,
      host: parsed.hostname || '127.0.0.1',
      port: Number.parseInt(parsed.port, 10) || 80,
    }
  } catch {
    return {
      ok: false,
      error: 'invalid_url',
      lastError: 'Local AI endpoint must be a valid http(s) URL.',
      baseUrl: normalizedBaseUrl,
    }
  }
}

async function ensurePrivateDirectory(dirPath) {
  await fs.ensureDir(dirPath)

  try {
    await fs.chmod(dirPath, 0o700)
  } catch {
    // Best effort on non-POSIX platforms.
  }
}

function buildManagedRuntimeEnv(runtimeRoot, extra = {}) {
  const hfHome = path.join(runtimeRoot, 'hf-home')
  const hubCache = path.join(hfHome, 'hub')
  const transformersCache = path.join(hfHome, 'transformers')

  return {
    ...process.env,
    HF_HOME: hfHome,
    HUGGINGFACE_HUB_CACHE: hubCache,
    TRANSFORMERS_CACHE: transformersCache,
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_DISABLE_XET: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_PYTHON_VERSION_WARNING: '1',
    PIP_REQUIRE_VIRTUALENV: '1',
    PYTHONUNBUFFERED: '1',
    PYTORCH_ENABLE_MPS_FALLBACK: '1',
    ...extra,
  }
}

async function resolveExistingDiskProbePath(targetPath) {
  let currentPath = path.resolve(trimString(targetPath) || process.cwd())

  while (!(await fs.pathExists(currentPath))) {
    const parentPath = path.dirname(currentPath)

    if (parentPath === currentPath) {
      return process.cwd()
    }

    currentPath = parentPath
  }

  return currentPath
}

async function probeFreeDiskBytes(targetPath) {
  const probePath = await resolveExistingDiskProbePath(targetPath)
  const stats = await fs.promises.statfs(probePath)
  const blockSize = Number(stats && stats.bsize)
  const availableBlocks = Number(stats && stats.bavail)
  const freeBytes = blockSize * availableBlocks

  if (!(Number.isFinite(freeBytes) && freeBytes >= 0)) {
    throw new Error(
      `Managed Local AI disk-space probe returned an invalid result for ${probePath}.`
    )
  }

  return {probePath, freeBytes}
}

function managedMolmo2SnapshotPath(runtimeRoot) {
  return path.join(runtimeRoot, 'model-snapshot')
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('error', reject)
    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}

async function verifyManagedMolmo2Snapshot(snapshotDir, runtimeConfig) {
  const config =
    runtimeConfig ||
    resolveManagedMolmo2RuntimeConfig(DEFAULT_MANAGED_MOLMO2_RUNTIME_FAMILY)
  const displayName = config ? config.displayName : 'Molmo2'
  const verifyFiles = config ? config.verifyFiles : {}
  const weightFiles = config ? config.weightFiles : []

  if (!(await fs.pathExists(snapshotDir))) {
    return {
      ok: false,
      error: 'missing_model_snapshot',
      lastError: `The pinned ${displayName} runtime snapshot is missing on this device.`,
    }
  }

  for (const [relativePath, manifestEntry] of Object.entries(verifyFiles)) {
    const filePath = path.join(snapshotDir, relativePath)

    if (!(await fs.pathExists(filePath))) {
      return {
        ok: false,
        error: 'missing_snapshot_file',
        lastError: `The pinned ${displayName} runtime file is missing: ${relativePath}`,
      }
    }

    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      return {
        ok: false,
        error: 'invalid_snapshot_file',
        lastError: `The pinned ${displayName} runtime path is not a file: ${relativePath}`,
      }
    }

    const expectedSize = Number.parseInt(manifestEntry.size, 10)
    if (Number.isFinite(expectedSize) && stats.size !== expectedSize) {
      return {
        ok: false,
        error: 'snapshot_size_mismatch',
        lastError: `The pinned ${displayName} runtime file has an unexpected size: ${relativePath}`,
      }
    }

    const expectedHash = trimString(manifestEntry.sha256).toLowerCase()
    if (expectedHash) {
      const actualHash = (await sha256File(filePath)).toLowerCase()

      if (actualHash !== expectedHash) {
        return {
          ok: false,
          error: 'snapshot_hash_mismatch',
          lastError: `The pinned ${displayName} runtime file failed verification: ${relativePath}`,
        }
      }
    }
  }

  const requiresIndexedWeights =
    weightFiles.length > 1 ||
    Object.prototype.hasOwnProperty.call(
      verifyFiles,
      'model.safetensors.index.json'
    )

  if (!requiresIndexedWeights) {
    return {
      ok: true,
      snapshotDir,
    }
  }

  const indexPath = path.join(snapshotDir, 'model.safetensors.index.json')

  if (!(await fs.pathExists(indexPath))) {
    return {
      ok: false,
      error: 'missing_weight_index',
      lastError: `The pinned ${displayName} runtime weight index is missing from the local snapshot.`,
    }
  }

  try {
    const index = await fs.readJson(indexPath)
    const weightMap =
      index && typeof index === 'object' && !Array.isArray(index)
        ? index.weight_map
        : null
    const shardNames = Array.from(
      new Set(
        Object.values(
          weightMap && typeof weightMap === 'object' ? weightMap : {}
        ).map((value) => trimString(value))
      )
    ).filter(Boolean)
    const expectedShards = new Set(weightFiles)

    if (
      shardNames.length !== expectedShards.size ||
      shardNames.some((value) => !expectedShards.has(value))
    ) {
      return {
        ok: false,
        error: 'unexpected_weight_layout',
        lastError: `The pinned ${displayName} runtime weight layout does not match the trusted manifest.`,
      }
    }
  } catch {
    return {
      ok: false,
      error: 'invalid_weight_index',
      lastError: `The pinned ${displayName} runtime weight index could not be verified.`,
    }
  }

  for (const fileName of weightFiles) {
    const filePath = path.join(snapshotDir, fileName)

    if (!(await fs.pathExists(filePath))) {
      return {
        ok: false,
        error: 'missing_weight_file',
        lastError: `The pinned ${displayName} runtime weight shard is missing: ${fileName}`,
      }
    }
  }

  return {
    ok: true,
    snapshotDir,
  }
}

function probeInstalledPackages(pythonPath, requirements = []) {
  const normalizedRequirements = Array.isArray(requirements)
    ? requirements
        .map((item) => ({
          name: trimString(item && item.name),
          version: trimString(item && item.version),
        }))
        .filter((item) => item.name && item.version)
    : []

  if (normalizedRequirements.length === 0) {
    return false
  }

  const probe = spawnSync(
    pythonPath,
    [
      '-c',
      [
        'import json',
        'import sys',
        'from importlib import metadata as md',
        'requirements = json.loads(sys.argv[1])',
        'try:',
        '    for item in requirements:',
        '        installed = md.version(item["name"])',
        '        if str(installed).strip() != str(item["version"]).strip():',
        '            raise SystemExit(1)',
        'except Exception:',
        '    raise SystemExit(1)',
        'raise SystemExit(0)',
      ].join('\n'),
      JSON.stringify(normalizedRequirements),
    ],
    {
      encoding: 'utf8',
    }
  )

  return probe.status === 0
}

function requirementSpecList(requirements = []) {
  return requirements
    .map((item) => {
      const name = trimString(item && item.name)
      const version = trimString(item && item.version)
      return name && version ? `${name}==${version}` : ''
    })
    .filter(Boolean)
}

function resolveManagedRuntimeRequirements(flavor, runtimeConfig = null) {
  if (flavor === 'mlx-vlm') {
    return MANAGED_MLX_VLM_REQUIREMENTS
  }

  if (
    Array.isArray(runtimeConfig && runtimeConfig.transformersRequirements) &&
    runtimeConfig.transformersRequirements.length > 0
  ) {
    return runtimeConfig.transformersRequirements
  }

  return MANAGED_GENERIC_TRANSFORMERS_REQUIREMENTS
}

function managedRuntimeTokenPath(runtimeRoot) {
  return path.join(runtimeRoot, 'runtime-auth-token')
}

function readManagedRuntimeAuthToken(runtimeRoot) {
  try {
    const token = trimString(
      fs.readFileSync(managedRuntimeTokenPath(runtimeRoot), 'utf8')
    )
    return token || null
  } catch {
    return null
  }
}

function generateManagedRuntimeAuthToken() {
  return crypto.randomBytes(32).toString('base64url')
}

async function ensureManagedRuntimeAuthToken(runtimeRoot) {
  const existing = readManagedRuntimeAuthToken(runtimeRoot)

  if (existing) {
    return existing
  }

  await ensurePrivateDirectory(runtimeRoot)

  const token = generateManagedRuntimeAuthToken()
  const tokenPath = managedRuntimeTokenPath(runtimeRoot)

  await fs.writeFile(tokenPath, `${token}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })

  try {
    await fs.chmod(tokenPath, 0o600)
  } catch {
    // Best effort on non-POSIX platforms.
  }

  return token
}

async function ensureManagedPythonVenv(
  runtimeRoot,
  preferArm64 = false,
  {onProgress, pythonPath = ''} = {}
) {
  const venvDir = path.join(runtimeRoot, 'venv')
  const venvPython = getVenvPythonPath(venvDir)

  if (await fs.pathExists(venvPython)) {
    emitRuntimeProgress(onProgress, {
      status: 'installing',
      stage: 'create_python_env',
      message: 'Using the existing Python environment for the local runtime.',
      progressPercent: 18,
      stageIndex: 2,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })
    return venvPython
  }

  await ensurePrivateDirectory(runtimeRoot)
  emitRuntimeProgress(onProgress, {
    status: 'installing',
    stage: 'create_python_env',
    message: 'Creating the Python environment for the local runtime.',
    progressPercent: 18,
    stageIndex: 2,
    stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
  })

  const variant = resolvePythonCommandParts({
    preferArm64,
    configured: pythonPath,
  })

  await runCommand({
    command: variant.command,
    args: variant.prefixArgs.concat(['-m', 'venv', venvDir]),
    label: 'Managed Local AI runtime bootstrap',
  })

  return venvPython
}

async function ensureManagedMolmo2RuntimeInstalled(
  runtimeRoot,
  flavor,
  {onProgress, pythonPath = '', runtimeConfig = null} = {}
) {
  const preferArm64 = flavor === 'mlx-vlm'
  const venvPython = await ensureManagedPythonVenv(runtimeRoot, preferArm64, {
    onProgress,
    pythonPath,
  })
  const env = buildManagedRuntimeEnv(runtimeRoot)
  const config =
    runtimeConfig ||
    resolveManagedRuntimeConfig(DEFAULT_MANAGED_LOCAL_RUNTIME_FAMILY)
  const requirements = resolveManagedRuntimeRequirements(flavor, config)

  if (probeInstalledPackages(venvPython, requirements)) {
    emitRuntimeProgress(onProgress, {
      status: 'installing',
      stage: 'verify_runtime_packages',
      message:
        'The local runtime packages are already installed on this device.',
      progressPercent: 58,
      stageIndex: 4,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })
    return {pythonPath: venvPython, flavor}
  }

  emitRuntimeProgress(onProgress, {
    status: 'installing',
    stage: 'install_runtime_packages',
    message:
      'Installing the local runtime packages. This can take several minutes on first use.',
    progressPercent: 38,
    stageIndex: 3,
    stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
  })

  await runCommand({
    command: venvPython,
    args: ['-m', 'pip', 'install'].concat(requirementSpecList(requirements)),
    env,
    label:
      flavor === 'mlx-vlm'
        ? 'Managed Local AI MLX runtime install'
        : 'Managed Local AI transformers runtime install',
    onOutput(chunk) {
      const detail = String(chunk || '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-1)[0]

      if (!detail) {
        return
      }

      emitRuntimeProgress(onProgress, {
        status: 'installing',
        stage: 'install_runtime_packages',
        message:
          'Installing the local runtime packages. This can take several minutes on first use.',
        detail,
        progressPercent: 38,
        stageIndex: 3,
        stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
      })
    },
  })

  emitRuntimeProgress(onProgress, {
    status: 'installing',
    stage: 'verify_runtime_packages',
    message: 'Verifying the installed local runtime packages.',
    progressPercent: 58,
    stageIndex: 4,
    stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
  })

  if (!probeInstalledPackages(venvPython, requirements)) {
    throw new Error(
      'Managed Local AI runtime installation completed, but the required Python modules are still unavailable.'
    )
  }

  return {pythonPath: venvPython, flavor}
}

async function ensureManagedRuntimeDiskSpace(
  runtimeRoot,
  flavor,
  runtimeConfig = null
) {
  const config =
    runtimeConfig ||
    resolveManagedRuntimeConfig(DEFAULT_MANAGED_LOCAL_RUNTIME_FAMILY)
  const displayName = config ? config.displayName : 'managed local'
  const snapshotDir = managedMolmo2SnapshotPath(runtimeRoot)
  const venvPython = getVenvPythonPath(path.join(runtimeRoot, 'venv'))
  const requirements = resolveManagedRuntimeRequirements(flavor, config)
  const hasVenvPython = await fs.pathExists(venvPython)
  const packageInstallRequired =
    !hasVenvPython || !probeInstalledPackages(venvPython, requirements)
  const snapshotVerification = await verifyManagedMolmo2Snapshot(
    snapshotDir,
    config
  )
  const snapshotInstallRequired = !snapshotVerification.ok
  const requiredBytes =
    (packageInstallRequired
      ? estimateManagedRuntimePackageInstallBytes(flavor)
      : 0) +
    (snapshotInstallRequired
      ? estimateManagedRuntimeSnapshotInstallBytes(config)
      : 0)

  if (!(requiredBytes > 0)) {
    return {
      probePath: runtimeRoot,
      freeBytes: 0,
      requiredBytes: 0,
      packageInstallRequired,
      snapshotInstallRequired,
      snapshotVerification,
    }
  }

  const {probePath, freeBytes} = await probeFreeDiskBytes(runtimeRoot)

  if (freeBytes < requiredBytes) {
    const error = createRuntimeControllerError(
      'managed_runtime_disk_space_low',
      `The managed ${displayName} runtime needs about ${formatApproxGiB(
        requiredBytes
      )} of free disk space before install can start, but only about ${formatApproxGiB(
        freeBytes
      )} is currently available at ${probePath}.`
    )
    error.requiredBytes = requiredBytes
    error.freeBytes = freeBytes
    error.probePath = probePath
    error.runtimeFamily = config ? config.runtimeFamily : ''
    throw error
  }

  return {
    probePath,
    freeBytes,
    requiredBytes,
    packageInstallRequired,
    snapshotInstallRequired,
    snapshotVerification,
  }
}

async function downloadManagedMolmo2Snapshot(
  pythonPath,
  runtimeRoot,
  runtimeConfig,
  {onProgress, existingVerification = null} = {}
) {
  const snapshotDir = managedMolmo2SnapshotPath(runtimeRoot)
  const env = buildManagedRuntimeEnv(runtimeRoot)
  const config =
    runtimeConfig ||
    resolveManagedRuntimeConfig(DEFAULT_MANAGED_LOCAL_RUNTIME_FAMILY)
  const displayName = config ? config.displayName : 'Molmo2'
  const verification =
    existingVerification ||
    (await verifyManagedMolmo2Snapshot(snapshotDir, config))

  if (verification.ok) {
    emitRuntimeProgress(onProgress, {
      status: 'installing',
      stage: 'verify_model_snapshot',
      message: `The pinned ${displayName} runtime snapshot is already verified on this device.`,
      progressPercent: 68,
      stageIndex: 5,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })
    return snapshotDir
  }

  await fs.remove(snapshotDir)
  await ensurePrivateDirectory(snapshotDir)
  emitRuntimeProgress(onProgress, {
    status: 'installing',
    stage: 'download_model_snapshot',
    message: `Downloading the pinned ${displayName} runtime snapshot and model weights. This can take a while on first use.`,
    progressPercent: 62,
    stageIndex: 5,
    stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
  })
  const totalSnapshotBytes = sumManagedRuntimeVerifyBytes(config)
  let snapshotProgressTimer = null

  if (typeof onProgress === 'function') {
    snapshotProgressTimer = setInterval(async () => {
      try {
        const downloadedBytes = await calculateDirectorySizeBytes(snapshotDir)
        const hasExpectedTotal = totalSnapshotBytes > 0
        const progressFraction = hasExpectedTotal
          ? Math.max(0, Math.min(downloadedBytes / totalSnapshotBytes, 0.99))
          : null
        const progressPercent =
          progressFraction !== null
            ? Math.max(62, Math.min(72, 62 + Math.round(progressFraction * 10)))
            : 62
        const detail = hasExpectedTotal
          ? `Downloaded about ${formatApproxGiB(
              downloadedBytes
            )} of ${formatApproxGiB(totalSnapshotBytes)} so far.`
          : `Downloaded about ${formatApproxGiB(downloadedBytes)} so far.`

        emitRuntimeProgress(onProgress, {
          status: 'installing',
          stage: 'download_model_snapshot',
          message: `Downloading the pinned ${displayName} runtime snapshot and model weights. This can take a while on first use.`,
          detail,
          progressPercent,
          stageIndex: 5,
          stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
        })
      } catch {
        // Best effort progress enrichment while the snapshot download runs.
      }
    }, 2000)
  }

  try {
    let downloadAttempt = 0

    while (downloadAttempt < MANAGED_RUNTIME_SNAPSHOT_DOWNLOAD_MAX_RETRIES) {
      downloadAttempt += 1

      try {
        await runCommand({
          command: pythonPath,
          args: [
            '-c',
            [
              'import json',
              'import sys',
              'from huggingface_hub import snapshot_download',
              'repo_id = sys.argv[1]',
              'revision = sys.argv[2]',
              'local_dir = sys.argv[3]',
              'allow_patterns = json.loads(sys.argv[4])',
              'snapshot_download(',
              '    repo_id=repo_id,',
              '    revision=revision,',
              '    local_dir=local_dir,',
              '    allow_patterns=allow_patterns,',
              ')',
            ].join('\n'),
            config.modelId,
            config.revision,
            snapshotDir,
            JSON.stringify(config.allowPatterns),
          ],
          env,
          label: 'Managed Local AI model snapshot download',
          onOutput(chunk) {
            const detail = String(chunk || '')
              .split(/\r?\n/u)
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(-1)[0]

            if (!detail) {
              return
            }

            emitRuntimeProgress(onProgress, {
              status: 'installing',
              stage: 'download_model_snapshot',
              message: `Downloading the pinned ${displayName} runtime snapshot and model weights. This can take a while on first use.`,
              detail,
              progressPercent: 62,
              stageIndex: 5,
              stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
            })
          },
        })
        break
      } catch (error) {
        const retryableDownloadError =
          isRetryableManagedSnapshotDownloadError(error)

        if (
          downloadAttempt >= MANAGED_RUNTIME_SNAPSHOT_DOWNLOAD_MAX_RETRIES ||
          !retryableDownloadError
        ) {
          if (retryableDownloadError) {
            throw createRuntimeControllerError(
              'managed_runtime_snapshot_download_interrupted',
              `The managed ${displayName} model download was interrupted repeatedly by the network. Retry Local AI startup once more. If this keeps happening, set an authenticated Hugging Face token for higher download reliability.`
            )
          }

          throw error
        }

        emitRuntimeProgress(onProgress, {
          status: 'installing',
          stage: 'download_model_snapshot',
          message: `The ${displayName} model download was interrupted. Retrying from the partially downloaded snapshot now.`,
          detail: `Retry ${
            downloadAttempt + 1
          } of ${MANAGED_RUNTIME_SNAPSHOT_DOWNLOAD_MAX_RETRIES}…`,
          progressPercent: 62,
          stageIndex: 5,
          stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
        })
        await sleep(MANAGED_RUNTIME_SNAPSHOT_DOWNLOAD_RETRY_DELAY_MS)
      }
    }
  } finally {
    if (snapshotProgressTimer) {
      clearInterval(snapshotProgressTimer)
    }
  }

  const verifiedSnapshot = await verifyManagedMolmo2Snapshot(
    snapshotDir,
    config
  )

  if (!verifiedSnapshot.ok) {
    await fs.remove(snapshotDir)
    throw createRuntimeControllerError(
      verifiedSnapshot.error || 'snapshot_verification_failed',
      verifiedSnapshot.lastError ||
        `The pinned ${displayName} runtime snapshot could not be verified.`
    )
  }

  emitRuntimeProgress(onProgress, {
    status: 'installing',
    stage: 'verify_model_snapshot',
    message: `Verified the pinned ${displayName} runtime snapshot before startup.`,
    progressPercent: 74,
    stageIndex: 5,
    stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
  })

  return snapshotDir
}

function spawnManagedProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      ...options,
    })

    child.once('error', reject)
    child.once('spawn', () => resolve(child))
  })
}

function stopManagedProcess(child) {
  if (!child || child.exitCode != null || child.killed) {
    return
  }

  try {
    process.kill(child.pid, 'SIGTERM')
  } catch {
    // Best effort stop.
  }
}

function ensureProcessSurvivesStartup(child, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (!child || child.exitCode != null) {
      reject(new Error('Managed Local AI runtime exited before startup.'))
      return
    }

    let settled = false
    let timerId = null

    function finalize(fn, value) {
      if (settled) {
        return
      }

      settled = true

      if (timerId) {
        clearTimeout(timerId)
      }

      child.removeListener('exit', handleExit)
      fn(value)
    }

    function handleExit(code, signal) {
      const detail = signal ? `signal ${signal}` : `exit code ${code}`
      finalize(
        reject,
        new Error(`Managed Local AI runtime exited during startup (${detail}).`)
      )
    }

    child.once('exit', handleExit)
    timerId = setTimeout(() => {
      finalize(resolve)
    }, timeoutMs)
  })
}

function sameManagedSpec(current = {}, next = {}) {
  return (
    current.kind === next.kind &&
    current.baseUrl === next.baseUrl &&
    current.model === next.model &&
    current.flavor === next.flavor &&
    current.revision === next.revision &&
    current.authToken === next.authToken
  )
}

function buildManagedLocalAiServerArgs({
  backend,
  host,
  port,
  modelPath,
  displayModelId,
  modelRevision,
} = {}) {
  const args = [
    path.resolve(__dirname, '..', '..', 'scripts', 'local_ai_server.py'),
    '--backend',
    backend,
    '--host',
    host,
    '--port',
    String(port),
    '--model',
    modelPath,
  ]

  if (trimString(displayModelId)) {
    args.push('--display-model-id', displayModelId)
  }

  if (trimString(modelRevision)) {
    args.push('--model-revision', modelRevision)
  }

  return args
}

function resolveManagedMolmo2RuntimeContext(baseDir, payload = {}) {
  const runtimeConfig = resolveManagedRuntimeConfig(
    managedRuntimeKindFromPayload(payload)
  )
  const endpoint = parseLoopbackBaseUrl(payload.baseUrl)

  if (!endpoint.ok) {
    return {
      ok: false,
      error: endpoint.error,
      lastError: endpoint.lastError,
      baseUrl: endpoint.baseUrl,
    }
  }

  if (!runtimeConfig) {
    return {
      ok: false,
      error: 'unsupported_managed_model',
      lastError:
        'The managed local runtime only supports the pinned runtime families bundled by IdenaAI.',
      baseUrl: endpoint.baseUrl,
    }
  }

  const flavor = resolveManagedLocalRuntimeFlavor(runtimeConfig)
  const requestedModel =
    trimString(payload.visionModel) || trimString(payload.model)

  if (requestedModel && requestedModel !== runtimeConfig.modelId) {
    return {
      ok: false,
      error: 'unsupported_managed_model',
      lastError: `The managed local runtime only supports the pinned ${runtimeConfig.displayName} model.`,
      baseUrl: endpoint.baseUrl,
    }
  }

  const model = runtimeConfig.modelId

  return {
    ok: true,
    endpoint,
    flavor,
    model,
    runtimeConfig,
    runtimeRoot: path.join(baseDir, runtimeConfig.runtimeRootName, flavor),
  }
}

function createDefaultRuntimeController({
  logger,
  isDev = false,
  baseDir = path.join(os.tmpdir(), 'idena-local-ai-managed-runtime'),
} = {}) {
  let managedProcess = null
  let managedSpec = null

  function rememberManagedProcess(child, spec) {
    managedProcess = child
    managedSpec = spec
    child.unref()
    child.once('exit', () => {
      if (managedProcess === child) {
        managedProcess = null
        managedSpec = null
      }
    })
  }

  async function startManagedMolmoRuntime(payload = {}) {
    if (!hasManagedRuntimeTrustApproval(payload)) {
      throw createRuntimeControllerError(
        'managed_runtime_trust_required',
        'Approve the managed Local AI runtime before IdenaAI installs pinned packages and runs a verified pinned on-device model snapshot on this device.'
      )
    }

    const onProgress =
      payload && typeof payload.onProgress === 'function'
        ? payload.onProgress
        : null
    const context = resolveManagedMolmo2RuntimeContext(baseDir, payload)

    if (!context.ok) {
      return {
        started: false,
        managed: false,
        error: context.error,
        lastError: context.lastError,
        baseUrl: context.baseUrl,
      }
    }

    const {endpoint, flavor, model, runtimeConfig, runtimeRoot} = context
    const pythonPath = trimString(payload.managedRuntimePythonPath)
    emitRuntimeProgress(onProgress, {
      status: 'installing',
      stage: 'prepare_runtime_files',
      message: 'Preparing the managed local runtime on this device.',
      progressPercent: 8,
      stageIndex: 1,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })
    const authToken = await ensureManagedRuntimeAuthToken(runtimeRoot)
    const env = buildManagedRuntimeEnv(runtimeRoot, {
      [MANAGED_RUNTIME_AUTH_ENV]: authToken,
    })
    const spec = {
      kind: runtimeConfig.runtimeFamily,
      flavor,
      baseUrl: endpoint.baseUrl,
      model,
      authToken,
      revision: runtimeConfig.revision,
    }

    if (
      managedProcess &&
      managedProcess.exitCode == null &&
      !managedProcess.killed &&
      sameManagedSpec(managedSpec, spec)
    ) {
      emitRuntimeProgress(onProgress, {
        active: false,
        status: 'ready',
        stage: 'runtime_already_running',
        message: 'The managed local runtime is already running.',
        progressPercent: 100,
        stageIndex: 6,
        stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
      })
      return {
        started: false,
        managed: true,
        pid: managedProcess.pid,
        flavor,
        model,
        authToken,
      }
    }

    if (
      managedProcess &&
      managedProcess.exitCode == null &&
      !managedProcess.killed
    ) {
      emitRuntimeProgress(onProgress, {
        status: 'starting',
        stage: 'restart_runtime_service',
        message: 'Restarting the managed local runtime service.',
        progressPercent: 68,
        stageIndex: 5,
        stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
      })
      stopManagedProcess(managedProcess)
      managedProcess = null
      managedSpec = null
    }

    const diskSpace = await ensureManagedRuntimeDiskSpace(
      runtimeRoot,
      flavor,
      runtimeConfig
    )
    const install = await ensureManagedMolmo2RuntimeInstalled(
      runtimeRoot,
      flavor,
      {onProgress, pythonPath, runtimeConfig}
    )
    const snapshotPath = await downloadManagedMolmo2Snapshot(
      install.pythonPath,
      runtimeRoot,
      runtimeConfig,
      {
        onProgress,
        existingVerification: diskSpace.snapshotVerification,
      }
    )
    emitRuntimeProgress(onProgress, {
      status: 'starting',
      stage: 'start_runtime_service',
      message: 'Starting the managed local runtime service.',
      progressPercent: 84,
      stageIndex: 6,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })
    const child = await spawnManagedProcess(
      install.pythonPath,
      buildManagedLocalAiServerArgs({
        backend: flavor,
        host: endpoint.host,
        port: endpoint.port,
        modelPath: snapshotPath,
        displayModelId: model,
        modelRevision: runtimeConfig.revision,
      }),
      {env}
    )

    rememberManagedProcess(child, spec)
    emitRuntimeProgress(onProgress, {
      status: 'starting',
      stage: 'wait_for_runtime_process',
      message: 'Waiting for the local runtime process to come online.',
      progressPercent: 92,
      stageIndex: 7,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })
    await ensureProcessSurvivesStartup(child)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Managed Local AI HTTP runtime spawned', {
        flavor,
        pid: child.pid,
        baseUrl: endpoint.baseUrl,
        model,
      })
    }

    emitRuntimeProgress(onProgress, {
      active: false,
      status: 'starting',
      stage: 'wait_for_runtime_model_load',
      message:
        'The local runtime process is up. On first use it may still be downloading and loading the model before the health check succeeds.',
      detail:
        'Keep this window open. The first on-device model load can take several more minutes after package installation finishes.',
      progressPercent: 97,
      stageIndex: 7,
      stageCount: MANAGED_MOLMO2_PROGRESS_STAGE_COUNT,
    })

    return {
      started: true,
      managed: true,
      pid: child.pid,
      flavor,
      model,
      baseUrl: endpoint.baseUrl,
      authToken,
      revision: runtimeConfig.revision,
    }
  }

  return {
    resolveAccess(payload = {}) {
      const managedKind = managedRuntimeKindFromPayload(payload)

      if (!managedKind || managedKind === 'ollama') {
        return {managed: false, authToken: null}
      }

      const context = resolveManagedMolmo2RuntimeContext(baseDir, payload)

      if (!context.ok) {
        return {
          managed: false,
          authToken: null,
          error: context.error,
          lastError: context.lastError,
          baseUrl: context.baseUrl,
        }
      }

      return {
        managed: true,
        authToken: readManagedRuntimeAuthToken(context.runtimeRoot),
        baseUrl: context.endpoint.baseUrl,
        model: context.model,
        flavor: context.flavor,
        revision: context.runtimeConfig.revision,
      }
    },

    async start(payload = {}) {
      const managedKind = managedRuntimeKindFromPayload(payload)
      const onProgress =
        payload && typeof payload.onProgress === 'function'
          ? payload.onProgress
          : null

      if (managedKind === 'ollama') {
        if (
          managedProcess &&
          managedProcess.exitCode == null &&
          !managedProcess.killed &&
          managedSpec &&
          managedSpec.kind === 'ollama'
        ) {
          emitRuntimeProgress(onProgress, {
            active: false,
            status: 'ready',
            stage: 'runtime_already_running',
            message: 'The Ollama local runtime is already running.',
            progressPercent: 100,
            stageIndex: 2,
            stageCount: 2,
          })
          return {
            started: false,
            managed: true,
            pid: managedProcess.pid,
          }
        }

        const command = resolveOllamaCommand(payload.ollamaCommandPath)
        const env = {...process.env}
        const baseUrlValidation = validateLocalAiBaseUrl(payload.baseUrl)

        if (!baseUrlValidation.ok) {
          return {
            started: false,
            managed: false,
            error: baseUrlValidation.reason,
            lastError: baseUrlValidation.message,
            baseUrl:
              baseUrlValidation.normalizedBaseUrl ||
              trimString(payload.baseUrl),
          }
        }

        if (
          managedProcess &&
          managedProcess.exitCode == null &&
          !managedProcess.killed
        ) {
          emitRuntimeProgress(onProgress, {
            status: 'starting',
            stage: 'restart_runtime_service',
            message: 'Restarting the Ollama local runtime.',
            progressPercent: 65,
            stageIndex: 1,
            stageCount: 2,
          })
          stopManagedProcess(managedProcess)
          managedProcess = null
          managedSpec = null
        }

        const host = resolveOllamaHostEnv(baseUrlValidation.normalizedBaseUrl)

        if (host) {
          env.OLLAMA_HOST = host
        }

        emitRuntimeProgress(onProgress, {
          status: 'starting',
          stage: 'start_runtime_service',
          message: 'Starting the Ollama local runtime.',
          progressPercent: 70,
          stageIndex: 1,
          stageCount: 2,
        })
        const child = await spawnManagedProcess(command, ['serve'], {env})

        rememberManagedProcess(child, {
          kind: 'ollama',
          baseUrl: baseUrlValidation.normalizedBaseUrl,
          model: '',
          flavor: 'ollama',
        })
        emitRuntimeProgress(onProgress, {
          status: 'starting',
          stage: 'wait_for_runtime_process',
          message:
            'Waiting for the Ollama local runtime process to come online.',
          progressPercent: 90,
          stageIndex: 2,
          stageCount: 2,
        })
        await ensureProcessSurvivesStartup(child)

        if (isDev && logger && typeof logger.debug === 'function') {
          logger.debug('Managed Local AI runtime spawned', {
            command,
            host,
            pid: child.pid,
          })
        }

        return {
          started: true,
          managed: true,
          pid: child.pid,
          command,
          host,
        }
      }

      if (managedKind && managedKind !== 'ollama') {
        return startManagedMolmoRuntime(payload)
      }

      return {started: false, managed: false}
    },

    async stop(payload = {}) {
      if (
        !managedProcess ||
        managedProcess.exitCode != null ||
        managedProcess.killed
      ) {
        return {stopped: false, managed: false}
      }

      const requestedKind = managedRuntimeKindFromPayload(payload)

      if (requestedKind && managedSpec && requestedKind !== managedSpec.kind) {
        return {stopped: false, managed: false}
      }

      const {pid} = managedProcess
      stopManagedProcess(managedProcess)
      managedProcess = null
      managedSpec = null

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Managed Local AI runtime stopped', {
          pid,
        })
      }

      return {
        stopped: true,
        managed: true,
        pid,
      }
    },
  }
}

module.exports = {
  estimateManagedRuntimeInstallBytes,
  MANAGED_MOLMO2_RUNTIME_FAMILY,
  MANAGED_MOLMO2_RUNTIME_START_TIMEOUT_MS,
  buildManagedLocalAiServerArgs,
  buildManagedRuntimeEnv,
  createDefaultRuntimeController,
  isManagedLocalHttpRuntime,
  resolveManagedLocalRuntimeFlavor,
  resolveManagedMolmo2RuntimeFlavor,
  sha256File,
}
