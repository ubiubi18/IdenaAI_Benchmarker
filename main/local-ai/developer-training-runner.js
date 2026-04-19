const {spawn, spawnSync} = require('child_process')
const fs = require('fs')
const path = require('path')

const DEFAULT_EVALUATION_FLIPS = 100
const ALLOWED_EVALUATION_FLIPS = [50, 100, 200]
const DEFAULT_TRAINING_EPOCHS = 1
const DEFAULT_TRAINING_BATCH_SIZE = 1
const DEFAULT_TRAINING_LEARNING_RATE = 1e-4
const DEFAULT_TRAINING_LORA_RANK = 10
const DEFAULT_TRAINING_MODEL_PATH = 'mlx-community/Qwen3.5-9B-MLX-4bit'
const DEFAULT_LOCAL_TRAINING_THERMAL_MODE = 'balanced'
const DEFAULT_RUN_STOP_MODE = 'run'
const RUN_STOP_MODE_OPTIONS = new Set(['run', 'cancel_now', 'after_unit'])
const ALLOWED_LOCAL_TRAINING_PROFILES = new Set(['safe', 'balanced', 'strong'])
const LOCAL_TRAINING_THERMAL_MODE_CONFIG = {
  full_speed: {
    stepCooldownMs: 0,
    epochCooldownMs: 0,
    benchmarkCooldownMs: 0,
  },
  balanced: {
    stepCooldownMs: 250,
    epochCooldownMs: 1500,
    benchmarkCooldownMs: 400,
  },
  cool: {
    stepCooldownMs: 750,
    epochCooldownMs: 4000,
    benchmarkCooldownMs: 1500,
  },
}
const DEFAULT_PREPARE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_TRAIN_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_EVALUATE_TIMEOUT_MS = 30 * 60 * 1000
const MAX_STDIO_CAPTURE_BYTES = 128 * 1024
const MAX_PROGRESS_LINE_BUFFER_CHARS = 16 * 1024
const DEFAULT_TRAINING_STATUS = 'trained'
const DEFAULT_COMPARISON_STATUS = 'evaluated'
const PYTHON_COMMAND_CANDIDATES = [
  process.env.IDENAAI_LOCAL_TRAINING_PYTHON,
  process.env.IDENAAI_PYTHON,
]
let cachedPythonCommand = null

function looksLikeQwen35ModelPath(value) {
  return /qwen(?:\/|[-_.])?qwen3\.5-9b|qwen3\.5-9b/i.test(String(value || ''))
}

function resolveRepoRoot() {
  return path.resolve(__dirname, '..', '..')
}

function resolveRuntimeTrainingDir(developerDir) {
  return path.join(developerDir, 'runtime-training')
}

function resolveTrainingMetadataPath(runtimeTrainingDir) {
  return path.join(runtimeTrainingDir, 'state.json')
}

function resolveRunControlPath(runtimeTrainingDir) {
  return path.join(runtimeTrainingDir, 'run-control.json')
}

function resolveTrainingDatasetDir(runtimeTrainingDir) {
  return path.join(runtimeTrainingDir, 'prepared-train')
}

function resolveTrainingOutputDir(runtimeTrainingDir) {
  return path.join(runtimeTrainingDir, 'trained-adapter')
}

function resolveHoldoutDir(runtimeTrainingDir, evaluationFlips) {
  return path.join(runtimeTrainingDir, `holdout-${evaluationFlips}`)
}

function resolveBaselineEvaluationPath(runtimeTrainingDir, evaluationFlips) {
  return path.join(runtimeTrainingDir, `baseline-eval-${evaluationFlips}.json`)
}

function resolveTrainedEvaluationPath(runtimeTrainingDir, evaluationFlips) {
  return path.join(runtimeTrainingDir, `trained-eval-${evaluationFlips}.json`)
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return null
  }

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function normalizeAccuracy(value) {
  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100
  }

  return null
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizePositiveInteger(value, fallback, min = 1, max = Infinity) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

function normalizeRunStopMode(value) {
  const stopMode = String(value || '')
    .trim()
    .toLowerCase()

  return RUN_STOP_MODE_OPTIONS.has(stopMode) ? stopMode : DEFAULT_RUN_STOP_MODE
}

function roundTelemetryValue(value, precision = 1) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  const factor = 10 ** precision
  return Math.round(parsed * factor) / factor
}

function normalizeEvaluationFlips(value) {
  const parsed = normalizeInteger(value)
  return ALLOWED_EVALUATION_FLIPS.includes(parsed)
    ? parsed
    : DEFAULT_EVALUATION_FLIPS
}

function normalizeDeveloperLocalTrainingThermalMode(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()

  return Object.prototype.hasOwnProperty.call(
    LOCAL_TRAINING_THERMAL_MODE_CONFIG,
    nextValue
  )
    ? nextValue
    : DEFAULT_LOCAL_TRAINING_THERMAL_MODE
}

function normalizeDeveloperLocalTrainingProfile(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()

  return ALLOWED_LOCAL_TRAINING_PROFILES.has(nextValue) ? nextValue : null
}

function resolveThermalThrottle(mode) {
  const normalizedMode = normalizeDeveloperLocalTrainingThermalMode(mode)
  const config =
    LOCAL_TRAINING_THERMAL_MODE_CONFIG[normalizedMode] ||
    LOCAL_TRAINING_THERMAL_MODE_CONFIG[DEFAULT_LOCAL_TRAINING_THERMAL_MODE]

  return {
    localTrainingThermalMode: normalizedMode,
    stepCooldownMs: config.stepCooldownMs,
    epochCooldownMs: config.epochCooldownMs,
    benchmarkCooldownMs: config.benchmarkCooldownMs,
  }
}

async function writeJsonAtomic(targetPath, value) {
  const nextPath = `${targetPath}.${process.pid}.tmp`
  await fs.promises.mkdir(path.dirname(targetPath), {recursive: true})
  await fs.promises.writeFile(nextPath, JSON.stringify(value, null, 2), 'utf8')
  await fs.promises.rename(nextPath, targetPath)
}

function resolveRunThermalControls({
  localTrainingThermalMode,
  localBenchmarkThermalMode,
  stopMode,
} = {}) {
  const training = resolveThermalThrottle(localTrainingThermalMode)
  const benchmark = resolveThermalThrottle(
    localBenchmarkThermalMode || localTrainingThermalMode
  )

  return {
    trainingThermalMode: training.localTrainingThermalMode,
    benchmarkThermalMode: benchmark.localTrainingThermalMode,
    trainingStepCooldownMs: training.stepCooldownMs,
    trainingEpochCooldownMs: training.epochCooldownMs,
    benchmarkCooldownMs: benchmark.benchmarkCooldownMs,
    stopMode: normalizeRunStopMode(stopMode),
    updatedAt: new Date().toISOString(),
  }
}

async function writeRunControlFile(controlPath, controls = {}) {
  if (!controlPath) {
    return null
  }

  const nextControls =
    controls && typeof controls === 'object' && !Array.isArray(controls)
      ? controls
      : {}
  await writeJsonAtomic(controlPath, nextControls)
  return nextControls
}

function readMetric(source, candidates = []) {
  for (const pathParts of candidates) {
    let current = source

    for (const part of pathParts) {
      if (
        !current ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        typeof current[part] === 'undefined'
      ) {
        current = undefined
        break
      }

      current = current[part]
    }

    if (typeof current !== 'undefined') {
      return current
    }
  }

  return undefined
}

function resolveCommandParts() {
  if (cachedPythonCommand) {
    return cachedPythonCommand
  }

  const repoRoot = resolveRepoRoot()
  const repoPython311 = path.join(
    repoRoot,
    '.tmp',
    'flip-train-venv-py311',
    'bin',
    'python'
  )
  const repoPython = path.join(
    repoRoot,
    '.tmp',
    'flip-train-venv',
    'bin',
    'python'
  )
  const benchmarkerPython = path.join(
    path.resolve(repoRoot, '..', 'IdenaAI_Benchmarker'),
    '.tmp',
    'flip-train-venv',
    'bin',
    'python'
  )
  const candidates = PYTHON_COMMAND_CANDIDATES.concat([
    fs.existsSync(repoPython311) ? repoPython311 : null,
    fs.existsSync(repoPython) ? repoPython : null,
    fs.existsSync(benchmarkerPython) ? benchmarkerPython : null,
    process.platform === 'win32' ? 'py -3.11' : 'python3.11',
    process.platform === 'win32' ? 'py -3' : 'python3',
  ])

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()

    if (normalized) {
      const parts = normalized.split(/\s+/u).filter(Boolean)

      if (parts.length > 0) {
        const variants = []
        const direct = {
          command: parts[0],
          prefixArgs: parts.slice(1),
          configured: normalized,
        }

        variants.push(direct)

        if (
          process.platform === 'darwin' &&
          process.arch === 'x64' &&
          direct.command !== 'arch'
        ) {
          variants.push({
            command: 'arch',
            prefixArgs: ['-arm64', direct.command].concat(direct.prefixArgs),
            configured: `arch -arm64 ${normalized}`,
          })
        }

        for (const variant of variants) {
          const probe = spawnSync(
            variant.command,
            variant.prefixArgs.concat([
              '-c',
              'import numpy, datasets; print("ok")',
            ]),
            {
              encoding: 'utf8',
            }
          )

          if (probe.status === 0) {
            cachedPythonCommand = variant
            return cachedPythonCommand
          }
        }
      }
    }
  }

  cachedPythonCommand = {
    command: 'python3',
    prefixArgs: [],
    configured: 'python3',
  }

  return cachedPythonCommand
}

function resolveTrainingModelPath() {
  const explicit = String(
    process.env.IDENAAI_LOCAL_TRAINING_MODEL_PATH ||
      process.env.IDENAAI_LOCAL_TRAINING_MODEL ||
      ''
  ).trim()

  return explicit || DEFAULT_TRAINING_MODEL_PATH
}

function resolveApprovedTrainingModelPaths() {
  return new Set(
    [resolveTrainingModelPath(), DEFAULT_TRAINING_MODEL_PATH]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )
}

function parseEnvInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseEnvFloat(name, fallback) {
  const parsed = Number.parseFloat(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function ensureInsideDir(baseDir, targetPath) {
  const resolvedBaseDir = path.resolve(String(baseDir || ''))
  const resolvedTargetPath = path.resolve(String(targetPath || ''))

  if (!resolvedBaseDir || !resolvedTargetPath) {
    throw new Error('Developer training paths must be resolved explicitly')
  }

  if (
    resolvedTargetPath !== resolvedBaseDir &&
    !resolvedTargetPath.startsWith(`${resolvedBaseDir}${path.sep}`)
  ) {
    throw new Error('Developer training path escaped the managed workspace')
  }

  return resolvedTargetPath
}

function createOutputCollector(maxBytes = MAX_STDIO_CAPTURE_BYTES) {
  const chunks = []
  let size = 0
  let truncated = false

  return {
    append(chunk) {
      const buffer = Buffer.from(chunk)

      if (!buffer.length) {
        return
      }

      if (size >= maxBytes) {
        truncated = true
        return
      }

      const remaining = maxBytes - size

      if (buffer.length > remaining) {
        chunks.push(buffer.subarray(0, remaining))
        size += remaining
        truncated = true
        return
      }

      chunks.push(buffer)
      size += buffer.length
    },
    toString() {
      const text = Buffer.concat(chunks).toString('utf8')
      return truncated ? `${text}\n...[truncated]` : text
    },
  }
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, {recursive: true})
  return dirPath
}

async function exists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readJsonIfExists(filePath, fallbackValue = null) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue
    }

    throw error
  }
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath))
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  )

  return filePath
}

function createProcessError(message, extra = {}) {
  const error = new Error(message)
  Object.assign(error, extra)
  return error
}

function createLineEmitter(
  onLine,
  maxBufferChars = MAX_PROGRESS_LINE_BUFFER_CHARS
) {
  let buffer = ''
  let overflow = false

  return {
    append(chunk) {
      if (typeof onLine !== 'function') {
        return
      }

      const nextText = Buffer.from(chunk).toString('utf8')

      if (!nextText) {
        return
      }

      if (overflow) {
        const overflowNewlineIndex = nextText.indexOf('\n')

        if (overflowNewlineIndex === -1) {
          return
        }

        overflow = false
        buffer = ''

        const remainingText = nextText.slice(overflowNewlineIndex + 1)
        if (remainingText) {
          this.append(remainingText)
        }
        return
      }

      buffer += nextText
      let newlineIndex = buffer.indexOf('\n')

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)

        if (line.trim()) {
          try {
            onLine(line)
          } catch {
            // Ignore progress parsing errors and keep the child process running.
          }
        }

        newlineIndex = buffer.indexOf('\n')
      }

      if (buffer.length > maxBufferChars) {
        buffer = ''
        overflow = true
      }
    },
    flush() {
      if (overflow) {
        buffer = ''
        overflow = false
        return
      }

      const line = buffer.replace(/\r$/, '').trim()

      if (!line || typeof onLine !== 'function') {
        return
      }

      try {
        onLine(line)
      } catch {
        // Ignore progress parsing errors and keep the child process running.
      }
    },
  }
}

async function runPythonScript({
  scriptPath,
  args = [],
  cwd,
  env = process.env,
  timeoutMs,
  logger,
  label,
  onStdoutLine,
  onStderrLine,
  runControl = null,
}) {
  const {command, prefixArgs, configured} = resolveCommandParts()
  const finalArgs = prefixArgs.concat([scriptPath]).concat(args)
  const targetLabel = String(label || path.basename(scriptPath)).trim()

  if (runControl && runControl.cancelRequested === true) {
    throw createProcessError(
      String(runControl.cancelReason || 'Local run stopped by user'),
      {
        status: 'stopped',
        stopped: true,
        command,
        args: finalArgs,
      }
    )
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, finalArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdoutCollector = createOutputCollector()
    const stderrCollector = createOutputCollector()
    const stdoutLineEmitter = createLineEmitter(onStdoutLine)
    const stderrLineEmitter = createLineEmitter(onStderrLine)
    let settled = false
    let timeoutId = null
    let forceKillId = null
    const clearRunControlChild = () => {
      if (runControl && runControl.currentChild === child) {
        runControl.currentChild = null
      }
    }

    if (runControl) {
      runControl.currentChild = child

      if (runControl.cancelRequested === true) {
        try {
          child.kill('SIGTERM')
        } catch {
          // Best effort stop during startup.
        }
      }
    }

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

      clearRunControlChild()

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

      clearRunControlChild()

      reject(error)
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutCollector.append(chunk)
        stdoutLineEmitter.append(chunk)
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrCollector.append(chunk)
        stderrLineEmitter.append(chunk)
      })
    }

    child.once('error', (error) => {
      fail(
        createProcessError(
          `${targetLabel} could not start with ${configured}: ${error.message}`,
          {
            status: 'spawn_failed',
            command,
            args: finalArgs,
            stdout: stdoutCollector.toString(),
            stderr: stderrCollector.toString(),
          }
        )
      )
    })

    child.once('exit', (code, signal) => {
      if (forceKillId) {
        clearTimeout(forceKillId)
      }

      stdoutLineEmitter.flush()
      stderrLineEmitter.flush()

      const stdout = stdoutCollector.toString()
      const stderr = stderrCollector.toString()
      const stoppedByUser = runControl && runControl.cancelRequested === true

      if (code === 0 && !stoppedByUser) {
        finalize({
          ok: true,
          command,
          configuredCommand: configured,
          args: finalArgs,
          stdout,
          stderr,
        })
        return
      }

      if (stoppedByUser) {
        fail(
          createProcessError(
            String(runControl.cancelReason || 'Local run stopped by user'),
            {
              status: 'stopped',
              stopped: true,
              command,
              args: finalArgs,
              exitCode: code,
              signal,
              stdout,
              stderr,
            }
          )
        )
        return
      }

      const message =
        stderr.trim() ||
        stdout.trim() ||
        `${targetLabel} failed with exit code ${
          code == null ? 'unknown' : code
        }`

      fail(
        createProcessError(message, {
          status: signal ? 'terminated' : 'failed',
          command,
          args: finalArgs,
          exitCode: code,
          signal,
          stdout,
          stderr,
        })
      )
    })

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          // Best effort timeout cleanup.
        }

        fail(
          createProcessError(`${targetLabel} timed out after ${timeoutMs}ms`, {
            status: 'timeout',
            command,
            args: finalArgs,
            stdout: stdoutCollector.toString(),
            stderr: stderrCollector.toString(),
          })
        )

        forceKillId = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // Best effort forced cleanup.
          }
        }, 2000)
      }, timeoutMs)
    }

    if (logger && typeof logger.debug === 'function') {
      logger.debug('Developer FLIP training command started', {
        label: targetLabel,
        cwd,
        command,
        args: finalArgs,
      })
    }
  })
}

function normalizeTrainingRequest(input = {}) {
  const source =
    input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const requestedModelPath = String(
    source.trainingModelPath || source.modelPath || ''
  ).trim()
  const approvedTrainingModelPaths = resolveApprovedTrainingModelPaths()

  return {
    developerHumanTeacher: source.developerHumanTeacher === true,
    sampleName: String(source.sampleName || '').trim(),
    trainingModelPath:
      requestedModelPath && approvedTrainingModelPaths.has(requestedModelPath)
        ? requestedModelPath
        : null,
    localTrainingProfile: normalizeDeveloperLocalTrainingProfile(
      source.localTrainingProfile
    ),
    localTrainingThermalMode: normalizeDeveloperLocalTrainingThermalMode(
      source.localTrainingThermalMode
    ),
    localBenchmarkThermalMode: normalizeDeveloperLocalTrainingThermalMode(
      source.localBenchmarkThermalMode || source.localTrainingThermalMode
    ),
    localTrainingEpochs: normalizePositiveInteger(
      source.localTrainingEpochs,
      DEFAULT_TRAINING_EPOCHS,
      1,
      6
    ),
    localTrainingBatchSize: normalizePositiveInteger(
      source.localTrainingBatchSize,
      DEFAULT_TRAINING_BATCH_SIZE,
      1,
      4
    ),
    localTrainingLoraRank: normalizePositiveInteger(
      source.localTrainingLoraRank,
      DEFAULT_TRAINING_LORA_RANK,
      4,
      16
    ),
    annotatedAnnotationsPath:
      String(source.annotatedAnnotationsPath || '').trim() || null,
    pendingAnnotationsPath:
      String(source.pendingAnnotationsPath || '').trim() || null,
    trainedAnnotationsPath:
      String(source.trainedAnnotationsPath || '').trim() || null,
    developerStatePath: String(source.developerStatePath || '').trim() || null,
    comparisonPath: String(source.comparisonPath || '').trim() || null,
    normalizedAnnotationsPath:
      String(source.normalizedAnnotationsPath || '').trim() || null,
    compareOnly: source.compareOnly === true || source.comparisonOnly === true,
    evaluationFlips: normalizeEvaluationFlips(source.evaluationFlips),
  }
}

function createRunProgressStages(kind) {
  if (kind === 'comparison') {
    return {
      prepare_holdout: {from: 0, to: 15, stageIndex: 1, stageCount: 3},
      benchmark_baseline: {from: 15, to: 55, stageIndex: 2, stageCount: 3},
      benchmark_adapter: {from: 55, to: 100, stageIndex: 3, stageCount: 3},
    }
  }

  return {
    prepare_training_dataset: {from: 0, to: 10, stageIndex: 1, stageCount: 5},
    train_adapter: {from: 10, to: 55, stageIndex: 2, stageCount: 5},
    prepare_holdout: {from: 55, to: 65, stageIndex: 3, stageCount: 5},
    benchmark_baseline: {from: 65, to: 82.5, stageIndex: 4, stageCount: 5},
    benchmark_adapter: {from: 82.5, to: 100, stageIndex: 5, stageCount: 5},
  }
}

function interpolateStageProgress(stageConfig, fraction = 0) {
  if (!stageConfig) {
    return null
  }

  const safeFraction = Math.min(1, Math.max(0, Number(fraction) || 0))
  return roundTelemetryValue(
    stageConfig.from + (stageConfig.to - stageConfig.from) * safeFraction,
    1
  )
}

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') {
    return
  }

  try {
    onProgress(payload)
  } catch {
    // Ignore progress delivery errors so training can continue.
  }
}

function parseJsonLine(line) {
  const text = String(line || '').trim()

  if (!text || !text.startsWith('{') || !text.endsWith('}')) {
    return null
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

function buildComparisonSummary({
  modelPath,
  adapterPath,
  holdoutPath,
  baselineResult,
  trainedResult,
  comparisonPath,
  baselineResultPath,
  trainedResultPath,
}) {
  const baselineAccuracy = normalizeAccuracy(
    readMetric(baselineResult, [['accuracy']])
  )
  const trainedAccuracy = normalizeAccuracy(
    readMetric(trainedResult, [['accuracy']])
  )
  const baselineCorrect = normalizeInteger(
    readMetric(baselineResult, [['correct']])
  )
  const trainedCorrect = normalizeInteger(
    readMetric(trainedResult, [['correct']])
  )
  const baselineTotal = normalizeInteger(
    readMetric(baselineResult, [['totalFlips'], ['examples']])
  )
  const trainedTotal = normalizeInteger(
    readMetric(trainedResult, [['totalFlips'], ['examples']])
  )
  const evaluatedAt =
    normalizeIsoDate(
      readMetric(trainedResult, [['evaluatedAt'], ['generatedAt']])
    ) || new Date().toISOString()

  return {
    ok: true,
    status: DEFAULT_COMPARISON_STATUS,
    trainingBackend: 'mlx_vlm_local',
    modelPath,
    adapterPath,
    holdoutPath,
    comparisonPath,
    evaluatedAt,
    baseline: {
      accuracy: baselineAccuracy,
      correct: baselineCorrect,
      totalFlips: baselineTotal,
      resultPath: baselineResultPath || null,
    },
    trained: {
      accuracy: trainedAccuracy,
      correct: trainedCorrect,
      totalFlips: trainedTotal,
      resultPath: trainedResultPath || null,
    },
    baselineAccuracy,
    accuracy: trainedAccuracy,
    correct: trainedCorrect,
    totalFlips: trainedTotal,
    deltaAccuracy:
      trainedAccuracy !== null && baselineAccuracy !== null
        ? Number((trainedAccuracy - baselineAccuracy).toFixed(6))
        : null,
  }
}

function hasUsableComparisonMetrics(summary = {}) {
  return (
    summary &&
    typeof summary === 'object' &&
    !Array.isArray(summary) &&
    (summary.accuracy !== null ||
      (summary.correct !== null && summary.totalFlips !== null))
  )
}

function extractFailureReason(error) {
  const candidates = [
    error && error.message,
    error && error.stderr,
    error && error.stdout,
    error && error.status,
  ]

  for (const candidate of candidates) {
    const message = String(candidate || '').trim()

    if (message) {
      return message.slice(0, 800)
    }
  }

  return 'Developer FLIP training failed'
}

function formatTrainingFailureReason(error, modelPath) {
  const rawReason = extractFailureReason(error)
  const stderr = String(error && error.stderr ? error.stderr : '').trim()
  const stdout = String(error && error.stdout ? error.stdout : '').trim()
  const combined = `${rawReason}\n${stderr}\n${stdout}`

  if (
    looksLikeQwen35ModelPath(modelPath) &&
    /qwen3_5|No module named 'mlx_vlm\.models\.qwen3_5'|Model type qwen3_5 not supported/i.test(
      combined
    )
  ) {
    return [
      'Qwen3.5 local MLX training requires a newer mlx-vlm build than the current training environment provides.',
      'Use Python 3.11 or newer, create a dedicated training venv, and install an mlx-vlm release that includes qwen3_5 support.',
      'Recommended setup: python3.11 -m venv .tmp/flip-train-venv-py311',
    ].join(' ')
  }

  return rawReason
}

function createDeveloperTrainingRunner({logger, isDev = false} = {}) {
  const repoRoot = resolveRepoRoot()
  const scriptsDir = path.join(repoRoot, 'scripts')
  const samplesDir = path.join(repoRoot, 'samples', 'flips')
  const prepareDeveloperScript = path.join(
    scriptsDir,
    'prepare_developer_human_teacher_mlx_vlm.py'
  )
  const prepareHoldoutScript = path.join(
    scriptsDir,
    'prepare_flip_challenge_mlx_vlm.py'
  )
  const trainScript = path.join(scriptsDir, 'train_flip_challenge_mlx_vlm.py')
  const evaluateScript = path.join(
    scriptsDir,
    'evaluate_flip_challenge_mlx_vlm.py'
  )
  let activeRunControl = null

  function assertRunNotCancelled(runControl) {
    if (!runControl || runControl.cancelRequested !== true) {
      return
    }

    throw createProcessError(
      String(runControl.cancelReason || 'Local run stopped by user'),
      {
        status: 'stopped',
        stopped: true,
      }
    )
  }

  async function ensureScriptAvailable(scriptPath) {
    if (!(await exists(scriptPath))) {
      throw new Error(`Missing developer training script: ${scriptPath}`)
    }

    return scriptPath
  }

  async function ensureHoldoutDataset({
    runtimeTrainingDir,
    evaluationFlips,
    onProgress = null,
    kind = 'training',
    runControl = null,
  }) {
    assertRunNotCancelled(runControl)
    const stages = createRunProgressStages(kind)
    const holdoutStage = stages.prepare_holdout
    const holdoutDir = resolveHoldoutDir(runtimeTrainingDir, evaluationFlips)
    const datasetPath = path.join(holdoutDir, 'hf-dataset')
    const manifestPath = path.join(holdoutDir, 'manifest.json')
    const existingManifest = await readJsonIfExists(manifestPath, null)

    emitProgress(onProgress, {
      kind,
      status: 'running',
      stage: 'prepare_holdout',
      stageIndex: holdoutStage.stageIndex,
      stageCount: holdoutStage.stageCount,
      progressPercent: interpolateStageProgress(holdoutStage, 0.1),
      benchmarkTotal: evaluationFlips,
      evaluationFlips,
      message: 'Preparing the unseen benchmark flips',
    })

    if (
      (await exists(datasetPath)) &&
      existingManifest &&
      normalizeInteger(existingManifest.count) === evaluationFlips
    ) {
      emitProgress(onProgress, {
        kind,
        status: 'running',
        stage: 'prepare_holdout',
        stageIndex: holdoutStage.stageIndex,
        stageCount: holdoutStage.stageCount,
        progressPercent: interpolateStageProgress(holdoutStage, 1),
        benchmarkTotal: evaluationFlips,
        evaluationFlips,
        message: 'Reusing the saved unseen benchmark flips',
      })
      return {
        holdoutDir,
        datasetPath,
        manifestPath,
        manifest: existingManifest,
        rebuilt: false,
      }
    }

    await ensureScriptAvailable(prepareHoldoutScript)
    await ensureDir(runtimeTrainingDir)
    await runPythonScript({
      scriptPath: prepareHoldoutScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_PREPARE_TIMEOUT_MS,
      logger,
      runControl,
      label: 'prepare developer holdout dataset',
      args: [
        '--split',
        'validation',
        '--max-flips',
        String(evaluationFlips),
        '--output-dir',
        holdoutDir,
        '--prompt-family',
        'runtime_aligned_native_frames_v2',
        '--image-mode',
        'native_frames',
        '--balance-canonical-answers',
      ],
    })

    emitProgress(onProgress, {
      kind,
      status: 'running',
      stage: 'prepare_holdout',
      stageIndex: holdoutStage.stageIndex,
      stageCount: holdoutStage.stageCount,
      progressPercent: interpolateStageProgress(holdoutStage, 1),
      benchmarkTotal: evaluationFlips,
      evaluationFlips,
      message: 'Unseen benchmark flips are ready',
    })

    return {
      holdoutDir,
      datasetPath,
      manifestPath,
      manifest: await readJsonIfExists(manifestPath, null),
      rebuilt: true,
    }
  }

  async function prepareTrainingDataset({
    runtimeTrainingDir,
    sampleName,
    annotationsJsonlPath,
    humanTeacherSystemPrompt = '',
    onProgress = null,
    runControl = null,
  }) {
    assertRunNotCancelled(runControl)
    const sampleJsonPath = path.join(samplesDir, `${sampleName}.json`)

    if (!(await exists(sampleJsonPath))) {
      throw new Error(`Missing developer sample JSON: ${sampleJsonPath}`)
    }

    if (!(await exists(annotationsJsonlPath))) {
      throw new Error(
        `Missing developer annotations JSONL: ${annotationsJsonlPath}`
      )
    }

    const preparedDir = resolveTrainingDatasetDir(runtimeTrainingDir)
    const datasetPath = path.join(preparedDir, 'hf-dataset')
    const manifestPath = path.join(preparedDir, 'manifest.json')
    const stages = createRunProgressStages('training')
    const prepareStage = stages.prepare_training_dataset

    emitProgress(onProgress, {
      kind: 'training',
      status: 'running',
      stage: 'prepare_training_dataset',
      stageIndex: prepareStage.stageIndex,
      stageCount: prepareStage.stageCount,
      progressPercent: interpolateStageProgress(prepareStage, 0.1),
      message: 'Preparing the 5-flip training pack',
    })

    await ensureScriptAvailable(prepareDeveloperScript)
    await runPythonScript({
      scriptPath: prepareDeveloperScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_PREPARE_TIMEOUT_MS,
      logger,
      runControl,
      label: 'prepare developer training dataset',
      args: [
        '--sample-name',
        sampleName,
        '--sample-json-path',
        sampleJsonPath,
        '--annotations-jsonl',
        annotationsJsonlPath,
        '--output-dir',
        preparedDir,
        '--prompt-family',
        'runtime_aligned_native_frames_v2',
        '--image-mode',
        'native_frames',
      ].concat(
        String(humanTeacherSystemPrompt || '').trim()
          ? [
              '--human-teacher-system-prompt',
              String(humanTeacherSystemPrompt || '').trim(),
            ]
          : []
      ),
    })

    const manifest = await readJsonIfExists(manifestPath, null)

    emitProgress(onProgress, {
      kind: 'training',
      status: 'running',
      stage: 'prepare_training_dataset',
      stageIndex: prepareStage.stageIndex,
      stageCount: prepareStage.stageCount,
      progressPercent: interpolateStageProgress(prepareStage, 1),
      message: 'Training pack is ready',
    })

    return {
      preparedDir,
      datasetPath,
      manifestPath,
      manifest,
      sampleJsonPath,
    }
  }

  async function runTraining({
    runtimeTrainingDir,
    datasetPath,
    modelPath,
    localTrainingThermalMode,
    localTrainingEpochs,
    localTrainingBatchSize,
    localTrainingLoraRank,
    datasetExampleCount = 0,
    onProgress = null,
    runControl = null,
  }) {
    assertRunNotCancelled(runControl)
    const outputDir = resolveTrainingOutputDir(runtimeTrainingDir)
    const steps = parseEnvInteger('IDENAAI_DEVELOPER_TRAIN_STEPS', 0)
    const epochs = normalizePositiveInteger(
      localTrainingEpochs,
      parseEnvInteger(
        'IDENAAI_DEVELOPER_TRAIN_EPOCHS',
        DEFAULT_TRAINING_EPOCHS
      ),
      1,
      6
    )
    const batchSize = normalizePositiveInteger(
      localTrainingBatchSize,
      parseEnvInteger(
        'IDENAAI_DEVELOPER_TRAIN_BATCH_SIZE',
        DEFAULT_TRAINING_BATCH_SIZE
      ),
      1,
      4
    )
    const learningRate = parseEnvFloat(
      'IDENAAI_DEVELOPER_TRAIN_LEARNING_RATE',
      DEFAULT_TRAINING_LEARNING_RATE
    )
    const loraRank = normalizePositiveInteger(
      localTrainingLoraRank,
      parseEnvInteger(
        'IDENAAI_DEVELOPER_TRAIN_LORA_RANK',
        DEFAULT_TRAINING_LORA_RANK
      ),
      4,
      16
    )
    const thermalThrottle = resolveThermalThrottle(localTrainingThermalMode)
    const stepCooldownMs =
      normalizeInteger(process.env.IDENAAI_DEVELOPER_TRAIN_STEP_COOLDOWN_MS) ??
      thermalThrottle.stepCooldownMs
    const epochCooldownMs =
      normalizeInteger(process.env.IDENAAI_DEVELOPER_TRAIN_EPOCH_COOLDOWN_MS) ??
      thermalThrottle.epochCooldownMs
    const stepsPerEpoch =
      steps ||
      Math.max(1, Math.ceil(Math.max(1, datasetExampleCount || 1) / batchSize))
    const totalSteps = Math.max(1, stepsPerEpoch * epochs)
    const stages = createRunProgressStages('training')
    const trainingStage = stages.train_adapter

    emitProgress(onProgress, {
      kind: 'training',
      status: 'running',
      stage: 'train_adapter',
      stageIndex: trainingStage.stageIndex,
      stageCount: trainingStage.stageCount,
      progressPercent: interpolateStageProgress(trainingStage, 0),
      totalEpochs: epochs,
      stepsPerEpoch,
      totalSteps,
      message: 'Training the local adapter on this 5-flip pack',
    })

    await ensureScriptAvailable(trainScript)
    await runPythonScript({
      scriptPath: trainScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_TRAIN_TIMEOUT_MS,
      logger,
      runControl,
      label: 'train developer FLIP adapter',
      onStdoutLine: (line) => {
        const event = parseJsonLine(line)

        if (
          !event ||
          !Number.isFinite(Number(event.epoch)) ||
          !Number.isFinite(Number(event.step))
        ) {
          return
        }

        const currentEpoch = Math.max(1, Number.parseInt(event.epoch, 10))
        const currentStep = Math.max(1, Number.parseInt(event.step, 10))
        const completedSteps =
          (currentEpoch - 1) * stepsPerEpoch +
          Math.min(currentStep, stepsPerEpoch)
        const fraction =
          totalSteps > 0 ? Math.min(1, completedSteps / totalSteps) : 0

        emitProgress(onProgress, {
          kind: 'training',
          status: 'running',
          stage: 'train_adapter',
          stageIndex: trainingStage.stageIndex,
          stageCount: trainingStage.stageCount,
          progressPercent: interpolateStageProgress(trainingStage, fraction),
          currentEpoch,
          totalEpochs: epochs,
          currentStep,
          stepsPerEpoch,
          totalSteps,
          latestLoss: Number.isFinite(Number(event.loss))
            ? Number(event.loss)
            : null,
          message: 'Training the local adapter on this 5-flip pack',
        })
      },
      args: [
        '--dataset-path',
        datasetPath,
        '--model-path',
        modelPath,
        '--output-dir',
        outputDir,
        '--epochs',
        String(epochs),
        '--batch-size',
        String(batchSize),
        '--learning-rate',
        String(learningRate),
        '--lora-rank',
        String(loraRank),
        '--step-cooldown-ms',
        String(stepCooldownMs),
        '--epoch-cooldown-ms',
        String(epochCooldownMs),
        '--run-control-path',
        String(runControl?.controlPath || ''),
      ].concat(steps > 0 ? ['--steps', String(steps)] : []),
    })

    const adapterPath = path.join(outputDir, 'adapters.safetensors')
    const summaryPath = path.join(outputDir, 'run-summary.json')

    if (!(await exists(adapterPath))) {
      throw new Error(
        'Developer FLIP training did not produce adapters.safetensors'
      )
    }

    return {
      outputDir,
      adapterPath,
      summaryPath,
      summary: await readJsonIfExists(summaryPath, null),
      stepsPerEpoch,
      totalSteps,
      localTrainingThermalMode: thermalThrottle.localTrainingThermalMode,
      localTrainingEpochs: epochs,
      localTrainingBatchSize: batchSize,
      localTrainingLoraRank: loraRank,
      stepCooldownMs,
      epochCooldownMs,
    }
  }

  async function runEvaluation({
    datasetPath,
    modelPath,
    adapterPath = null,
    outputPath,
    evaluationFlips,
    localBenchmarkThermalMode,
    label,
    kind = 'training',
    phase = 'benchmark_baseline',
    onProgress = null,
    runControl = null,
  }) {
    assertRunNotCancelled(runControl)
    const stages = createRunProgressStages(kind)
    const stage = stages[phase]
    emitProgress(onProgress, {
      kind,
      status: 'running',
      stage: phase,
      stageIndex: stage.stageIndex,
      stageCount: stage.stageCount,
      progressPercent: interpolateStageProgress(stage, 0),
      benchmarkPhase: phase === 'benchmark_adapter' ? 'adapter' : 'baseline',
      benchmarkCurrent: 0,
      benchmarkTotal: evaluationFlips,
      evaluationFlips,
      message:
        phase === 'benchmark_adapter'
          ? 'Scoring unseen flips with the trained adapter'
          : 'Scoring unseen flips with the baseline model',
    })
    const thermalThrottle = resolveThermalThrottle(localBenchmarkThermalMode)
    const benchmarkCooldownMs =
      normalizeInteger(process.env.IDENAAI_DEVELOPER_BENCHMARK_COOLDOWN_MS) ??
      thermalThrottle.benchmarkCooldownMs
    await ensureScriptAvailable(evaluateScript)
    await runPythonScript({
      scriptPath: evaluateScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_EVALUATE_TIMEOUT_MS,
      logger,
      runControl,
      label,
      onStdoutLine: (line) => {
        const event = parseJsonLine(line)

        if (!event || !Number.isFinite(Number(event.index))) {
          return
        }

        const benchmarkCurrent = Math.max(1, Number.parseInt(event.index, 10))
        const fraction =
          evaluationFlips > 0
            ? Math.min(1, benchmarkCurrent / evaluationFlips)
            : 0

        emitProgress(onProgress, {
          kind,
          status: 'running',
          stage: phase,
          stageIndex: stage.stageIndex,
          stageCount: stage.stageCount,
          progressPercent: interpolateStageProgress(stage, fraction),
          benchmarkPhase:
            phase === 'benchmark_adapter' ? 'adapter' : 'baseline',
          benchmarkCurrent,
          benchmarkTotal: evaluationFlips,
          evaluationFlips,
          currentFlipHash: String(event.flipHash || '').trim() || null,
          message:
            phase === 'benchmark_adapter'
              ? 'Scoring unseen flips with the trained adapter'
              : 'Scoring unseen flips with the baseline model',
        })
      },
      args: [
        '--dataset-path',
        datasetPath,
        '--model-path',
        modelPath,
        '--output',
        outputPath,
        '--mode',
        'score',
        '--example-cooldown-ms',
        String(benchmarkCooldownMs),
        '--run-control-path',
        String(runControl?.controlPath || ''),
      ].concat(adapterPath ? ['--adapter-path', adapterPath] : []),
    })

    const result = await readJsonIfExists(outputPath, null)

    if (!result) {
      throw new Error(`Missing evaluation report: ${outputPath}`)
    }

    return {
      result,
      outputPath,
      evaluationFlips,
      benchmarkCooldownMs,
    }
  }

  async function writeTrainingMetadata(metadataPath, payload) {
    const nextPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {}
    await writeJson(metadataPath, nextPayload)
    return nextPayload
  }

  async function loadTrainingMetadata(metadataPath) {
    const metadata = await readJsonIfExists(metadataPath, null)
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {}
  }

  async function buildComparison({
    runtimeTrainingDir,
    modelPath,
    adapterPath,
    evaluationFlips,
    comparisonPath,
    localBenchmarkThermalMode,
    kind = 'training',
    onProgress = null,
    runControl = null,
  }) {
    assertRunNotCancelled(runControl)
    const holdout = await ensureHoldoutDataset({
      runtimeTrainingDir,
      evaluationFlips,
      onProgress,
      kind,
      runControl,
    })
    const baselinePath = resolveBaselineEvaluationPath(
      runtimeTrainingDir,
      evaluationFlips
    )
    const trainedPath = resolveTrainedEvaluationPath(
      runtimeTrainingDir,
      evaluationFlips
    )
    const baselineEval = await runEvaluation({
      datasetPath: holdout.datasetPath,
      modelPath,
      outputPath: baselinePath,
      evaluationFlips,
      localBenchmarkThermalMode,
      label: 'evaluate developer FLIP baseline',
      kind,
      phase: 'benchmark_baseline',
      onProgress,
      runControl,
    })
    const trainedEval = await runEvaluation({
      datasetPath: holdout.datasetPath,
      modelPath,
      adapterPath,
      outputPath: trainedPath,
      evaluationFlips,
      localBenchmarkThermalMode,
      label: 'evaluate developer FLIP adapter',
      kind,
      phase: 'benchmark_adapter',
      onProgress,
      runControl,
    })
    const summary = buildComparisonSummary({
      modelPath,
      adapterPath,
      holdoutPath: holdout.datasetPath,
      baselineResult: baselineEval.result,
      trainedResult: trainedEval.result,
      comparisonPath,
      baselineResultPath: baselinePath,
      trainedResultPath: trainedPath,
    })

    if (!hasUsableComparisonMetrics(summary)) {
      throw new Error(
        'The local comparison finished without benchmark metrics.'
      )
    }

    await writeJson(comparisonPath, summary)

    return {
      holdout,
      baselineEval,
      trainedEval,
      summary,
    }
  }

  async function runEpoch(payload = {}) {
    const request = normalizeTrainingRequest(payload.input || payload)
    const onProgress =
      typeof payload.onProgress === 'function' ? payload.onProgress : null
    const runControl = {
      kind: request.compareOnly ? 'comparison' : 'training',
      sampleName: request.sampleName,
      cancelRequested: false,
      cancelReason: '',
      stopMode: DEFAULT_RUN_STOP_MODE,
      currentChild: null,
      controlPath: null,
      trainingThermalMode: null,
      benchmarkThermalMode: null,
    }

    if (!request.developerHumanTeacher) {
      return {
        ok: false,
        status: 'unsupported_request',
        failureReason:
          'Developer training runner only handles developer human-teacher FLIP requests',
      }
    }

    const developerStatePath = String(request.developerStatePath || '').trim()

    if (!developerStatePath) {
      return {
        ok: false,
        status: 'failed',
        failureReason:
          'Developer training runner requires a developer state path',
      }
    }

    const developerDir = path.dirname(developerStatePath)
    const runtimeTrainingDir = ensureInsideDir(
      developerDir,
      resolveRuntimeTrainingDir(developerDir)
    )
    const controlPath = ensureInsideDir(
      developerDir,
      resolveRunControlPath(runtimeTrainingDir)
    )
    const metadataPath = ensureInsideDir(
      developerDir,
      resolveTrainingMetadataPath(runtimeTrainingDir)
    )
    const comparisonPath = ensureInsideDir(
      developerDir,
      request.comparisonPath ||
        path.join(
          developerDir,
          `comparison-${
            request.evaluationFlips || DEFAULT_EVALUATION_FLIPS
          }flips.json`
        )
    )
    const preferredModelPath =
      String(request.trainingModelPath || '').trim() ||
      resolveTrainingModelPath()

    try {
      activeRunControl = runControl
      const runControls = await writeRunControlFile(
        controlPath,
        resolveRunThermalControls({
          localTrainingThermalMode: request.localTrainingThermalMode,
          localBenchmarkThermalMode: request.localBenchmarkThermalMode,
          stopMode: DEFAULT_RUN_STOP_MODE,
        })
      )
      runControl.controlPath = controlPath
      runControl.trainingThermalMode = runControls.trainingThermalMode
      runControl.benchmarkThermalMode = runControls.benchmarkThermalMode
      runControl.stopMode = runControls.stopMode
      const metadata = await loadTrainingMetadata(metadataPath)

      if (request.compareOnly) {
        assertRunNotCancelled(runControl)
        const adapterPath = String(
          metadata.latestAdapterPath || metadata.adapterPath || ''
        ).trim()

        if (!adapterPath || !(await exists(adapterPath))) {
          return {
            ok: false,
            status: 'failed',
            failureReason:
              'No trained developer FLIP adapter is available yet. Train a 5-flip chunk first.',
          }
        }

        const comparisonRun = await buildComparison({
          runtimeTrainingDir,
          modelPath: String(metadata.modelPath || preferredModelPath).trim(),
          adapterPath,
          evaluationFlips: request.evaluationFlips,
          comparisonPath,
          localBenchmarkThermalMode:
            request.localBenchmarkThermalMode ||
            metadata.localBenchmarkThermalMode ||
            metadata.localTrainingThermalMode ||
            null,
          kind: 'comparison',
          onProgress,
          runControl,
        })
        await writeTrainingMetadata(metadataPath, {
          ...metadata,
          latestAdapterPath: adapterPath,
          modelPath: String(metadata.modelPath || preferredModelPath).trim(),
          localTrainingProfile:
            request.localTrainingProfile ||
            metadata.localTrainingProfile ||
            null,
          localTrainingThermalMode:
            request.localTrainingThermalMode ||
            metadata.localTrainingThermalMode ||
            null,
          localBenchmarkThermalMode:
            request.localBenchmarkThermalMode ||
            metadata.localBenchmarkThermalMode ||
            metadata.localTrainingThermalMode ||
            null,
          latestComparisonPath: comparisonPath,
          latestHoldoutPath: comparisonRun.holdout.datasetPath,
          lastEvaluatedAt: comparisonRun.summary.evaluatedAt,
        })

        return {
          ok: true,
          status: DEFAULT_COMPARISON_STATUS,
          trainingBackend: 'mlx_vlm_local',
          modelPath: String(metadata.modelPath || preferredModelPath).trim(),
          localTrainingProfile:
            request.localTrainingProfile ||
            metadata.localTrainingProfile ||
            null,
          localTrainingThermalMode:
            request.localTrainingThermalMode ||
            metadata.localTrainingThermalMode ||
            null,
          localBenchmarkThermalMode:
            request.localBenchmarkThermalMode ||
            metadata.localBenchmarkThermalMode ||
            metadata.localTrainingThermalMode ||
            null,
          adapterPath,
          comparisonPath,
          holdoutPath: comparisonRun.holdout.datasetPath,
          evaluatedAt: comparisonRun.summary.evaluatedAt,
          baselineAccuracy: comparisonRun.summary.baselineAccuracy,
          accuracy: comparisonRun.summary.accuracy,
          correct: comparisonRun.summary.correct,
          totalFlips: comparisonRun.summary.totalFlips,
          deltaAccuracy: comparisonRun.summary.deltaAccuracy,
          comparison100: comparisonRun.summary,
        }
      }

      const annotatedAnnotationsPath = ensureInsideDir(
        developerDir,
        request.annotatedAnnotationsPath ||
          request.normalizedAnnotationsPath ||
          ''
      )
      const prepared = await prepareTrainingDataset({
        runtimeTrainingDir,
        sampleName: request.sampleName,
        annotationsJsonlPath: annotatedAnnotationsPath,
        humanTeacherSystemPrompt: request.developerHumanTeacherSystemPrompt,
        onProgress,
        runControl,
      })
      const training = await runTraining({
        runtimeTrainingDir,
        datasetPath: prepared.datasetPath,
        modelPath: preferredModelPath,
        localTrainingThermalMode: request.localTrainingThermalMode,
        localTrainingEpochs: request.localTrainingEpochs,
        localTrainingBatchSize: request.localTrainingBatchSize,
        localTrainingLoraRank: request.localTrainingLoraRank,
        datasetExampleCount:
          normalizeInteger(prepared.manifest && prepared.manifest.count) || 0,
        onProgress,
        runControl,
      })
      const comparison = await buildComparison({
        runtimeTrainingDir,
        modelPath: preferredModelPath,
        adapterPath: training.adapterPath,
        evaluationFlips: request.evaluationFlips,
        comparisonPath,
        localBenchmarkThermalMode: request.localBenchmarkThermalMode || null,
        kind: 'training',
        onProgress,
        runControl,
      })

      await writeTrainingMetadata(metadataPath, {
        sampleName: request.sampleName,
        modelPath: preferredModelPath,
        localTrainingProfile: request.localTrainingProfile || null,
        localTrainingThermalMode:
          training.localTrainingThermalMode ||
          request.localTrainingThermalMode ||
          null,
        localBenchmarkThermalMode: request.localBenchmarkThermalMode || null,
        localTrainingEpochs: training.localTrainingEpochs,
        localTrainingBatchSize: training.localTrainingBatchSize,
        localTrainingLoraRank: training.localTrainingLoraRank,
        stepCooldownMs: training.stepCooldownMs,
        epochCooldownMs: training.epochCooldownMs,
        latestPreparedDatasetPath: prepared.datasetPath,
        latestPreparedManifestPath: prepared.manifestPath,
        latestAdapterPath: training.adapterPath,
        latestTrainingOutputDir: training.outputDir,
        latestTrainingSummaryPath: training.summaryPath,
        latestComparisonPath: comparisonPath,
        latestHoldoutPath: comparison.holdout.datasetPath,
        developerHumanTeacherSystemPrompt:
          String(request.developerHumanTeacherSystemPrompt || '').trim() || '',
        lastTrainedAt: new Date().toISOString(),
        lastEvaluatedAt: comparison.summary.evaluatedAt,
      })

      return {
        ok: true,
        status: DEFAULT_TRAINING_STATUS,
        trainingBackend: 'mlx_vlm_local',
        modelPath: preferredModelPath,
        localTrainingProfile: request.localTrainingProfile || null,
        localTrainingThermalMode:
          training.localTrainingThermalMode ||
          request.localTrainingThermalMode ||
          null,
        localBenchmarkThermalMode: request.localBenchmarkThermalMode || null,
        localTrainingEpochs: training.localTrainingEpochs,
        localTrainingBatchSize: training.localTrainingBatchSize,
        localTrainingLoraRank: training.localTrainingLoraRank,
        stepCooldownMs: training.stepCooldownMs,
        epochCooldownMs: training.epochCooldownMs,
        adapterPath: training.adapterPath,
        preparedDatasetPath: prepared.datasetPath,
        preparedManifestPath: prepared.manifestPath,
        trainingSummaryPath: training.summaryPath,
        developerHumanTeacherSystemPrompt:
          String(request.developerHumanTeacherSystemPrompt || '').trim() || '',
        acceptedRows:
          normalizeInteger(prepared.manifest && prepared.manifest.count) ||
          null,
        holdoutPath: comparison.holdout.datasetPath,
        comparisonPath,
        evaluatedAt: comparison.summary.evaluatedAt,
        baselineAccuracy: comparison.summary.baselineAccuracy,
        accuracy: comparison.summary.accuracy,
        correct: comparison.summary.correct,
        totalFlips: comparison.summary.totalFlips,
        deltaAccuracy: comparison.summary.deltaAccuracy,
        comparison100: comparison.summary,
      }
    } catch (error) {
      emitProgress(onProgress, {
        kind: request.compareOnly ? 'comparison' : 'training',
        status: 'failed',
        message: extractFailureReason(error),
      })
      const failureReason = formatTrainingFailureReason(
        error,
        preferredModelPath
      )

      if (isDev && logger && typeof logger.error === 'function') {
        logger.error('Developer FLIP training failed', {
          message: failureReason,
          sampleName: request.sampleName,
          compareOnly: request.compareOnly,
        })
      }

      return {
        ok: false,
        status: error && error.status === 'stopped' ? 'stopped' : 'failed',
        trainingBackend: 'mlx_vlm_local',
        modelPath: preferredModelPath,
        localTrainingProfile: request.localTrainingProfile || null,
        localTrainingThermalMode: request.localTrainingThermalMode || null,
        localBenchmarkThermalMode: request.localBenchmarkThermalMode || null,
        localTrainingEpochs: request.localTrainingEpochs,
        localTrainingBatchSize: request.localTrainingBatchSize,
        localTrainingLoraRank: request.localTrainingLoraRank,
        failureReason,
        partialTrainingCompleted:
          request.compareOnly !== true &&
          (await exists(
            path.join(
              resolveTrainingOutputDir(runtimeTrainingDir),
              'adapters.safetensors'
            )
          )),
        message: failureReason,
        error:
          error && error.status ? error.status : 'developer_training_failed',
        stdout:
          String(error && error.stdout ? error.stdout : '').trim() || null,
        stderr:
          String(error && error.stderr ? error.stderr : '').trim() || null,
      }
    } finally {
      if (activeRunControl === runControl) {
        activeRunControl = null
      }
    }
  }

  async function stopCurrentRun(payload = {}) {
    const runControl = activeRunControl

    if (!runControl) {
      return {stopped: false, status: 'idle'}
    }

    const stopMode = normalizeRunStopMode(payload.stopMode)
    runControl.cancelRequested = true
    runControl.stopMode = stopMode
    runControl.cancelReason =
      stopMode === 'after_unit'
        ? 'Stopped by user after current step'
        : 'Stopped by user'

    if (runControl.controlPath) {
      await writeRunControlFile(
        runControl.controlPath,
        resolveRunThermalControls({
          localTrainingThermalMode: runControl.trainingThermalMode,
          localBenchmarkThermalMode: runControl.benchmarkThermalMode,
          stopMode,
        })
      )
    }

    const child = runControl.currentChild

    if (
      stopMode !== 'after_unit' &&
      child &&
      child.exitCode == null &&
      child.killed !== true
    ) {
      try {
        child.kill('SIGTERM')
      } catch {
        // Best effort stop request.
      }
    }

    return {
      stopped: true,
      status: stopMode === 'after_unit' ? 'stopping_after_unit' : 'stopping',
      stopMode,
      kind: runControl.kind,
      sampleName: runControl.sampleName,
    }
  }

  async function updateCurrentRunControls({
    localTrainingThermalMode,
    localBenchmarkThermalMode,
  } = {}) {
    const runControl = activeRunControl

    if (!runControl || !runControl.controlPath) {
      return {updated: false, status: 'idle'}
    }

    const controls = await writeRunControlFile(
      runControl.controlPath,
      resolveRunThermalControls({
        localTrainingThermalMode:
          localTrainingThermalMode || runControl.trainingThermalMode,
        localBenchmarkThermalMode:
          localBenchmarkThermalMode || runControl.benchmarkThermalMode,
        stopMode: runControl.stopMode,
      })
    )

    runControl.trainingThermalMode = controls.trainingThermalMode
    runControl.benchmarkThermalMode = controls.benchmarkThermalMode
    runControl.stopMode = controls.stopMode

    return {
      updated: true,
      status: 'updated',
      trainingThermalMode: controls.trainingThermalMode,
      benchmarkThermalMode: controls.benchmarkThermalMode,
      trainingStepCooldownMs: controls.trainingStepCooldownMs,
      trainingEpochCooldownMs: controls.trainingEpochCooldownMs,
      benchmarkCooldownMs: controls.benchmarkCooldownMs,
    }
  }

  return {
    runEpoch,
    stopCurrentRun,
    updateCurrentRunControls,
  }
}

module.exports = {
  DEFAULT_EVALUATION_FLIPS,
  DEFAULT_TRAINING_MODEL_PATH,
  createDeveloperTrainingRunner,
}
