const {spawn, spawnSync} = require('child_process')
const fs = require('fs')
const path = require('path')

const DEFAULT_EVALUATION_FLIPS = 100
const DEFAULT_TRAINING_EPOCHS = 1
const DEFAULT_TRAINING_BATCH_SIZE = 1
const DEFAULT_TRAINING_LEARNING_RATE = 1e-4
const DEFAULT_TRAINING_LORA_RANK = 10
const DEFAULT_TRAINING_MODEL_PATH = 'mlx-community/Qwen3.5-9B-MLX-4bit'
const STRONG_FALLBACK_TRAINING_MODEL_PATH =
  'mlx-community/Qwen2.5-VL-7B-Instruct-4bit'
const FALLBACK_TRAINING_MODEL_PATH = 'mlx-community/Qwen2-VL-2B-Instruct-4bit'
const DEFAULT_PREPARE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_TRAIN_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_EVALUATE_TIMEOUT_MS = 30 * 60 * 1000
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

function resolveTrainingFallbackModelPath() {
  const explicit = String(
    process.env.IDENAAI_LOCAL_TRAINING_FALLBACK_MODEL_PATH ||
      process.env.IDENAAI_LOCAL_TRAINING_FALLBACK_MODEL ||
      ''
  ).trim()

  return explicit || FALLBACK_TRAINING_MODEL_PATH
}

function resolveTrainingStrongFallbackModelPath() {
  const explicit = String(
    process.env.IDENAAI_LOCAL_TRAINING_STRONG_FALLBACK_MODEL_PATH ||
      process.env.IDENAAI_LOCAL_TRAINING_STRONG_FALLBACK_MODEL ||
      ''
  ).trim()

  return explicit || STRONG_FALLBACK_TRAINING_MODEL_PATH
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

async function runPythonScript({
  scriptPath,
  args = [],
  cwd,
  env = process.env,
  timeoutMs,
  logger,
  label,
}) {
  const {command, prefixArgs, configured} = resolveCommandParts()
  const finalArgs = prefixArgs.concat([scriptPath]).concat(args)
  const targetLabel = String(label || path.basename(scriptPath)).trim()

  return new Promise((resolve, reject) => {
    const child = spawn(command, finalArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdoutChunks = []
    const stderrChunks = []
    let settled = false
    let timeoutId = null

    function finalize(result) {
      if (settled) {
        return
      }

      settled = true

      if (timeoutId) {
        clearTimeout(timeoutId)
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

      reject(error)
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(Buffer.from(chunk))
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrChunks.push(Buffer.from(chunk))
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
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
          }
        )
      )
    })

    child.once('exit', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')

      if (code === 0) {
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
        child.kill('SIGTERM')
        fail(
          createProcessError(`${targetLabel} timed out after ${timeoutMs}ms`, {
            status: 'timeout',
            command,
            args: finalArgs,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
          })
        )
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

  return {
    developerHumanTeacher: source.developerHumanTeacher === true,
    sampleName: String(source.sampleName || '').trim(),
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
    evaluationFlips:
      normalizeInteger(source.evaluationFlips) || DEFAULT_EVALUATION_FLIPS,
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

  async function ensureScriptAvailable(scriptPath) {
    if (!(await exists(scriptPath))) {
      throw new Error(`Missing developer training script: ${scriptPath}`)
    }

    return scriptPath
  }

  async function ensureHoldoutDataset({runtimeTrainingDir, evaluationFlips}) {
    const holdoutDir = resolveHoldoutDir(runtimeTrainingDir, evaluationFlips)
    const datasetPath = path.join(holdoutDir, 'hf-dataset')
    const manifestPath = path.join(holdoutDir, 'manifest.json')
    const existingManifest = await readJsonIfExists(manifestPath, null)

    if (
      (await exists(datasetPath)) &&
      existingManifest &&
      normalizeInteger(existingManifest.count) === evaluationFlips
    ) {
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
  }) {
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

    await ensureScriptAvailable(prepareDeveloperScript)
    await runPythonScript({
      scriptPath: prepareDeveloperScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_PREPARE_TIMEOUT_MS,
      logger,
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
      ],
    })

    const manifest = await readJsonIfExists(manifestPath, null)

    return {
      preparedDir,
      datasetPath,
      manifestPath,
      manifest,
      sampleJsonPath,
    }
  }

  async function runTraining({runtimeTrainingDir, datasetPath, modelPath}) {
    const outputDir = resolveTrainingOutputDir(runtimeTrainingDir)
    const steps = parseEnvInteger('IDENAAI_DEVELOPER_TRAIN_STEPS', 0)
    const epochs = parseEnvInteger(
      'IDENAAI_DEVELOPER_TRAIN_EPOCHS',
      DEFAULT_TRAINING_EPOCHS
    )
    const batchSize = parseEnvInteger(
      'IDENAAI_DEVELOPER_TRAIN_BATCH_SIZE',
      DEFAULT_TRAINING_BATCH_SIZE
    )
    const learningRate = parseEnvFloat(
      'IDENAAI_DEVELOPER_TRAIN_LEARNING_RATE',
      DEFAULT_TRAINING_LEARNING_RATE
    )
    const loraRank = parseEnvInteger(
      'IDENAAI_DEVELOPER_TRAIN_LORA_RANK',
      DEFAULT_TRAINING_LORA_RANK
    )

    await ensureScriptAvailable(trainScript)
    await runPythonScript({
      scriptPath: trainScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_TRAIN_TIMEOUT_MS,
      logger,
      label: 'train developer FLIP adapter',
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
    }
  }

  async function runEvaluation({
    datasetPath,
    modelPath,
    adapterPath = null,
    outputPath,
    evaluationFlips,
    label,
  }) {
    await ensureScriptAvailable(evaluateScript)
    await runPythonScript({
      scriptPath: evaluateScript,
      cwd: repoRoot,
      timeoutMs: DEFAULT_EVALUATE_TIMEOUT_MS,
      logger,
      label,
      args: [
        '--dataset-path',
        datasetPath,
        '--model-path',
        modelPath,
        '--output',
        outputPath,
        '--mode',
        'score',
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
  }) {
    const holdout = await ensureHoldoutDataset({
      runtimeTrainingDir,
      evaluationFlips,
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
      label: 'evaluate developer FLIP baseline',
    })
    const trainedEval = await runEvaluation({
      datasetPath: holdout.datasetPath,
      modelPath,
      adapterPath,
      outputPath: trainedPath,
      evaluationFlips,
      label: 'evaluate developer FLIP adapter',
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

    try {
      const metadata = await loadTrainingMetadata(metadataPath)
      const preferredModelPath = resolveTrainingModelPath()

      if (request.compareOnly) {
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
        })
        await writeTrainingMetadata(metadataPath, {
          ...metadata,
          latestAdapterPath: adapterPath,
          modelPath: String(metadata.modelPath || preferredModelPath).trim(),
          latestComparisonPath: comparisonPath,
          latestHoldoutPath: comparisonRun.holdout.datasetPath,
          lastEvaluatedAt: comparisonRun.summary.evaluatedAt,
        })

        return {
          ok: true,
          status: DEFAULT_COMPARISON_STATUS,
          trainingBackend: 'mlx_vlm_local',
          modelPath: String(metadata.modelPath || preferredModelPath).trim(),
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
      })
      const training = await runTraining({
        runtimeTrainingDir,
        datasetPath: prepared.datasetPath,
        modelPath: preferredModelPath,
      })
      const comparison = await buildComparison({
        runtimeTrainingDir,
        modelPath: preferredModelPath,
        adapterPath: training.adapterPath,
        evaluationFlips: request.evaluationFlips,
        comparisonPath,
      })

      await writeTrainingMetadata(metadataPath, {
        sampleName: request.sampleName,
        modelPath: preferredModelPath,
        strongFallbackModelPath: resolveTrainingStrongFallbackModelPath(),
        fallbackModelPath: resolveTrainingFallbackModelPath(),
        latestPreparedDatasetPath: prepared.datasetPath,
        latestPreparedManifestPath: prepared.manifestPath,
        latestAdapterPath: training.adapterPath,
        latestTrainingOutputDir: training.outputDir,
        latestTrainingSummaryPath: training.summaryPath,
        latestComparisonPath: comparisonPath,
        latestHoldoutPath: comparison.holdout.datasetPath,
        lastTrainedAt: new Date().toISOString(),
        lastEvaluatedAt: comparison.summary.evaluatedAt,
      })

      return {
        ok: true,
        status: DEFAULT_TRAINING_STATUS,
        trainingBackend: 'mlx_vlm_local',
        modelPath: preferredModelPath,
        adapterPath: training.adapterPath,
        preparedDatasetPath: prepared.datasetPath,
        preparedManifestPath: prepared.manifestPath,
        trainingSummaryPath: training.summaryPath,
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
      const failureReason = formatTrainingFailureReason(
        error,
        resolveTrainingModelPath()
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
        status: 'failed',
        trainingBackend: 'mlx_vlm_local',
        modelPath: resolveTrainingModelPath(),
        failureReason,
        message: failureReason,
        error:
          error && error.status ? error.status : 'developer_training_failed',
        stdout:
          String(error && error.stdout ? error.stdout : '').trim() || null,
        stderr:
          String(error && error.stderr ? error.stderr : '').trim() || null,
      }
    }
  }

  return {
    runEpoch,
  }
}

module.exports = {
  DEFAULT_EVALUATION_FLIPS,
  DEFAULT_TRAINING_MODEL_PATH,
  STRONG_FALLBACK_TRAINING_MODEL_PATH,
  FALLBACK_TRAINING_MODEL_PATH,
  createDeveloperTrainingRunner,
}
