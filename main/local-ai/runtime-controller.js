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

const DEFAULT_MANAGED_MOLMO2_MODEL = 'allenai/Molmo2-O-7B'
const MANAGED_MOLMO2_MODEL_REVISION = '784410650d12be9bc086118fdefa32d2c3bced86'
const MANAGED_MOLMO2_RUNTIME_FAMILY = 'molmo2-o'
const MANAGED_MOLMO2_RUNTIME_START_TIMEOUT_MS = 20 * 60 * 1000
const MANAGED_RUNTIME_INSTALL_TIMEOUT_MS = 45 * 60 * 1000
const MANAGED_RUNTIME_AUTH_ENV = 'IDENAAI_LOCAL_RUNTIME_TOKEN'
const OLLAMA_COMMAND_CANDIDATES = [
  '/opt/homebrew/bin/ollama',
  '/usr/local/bin/ollama',
  'ollama',
]
const PYTHON_COMMAND_CANDIDATES = [
  process.env.IDENAAI_PYTHON || '',
  process.platform === 'win32' ? 'py -3.11' : 'python3.11',
  process.platform === 'win32' ? 'py -3' : 'python3',
  process.platform === 'win32' ? 'python' : 'python',
]
const MANAGED_MLX_VLM_REQUIREMENTS = [
  {name: 'mlx-vlm', version: '0.4.4'},
  {name: 'huggingface-hub', version: '1.11.0'},
  {name: 'pillow', version: '12.2.0'},
]
const MANAGED_TRANSFORMERS_REQUIREMENTS = [
  {name: 'transformers', version: '4.57.1'},
  {name: 'torch', version: '2.11.0'},
  {name: 'torchvision', version: '0.26.0'},
  {name: 'accelerate', version: '1.13.0'},
  {name: 'pillow', version: '12.2.0'},
  {name: 'einops', version: '0.8.2'},
  {name: 'molmo_utils', version: '0.0.1'},
  {name: 'decord2', version: '3.3.0'},
  {name: 'huggingface-hub', version: '1.11.0'},
]

function trimString(value) {
  return String(value || '').trim()
}

function normalizeBaseUrl(value, fallback = 'http://localhost:5000') {
  const baseUrl = trimString(value || fallback)
  return baseUrl || fallback
}

function resolveOllamaCommand() {
  const explicit = trimString(process.env.OLLAMA_PATH)

  if (explicit) {
    return explicit
  }

  return (
    OLLAMA_COMMAND_CANDIDATES.find(
      (candidate) => candidate === 'ollama' || fs.existsSync(candidate)
    ) || 'ollama'
  )
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
    runtimeFamily === MANAGED_MOLMO2_RUNTIME_FAMILY
  ) {
    return 'molmo2-o'
  }

  return null
}

function isManagedLocalHttpRuntime(payload = {}) {
  return managedRuntimeKindFromPayload(payload) === 'molmo2-o'
}

function resolveManagedMolmo2RuntimeFlavor() {
  return process.platform === 'darwin' && process.arch === 'arm64'
    ? 'mlx-vlm'
    : 'transformers'
}

function buildPythonVariants(configured, preferArm64 = false) {
  const parts = trimString(configured).split(/\s+/u).filter(Boolean)

  if (parts.length === 0) {
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

function resolvePythonCommandParts({preferArm64 = false} = {}) {
  for (const candidate of PYTHON_COMMAND_CANDIDATES) {
    const variants = buildPythonVariants(candidate, preferArm64)

    for (const variant of variants) {
      if (probePythonVariant(variant)) {
        return variant
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

function runCommand({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = MANAGED_RUNTIME_INSTALL_TIMEOUT_MS,
  label = 'Managed Local AI command',
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
      child.stdout.on('data', (chunk) => stdout.append(chunk))
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => stderr.append(chunk))
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
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_PYTHON_VERSION_WARNING: '1',
    PYTHONUNBUFFERED: '1',
    PYTORCH_ENABLE_MPS_FALLBACK: '1',
    ...extra,
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

  await fs.ensureDir(runtimeRoot)

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

async function ensureManagedPythonVenv(runtimeRoot, preferArm64 = false) {
  const venvDir = path.join(runtimeRoot, 'venv')
  const venvPython = getVenvPythonPath(venvDir)

  if (await fs.pathExists(venvPython)) {
    return venvPython
  }

  await fs.ensureDir(runtimeRoot)

  const variant = resolvePythonCommandParts({preferArm64})

  await runCommand({
    command: variant.command,
    args: variant.prefixArgs.concat(['-m', 'venv', venvDir]),
    label: 'Managed Local AI runtime bootstrap',
  })

  return venvPython
}

async function ensureManagedMolmo2RuntimeInstalled(runtimeRoot, flavor) {
  const preferArm64 = flavor === 'mlx-vlm'
  const venvPython = await ensureManagedPythonVenv(runtimeRoot, preferArm64)
  const env = buildManagedRuntimeEnv(runtimeRoot)
  const requirements =
    flavor === 'mlx-vlm'
      ? MANAGED_MLX_VLM_REQUIREMENTS
      : MANAGED_TRANSFORMERS_REQUIREMENTS

  if (probeInstalledPackages(venvPython, requirements)) {
    return {pythonPath: venvPython, flavor}
  }

  await runCommand({
    command: venvPython,
    args: ['-m', 'pip', 'install'].concat(requirementSpecList(requirements)),
    env,
    label:
      flavor === 'mlx-vlm'
        ? 'Managed Local AI MLX runtime install'
        : 'Managed Local AI transformers runtime install',
  })

  if (!probeInstalledPackages(venvPython, requirements)) {
    throw new Error(
      'Managed Local AI runtime installation completed, but the required Python modules are still unavailable.'
    )
  }

  return {pythonPath: venvPython, flavor}
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
    current.flavor === next.flavor
  )
}

function resolveManagedMolmo2RuntimeContext(baseDir, payload = {}) {
  const endpoint = parseLoopbackBaseUrl(payload.baseUrl)

  if (!endpoint.ok) {
    return {
      ok: false,
      error: endpoint.error,
      lastError: endpoint.lastError,
      baseUrl: endpoint.baseUrl,
    }
  }

  const flavor = resolveManagedMolmo2RuntimeFlavor()
  const model =
    trimString(payload.visionModel) ||
    trimString(payload.model) ||
    DEFAULT_MANAGED_MOLMO2_MODEL

  return {
    ok: true,
    endpoint,
    flavor,
    model,
    runtimeRoot: path.join(baseDir, 'molmo2-o', flavor),
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

    const {endpoint, flavor, model, runtimeRoot} = context
    const authToken = await ensureManagedRuntimeAuthToken(runtimeRoot)
    const env = buildManagedRuntimeEnv(runtimeRoot, {
      [MANAGED_RUNTIME_AUTH_ENV]: authToken,
    })
    const spec = {
      kind: 'molmo2-o',
      flavor,
      baseUrl: endpoint.baseUrl,
      model,
      authToken,
    }

    if (
      managedProcess &&
      managedProcess.exitCode == null &&
      !managedProcess.killed &&
      sameManagedSpec(managedSpec, spec)
    ) {
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
      stopManagedProcess(managedProcess)
      managedProcess = null
      managedSpec = null
    }

    const install = await ensureManagedMolmo2RuntimeInstalled(
      runtimeRoot,
      flavor
    )
    const child = await spawnManagedProcess(
      install.pythonPath,
      [
        path.resolve(__dirname, '..', '..', 'scripts', 'local_ai_server.py'),
        '--backend',
        flavor,
        '--host',
        endpoint.host,
        '--port',
        String(endpoint.port),
        '--model',
        model,
        '--model-revision',
        MANAGED_MOLMO2_MODEL_REVISION,
        '--trust-remote-code',
      ],
      {env}
    )

    rememberManagedProcess(child, spec)
    await ensureProcessSurvivesStartup(child)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Managed Local AI HTTP runtime spawned', {
        flavor,
        pid: child.pid,
        baseUrl: endpoint.baseUrl,
        model,
      })
    }

    return {
      started: true,
      managed: true,
      pid: child.pid,
      flavor,
      model,
      baseUrl: endpoint.baseUrl,
      authToken,
      revision: MANAGED_MOLMO2_MODEL_REVISION,
    }
  }

  return {
    resolveAccess(payload = {}) {
      const managedKind = managedRuntimeKindFromPayload(payload)

      if (managedKind !== 'molmo2-o') {
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
        revision: MANAGED_MOLMO2_MODEL_REVISION,
      }
    },

    async start(payload = {}) {
      const managedKind = managedRuntimeKindFromPayload(payload)

      if (managedKind === 'ollama') {
        if (
          managedProcess &&
          managedProcess.exitCode == null &&
          !managedProcess.killed &&
          managedSpec &&
          managedSpec.kind === 'ollama'
        ) {
          return {
            started: false,
            managed: true,
            pid: managedProcess.pid,
          }
        }

        const command = resolveOllamaCommand()
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
          stopManagedProcess(managedProcess)
          managedProcess = null
          managedSpec = null
        }

        const host = resolveOllamaHostEnv(baseUrlValidation.normalizedBaseUrl)

        if (host) {
          env.OLLAMA_HOST = host
        }

        const child = await spawnManagedProcess(command, ['serve'], {env})

        rememberManagedProcess(child, {
          kind: 'ollama',
          baseUrl: baseUrlValidation.normalizedBaseUrl,
          model: '',
          flavor: 'ollama',
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

      if (managedKind === 'molmo2-o') {
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
  MANAGED_MOLMO2_RUNTIME_FAMILY,
  MANAGED_MOLMO2_RUNTIME_START_TIMEOUT_MS,
  createDefaultRuntimeController,
  isManagedLocalHttpRuntime,
}
