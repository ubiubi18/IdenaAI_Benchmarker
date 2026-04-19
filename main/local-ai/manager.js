const {spawn, spawnSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {createLocalAiStorage} = require('./storage')
const {resolveAdapterContract} = require('./adapter-contract')
const {createLocalAiSidecar} = require('./sidecar')
const {
  DEFAULT_DEMO_SAMPLE_NAME,
  buildHumanTeacherDemoWorkspace,
  listDeveloperHumanTeacherSamples,
  listHumanTeacherDemoSamples,
  loadDeveloperHumanTeacherSample,
  loadHumanTeacherDemoSample,
  normalizeDeveloperHumanTeacherSampleName,
  normalizeDemoSampleName,
} = require('./human-teacher-demo')
const {exportHumanTeacherTasks} = require('./human-teacher-export')
const {importHumanTeacherAnnotations} = require('./human-teacher-import')
const {resolveModelReference} = require('./model-reference')
const {createModernTrainingCollector} = require('./modern-training')
const {createDeveloperTrainingRunner} = require('./developer-training-runner')
const {
  LOCAL_AI_OLLAMA_RUNTIME_BACKEND,
  resolveLocalAiRuntimeAdapter,
  validateLocalAiBaseUrl,
} = require('./runtime-adapter')

const CAPTURE_INDEX_VERSION = 1
const TRAINING_CANDIDATE_PACKAGE_VERSION = 1
const HUMAN_TEACHER_PACKAGE_VERSION = 1
const MAX_CAPTURE_INDEX_ITEMS = 1000
const MAX_RECENT_CAPTURES = 20
const MAX_IMPORTED_ADAPTER_BYTES = 96 * 1024 * 1024
const DEFAULT_HUMAN_TEACHER_BATCH_SIZE = 30
const MAX_HUMAN_TEACHER_BATCH_SIZE = 30
const DEMO_HUMAN_TEACHER_BATCH_SIZE = 5
const DEMO_HUMAN_TEACHER_STATE_VERSION = 1
const DEVELOPER_HUMAN_TEACHER_BATCH_SIZE = 5
const DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE =
  'flip-challenge-test-20-decoded-labeled'
const DEVELOPER_HUMAN_TEACHER_STATE_VERSION = 1
const DEFAULT_RUNTIME_START_TIMEOUT_MS = 10 * 1000
const DEFAULT_RUNTIME_START_RETRY_DELAY_MS = 400
const ACTIVE_VALIDATION_PERIODS = new Set(['ShortSession', 'LongSession'])
const MAX_DEVELOPER_COMPARISON_HISTORY = 30
const EXTERNAL_DEVELOPER_TRAINING_BUNDLE_VERSION = 1
const EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL = ''
const EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE = 200
const DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE = 100
const MAX_DEVELOPER_LOCAL_BENCHMARK_SIZE = 500
const MAX_DEVELOPER_COMPARISON_TRACE_DEPTH = 3
const MAX_DEVELOPER_COMPARISON_TRACE_OBJECT_KEYS = 24
const MAX_DEVELOPER_COMPARISON_TRACE_ARRAY_ITEMS = 12
const MAX_DEVELOPER_COMPARISON_TRACE_STRING_LENGTH = 400
const DEVELOPER_LOCAL_TRAINING_MODEL_OPTIONS = new Set([
  EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL,
])
const DEVELOPER_LOCAL_TRAINING_PROFILE_OPTIONS = new Set([
  'safe',
  'balanced',
  'strong',
])
const DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE = 'strong'
const DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_OPTIONS = new Set([
  'full_speed',
  'balanced',
  'cool',
])
const DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE = 'balanced'
const DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE = 'balanced'
const HUMAN_TEACHER_WORKSPACE_METADATA_FILE = 'workspace-metadata.json'
const HUMAN_TEACHER_WORKSPACE_TYPE =
  'local-ai-human-teacher-annotation-workspace'
const OLLAMA_COMMAND_CANDIDATES = [
  '/opt/homebrew/bin/ollama',
  '/usr/local/bin/ollama',
  'ollama',
]
const ELIGIBLE_CONSENSUS_ANSWERS = new Set(['left', 'right'])

function roundTelemetryValue(value, precision = 1) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  const factor = 10 ** precision
  return Math.round(parsed * factor) / factor
}

function bytesToGiB(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return roundTelemetryValue(parsed / 1024 / 1024 / 1024, 2)
}

function captureCpuSnapshot() {
  const cpus = Array.isArray(os.cpus()) ? os.cpus() : []

  if (!cpus.length) {
    return null
  }

  return cpus.reduce(
    (snapshot, cpu) => {
      const times = cpu && cpu.times ? cpu.times : {}
      const total =
        Number(times.user || 0) +
        Number(times.nice || 0) +
        Number(times.sys || 0) +
        Number(times.idle || 0) +
        Number(times.irq || 0)

      snapshot.total += total
      snapshot.idle += Number(times.idle || 0)
      snapshot.cores += 1

      return snapshot
    },
    {capturedAt: Date.now(), total: 0, idle: 0, cores: 0}
  )
}

function calculateCpuUsagePercent(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot || !nextSnapshot) {
    return null
  }

  const totalDelta = Number(nextSnapshot.total) - Number(previousSnapshot.total)
  const idleDelta = Number(nextSnapshot.idle) - Number(previousSnapshot.idle)

  if (!Number.isFinite(totalDelta) || totalDelta <= 0) {
    return null
  }

  return roundTelemetryValue(
    ((totalDelta - Math.max(0, idleDelta)) / totalDelta) * 100,
    1
  )
}

function runBestEffortCommand(command, args = [], timeoutMs = 1200) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return {
      ok: !result.error,
      status: result.status,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      error: result.error ? String(result.error.message || result.error) : '',
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      error: String(error && error.message ? error.message : error || ''),
    }
  }
}

function parseBatteryTimeRemainingMinutes(text) {
  const match = String(text || '').match(/(\d+):(\d+)\s+remaining/i)

  if (!match) {
    return null
  }

  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10)
}

function parsePmsetBatteryOutput(stdout) {
  const raw = String(stdout || '').trim()

  if (!raw) {
    return {
      available: false,
      source: '',
      percent: null,
      state: '',
      isCharging: null,
      timeRemainingMinutes: null,
      raw: '',
    }
  }

  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const sourceLine = lines[0] || ''
  const detailLine = lines.find((line) => /%/.test(line)) || ''
  const sourceMatch = sourceLine.match(/Now drawing from '([^']+)'/i)
  const percentMatch = detailLine.match(/(\d+)%/)
  const stateMatch = detailLine.match(/\d+%;\s*([^;]+);/i)
  const percent = percentMatch ? Number.parseInt(percentMatch[1], 10) : null
  const state = stateMatch ? String(stateMatch[1] || '').trim() : ''
  const source = sourceMatch ? String(sourceMatch[1] || '').trim() : ''
  let isCharging = null

  if (/discharging/i.test(state)) {
    isCharging = false
  } else if (/charged|charging|finishing charge/i.test(state)) {
    isCharging = true
  } else if (/AC Power/i.test(source)) {
    isCharging = true
  } else if (/Battery Power/i.test(source)) {
    isCharging = false
  }

  return {
    available: Boolean(source || percent !== null),
    source,
    percent,
    state,
    isCharging,
    timeRemainingMinutes: parseBatteryTimeRemainingMinutes(detailLine),
    raw,
  }
}

function parsePmsetThermalOutput(stdout) {
  const raw = String(stdout || '').trim()

  if (!raw) {
    return {
      available: false,
      pressure: 'unavailable',
      thermalLevel: null,
      cpuSpeedLimit: null,
      schedulerLimit: null,
      notes: [],
      raw: '',
    }
  }

  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const readMetric = (name) => {
    const line = lines.find((entry) => entry.startsWith(`${name} =`))

    if (!line) {
      return null
    }

    const parsed = Number.parseInt(line.split('=').pop(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  const thermalLevel = readMetric('ThermalLevel')
  const cpuSpeedLimit = readMetric('CPU_Speed_Limit')
  const schedulerLimit = readMetric('Scheduler_Limit')
  const hasExplicitLimiting =
    (Number.isFinite(thermalLevel) && thermalLevel > 0) ||
    (Number.isFinite(cpuSpeedLimit) && cpuSpeedLimit < 100) ||
    (Number.isFinite(schedulerLimit) && schedulerLimit < 100)
  const hasWarningNote = lines.some(
    (line) =>
      /^Note:/i.test(line) &&
      !/No thermal warning level has been recorded/i.test(line) &&
      !/No performance warning level has been recorded/i.test(line) &&
      !/No CPU power status has been recorded/i.test(line)
  )

  let pressure = 'nominal'

  if (hasExplicitLimiting) {
    pressure = 'limited'
  } else if (hasWarningNote) {
    pressure = 'elevated'
  }

  return {
    available: true,
    pressure,
    thermalLevel,
    cpuSpeedLimit,
    schedulerLimit,
    notes: lines.filter((line) => /^Note:/i.test(line)),
    raw,
  }
}

function parseIoregGpuOutput(stdout) {
  const raw = String(stdout || '').trim()

  if (!raw) {
    return {
      available: false,
      deviceUtilizationPercent: null,
      rendererUtilizationPercent: null,
      tilerUtilizationPercent: null,
      raw: '',
    }
  }

  const readAverageMetric = (label) => {
    const matches = Array.from(
      raw.matchAll(new RegExp(`"${label}"\\s*=\\s*(\\d+)`, 'g'))
    )

    if (!matches.length) {
      return null
    }

    const values = matches
      .map((match) => Number.parseInt(match[1], 10))
      .filter((value) => Number.isFinite(value) && value >= 0)

    if (!values.length) {
      return null
    }

    return roundTelemetryValue(
      values.reduce((sum, value) => sum + value, 0) / values.length,
      1
    )
  }

  const deviceUtilizationPercent = readAverageMetric('Device Utilization %')
  const rendererUtilizationPercent = readAverageMetric('Renderer Utilization %')
  const tilerUtilizationPercent = readAverageMetric('Tiler Utilization %')

  return {
    available:
      deviceUtilizationPercent !== null ||
      rendererUtilizationPercent !== null ||
      tilerUtilizationPercent !== null,
    deviceUtilizationPercent,
    rendererUtilizationPercent,
    tilerUtilizationPercent,
    raw,
  }
}

function createDefaultSystemTelemetryProvider() {
  let previousCpuSnapshot = captureCpuSnapshot()

  return async function getDeveloperTelemetry() {
    const currentCpuSnapshot = captureCpuSnapshot()
    const loadAverage = Array.isArray(os.loadavg()) ? os.loadavg() : [0, 0, 0]
    const totalMemoryBytes = os.totalmem()
    const freeMemoryBytes = os.freemem()
    const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes)
    const cpuCoreCount =
      Number(currentCpuSnapshot?.cores) || os.cpus().length || 0
    const cpuUsagePercent = calculateCpuUsagePercent(
      previousCpuSnapshot,
      currentCpuSnapshot
    )

    previousCpuSnapshot = currentCpuSnapshot

    let battery = {
      available: false,
      source: '',
      percent: null,
      state: '',
      isCharging: null,
      timeRemainingMinutes: null,
      raw: '',
    }
    let thermal = {
      available: false,
      pressure: 'unavailable',
      thermalLevel: null,
      cpuSpeedLimit: null,
      schedulerLimit: null,
      notes: [],
      raw: '',
    }
    let gpu = {
      available: false,
      deviceUtilizationPercent: null,
      rendererUtilizationPercent: null,
      tilerUtilizationPercent: null,
      raw: '',
    }

    if (process.platform === 'darwin') {
      const batteryCommand = runBestEffortCommand('pmset', ['-g', 'batt'])
      if (batteryCommand.ok) {
        battery = parsePmsetBatteryOutput(batteryCommand.stdout)
      }

      const thermalCommand = runBestEffortCommand('pmset', ['-g', 'therm'])
      if (thermalCommand.ok) {
        thermal = parsePmsetThermalOutput(thermalCommand.stdout)
      }

      const gpuCommand = runBestEffortCommand('ioreg', [
        '-r',
        '-d',
        '1',
        '-w',
        '0',
        '-c',
        'IOAccelerator',
      ])
      if (gpuCommand.ok) {
        gpu = parseIoregGpuOutput(gpuCommand.stdout)
      }
    }

    return {
      collectedAt: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        cpuCoreCount: cpuCoreCount || null,
        cpuUsagePercent,
        loadAverage1m: roundTelemetryValue(loadAverage[0], 2),
        loadAverage5m: roundTelemetryValue(loadAverage[1], 2),
        loadAverage15m: roundTelemetryValue(loadAverage[2], 2),
        loadAveragePerCore1m:
          cpuCoreCount > 0
            ? roundTelemetryValue(loadAverage[0] / cpuCoreCount, 2)
            : null,
        memoryUsedGiB: bytesToGiB(usedMemoryBytes),
        memoryFreeGiB: bytesToGiB(freeMemoryBytes),
        memoryTotalGiB: bytesToGiB(totalMemoryBytes),
        memoryUsagePercent:
          totalMemoryBytes > 0
            ? roundTelemetryValue((usedMemoryBytes / totalMemoryBytes) * 100, 1)
            : null,
        appMemoryRssMb: roundTelemetryValue(
          process.memoryUsage().rss / 1024 / 1024,
          0
        ),
        gpuUsagePercent: roundTelemetryValue(gpu.deviceUtilizationPercent, 1),
        gpu,
        battery,
        thermal,
      },
    }
  }
}

function getTelemetrySystem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  if (
    !value.system ||
    typeof value.system !== 'object' ||
    Array.isArray(value.system)
  ) {
    return {}
  }

  return value.system
}

function getTelemetryTrainingReadiness(telemetry) {
  const system = getTelemetrySystem(telemetry)
  const thermal =
    system.thermal &&
    typeof system.thermal === 'object' &&
    !Array.isArray(system.thermal)
      ? system.thermal
      : {}
  const battery =
    system.battery &&
    typeof system.battery === 'object' &&
    !Array.isArray(system.battery)
      ? system.battery
      : {}
  const pressure = String(thermal.pressure || '')
    .trim()
    .toLowerCase()
  const cpuSpeedLimit = Number(thermal.cpuSpeedLimit)
  const batteryPercent = Number(battery.percent)
  const cpuUsagePercent = Number(system.cpuUsagePercent)
  const memoryUsagePercent = Number(system.memoryUsagePercent)
  const memoryFreeGiB = Number(system.memoryFreeGiB)

  if (!Object.keys(system).length) {
    return {
      status: 'unknown',
      tone: 'gray',
      label: 'Telemetry unavailable',
      message:
        'No local system telemetry is available right now, so the app cannot verify heat, battery, or memory conditions before training starts.',
      requiresExplicitOverride: false,
      canStartWithoutOverride: true,
    }
  }

  if (pressure === 'limited') {
    return {
      status: 'blocked',
      tone: 'red',
      label: 'Blocked by heat',
      message: Number.isFinite(cpuSpeedLimit)
        ? `macOS is already limiting CPU speed to ${cpuSpeedLimit}%. Cool the machine down first, or explicitly override this warning for one run.`
        : 'macOS is already thermally limiting this machine. Cool it down first, or explicitly override this warning for one run.',
      requiresExplicitOverride: true,
      canStartWithoutOverride: false,
    }
  }

  if (
    battery.available === true &&
    battery.isCharging === false &&
    Number.isFinite(batteryPercent) &&
    batteryPercent < 15
  ) {
    return {
      status: 'blocked',
      tone: 'red',
      label: 'Blocked on low battery',
      message: `Battery is at ${batteryPercent}% and not charging. Plug in before local training, or explicitly override this warning for one run.`,
      requiresExplicitOverride: true,
      canStartWithoutOverride: false,
    }
  }

  if (
    (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 95) ||
    (Number.isFinite(memoryFreeGiB) && memoryFreeGiB <= 1.5)
  ) {
    const memoryPercentLabel = Number.isFinite(memoryUsagePercent)
      ? `${memoryUsagePercent}%`
      : 'an unknown percentage'
    const memoryFreeLabel = Number.isFinite(memoryFreeGiB)
      ? `${memoryFreeGiB} GiB free`
      : 'free memory unavailable'

    return {
      status: 'blocked',
      tone: 'red',
      label: 'Blocked by memory pressure',
      message: `System memory is already at ${memoryPercentLabel} used (${memoryFreeLabel}). Close heavy apps first, or explicitly override this warning for one run.`,
      requiresExplicitOverride: true,
      canStartWithoutOverride: false,
    }
  }

  if (
    (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 90) ||
    (Number.isFinite(memoryFreeGiB) && memoryFreeGiB <= 3)
  ) {
    const memoryPercentLabel = Number.isFinite(memoryUsagePercent)
      ? `${memoryUsagePercent}%`
      : 'a high level'
    const memoryFreeLabel = Number.isFinite(memoryFreeGiB)
      ? `${memoryFreeGiB} GiB free`
      : 'free memory unavailable'

    return {
      status: 'caution',
      tone: 'orange',
      label: 'Caution: memory already tight',
      message: `System memory is already tight at ${memoryPercentLabel} used (${memoryFreeLabel}). Local training can still run, but it is more likely to slow down, swap, or compete with the rest of the desktop.`,
      requiresExplicitOverride: false,
      canStartWithoutOverride: true,
    }
  }

  if (pressure === 'elevated') {
    return {
      status: 'caution',
      tone: 'orange',
      label: 'Caution: warming up',
      message:
        'macOS has already recorded thermal warnings. Local training can still run, but it is more likely to slow down and add more heat.',
      requiresExplicitOverride: false,
      canStartWithoutOverride: true,
    }
  }

  if (battery.available === true && battery.isCharging === false) {
    return {
      status: 'caution',
      tone: 'orange',
      label: 'Caution: on battery',
      message: Number.isFinite(batteryPercent)
        ? `This Mac is on battery at ${batteryPercent}%. A local run will trade battery life and battery wear for convenience.`
        : 'This Mac is on battery. A local run will trade battery life and battery wear for convenience.',
      requiresExplicitOverride: false,
      canStartWithoutOverride: true,
    }
  }

  if (
    Number.isFinite(cpuUsagePercent) &&
    cpuUsagePercent >= 80 &&
    Number.isFinite(memoryUsagePercent) &&
    memoryUsagePercent >= 80
  ) {
    return {
      status: 'caution',
      tone: 'yellow',
      label: 'Caution: machine already busy',
      message:
        'CPU and memory are both already busy. Local training can still start, but it will compete harder with the rest of the desktop.',
      requiresExplicitOverride: false,
      canStartWithoutOverride: true,
    }
  }

  return {
    status: 'ready',
    tone: 'green',
    label: 'Ready for local training',
    message:
      'No hard heat or battery stop condition is visible right now. This does not guarantee a fast run, but the machine looks safe enough to start a small local pilot.',
    requiresExplicitOverride: false,
    canStartWithoutOverride: true,
  }
}

function normalizeMode(value, fallback = 'sidecar') {
  const mode = String(value || fallback).trim()
  return mode || fallback
}

function normalizeBaseUrl(value, fallback = 'http://localhost:5000') {
  const baseUrl = String(value || fallback).trim()
  return baseUrl || fallback
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function resolveOllamaCommand() {
  const explicit = String(process.env.OLLAMA_PATH || '').trim()

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

function createDefaultRuntimeController({logger, isDev = false} = {}) {
  let managedProcess = null

  return {
    async start(payload = {}) {
      if (payload.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
        return {started: false, managed: false}
      }

      if (
        managedProcess &&
        managedProcess.exitCode == null &&
        !managedProcess.killed
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
            String(payload.baseUrl || ''),
        }
      }

      const host = resolveOllamaHostEnv(baseUrlValidation.normalizedBaseUrl)

      if (host) {
        env.OLLAMA_HOST = host
      }

      const child = await new Promise((resolve, reject) => {
        const nextChild = spawn(command, ['serve'], {
          detached: true,
          stdio: 'ignore',
          env,
        })

        nextChild.once('error', reject)
        nextChild.once('spawn', () => resolve(nextChild))
      })

      child.unref()
      managedProcess = child
      child.once('exit', () => {
        if (managedProcess === child) {
          managedProcess = null
        }
      })

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
    },

    async stop(payload = {}) {
      if (
        payload.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND ||
        !managedProcess ||
        managedProcess.exitCode != null ||
        managedProcess.killed
      ) {
        return {stopped: false, managed: false}
      }

      const {pid} = managedProcess

      try {
        process.kill(pid, 'SIGTERM')
      } finally {
        managedProcess = null
      }

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

function normalizeRuntimePayload(payload, fallbackRuntime = {}) {
  const nextPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}
  const runtime = resolveLocalAiRuntimeAdapter(nextPayload, fallbackRuntime)

  return {
    ...nextPayload,
    runtime: runtime.runtime,
    runtimeBackend: runtime.runtimeBackend,
    runtimeType: runtime.runtimeType,
    baseUrl: normalizeBaseUrl(
      nextPayload.baseUrl || nextPayload.endpoint,
      runtime.defaultBaseUrl
    ),
  }
}

function pickRuntimeInput(payload) {
  if (typeof payload.input !== 'undefined') {
    return payload.input
  }

  if (typeof payload.payload !== 'undefined') {
    return payload.payload
  }

  return payload
}

function isDeveloperHumanTeacherTrainingRequest(payload) {
  const input = pickRuntimeInput(payload)

  return Boolean(
    input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      input.developerHumanTeacher === true
  )
}

function normalizeEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) ? epoch : null
}

function normalizeOptionalEpoch(value) {
  const epoch = Number.parseInt(value, 10)
  return Number.isFinite(epoch) ? epoch : null
}

function normalizeFilePath(value) {
  const filePath = String(value || '').trim()
  return filePath ? path.resolve(filePath) : null
}

function normalizeSessionType(value) {
  const sessionType = String(value || '').trim()
  return sessionType || null
}

function normalizePanelCount(value) {
  const panelCount = Number.parseInt(value, 10)
  return Number.isFinite(panelCount) && panelCount > 0 ? panelCount : 0
}

function normalizeConsensus(consensus) {
  if (!consensus || typeof consensus !== 'object' || Array.isArray(consensus)) {
    return null
  }

  const finalAnswer = String(
    consensus.finalAnswer || consensus.finalAnswerAfterRemap || ''
  )
    .trim()
    .toLowerCase()

  const reported = Boolean(consensus.reported)

  if (!finalAnswer && !reported) {
    return null
  }

  return {
    finalAnswer: finalAnswer || null,
    reported,
    strength: String(consensus.strength || '').trim() || null,
  }
}

function hasExplicitConsensus(payload) {
  return Boolean(
    payload &&
      payload.consensus &&
      typeof payload.consensus === 'object' &&
      !Array.isArray(payload.consensus)
  )
}

function hasEligibleConsensusAnswer(consensus) {
  return Boolean(
    consensus &&
      consensus.finalAnswer &&
      ELIGIBLE_CONSENSUS_ANSWERS.has(String(consensus.finalAnswer).trim())
  )
}

function normalizeOrders(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((order) =>
      Array.isArray(order)
        ? order
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isFinite(item) && item >= 0)
        : []
    )
    .filter((order) => order.length > 0)
    .slice(0, 2)
}

function normalizeWords(words) {
  if (!Array.isArray(words)) {
    return []
  }

  return words
    .map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? {
            id: Number.isFinite(Number(item.id)) ? Number(item.id) : null,
            name: String(item.name || '').trim() || null,
            desc: String(item.desc || item.description || '').trim() || null,
          }
        : null
    )
    .filter(Boolean)
}

function normalizeSelectedOrder(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()
  return nextValue === 'left' || nextValue === 'right' ? nextValue : null
}

function normalizeRelevance(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()
  return nextValue || null
}

function normalizeAuthor(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()
  return nextValue || null
}

function toCaptureMeta(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const flipHash = String(payload.flipHash || payload.hash || '').trim()

  if (!flipHash) {
    return null
  }

  const images = Array.isArray(payload.images) ? payload.images : []
  const explicitPanelCount = normalizePanelCount(payload.panelCount)
  const panelCount = explicitPanelCount || images.length

  return {
    flipHash,
    epoch: normalizeEpoch(payload.epoch),
    sessionType: normalizeSessionType(payload.sessionType),
    panelCount,
    timestamp: Date.now(),
    capturedAt: new Date().toISOString(),
    consensus: normalizeConsensus(payload.consensus),
    author: normalizeAuthor(payload.author),
    orders: normalizeOrders(payload.orders),
    words: normalizeWords(payload.words),
    selectedOrder: normalizeSelectedOrder(payload.selectedOrder),
    relevance: normalizeRelevance(payload.relevance),
    best: payload.best === true,
  }
}

function normalizeCapture(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }

  const flipHash = String(item.flipHash || item.hash || '').trim()

  if (!flipHash) {
    return null
  }

  return {
    flipHash,
    epoch: normalizeEpoch(item.epoch),
    sessionType: normalizeSessionType(item.sessionType),
    panelCount: normalizePanelCount(item.panelCount),
    timestamp: Number.isFinite(Number(item.timestamp))
      ? Number(item.timestamp)
      : Date.now(),
    capturedAt:
      String(item.capturedAt || '').trim() || new Date().toISOString(),
    consensus: normalizeConsensus(item.consensus),
    author: normalizeAuthor(item.author),
    orders: normalizeOrders(item.orders),
    words: normalizeWords(item.words),
    selectedOrder: normalizeSelectedOrder(item.selectedOrder),
    relevance: normalizeRelevance(item.relevance),
    best: item.best === true,
  }
}

function mergeConsensus(previousConsensus, nextConsensus) {
  if (!previousConsensus && !nextConsensus) {
    return null
  }

  return {
    finalAnswer:
      (nextConsensus && nextConsensus.finalAnswer) ||
      (previousConsensus && previousConsensus.finalAnswer) ||
      null,
    reported:
      (nextConsensus && nextConsensus.reported) ||
      (previousConsensus && previousConsensus.reported) ||
      false,
    strength:
      (nextConsensus && nextConsensus.strength) ||
      (previousConsensus && previousConsensus.strength) ||
      null,
  }
}

function mergeCaptureMeta(previousCapture, nextCapture) {
  const previous = previousCapture || {}
  const next = nextCapture || {}
  const nextOrders =
    Array.isArray(next.orders) && next.orders.length ? next.orders : null
  const previousOrders = Array.isArray(previous.orders) ? previous.orders : []
  const nextWords =
    Array.isArray(next.words) && next.words.length ? next.words : null
  const previousWords = Array.isArray(previous.words) ? previous.words : []

  return {
    flipHash: next.flipHash || previous.flipHash || null,
    epoch: next.epoch ?? previous.epoch ?? null,
    sessionType: next.sessionType || previous.sessionType || null,
    panelCount: next.panelCount || previous.panelCount || 0,
    timestamp: Number(next.timestamp || previous.timestamp || Date.now()),
    capturedAt:
      next.capturedAt || previous.capturedAt || new Date().toISOString(),
    consensus: mergeConsensus(previous.consensus, next.consensus),
    author: next.author || previous.author || null,
    orders: nextOrders || previousOrders,
    words: nextWords || previousWords,
    selectedOrder: next.selectedOrder || previous.selectedOrder || null,
    relevance: next.relevance || previous.relevance || null,
    best: next.best === true || previous.best === true,
  }
}

function normalizeCaptureIndex(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const captures = Array.isArray(source.captures)
    ? source.captures
        .map(normalizeCapture)
        .filter(Boolean)
        .slice(-MAX_CAPTURE_INDEX_ITEMS)
    : []
  const capturedCount = Number.parseInt(source.capturedCount, 10)

  return {
    version: CAPTURE_INDEX_VERSION,
    capturedCount: Number.isFinite(capturedCount)
      ? Math.max(capturedCount, captures.length)
      : captures.length,
    captures,
    updatedAt: String(source.updatedAt || '').trim() || null,
  }
}

function defaultCaptureIndex() {
  return {
    version: CAPTURE_INDEX_VERSION,
    capturedCount: 0,
    captures: [],
    updatedAt: null,
  }
}

function captureIndexPath(storage) {
  return storage.resolveLocalAiPath('captures', 'index.json')
}

function manifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('manifests', `epoch-${epoch}-manifest.json`)
}

function adapterArtifactManifestPath(storage, epoch) {
  return storage.resolveLocalAiPath('adapters', `epoch-${epoch}.json`)
}

function normalizeAdapterImportToken(value) {
  const baseName = path.basename(String(value || '').trim())
  const normalized = baseName.replace(/[^a-zA-Z0-9._-]+/g, '-')
  return normalized || null
}

function sanitizeAdapterArtifactFileName(fileName, fallback = 'adapter.bin') {
  const baseName = path.basename(String(fileName || '').trim())
  const normalized = baseName.replace(/[^a-zA-Z0-9._-]+/g, '-')
  return normalized || fallback
}

function adapterImportedArtifactPath(storage, epoch, token) {
  return path.join(
    storage.resolveLocalAiPath('adapter-imports', String(epoch)),
    normalizeAdapterImportToken(token) || 'adapter.bin'
  )
}

function adapterArtifactFileNameFromToken(token, fallback = 'adapter.bin') {
  const normalizedToken = normalizeAdapterImportToken(token)

  if (!normalizedToken) {
    return fallback
  }

  const parts = normalizedToken.split('-')

  if (parts.length < 3) {
    return normalizedToken
  }

  return sanitizeAdapterArtifactFileName(parts.slice(2).join('-'), fallback)
}

function decodeAdapterImportBuffer(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return null
  }

  const base64 = raw.includes(',')
    ? raw.slice(raw.indexOf(',') + 1).replace(/\s+/g, '')
    : raw.replace(/\s+/g, '')

  if (!base64 || /[^A-Za-z0-9+/=]/u.test(base64)) {
    return null
  }

  const buffer = Buffer.from(base64, 'base64')
  return buffer.length ? buffer : null
}

function toPublicAdapterArtifactManifest(manifestPathValue, manifest = {}) {
  const adapterArtifact =
    manifest &&
    manifest.adapterArtifact &&
    typeof manifest.adapterArtifact === 'object' &&
    !Array.isArray(manifest.adapterArtifact)
      ? manifest.adapterArtifact
      : {}

  return {
    epoch: manifest.epoch,
    adapterManifestPath: manifestPathValue,
    publicModelId: manifest.publicModelId || null,
    publicVisionId: manifest.publicVisionId || null,
    runtimeBackend: manifest.runtimeBackend || null,
    reasonerBackend: manifest.reasonerBackend || null,
    visionBackend: manifest.visionBackend || null,
    contractVersion: manifest.contractVersion || null,
    baseModelId: manifest.baseModelId || null,
    baseModelHash: manifest.baseModelHash || null,
    deltaType: manifest.deltaType || null,
    adapterFormat: manifest.adapterFormat || null,
    adapterSha256: manifest.adapterSha256 || null,
    trainingConfigHash: manifest.trainingConfigHash || null,
    registeredAt: manifest.registeredAt || null,
    adapterArtifact: {
      file: adapterArtifact.file || null,
      sizeBytes: Number.isFinite(Number(adapterArtifact.sizeBytes))
        ? Number(adapterArtifact.sizeBytes)
        : null,
      artifactToken: normalizeAdapterImportToken(adapterArtifact.artifactToken),
    },
  }
}

function trainingCandidatePackagePath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'training-candidates',
    `epoch-${epoch}-candidates.json`
  )
}

function humanTeacherPackagePath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher',
    `epoch-${epoch}-tasks.json`
  )
}

function humanTeacherExportDir(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher-exports',
    `epoch-${epoch}-tasks`
  )
}

function humanTeacherDemoDir(storage, sampleName = DEFAULT_DEMO_SAMPLE_NAME) {
  return storage.resolveLocalAiPath(
    'human-teacher-demo',
    normalizeDemoSampleName(sampleName)
  )
}

function demoHumanTeacherStatePath(
  storage,
  sampleName = DEFAULT_DEMO_SAMPLE_NAME
) {
  return path.join(humanTeacherDemoDir(storage, sampleName), 'state.json')
}

function demoHumanTeacherChunkDir(
  storage,
  sampleName = DEFAULT_DEMO_SAMPLE_NAME,
  offset = 0
) {
  const nextOffset = Math.max(0, Number.parseInt(offset, 10) || 0)
  return path.join(
    humanTeacherDemoDir(storage, sampleName),
    'chunks',
    `offset-${String(nextOffset).padStart(4, '0')}`
  )
}

function developerHumanTeacherDir(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return storage.resolveLocalAiPath(
    'human-teacher-developer',
    normalizeDeveloperHumanTeacherSampleName(sampleName)
  )
}

function developerHumanTeacherStatePath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(developerHumanTeacherDir(storage, sampleName), 'state.json')
}

function developerHumanTeacherChunkDir(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  offset = 0
) {
  const nextOffset = Math.max(0, Number.parseInt(offset, 10) || 0)
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'chunks',
    `offset-${String(nextOffset).padStart(4, '0')}`
  )
}

function developerHumanTeacherAnnotatedPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'annotations.annotated.jsonl'
  )
}

function developerHumanTeacherPendingPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'annotations.pending.jsonl'
  )
}

function developerHumanTeacherTrainedPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    'annotations.trained.jsonl'
  )
}

function developerHumanTeacherComparisonPath(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  evaluationFlips = DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE
) {
  return path.join(
    developerHumanTeacherDir(storage, sampleName),
    `comparison-${normalizeDeveloperLocalBenchmarkFlips(
      evaluationFlips
    )}flips.json`
  )
}

function developerHumanTeacherExternalBundleDir(
  storage,
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  bundleId = ''
) {
  const baseDir = path.join(
    developerHumanTeacherDir(storage, sampleName),
    'external-training-bundles'
  )

  if (!bundleId) {
    return baseDir
  }

  return path.join(baseDir, String(bundleId || '').trim())
}

function humanTeacherNormalizedAnnotationsPath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher-exports',
    `epoch-${epoch}-tasks`,
    'annotations.normalized.jsonl'
  )
}

function humanTeacherImportSummaryPath(storage, epoch) {
  return storage.resolveLocalAiPath(
    'human-teacher-exports',
    `epoch-${epoch}-tasks`,
    'annotations.import-summary.json'
  )
}

function normalizeHumanTeacherBatchSize(value) {
  const batchSize = Number.parseInt(value, 10)

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    return DEFAULT_HUMAN_TEACHER_BATCH_SIZE
  }

  return Math.min(batchSize, MAX_HUMAN_TEACHER_BATCH_SIZE)
}

function normalizeDeveloperHumanTeacherOffset(value) {
  const offset = Number.parseInt(value, 10)

  if (!Number.isFinite(offset) || offset < 0) {
    return 0
  }

  return offset
}

function normalizeDemoHumanTeacherOffset(value) {
  return normalizeDeveloperHumanTeacherOffset(value)
}

function normalizeDeveloperLocalBenchmarkFlips(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE
  }

  return Math.min(MAX_DEVELOPER_LOCAL_BENCHMARK_SIZE, Math.max(1, parsed))
}

function normalizeDeveloperTrainingInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

function normalizeDeveloperTrainingModelPath(value) {
  const modelPath = String(value || '').trim()

  if (!modelPath) {
    return null
  }

  return DEVELOPER_LOCAL_TRAINING_MODEL_OPTIONS.has(modelPath)
    ? modelPath
    : null
}

function normalizeDeveloperTrainingProfile(value) {
  const profile = String(value || '')
    .trim()
    .toLowerCase()

  return DEVELOPER_LOCAL_TRAINING_PROFILE_OPTIONS.has(profile)
    ? profile
    : DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE
}

function normalizeDeveloperTrainingThermalMode(value) {
  const thermalMode = String(value || '')
    .trim()
    .toLowerCase()

  return DEVELOPER_LOCAL_TRAINING_THERMAL_MODE_OPTIONS.has(thermalMode)
    ? thermalMode
    : DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE
}

function normalizeDeveloperRunStopMode(value) {
  const stopMode = String(value || '')
    .trim()
    .toLowerCase()

  return stopMode === 'after_unit' ? 'after_unit' : 'cancel_now'
}

function readDeveloperHumanTeacherTrainingTarget(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : null

  if (!source) {
    return null
  }

  if (source.developerHumanTeacher === true) {
    return source
  }

  if (
    source.input &&
    typeof source.input === 'object' &&
    !Array.isArray(source.input) &&
    source.input.developerHumanTeacher === true
  ) {
    return source.input
  }

  if (
    source.payload &&
    typeof source.payload === 'object' &&
    !Array.isArray(source.payload) &&
    source.payload.developerHumanTeacher === true
  ) {
    return source.payload
  }

  return null
}

function hasDeveloperTrainingSystemPressureOverride(value) {
  const target = readDeveloperHumanTeacherTrainingTarget(value)
  return Boolean(target && target.allowSystemPressureOverride === true)
}

function sanitizeDeveloperHumanTeacherTrainingTarget(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : null

  if (!source || source.developerHumanTeacher !== true) {
    return value
  }

  const normalizedTrainingModelPath = normalizeDeveloperTrainingModelPath(
    source.trainingModelPath || source.modelPath
  )
  const next = {
    ...source,
    allowSystemPressureOverride: source.allowSystemPressureOverride === true,
    localTrainingProfile: normalizeDeveloperTrainingProfile(
      source.localTrainingProfile
    ),
    localTrainingThermalMode: normalizeDeveloperTrainingThermalMode(
      source.localTrainingThermalMode
    ),
    localBenchmarkThermalMode: normalizeDeveloperTrainingThermalMode(
      source.localBenchmarkThermalMode || source.localTrainingThermalMode
    ),
    localTrainingEpochs: normalizeDeveloperTrainingInteger(
      source.localTrainingEpochs,
      1,
      1,
      6
    ),
    localTrainingBatchSize: normalizeDeveloperTrainingInteger(
      source.localTrainingBatchSize,
      1,
      1,
      4
    ),
    localTrainingLoraRank: normalizeDeveloperTrainingInteger(
      source.localTrainingLoraRank,
      10,
      4,
      16
    ),
  }

  if (typeof source.evaluationFlips !== 'undefined') {
    next.evaluationFlips = normalizeDeveloperLocalBenchmarkFlips(
      source.evaluationFlips
    )
  }

  if (normalizedTrainingModelPath) {
    next.trainingModelPath = normalizedTrainingModelPath
    next.modelPath = normalizedTrainingModelPath
  } else {
    delete next.trainingModelPath
    delete next.modelPath
  }

  return next
}

function sanitizeDeveloperHumanTeacherTrainingPayload(payload) {
  const source =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}
  const next = sanitizeDeveloperHumanTeacherTrainingTarget(source)

  if (next !== source) {
    return next
  }

  let changed = false
  const updated = {...source}

  if (typeof source.input !== 'undefined') {
    const nextInput = sanitizeDeveloperHumanTeacherTrainingTarget(source.input)

    if (nextInput !== source.input) {
      updated.input = nextInput
      changed = true
    }
  }

  if (typeof source.payload !== 'undefined') {
    const nextPayload = sanitizeDeveloperHumanTeacherTrainingTarget(
      source.payload
    )

    if (nextPayload !== source.payload) {
      updated.payload = nextPayload
      changed = true
    }
  }

  return changed ? updated : source
}

function clampDemoHumanTeacherOffset(offset, totalFlips) {
  const nextOffset = normalizeDemoHumanTeacherOffset(offset)
  const total = Number.parseInt(totalFlips, 10)

  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }

  const maxOffset = Math.max(
    0,
    total - Math.min(DEMO_HUMAN_TEACHER_BATCH_SIZE, total)
  )

  return Math.min(nextOffset, maxOffset)
}

function clampDeveloperHumanTeacherOffset(offset, totalFlips) {
  const nextOffset = normalizeDeveloperHumanTeacherOffset(offset)
  const total = Number.parseInt(totalFlips, 10)

  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }

  const maxOffset = Math.max(
    0,
    total - Math.min(DEVELOPER_HUMAN_TEACHER_BATCH_SIZE, total)
  )

  return Math.min(nextOffset, maxOffset)
}

function isDeveloperHumanTeacherChunkFullyAnnotated(state, offset) {
  const normalizedOffset = normalizeDeveloperHumanTeacherOffset(offset)
  const source =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const annotatedTaskIds = new Set(uniqueStrings(source.annotatedTaskIds || []))
  const chunkEntry = Array.isArray(source.chunks)
    ? source.chunks.find(
        (entry) =>
          normalizeDeveloperHumanTeacherOffset(entry && entry.offset) ===
          normalizedOffset
      )
    : null
  const taskIds = uniqueStrings(chunkEntry?.taskIds || [])

  if (!taskIds.length) {
    return false
  }

  return taskIds.every((taskId) => annotatedTaskIds.has(taskId))
}

function resolveDeveloperHumanTeacherSessionOffset(
  state,
  totalFlips,
  preferredOffset = 0
) {
  const total = Number.parseInt(totalFlips, 10)

  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }

  const startOffset = clampDeveloperHumanTeacherOffset(preferredOffset, total)
  const maxOffset = clampDeveloperHumanTeacherOffset(total, total)

  for (
    let nextOffset = startOffset;
    nextOffset <= maxOffset;
    nextOffset += DEVELOPER_HUMAN_TEACHER_BATCH_SIZE
  ) {
    if (!isDeveloperHumanTeacherChunkFullyAnnotated(state, nextOffset)) {
      return nextOffset
    }
  }

  return startOffset
}

function normalizeCurrentPeriod(value) {
  return String(value || '').trim()
}

function assertDeveloperHumanTeacherSessionAllowed(currentPeriod, action) {
  const nextCurrentPeriod = normalizeCurrentPeriod(currentPeriod)

  if (ACTIVE_VALIDATION_PERIODS.has(nextCurrentPeriod)) {
    throw new Error(
      `Developer human-teacher ${action} is blocked while a validation session is running`
    )
  }
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(values.map((item) => String(item || '').trim()).filter(Boolean))
  )
}

function uniqueNumbers(values = []) {
  return Array.from(
    new Set(
      values
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isFinite(item) && item >= 0)
    )
  ).sort((left, right) => left - right)
}

function mergeJsonlRowsByTaskId(rows = [], extraRows = []) {
  const nextRows = new Map()

  ;[...rows, ...extraRows].forEach((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return
    }

    const taskId = String(
      row.task_id || row.taskId || row.sample_id || row.sampleId || ''
    ).trim()

    if (!taskId) {
      return
    }

    nextRows.set(taskId, row)
  })

  return Array.from(nextRows.values())
}

function summarizeDeveloperChunkRows(rows = []) {
  const taskIds = uniqueStrings(rows.map((row) => row && row.task_id))
  return {
    taskIds,
    rowCount: rows.length,
  }
}

function normalizeAccuracyValue(value) {
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

function normalizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeDeveloperComparisonStatus(value, fallback = 'not_loaded') {
  const status = String(value || fallback).trim()
  return status || fallback
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return null
  }

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function createDefaultDeveloperComparisonState() {
  return {
    status: 'not_loaded',
    benchmarkFlips: null,
    holdoutPath: null,
    lastEvaluatedAt: null,
    lastResultPath: null,
    accuracy: null,
    correct: null,
    totalFlips: null,
    bestAccuracy: null,
    fairBenchmark: {
      legacyFairnessUnknown: false,
      requestedCount: null,
      actualCount: null,
      swapConsistencyDefault: null,
      presentationEnsembleDefault: null,
      optionAMapping: {
        enabled: false,
        applied: false,
        optionAMapsToCounts: {
          left: 0,
          right: 0,
        },
        optionAMapsToImbalance: null,
        optionAWouldBeCorrect: null,
        optionAWouldBeWrong: null,
      },
    },
    history: [],
  }
}

function normalizeDeveloperComparisonFairBenchmark(value, fallback = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const optionAMappingSource =
    source.optionAMapping &&
    typeof source.optionAMapping === 'object' &&
    !Array.isArray(source.optionAMapping)
      ? source.optionAMapping
      : {}
  const optionCountsSource =
    optionAMappingSource.optionAMapsToCounts &&
    typeof optionAMappingSource.optionAMapsToCounts === 'object' &&
    !Array.isArray(optionAMappingSource.optionAMapsToCounts)
      ? optionAMappingSource.optionAMapsToCounts
      : {}
  let swapConsistencyDefault = null
  if (typeof source.swapConsistencyDefault === 'boolean') {
    swapConsistencyDefault = source.swapConsistencyDefault
  } else if (typeof fallback.swapConsistencyDefault === 'boolean') {
    swapConsistencyDefault = fallback.swapConsistencyDefault
  }
  let presentationEnsembleDefault = null
  if (typeof source.presentationEnsembleDefault === 'boolean') {
    presentationEnsembleDefault = source.presentationEnsembleDefault
  } else if (typeof fallback.presentationEnsembleDefault === 'boolean') {
    presentationEnsembleDefault = fallback.presentationEnsembleDefault
  }

  return {
    legacyFairnessUnknown:
      source.legacyFairnessUnknown === true ||
      fallback.legacyFairnessUnknown === true,
    requestedCount: normalizeNonNegativeInteger(
      source.requestedCount ?? fallback.requestedCount
    ),
    actualCount: normalizeNonNegativeInteger(
      source.actualCount ?? fallback.actualCount
    ),
    swapConsistencyDefault,
    presentationEnsembleDefault,
    optionAMapping: {
      enabled: Boolean(
        optionAMappingSource.enabled === true ||
          fallback?.optionAMapping?.enabled === true
      ),
      applied: Boolean(
        optionAMappingSource.applied === true ||
          fallback?.optionAMapping?.applied === true
      ),
      optionAMapsToCounts: {
        left:
          normalizeNonNegativeInteger(optionCountsSource.left) ??
          normalizeNonNegativeInteger(
            fallback?.optionAMapping?.optionAMapsToCounts?.left
          ) ??
          0,
        right:
          normalizeNonNegativeInteger(optionCountsSource.right) ??
          normalizeNonNegativeInteger(
            fallback?.optionAMapping?.optionAMapsToCounts?.right
          ) ??
          0,
      },
      optionAMapsToImbalance:
        normalizeNonNegativeInteger(
          optionAMappingSource.optionAMapsToImbalance
        ) ??
        normalizeNonNegativeInteger(
          fallback?.optionAMapping?.optionAMapsToImbalance
        ),
      optionAWouldBeCorrect:
        normalizeNonNegativeInteger(
          optionAMappingSource.optionAWouldBeCorrect
        ) ??
        normalizeNonNegativeInteger(
          fallback?.optionAMapping?.optionAWouldBeCorrect
        ),
      optionAWouldBeWrong:
        normalizeNonNegativeInteger(optionAMappingSource.optionAWouldBeWrong) ??
        normalizeNonNegativeInteger(
          fallback?.optionAMapping?.optionAWouldBeWrong
        ),
    },
  }
}

function hasDeveloperComparisonMetrics(source = {}) {
  const comparison =
    source && typeof source === 'object' && !Array.isArray(source) ? source : {}

  return (
    comparison.accuracy !== null ||
    (comparison.correct !== null && comparison.totalFlips !== null)
  )
}

function inferDeveloperComparisonBenchmarkFlips(source = {}) {
  const resultPath = String(
    source.resultPath || source.lastResultPath || source.path || ''
  ).trim()
  const resultPathMatch = resultPath.match(/comparison-(\d+)flips\.json$/i)
  const resultPathBenchmarkFlips = resultPathMatch
    ? normalizeNonNegativeInteger(resultPathMatch[1])
    : null

  return (
    resultPathBenchmarkFlips ||
    normalizeNonNegativeInteger(source.benchmarkFlips) ||
    normalizeNonNegativeInteger(
      source.totalFlips || source.total || source.flipCount
    )
  )
}

function normalizeDeveloperComparisonHistoryEntry(entry = {}) {
  const source =
    entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}

  return {
    status: normalizeDeveloperComparisonStatus(source.status, 'evaluated'),
    benchmarkFlips: inferDeveloperComparisonBenchmarkFlips(source),
    evaluatedAt: normalizeIsoDate(
      source.evaluatedAt || source.lastEvaluatedAt || source.generatedAt
    ),
    resultPath:
      String(
        source.resultPath || source.lastResultPath || source.path || ''
      ).trim() || null,
    holdoutPath: String(source.holdoutPath || '').trim() || null,
    accuracy: normalizeAccuracyValue(source.accuracy),
    correct: normalizeNonNegativeInteger(source.correct),
    totalFlips: normalizeNonNegativeInteger(
      source.totalFlips || source.total || source.flipCount
    ),
    fairBenchmark: normalizeDeveloperComparisonFairBenchmark(
      source.fairBenchmark,
      source.fairBenchmark
        ? {}
        : {
            legacyFairnessUnknown: true,
            requestedCount: inferDeveloperComparisonBenchmarkFlips(source),
            actualCount:
              normalizeNonNegativeInteger(
                source.totalFlips || source.total || source.flipCount
              ) || null,
          }
    ),
  }
}

function dedupeDeveloperComparisonHistory(entries = []) {
  const normalizedEntries = entries
    .map((entry) => normalizeDeveloperComparisonHistoryEntry(entry))
    .filter(
      (entry) =>
        entry.evaluatedAt ||
        entry.benchmarkFlips !== null ||
        entry.resultPath ||
        entry.accuracy !== null ||
        entry.correct !== null ||
        entry.totalFlips !== null
    )
    .sort((left, right) => {
      const leftTime = left.evaluatedAt ? Date.parse(left.evaluatedAt) : 0
      const rightTime = right.evaluatedAt ? Date.parse(right.evaluatedAt) : 0
      return rightTime - leftTime
    })

  const uniqueEntries = []
  const seenKeys = new Set()

  normalizedEntries.forEach((entry) => {
    const key = [
      entry.evaluatedAt || '',
      entry.benchmarkFlips === null ? '' : String(entry.benchmarkFlips),
      entry.resultPath || '',
      entry.accuracy === null ? '' : String(entry.accuracy),
      entry.correct === null ? '' : String(entry.correct),
      entry.totalFlips === null ? '' : String(entry.totalFlips),
    ].join('::')

    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueEntries.push(entry)
    }
  })

  return uniqueEntries.slice(0, MAX_DEVELOPER_COMPARISON_HISTORY)
}

function normalizeDeveloperComparisonState(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const fallback = createDefaultDeveloperComparisonState()
  const history = dedupeDeveloperComparisonHistory(source.history)
  const latestEntry =
    history[0] ||
    normalizeDeveloperComparisonHistoryEntry({
      status: source.status,
      benchmarkFlips: source.benchmarkFlips,
      evaluatedAt: source.lastEvaluatedAt,
      resultPath: source.lastResultPath,
      holdoutPath: source.holdoutPath,
      accuracy: source.accuracy,
      correct: source.correct,
      totalFlips: source.totalFlips,
    })
  const bestAccuracy = history.reduce((best, entry) => {
    if (entry.accuracy === null) {
      return best
    }

    return best === null ? entry.accuracy : Math.max(best, entry.accuracy)
  }, normalizeAccuracyValue(source.bestAccuracy))

  return {
    ...fallback,
    ...source,
    status: normalizeDeveloperComparisonStatus(
      latestEntry?.status || source.status,
      fallback.status
    ),
    benchmarkFlips:
      latestEntry?.benchmarkFlips !== null
        ? latestEntry.benchmarkFlips
        : normalizeNonNegativeInteger(source.benchmarkFlips),
    holdoutPath:
      String(
        latestEntry?.holdoutPath || source.holdoutPath || fallback.holdoutPath
      ).trim() || null,
    lastEvaluatedAt:
      latestEntry?.evaluatedAt ||
      normalizeIsoDate(source.lastEvaluatedAt) ||
      fallback.lastEvaluatedAt,
    lastResultPath:
      String(
        latestEntry?.resultPath ||
          source.lastResultPath ||
          fallback.lastResultPath
      ).trim() || null,
    accuracy:
      latestEntry?.accuracy !== null
        ? latestEntry.accuracy
        : normalizeAccuracyValue(source.accuracy),
    correct:
      latestEntry?.correct !== null
        ? latestEntry.correct
        : normalizeNonNegativeInteger(source.correct),
    totalFlips:
      latestEntry?.totalFlips !== null
        ? latestEntry.totalFlips
        : normalizeNonNegativeInteger(source.totalFlips),
    bestAccuracy,
    fairBenchmark: normalizeDeveloperComparisonFairBenchmark(
      latestEntry?.fairBenchmark || source.fairBenchmark,
      !latestEntry?.fairBenchmark && !source.fairBenchmark
        ? {
            legacyFairnessUnknown: hasDeveloperComparisonMetrics(source),
            requestedCount:
              latestEntry?.benchmarkFlips ??
              normalizeNonNegativeInteger(source.benchmarkFlips),
            actualCount:
              latestEntry?.totalFlips ??
              normalizeNonNegativeInteger(source.totalFlips),
          }
        : {}
    ),
    history,
  }
}

function sanitizePublicDeveloperComparisonHistoryEntry(entry = {}) {
  const source = normalizeDeveloperComparisonHistoryEntry(entry)

  return {
    status: source.status,
    benchmarkFlips: source.benchmarkFlips,
    evaluatedAt: source.evaluatedAt,
    accuracy: source.accuracy,
    correct: source.correct,
    totalFlips: source.totalFlips,
    fairBenchmark: source.fairBenchmark,
  }
}

function sanitizePublicDeveloperComparisonState(value) {
  const source = normalizeDeveloperComparisonState(value)

  return {
    status: source.status,
    benchmarkFlips: source.benchmarkFlips,
    lastEvaluatedAt: source.lastEvaluatedAt,
    accuracy: source.accuracy,
    correct: source.correct,
    totalFlips: source.totalFlips,
    bestAccuracy: source.bestAccuracy,
    fairBenchmark: source.fairBenchmark,
    history: Array.isArray(source.history)
      ? source.history.map((entry) =>
          sanitizePublicDeveloperComparisonHistoryEntry(entry)
        )
      : [],
  }
}

function sanitizePublicDeveloperRunResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const source = value
  const acceptedRows = normalizeNonNegativeInteger(source.acceptedRows)
  const localTrainingEpochs = normalizeNonNegativeInteger(
    source.localTrainingEpochs
  )
  const localTrainingBatchSize = normalizeNonNegativeInteger(
    source.localTrainingBatchSize
  )
  const localTrainingLoraRank = normalizeNonNegativeInteger(
    source.localTrainingLoraRank
  )

  return {
    ok: source.ok === true,
    status: String(source.status || '').trim() || null,
    partialTrainingCompleted: source.partialTrainingCompleted === true,
    error: String(source.error || '').trim() || null,
    lastError: String(source.lastError || '').trim() || null,
    failureReason:
      String(
        source.failureReason || extractDeveloperTrainingFailureReason(source)
      ).trim() || null,
    acceptedRows,
    trainingBackend: String(source.trainingBackend || '').trim() || null,
    localTrainingProfile:
      String(source.localTrainingProfile || '').trim() || null,
    localTrainingThermalMode:
      String(source.localTrainingThermalMode || '').trim() || null,
    localTrainingEpochs,
    localTrainingBatchSize,
    localTrainingLoraRank,
    evaluatedAt: normalizeIsoDate(source.evaluatedAt),
    baselineAccuracy: normalizeAccuracyValue(source.baselineAccuracy),
    accuracy: normalizeAccuracyValue(source.accuracy),
    correct: normalizeNonNegativeInteger(source.correct),
    totalFlips: normalizeNonNegativeInteger(
      source.totalFlips || source.total || source.flipCount
    ),
    deltaAccuracy: normalizeAccuracyValue(source.deltaAccuracy),
    fairBenchmark: normalizeDeveloperComparisonFairBenchmark(
      source.fairBenchmark,
      source.fairBenchmark
        ? {}
        : {
            legacyFairnessUnknown: true,
            requestedCount: normalizeNonNegativeInteger(
              source.requestedBenchmarkFlips || source.benchmarkFlips
            ),
            actualCount: normalizeNonNegativeInteger(
              source.totalFlips || source.total || source.flipCount
            ),
          }
    ),
    comparison100: source.comparison100
      ? sanitizePublicDeveloperComparisonState(source.comparison100)
      : null,
  }
}

function readComparisonMetric(source, candidates = []) {
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

function extractDeveloperComparisonSnapshot(
  result,
  {resultPath = null, holdoutPath = null, fallbackStatus = 'evaluated'} = {}
) {
  const source =
    result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  const accuracy = normalizeAccuracyValue(
    readComparisonMetric(source, [
      ['accuracy'],
      ['summary', 'accuracy'],
      ['metrics', 'accuracy'],
      ['result', 'accuracy'],
      ['comparison100', 'accuracy'],
    ])
  )
  const correct = normalizeNonNegativeInteger(
    readComparisonMetric(source, [
      ['correct'],
      ['summary', 'correct'],
      ['metrics', 'correct'],
      ['result', 'correct'],
      ['comparison100', 'correct'],
    ])
  )
  const totalFlips = normalizeNonNegativeInteger(
    readComparisonMetric(source, [
      ['totalFlips'],
      ['total'],
      ['flipCount'],
      ['summary', 'totalFlips'],
      ['summary', 'total'],
      ['metrics', 'totalFlips'],
      ['result', 'totalFlips'],
      ['comparison100', 'totalFlips'],
    ])
  )

  if (accuracy === null && correct === null && totalFlips === null) {
    return null
  }

  const evaluatedAt = normalizeIsoDate(
    readComparisonMetric(source, [
      ['evaluatedAt'],
      ['lastEvaluatedAt'],
      ['generatedAt'],
      ['summary', 'evaluatedAt'],
      ['comparison100', 'lastEvaluatedAt'],
    ])
  )
  const resolvedResultPath =
    String(
      readComparisonMetric(source, [
        ['resultPath'],
        ['lastResultPath'],
        ['path'],
        ['comparison100', 'lastResultPath'],
      ]) ||
        resultPath ||
        ''
    ).trim() || null
  const resolvedHoldoutPath =
    String(
      readComparisonMetric(source, [
        ['holdoutPath'],
        ['comparison100', 'holdoutPath'],
      ]) ||
        holdoutPath ||
        ''
    ).trim() || null
  const fairBenchmark = normalizeDeveloperComparisonFairBenchmark(
    readComparisonMetric(source, [
      ['fairBenchmark'],
      ['summary', 'fairBenchmark'],
      ['comparison100', 'fairBenchmark'],
    ]),
    {
      legacyFairnessUnknown: true,
      requestedCount: inferDeveloperComparisonBenchmarkFlips(source),
      actualCount: totalFlips,
    }
  )

  return normalizeDeveloperComparisonHistoryEntry({
    status: fallbackStatus,
    evaluatedAt: evaluatedAt || new Date().toISOString(),
    resultPath: resolvedResultPath,
    holdoutPath: resolvedHoldoutPath,
    accuracy,
    correct,
    totalFlips,
    fairBenchmark,
  })
}

function mergeDeveloperComparisonSnapshot(
  currentComparison,
  snapshot,
  fallbackStatus = 'evaluated'
) {
  const normalizedCurrent = normalizeDeveloperComparisonState(currentComparison)

  if (!snapshot) {
    return {
      ...normalizedCurrent,
      status: normalizeDeveloperComparisonStatus(
        normalizedCurrent.status,
        fallbackStatus
      ),
    }
  }

  return normalizeDeveloperComparisonState({
    ...normalizedCurrent,
    status: normalizeDeveloperComparisonStatus(snapshot.status, fallbackStatus),
    benchmarkFlips:
      snapshot.benchmarkFlips !== null
        ? snapshot.benchmarkFlips
        : normalizedCurrent.benchmarkFlips,
    holdoutPath: snapshot.holdoutPath || normalizedCurrent.holdoutPath,
    lastEvaluatedAt: snapshot.evaluatedAt || normalizedCurrent.lastEvaluatedAt,
    lastResultPath: snapshot.resultPath || normalizedCurrent.lastResultPath,
    accuracy:
      snapshot.accuracy !== null
        ? snapshot.accuracy
        : normalizedCurrent.accuracy,
    correct:
      snapshot.correct !== null ? snapshot.correct : normalizedCurrent.correct,
    totalFlips:
      snapshot.totalFlips !== null
        ? snapshot.totalFlips
        : normalizedCurrent.totalFlips,
    fairBenchmark: snapshot.fairBenchmark || normalizedCurrent.fairBenchmark,
    history: [snapshot, ...normalizedCurrent.history],
  })
}

function normalizeDeveloperComparisonExampleAnswer(value) {
  const nextValue = String(value || '')
    .trim()
    .toLowerCase()

  return ['left', 'right', 'skip'].includes(nextValue) ? nextValue : null
}

function sanitizeDeveloperComparisonTraceValue(value, depth = 0) {
  if (value === null || typeof value === 'undefined') {
    return null
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_DEVELOPER_COMPARISON_TRACE_STRING_LENGTH)
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (depth >= MAX_DEVELOPER_COMPARISON_TRACE_DEPTH) {
    return '[truncated]'
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DEVELOPER_COMPARISON_TRACE_ARRAY_ITEMS)
      .map((item) => sanitizeDeveloperComparisonTraceValue(item, depth + 1))

    if (value.length > MAX_DEVELOPER_COMPARISON_TRACE_ARRAY_ITEMS) {
      items.push(
        `… ${
          value.length - MAX_DEVELOPER_COMPARISON_TRACE_ARRAY_ITEMS
        } more items`
      )
    }

    return items
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(
      0,
      MAX_DEVELOPER_COMPARISON_TRACE_OBJECT_KEYS
    )
    const next = {}

    entries.forEach(([key, item]) => {
      const normalizedKey = String(key).slice(0, 64)
      const safeKey =
        normalizedKey === '__proto__' ||
        normalizedKey === 'prototype' ||
        normalizedKey === 'constructor'
          ? `_${normalizedKey}`
          : normalizedKey

      next[safeKey] = sanitizeDeveloperComparisonTraceValue(item, depth + 1)
    })

    if (
      Object.keys(value).length > MAX_DEVELOPER_COMPARISON_TRACE_OBJECT_KEYS
    ) {
      next.__truncated_keys__ =
        Object.keys(value).length - MAX_DEVELOPER_COMPARISON_TRACE_OBJECT_KEYS
    }

    return next
  }

  return String(value).slice(0, MAX_DEVELOPER_COMPARISON_TRACE_STRING_LENGTH)
}

function normalizeDeveloperComparisonExampleEntry(entry = {}) {
  const source =
    entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
  const normalizedSampleId = String(
    source.sampleId || source.sample_id || source.taskId || ''
  ).trim()
  let normalizedCorrect = null

  if (typeof source.correct === 'boolean') {
    normalizedCorrect = source.correct
  } else if (source.correct !== null && typeof source.correct !== 'undefined') {
    normalizedCorrect = Boolean(source.correct)
  }

  return {
    index: normalizeNonNegativeInteger(source.index),
    sampleId: normalizedSampleId || null,
    flipHash:
      String(source.flipHash || source.flip_hash || source.hash || '').trim() ||
      null,
    expected: normalizeDeveloperComparisonExampleAnswer(source.expected),
    predicted: normalizeDeveloperComparisonExampleAnswer(source.predicted),
    generatedPrediction: normalizeDeveloperComparisonExampleAnswer(
      source.generatedPrediction
    ),
    scoredPrediction: normalizeDeveloperComparisonExampleAnswer(
      source.scoredPrediction
    ),
    selectedCandidate:
      String(source.selectedCandidate || '')
        .trim()
        .toLowerCase() || null,
    generatedCandidate:
      String(source.generatedCandidate || '')
        .trim()
        .toLowerCase() || null,
    scoredCandidate:
      String(source.scoredCandidate || '')
        .trim()
        .toLowerCase() || null,
    correct: normalizedCorrect,
    rankingSource: String(source.rankingSource || '').trim() || null,
    rawResponse:
      String(source.rawResponse || '')
        .trim()
        .slice(0, 4000) || null,
    parsedResponse:
      source.parsedResponse &&
      typeof source.parsedResponse === 'object' &&
      !Array.isArray(source.parsedResponse)
        ? sanitizeDeveloperComparisonTraceValue(source.parsedResponse)
        : null,
    candidateScores:
      source.candidateScores &&
      typeof source.candidateScores === 'object' &&
      !Array.isArray(source.candidateScores)
        ? sanitizeDeveloperComparisonTraceValue(source.candidateScores)
        : null,
    candidateAnalyses:
      source.candidateAnalyses &&
      typeof source.candidateAnalyses === 'object' &&
      !Array.isArray(source.candidateAnalyses)
        ? sanitizeDeveloperComparisonTraceValue(source.candidateAnalyses)
        : null,
    optionAMapsTo:
      String(source.optionAMapsTo || source.option_a_maps_to || '')
        .trim()
        .toLowerCase() || null,
    optionBMapsTo:
      String(source.optionBMapsTo || source.option_b_maps_to || '')
        .trim()
        .toLowerCase() || null,
  }
}

function buildDeveloperComparisonExampleDetails(entry = null) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null
  }

  return {
    predicted: entry.predicted,
    generatedPrediction: entry.generatedPrediction,
    scoredPrediction: entry.scoredPrediction,
    correct: entry.correct,
    selectedCandidate: entry.selectedCandidate,
    generatedCandidate: entry.generatedCandidate,
    scoredCandidate: entry.scoredCandidate,
    rawResponse: entry.rawResponse || null,
    parsedResponse: entry.parsedResponse || null,
    candidateScores: entry.candidateScores || null,
    candidateAnalyses: entry.candidateAnalyses || null,
    optionAMapsTo: entry.optionAMapsTo || null,
    optionBMapsTo: entry.optionBMapsTo || null,
  }
}

async function readJsonFileIfExists(filePath, fallbackValue = null) {
  const targetPath = String(filePath || '').trim()

  if (!targetPath) {
    return fallbackValue
  }

  try {
    const raw = await fs.promises.readFile(targetPath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue
    }

    throw error
  }
}

function normalizeDeveloperComparisonSummary(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  return {
    evaluatedAt: normalizeIsoDate(source.evaluatedAt),
    accuracy: normalizeAccuracyValue(source.accuracy),
    correct: normalizeNonNegativeInteger(source.correct),
    totalFlips: normalizeNonNegativeInteger(
      source.totalFlips || source.total || source.flipCount
    ),
    deltaAccuracy: normalizeAccuracyValue(source.deltaAccuracy),
    fairBenchmark: normalizeDeveloperComparisonFairBenchmark(
      source.fairBenchmark,
      source.fairBenchmark
        ? {}
        : {
            legacyFairnessUnknown: true,
            requestedCount: normalizeNonNegativeInteger(source.benchmarkFlips),
            actualCount: normalizeNonNegativeInteger(
              source.totalFlips || source.total || source.flipCount
            ),
          }
    ),
  }
}

async function loadDeveloperComparisonArtifact(
  developerDir,
  comparisonEntry = {}
) {
  const resultPath = String(comparisonEntry.resultPath || '').trim()

  if (!resultPath) {
    return null
  }

  const comparisonSummaryPath = resolveWorkspaceChildPath(
    developerDir,
    resultPath
  )
  const comparisonSummary = await readJsonFileIfExists(
    comparisonSummaryPath,
    null
  )

  if (
    !comparisonSummary ||
    typeof comparisonSummary !== 'object' ||
    Array.isArray(comparisonSummary)
  ) {
    return null
  }

  const baselineResultPath = String(
    comparisonSummary?.baseline?.resultPath || ''
  ).trim()
  const trainedResultPath = String(
    comparisonSummary?.trained?.resultPath || ''
  ).trim()
  const _baselineResult = baselineResultPath
    ? await readJsonFileIfExists(
        resolveWorkspaceChildPath(developerDir, baselineResultPath),
        null
      )
    : null
  const trainedResult = trainedResultPath
    ? await readJsonFileIfExists(
        resolveWorkspaceChildPath(developerDir, trainedResultPath),
        null
      )
    : null
  const trainedResults = Array.isArray(trainedResult?.results)
    ? trainedResult.results.map((item) =>
        normalizeDeveloperComparisonExampleEntry(item)
      )
    : []
  const baselineResults = Array.isArray(_baselineResult?.results)
    ? _baselineResult.results.map((item) =>
        normalizeDeveloperComparisonExampleEntry(item)
      )
    : []

  return {
    entry: normalizeDeveloperComparisonHistoryEntry(comparisonEntry),
    summaryPath: comparisonSummaryPath,
    summary: normalizeDeveloperComparisonSummary(comparisonSummary),
    trainedResultPath: trainedResultPath
      ? resolveWorkspaceChildPath(developerDir, trainedResultPath)
      : null,
    baselineResultPath: baselineResultPath
      ? resolveWorkspaceChildPath(developerDir, baselineResultPath)
      : null,
    trainedResults,
    baselineResults,
    baselineSummary: normalizeDeveloperComparisonSummary(
      comparisonSummary?.baseline
    ),
    trainedSummary: normalizeDeveloperComparisonSummary(
      comparisonSummary?.trained
    ),
    hasDetailedResults: trainedResults.length > 0,
  }
}

function classifyDeveloperComparisonExampleChange(currentEntry, previousEntry) {
  const currentCorrect = currentEntry?.correct === true
  const previousCorrect = previousEntry?.correct === true

  if (previousEntry) {
    if (currentCorrect && !previousCorrect) {
      return 'improved'
    }

    if (!currentCorrect && previousCorrect) {
      return 'regressed'
    }

    if (currentCorrect && previousCorrect) {
      return 'unchanged_correct'
    }

    return 'unchanged_wrong'
  }

  return currentCorrect ? 'current_correct' : 'current_wrong'
}

function rankDeveloperComparisonExampleChange(changeType) {
  switch (changeType) {
    case 'improved':
      return 0
    case 'regressed':
      return 1
    case 'unchanged_wrong':
      return 2
    case 'unchanged_correct':
      return 3
    case 'current_wrong':
      return 4
    case 'current_correct':
      return 5
    default:
      return 6
  }
}

function createDeveloperComparisonReviewLookup(sample = null) {
  const lookup = new Map()
  const flips = Array.isArray(sample?.flips) ? sample.flips : []
  const sampleName = normalizeDeveloperHumanTeacherSampleName(
    sample?.sampleName
  )

  flips.forEach((flip, index) => {
    const absoluteIndex = index + 1
    const taskId = `demo:${sampleName}:${absoluteIndex}`
    const reviewTarget = {
      sampleName,
      taskId,
      taskNumber: absoluteIndex,
      offset:
        Math.floor(index / DEVELOPER_HUMAN_TEACHER_BATCH_SIZE) *
        DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
      sampleId:
        String(flip?.sample_id || flip?.sampleId || '').trim() || taskId,
      flipHash: String(flip?.flip_hash || flip?.flipHash || '').trim() || null,
    }
    const keys = uniqueStrings([
      taskId,
      reviewTarget.sampleId,
      reviewTarget.flipHash,
    ])

    keys.forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, reviewTarget)
      }
    })
  })

  return lookup
}

function selectDeveloperComparisonExamples({
  currentArtifact,
  previousArtifact = null,
  sample = null,
  maxExamples = 6,
} = {}) {
  const currentResults = Array.isArray(currentArtifact?.trainedResults)
    ? currentArtifact.trainedResults
    : []
  const baselineResults = Array.isArray(currentArtifact?.baselineResults)
    ? currentArtifact.baselineResults
    : []
  const previousResults = Array.isArray(previousArtifact?.trainedResults)
    ? previousArtifact.trainedResults
    : []
  const previousByFlipHash = new Map()
  const baselineByFlipHash = new Map()
  const reviewLookup = createDeveloperComparisonReviewLookup(sample)

  previousResults.forEach((entry) => {
    const key =
      entry.flipHash ||
      entry.sampleId ||
      (entry.index !== null ? `${entry.index}` : '')

    if (key && !previousByFlipHash.has(key)) {
      previousByFlipHash.set(key, entry)
    }
  })
  baselineResults.forEach((entry) => {
    const key =
      entry.flipHash ||
      entry.sampleId ||
      (entry.index !== null ? `${entry.index}` : '')

    if (key && !baselineByFlipHash.has(key)) {
      baselineByFlipHash.set(key, entry)
    }
  })

  const rankedExamples = currentResults
    .map((entry) => {
      const comparisonKey =
        entry.flipHash ||
        entry.sampleId ||
        (entry.index !== null ? `${entry.index}` : '')
      const baselineEntry = comparisonKey
        ? baselineByFlipHash.get(comparisonKey) || null
        : null
      const previousEntry = comparisonKey
        ? previousByFlipHash.get(comparisonKey) || null
        : null
      const changeType = classifyDeveloperComparisonExampleChange(
        entry,
        previousEntry
      )
      const reviewTarget =
        reviewLookup.get(entry.sampleId) ||
        reviewLookup.get(entry.flipHash) ||
        reviewLookup.get(comparisonKey) ||
        null
      let exampleIndex = null

      if (entry.index !== null) {
        exampleIndex = entry.index
      } else if (previousEntry && previousEntry.index !== null) {
        exampleIndex = previousEntry.index
      }

      return {
        flipHash: entry.flipHash,
        sampleId: entry.sampleId,
        benchmarkFlips:
          currentArtifact?.entry?.benchmarkFlips ||
          currentArtifact?.summary?.fairBenchmark?.requestedCount ||
          null,
        evaluatedAt:
          currentArtifact?.summary?.evaluatedAt ||
          currentArtifact?.entry?.evaluatedAt ||
          null,
        expected: entry.expected,
        current: {
          predicted: entry.predicted,
          correct: entry.correct,
          generatedPrediction: entry.generatedPrediction,
          scoredPrediction: entry.scoredPrediction,
        },
        baseline: baselineEntry
          ? {
              predicted: baselineEntry.predicted,
              correct: baselineEntry.correct,
              generatedPrediction: baselineEntry.generatedPrediction,
              scoredPrediction: baselineEntry.scoredPrediction,
            }
          : null,
        previous: previousEntry
          ? {
              predicted: previousEntry.predicted,
              correct: previousEntry.correct,
              generatedPrediction: previousEntry.generatedPrediction,
              scoredPrediction: previousEntry.scoredPrediction,
            }
          : null,
        currentDetails: buildDeveloperComparisonExampleDetails(entry),
        baselineDetails: buildDeveloperComparisonExampleDetails(baselineEntry),
        previousDetails: buildDeveloperComparisonExampleDetails(previousEntry),
        reviewTarget,
        changeType,
        order: rankDeveloperComparisonExampleChange(changeType),
        index: exampleIndex,
        rankingSource:
          entry.rankingSource || previousEntry?.rankingSource || null,
      }
    })
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order
      }

      const leftIndex =
        left.index === null ? Number.MAX_SAFE_INTEGER : left.index
      const rightIndex =
        right.index === null ? Number.MAX_SAFE_INTEGER : right.index

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }

      return String(left.flipHash || left.sampleId || '').localeCompare(
        String(right.flipHash || right.sampleId || '')
      )
    })

  return rankedExamples.slice(0, Math.max(1, maxExamples))
}

function createDefaultDemoHumanTeacherState({
  sampleName = DEFAULT_DEMO_SAMPLE_NAME,
  totalAvailableTasks = 0,
  currentOffset = 0,
} = {}) {
  return {
    schemaVersion: DEMO_HUMAN_TEACHER_STATE_VERSION,
    mode: 'demo-human-teacher',
    sampleName: normalizeDemoSampleName(sampleName),
    chunkSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: Math.max(
      0,
      Number.parseInt(totalAvailableTasks, 10) || 0
    ),
    currentOffset: normalizeDemoHumanTeacherOffset(currentOffset),
    annotatedTaskIds: [],
    trainedChunkOffsets: [],
    chunks: [],
    lastSavedAt: null,
    lastTraining: null,
  }
}

function normalizeDemoHumanTeacherState(
  state,
  {sampleName = DEFAULT_DEMO_SAMPLE_NAME, totalAvailableTasks = 0} = {}
) {
  const fallback = createDefaultDemoHumanTeacherState({
    sampleName,
    totalAvailableTasks,
  })
  const source =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const persistedTotal = Math.max(
    0,
    Number.parseInt(source.totalAvailableTasks, 10) || 0
  )
  const discoveredTotal = Math.max(
    0,
    Number.parseInt(totalAvailableTasks, 10) || 0
  )
  const total = Math.max(persistedTotal, discoveredTotal)

  return {
    ...fallback,
    ...source,
    sampleName: normalizeDemoSampleName(source.sampleName || sampleName),
    chunkSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: total,
    currentOffset: clampDemoHumanTeacherOffset(source.currentOffset, total),
    annotatedTaskIds: uniqueStrings(source.annotatedTaskIds),
    trainedChunkOffsets: uniqueNumbers(source.trainedChunkOffsets),
    chunks: Array.isArray(source.chunks)
      ? source.chunks
          .map((chunk) => {
            const raw =
              chunk && typeof chunk === 'object' && !Array.isArray(chunk)
                ? chunk
                : {}

            return {
              offset: normalizeDemoHumanTeacherOffset(raw.offset),
              taskIds: uniqueStrings(raw.taskIds),
              rowCount: Math.max(0, Number.parseInt(raw.rowCount, 10) || 0),
              committedAt: String(raw.committedAt || '').trim() || null,
              trainedAt: String(raw.trainedAt || '').trim() || null,
              trainingStatus:
                String(raw.trainingStatus || '').trim() || 'pending',
            }
          })
          .sort((left, right) => left.offset - right.offset)
      : [],
  }
}

function extractDeveloperTrainingFailureReason(result) {
  const source =
    result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  const rawError =
    source.error &&
    typeof source.error === 'object' &&
    !Array.isArray(source.error)
      ? source.error
      : null

  const candidates = [
    source.failureReason,
    source.message,
    source.reason,
    source.lastError,
    rawError?.message,
    typeof source.error === 'string' ? source.error : null,
    source.details,
    source.stderr,
    source.status,
  ]

  for (const candidate of candidates) {
    const message = String(candidate || '').trim()

    if (message) {
      return message.slice(0, 400)
    }
  }

  return null
}

function normalizeDeveloperLastTrainingState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const source = value
  const status = String(source.status || '').trim() || null
  const offset = Number.parseInt(source.offset, 10)
  const rowCount = Number.parseInt(source.rowCount, 10)

  return {
    at: String(source.at || '').trim() || null,
    status,
    offset: Number.isFinite(offset)
      ? normalizeDeveloperHumanTeacherOffset(offset)
      : null,
    rowCount: Number.isFinite(rowCount) && rowCount > 0 ? rowCount : 0,
    failureReason:
      status === 'failed'
        ? String(
            source.failureReason ||
              extractDeveloperTrainingFailureReason(source.result)
          ).trim() || null
        : null,
    result: null,
  }
}

function normalizeDeveloperActiveRunState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const source = value
  const kind = String(source.kind || '')
    .trim()
    .toLowerCase()
  const status = String(source.status || '')
    .trim()
    .toLowerCase()
  const stage =
    String(source.stage || '')
      .trim()
      .toLowerCase() || null
  const message = String(source.message || '').trim() || null
  const sampleName = String(source.sampleName || '').trim()
  const currentEpoch = Number.parseInt(source.currentEpoch, 10)
  const totalEpochs = Number.parseInt(source.totalEpochs, 10)
  const currentStep = Number.parseInt(source.currentStep, 10)
  const stepsPerEpoch = Number.parseInt(source.stepsPerEpoch, 10)
  const totalSteps = Number.parseInt(source.totalSteps, 10)
  const stageIndex = Number.parseInt(source.stageIndex, 10)
  const stageCount = Number.parseInt(source.stageCount, 10)
  const chunkOffset = Number.parseInt(source.chunkOffset, 10)
  const chunkSize = Number.parseInt(source.chunkSize, 10)
  const benchmarkCurrent = Number.parseInt(source.benchmarkCurrent, 10)
  const benchmarkTotal = Number.parseInt(source.benchmarkTotal, 10)
  const evaluationFlips = Number.parseInt(source.evaluationFlips, 10)
  const progressPercent = roundTelemetryValue(source.progressPercent, 1)
  const latestLoss = roundTelemetryValue(source.latestLoss, 6)
  const benchmarkPhase =
    String(source.benchmarkPhase || '')
      .trim()
      .toLowerCase() || null
  const stopMode =
    String(source.stopMode || '')
      .trim()
      .toLowerCase() || null
  const currentFlipHash = String(source.currentFlipHash || '').trim() || null
  const trainingThermalMode = normalizeDeveloperTrainingThermalMode(
    source.trainingThermalMode
  )
  const benchmarkThermalMode = normalizeDeveloperTrainingThermalMode(
    source.benchmarkThermalMode
  )

  if (!kind || !status) {
    return null
  }

  return {
    kind,
    status,
    stage,
    stageIndex:
      Number.isFinite(stageIndex) && stageIndex > 0 ? stageIndex : null,
    stageCount:
      Number.isFinite(stageCount) && stageCount > 0 ? stageCount : null,
    progressPercent:
      Number.isFinite(progressPercent) && progressPercent >= 0
        ? Math.min(100, Math.max(0, progressPercent))
        : null,
    message,
    sampleName: sampleName
      ? normalizeDeveloperHumanTeacherSampleName(sampleName)
      : null,
    chunkOffset:
      Number.isFinite(chunkOffset) && chunkOffset >= 0
        ? normalizeDeveloperHumanTeacherOffset(chunkOffset)
        : null,
    chunkSize: Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : null,
    currentEpoch:
      Number.isFinite(currentEpoch) && currentEpoch > 0 ? currentEpoch : null,
    totalEpochs:
      Number.isFinite(totalEpochs) && totalEpochs > 0 ? totalEpochs : null,
    currentStep:
      Number.isFinite(currentStep) && currentStep > 0 ? currentStep : null,
    stepsPerEpoch:
      Number.isFinite(stepsPerEpoch) && stepsPerEpoch > 0
        ? stepsPerEpoch
        : null,
    totalSteps:
      Number.isFinite(totalSteps) && totalSteps > 0 ? totalSteps : null,
    latestLoss:
      Number.isFinite(latestLoss) && latestLoss >= 0 ? latestLoss : null,
    benchmarkPhase,
    stopMode,
    benchmarkCurrent:
      Number.isFinite(benchmarkCurrent) && benchmarkCurrent > 0
        ? benchmarkCurrent
        : null,
    benchmarkTotal:
      Number.isFinite(benchmarkTotal) && benchmarkTotal > 0
        ? benchmarkTotal
        : null,
    evaluationFlips:
      Number.isFinite(evaluationFlips) && evaluationFlips > 0
        ? evaluationFlips
        : null,
    currentFlipHash,
    trainingThermalMode,
    benchmarkThermalMode,
    startedAt: normalizeIsoDate(source.startedAt),
    stageStartedAt:
      normalizeIsoDate(source.stageStartedAt) ||
      normalizeIsoDate(source.startedAt),
    updatedAt:
      normalizeIsoDate(source.updatedAt) || normalizeIsoDate(source.startedAt),
  }
}

function createDefaultDeveloperHumanTeacherState({
  sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
  totalAvailableTasks = 0,
  currentOffset = 0,
} = {}) {
  return {
    schemaVersion: DEVELOPER_HUMAN_TEACHER_STATE_VERSION,
    mode: 'developer-human-teacher',
    sampleName: normalizeDeveloperHumanTeacherSampleName(sampleName),
    chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: Math.max(
      0,
      Number.parseInt(totalAvailableTasks, 10) || 0
    ),
    currentOffset: normalizeDeveloperHumanTeacherOffset(currentOffset),
    annotatedTaskIds: [],
    pendingTrainingTaskIds: [],
    trainedTaskIds: [],
    chunks: [],
    lastSavedAt: null,
    lastTraining: null,
    activeTrainingModelPath: null,
    activeTrainingBackend: null,
    activeLocalTrainingProfile: null,
    activeLocalTrainingThermalMode: null,
    activeRun: null,
    comparison100: createDefaultDeveloperComparisonState(),
  }
}

function normalizeDeveloperHumanTeacherState(
  state,
  {
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    totalAvailableTasks = 0,
  } = {}
) {
  const fallback = createDefaultDeveloperHumanTeacherState({
    sampleName,
    totalAvailableTasks,
  })
  const source =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const persistedTotal = Math.max(
    0,
    Number.parseInt(source.totalAvailableTasks, 10) || 0
  )
  const discoveredTotal = Math.max(
    0,
    Number.parseInt(totalAvailableTasks, 10) || 0
  )
  const total = Math.max(persistedTotal, discoveredTotal)

  return {
    ...fallback,
    ...source,
    sampleName: normalizeDeveloperHumanTeacherSampleName(
      source.sampleName || sampleName
    ),
    chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
    totalAvailableTasks: total,
    currentOffset: clampDeveloperHumanTeacherOffset(
      source.currentOffset,
      total
    ),
    annotatedTaskIds: uniqueStrings(source.annotatedTaskIds),
    pendingTrainingTaskIds: uniqueStrings(source.pendingTrainingTaskIds),
    trainedTaskIds: uniqueStrings(source.trainedTaskIds),
    activeTrainingModelPath:
      String(source.activeTrainingModelPath || '').trim() || null,
    activeTrainingBackend:
      String(source.activeTrainingBackend || '').trim() || null,
    activeLocalTrainingProfile:
      String(source.activeLocalTrainingProfile || '').trim() || null,
    activeLocalTrainingThermalMode:
      String(source.activeLocalTrainingThermalMode || '').trim() || null,
    activeRun: normalizeDeveloperActiveRunState(source.activeRun),
    lastTraining: normalizeDeveloperLastTrainingState(source.lastTraining),
    chunks: Array.isArray(source.chunks)
      ? source.chunks
          .map((chunk) => {
            const raw =
              chunk && typeof chunk === 'object' && !Array.isArray(chunk)
                ? chunk
                : {}

            return {
              offset: normalizeDeveloperHumanTeacherOffset(raw.offset),
              taskIds: uniqueStrings(raw.taskIds),
              rowCount: Math.max(0, Number.parseInt(raw.rowCount, 10) || 0),
              committedAt: String(raw.committedAt || '').trim() || null,
              trainedAt: String(raw.trainedAt || '').trim() || null,
              trainingStatus:
                String(raw.trainingStatus || '').trim() || 'pending',
              normalizedPath: String(raw.normalizedPath || '').trim() || null,
              summaryPath: String(raw.summaryPath || '').trim() || null,
            }
          })
          .sort((left, right) => left.offset - right.offset)
      : [],
    comparison100: normalizeDeveloperComparisonState(source.comparison100),
  }
}

function assertPastHumanTeacherEpoch(epoch, currentEpoch, action) {
  if (currentEpoch === null) {
    return
  }

  if (epoch >= currentEpoch) {
    throw new Error(
      `Human-teacher ${action} is only available after the session finishes and consensus exists for a past epoch`
    )
  }
}

function reduceLatestCaptures(captures) {
  const uniqueCaptures = new Map()

  captures.forEach((capture) => {
    uniqueCaptures.set(capture.flipHash, capture)
  })

  return Array.from(uniqueCaptures.values())
}

function getExclusionReasons(capture, epoch) {
  const reasons = []

  if (!capture.flipHash) {
    reasons.push('missing_flip_hash')
  }

  if (capture.epoch === null) {
    reasons.push('missing_epoch')
  } else if (capture.epoch !== epoch) {
    reasons.push('epoch_mismatch')
  }

  if (!capture.consensus || !capture.consensus.finalAnswer) {
    reasons.push('missing_consensus')
  } else if (!hasEligibleConsensusAnswer(capture.consensus)) {
    reasons.push('invalid_consensus')
  }

  if (capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (!capture.panelCount) {
    reasons.push('missing_local_metadata')
  }

  return reasons
}

function getCaptureSkipReasons(payload, capture) {
  const reasons = []
  const explicitConsensus = hasExplicitConsensus(payload)

  if (capture && capture.consensus && capture.consensus.reported) {
    reasons.push('reported')
  }

  if (capture && capture.consensus && capture.consensus.finalAnswer) {
    if (!hasEligibleConsensusAnswer(capture.consensus)) {
      reasons.push('invalid_consensus')
    }
  } else if (explicitConsensus) {
    reasons.push('missing_consensus')
  }

  return reasons
}

function collectInconsistencyFlags(excluded) {
  const flags = new Set()

  excluded.forEach(({reasons}) => {
    if (reasons.includes('missing_consensus')) {
      flags.add('contains_unresolved_captures')
    }

    if (reasons.includes('reported')) {
      flags.add('contains_reported_captures')
    }

    if (reasons.includes('invalid_consensus')) {
      flags.add('contains_invalid_consensus')
    }

    if (reasons.includes('epoch_mismatch')) {
      flags.add('contains_other_epoch_captures')
    }

    if (reasons.includes('missing_local_metadata')) {
      flags.add('contains_incomplete_metadata')
    }
  })

  return Array.from(flags)
}

function normalizePackagedCapturedAt(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    throw new Error('captured_at_required')
  }

  const nextDate = new Date(raw)

  if (!Number.isFinite(nextDate.getTime())) {
    throw new Error('captured_at_invalid')
  }

  return nextDate.toISOString()
}

function buildTrainingCandidateItem(capture) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error('invalid_capture')
  }

  if (!capture.consensus || !hasEligibleConsensusAnswer(capture.consensus)) {
    throw new Error('final_consensus_required')
  }

  return {
    flipHash: capture.flipHash,
    epoch: capture.epoch,
    sessionType: capture.sessionType,
    panelCount: capture.panelCount,
    timestamp: Number(capture.timestamp),
    capturedAt: normalizePackagedCapturedAt(capture.capturedAt),
    finalAnswer: capture.consensus.finalAnswer,
    orders: Array.isArray(capture.orders) ? capture.orders : [],
    words: Array.isArray(capture.words) ? capture.words : [],
    selectedOrder: capture.selectedOrder || null,
    relevance: capture.relevance || null,
    best: capture.best === true,
    author: capture.author || null,
  }
}

function sortHumanTeacherItems(items) {
  return items.slice().sort((left, right) => {
    const leftBest = left.best === true ? 1 : 0
    const rightBest = right.best === true ? 1 : 0

    if (leftBest !== rightBest) {
      return rightBest - leftBest
    }

    const leftWeight = Number(left.trainingWeight) || 0
    const rightWeight = Number(right.trainingWeight) || 0

    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight
    }

    const leftTimestamp = Number(left.timestamp) || 0
    const rightTimestamp = Number(right.timestamp) || 0

    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp
    }

    return String(left.flipHash || '').localeCompare(
      String(right.flipHash || '')
    )
  })
}

function buildHumanTeacherItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('invalid_item')
  }

  const flipHash = String(item.flipHash || item.cid || '').trim()

  if (!flipHash) {
    throw new Error('flip_hash_required')
  }

  const finalAnswer = String(
    item.finalAnswer || item.consensusLabel || ''
  ).trim()

  if (!hasEligibleConsensusAnswer({finalAnswer})) {
    throw new Error('final_consensus_required')
  }

  const payloadPath = normalizeFilePath(item.payloadPath)

  if (!payloadPath) {
    throw new Error('payload_path_required')
  }

  return {
    taskId: `${flipHash}::human-teacher`,
    sampleId: `${flipHash}::human-teacher`,
    flipHash,
    epoch: normalizeEpoch(item.epoch),
    sessionType: normalizeSessionType(item.sessionType),
    panelCount: normalizePanelCount(item.panelCount),
    timestamp: Number(item.timestamp),
    capturedAt: normalizePackagedCapturedAt(item.capturedAt),
    finalAnswer,
    consensusStrength: String(item.consensusStrength || '').trim() || null,
    orders: Array.isArray(item.orders) ? item.orders : [],
    selectedOrder: item.selectedOrder || null,
    relevance: item.relevance || null,
    best: item.best === true,
    author:
      normalizeAuthor(item.author) ||
      normalizeAuthor(item.audit && item.audit.author) ||
      null,
    payloadPath,
    trainingWeight:
      Number.isFinite(Number(item.trainingWeight)) &&
      Number(item.trainingWeight) > 0
        ? Number(item.trainingWeight)
        : null,
    rankingSource: String(item.rankingSource || '').trim() || null,
    source:
      item.source &&
      typeof item.source === 'object' &&
      !Array.isArray(item.source)
        ? item.source
        : null,
    words:
      item.words && typeof item.words === 'object' && !Array.isArray(item.words)
        ? item.words
        : {
            localNode: {},
            publicIndexer: {},
          },
    audit:
      item.audit && typeof item.audit === 'object' && !Array.isArray(item.audit)
        ? item.audit
        : null,
    annotationStatus: 'pending',
    annotationHints: {
      requiresFrameCaptions: true,
      requiresTextCheck: true,
      requiresChronologyExplanation: true,
      requiresReportabilityCheck: true,
    },
  }
}

function buildDefaultHumanTeacherAnnotationRow(task = {}) {
  return {
    task_id: String(task.task_id || task.taskId || '').trim(),
    sample_id: String(task.sample_id || task.sampleId || '').trim(),
    flip_hash: String(task.flip_hash || task.flipHash || '').trim(),
    epoch:
      task.epoch === null || typeof task.epoch === 'undefined'
        ? null
        : task.epoch,
    consensus_answer: String(
      task.final_answer || task.finalAnswer || task.consensusAnswer || ''
    ).trim(),
    consensus_strength: String(
      task.consensus_strength || task.consensusStrength || ''
    ).trim(),
    annotator: '',
    frame_captions: ['', '', '', ''],
    option_a_summary: '',
    option_b_summary: '',
    ai_annotation: null,
    ai_annotation_feedback: '',
    panel_references: ['A', 'B', 'C'].map((code) => ({
      code,
      description: '',
      panel_index: null,
      x: null,
      y: null,
    })),
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    final_answer: '',
    why_answer: '',
    confidence: null,
    benchmark_review: {
      context: {
        expected_answer: '',
        ai_prediction: '',
        baseline_prediction: '',
        previous_prediction: '',
        benchmark_flips: null,
        evaluated_at: '',
        change_type: '',
        ai_correct: null,
      },
      correction: {
        issue_type: '',
        failure_note: '',
        retraining_hint: '',
        include_for_training: null,
      },
    },
    benchmark_review_issue_type: '',
    benchmark_review_failure_note: '',
    benchmark_review_retraining_hint: '',
    benchmark_review_include_for_training: null,
  }
}

function normalizeHumanTeacherBenchmarkReviewContext(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const expectedAnswer = normalizeHumanTeacherDraftText(
    source.expected_answer ?? source.expectedAnswer,
    16
  ).toLowerCase()
  const aiPrediction = normalizeHumanTeacherDraftText(
    source.ai_prediction ?? source.aiPrediction,
    16
  ).toLowerCase()
  const baselinePrediction = normalizeHumanTeacherDraftText(
    source.baseline_prediction ?? source.baselinePrediction,
    16
  ).toLowerCase()
  const previousPrediction = normalizeHumanTeacherDraftText(
    source.previous_prediction ?? source.previousPrediction,
    16
  ).toLowerCase()
  const changeType = normalizeHumanTeacherDraftText(
    source.change_type ?? source.changeType,
    32
  )
    .toLowerCase()
    .replace(/\s+/gu, '_')

  return {
    expected_answer: ['left', 'right', 'skip'].includes(expectedAnswer)
      ? expectedAnswer
      : '',
    ai_prediction: ['left', 'right', 'skip'].includes(aiPrediction)
      ? aiPrediction
      : '',
    baseline_prediction: ['left', 'right', 'skip'].includes(baselinePrediction)
      ? baselinePrediction
      : '',
    previous_prediction: ['left', 'right', 'skip'].includes(previousPrediction)
      ? previousPrediction
      : '',
    benchmark_flips: normalizeNonNegativeInteger(
      source.benchmark_flips ?? source.benchmarkFlips
    ),
    evaluated_at: normalizeHumanTeacherDraftText(
      source.evaluated_at ?? source.evaluatedAt,
      64
    ),
    change_type: changeType,
    ai_correct: normalizeHumanTeacherDraftBool(
      source.ai_correct ?? source.aiCorrect
    ),
  }
}

function normalizeHumanTeacherBenchmarkReviewLayer(source = {}, aliases = {}) {
  const nestedSource =
    source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  const aliasSource =
    aliases && typeof aliases === 'object' && !Array.isArray(aliases)
      ? aliases
      : {}
  let includeForTrainingSource
  if (typeof nestedSource?.correction?.include_for_training !== 'undefined') {
    includeForTrainingSource = nestedSource.correction.include_for_training
  } else if (
    typeof nestedSource?.correction?.includeForTraining !== 'undefined'
  ) {
    includeForTrainingSource = nestedSource.correction.includeForTraining
  } else {
    includeForTrainingSource =
      aliasSource.benchmark_review_include_for_training ??
      aliasSource.benchmarkReviewIncludeForTraining
  }

  const normalizedCorrection = {
    issue_type: normalizeHumanTeacherBenchmarkReviewIssueType(
      nestedSource?.correction?.issue_type ??
        nestedSource?.correction?.issueType ??
        aliasSource.benchmark_review_issue_type ??
        aliasSource.benchmarkReviewIssueType
    ),
    failure_note: normalizeHumanTeacherDraftText(
      nestedSource?.correction?.failure_note ??
        nestedSource?.correction?.failureNote ??
        aliasSource.benchmark_review_failure_note ??
        aliasSource.benchmarkReviewFailureNote,
      900
    ),
    retraining_hint: normalizeHumanTeacherDraftText(
      nestedSource?.correction?.retraining_hint ??
        nestedSource?.correction?.retrainingHint ??
        aliasSource.benchmark_review_retraining_hint ??
        aliasSource.benchmarkReviewRetrainingHint,
      900
    ),
    include_for_training: normalizeHumanTeacherDraftBool(
      includeForTrainingSource
    ),
  }

  return {
    context: normalizeHumanTeacherBenchmarkReviewContext(
      nestedSource.context || nestedSource.source || nestedSource
    ),
    correction: normalizedCorrection,
  }
}

function buildDefaultHumanTeacherAiAnnotation() {
  return {
    task_id: '',
    generated_at: '',
    runtime_backend: '',
    runtime_type: '',
    model: '',
    vision_model: '',
    ordered_panel_descriptions: Array.from({length: 8}, () => ''),
    ordered_panel_text: Array.from({length: 8}, () => ''),
    option_a_story_analysis: '',
    option_b_story_analysis: '',
    final_answer: '',
    why_answer: '',
    confidence: null,
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    option_a_summary: '',
    option_b_summary: '',
    rating: '',
  }
}

function normalizeHumanTeacherAiAnnotationRating(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['good', 'bad', 'wrong'].includes(next) ? next : ''
}

function normalizeHumanTeacherDraftList(
  value,
  {maxItems = 8, maxLength = 280} = {}
) {
  let items = []

  if (Array.isArray(value)) {
    items = value
  } else if (value && typeof value === 'object') {
    items = Object.entries(value)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([_key, item]) => item)
  }

  const next = items
    .slice(0, maxItems)
    .map((item) => normalizeHumanTeacherDraftText(item, maxLength))

  while (next.length < maxItems) {
    next.push('')
  }

  return next
}

function hasHumanTeacherDraftListContent(value = []) {
  return Array.isArray(value) && value.some((item) => Boolean(item))
}

function normalizeHumanTeacherDraftText(value, maxLength = 2000) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

function normalizeHumanTeacherDraftBool(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  const raw = String(value).trim().toLowerCase()

  if (['true', 'yes', '1'].includes(raw)) {
    return true
  }

  if (['false', 'no', '0'].includes(raw)) {
    return false
  }

  return null
}

function normalizeHumanTeacherDraftConfidence(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  if (parsed <= 1) {
    return Math.min(5, Math.max(1, Math.round(parsed * 4 + 1)))
  }

  if (parsed > 5) {
    return null
  }

  return Math.round(parsed)
}

function normalizeHumanTeacherBenchmarkReviewIssueType(value) {
  const next = normalizeHumanTeacherDraftText(value, 64)
    .toLowerCase()
    .replace(/\s+/gu, '_')

  return [
    'wrong_answer',
    'missed_text',
    'sequence_confusion',
    'reportability_miss',
    'weak_reasoning',
    'panel_read_failure',
    'ambiguous_flip',
    'other',
  ].includes(next)
    ? next
    : ''
}

function normalizeHumanTeacherDraftCaptions(value) {
  const next = Array.isArray(value) ? value.slice(0, 4) : []

  while (next.length < 4) {
    next.push('')
  }

  return next.map((item) => normalizeHumanTeacherDraftText(item, 400))
}

function normalizeHumanTeacherDraftPanelIndex(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
    return null
  }

  return parsed
}

function normalizeHumanTeacherDraftPanelCoordinate(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizeHumanTeacherDraftPanelReferences(value) {
  let source = []

  if (Array.isArray(value)) {
    source = value
  } else if (value && typeof value === 'object') {
    source = ['A', 'B', 'C'].map((code) => {
      const raw =
        value[code] ||
        value[code.toLowerCase()] ||
        value[String(code || '').toUpperCase()] ||
        {}

      return typeof raw === 'string' ? {code, description: raw} : {code, ...raw}
    })
  }
  const byCode = new Map(
    source
      .map((entry, index) => {
        const code = String(entry?.code || ['A', 'B', 'C'][index] || '')
          .trim()
          .toUpperCase()

        return [code, entry]
      })
      .filter(([code]) => ['A', 'B', 'C'].includes(code))
  )

  return ['A', 'B', 'C'].map((code) => {
    const raw = byCode.get(code) || {}
    const panelIndex = normalizeHumanTeacherDraftPanelIndex(
      raw.panel_index ?? raw.panelIndex
    )

    return {
      code,
      description: normalizeHumanTeacherDraftText(raw.description, 160),
      panel_index: panelIndex,
      x:
        panelIndex === null
          ? null
          : normalizeHumanTeacherDraftPanelCoordinate(raw.x),
      y:
        panelIndex === null
          ? null
          : normalizeHumanTeacherDraftPanelCoordinate(raw.y),
    }
  })
}

function hasHumanTeacherAiAnnotation(annotation = null) {
  if (
    !annotation ||
    typeof annotation !== 'object' ||
    Array.isArray(annotation)
  ) {
    return false
  }

  return Boolean(
    annotation.generated_at ||
      annotation.runtime_backend ||
      annotation.runtime_type ||
      annotation.model ||
      annotation.vision_model ||
      hasHumanTeacherDraftListContent(annotation.ordered_panel_descriptions) ||
      hasHumanTeacherDraftListContent(annotation.ordered_panel_text) ||
      annotation.option_a_story_analysis ||
      annotation.option_b_story_analysis ||
      annotation.final_answer ||
      annotation.why_answer ||
      annotation.option_a_summary ||
      annotation.option_b_summary ||
      annotation.rating ||
      annotation.report_reason ||
      annotation.text_required !== null ||
      annotation.sequence_markers_present !== null ||
      annotation.report_required !== null ||
      annotation.confidence !== null
  )
}

function normalizeHumanTeacherAiAnnotation(value = null, expectedTaskId = '') {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const normalizedTaskId = normalizeHumanTeacherDraftText(
    source.task_id ?? source.taskId,
    256
  )
  const boundTaskId = normalizeHumanTeacherDraftText(expectedTaskId, 256)
  const finalAnswer = normalizeHumanTeacherDraftText(
    source.final_answer ?? source.finalAnswer,
    16
  ).toLowerCase()

  if (boundTaskId && normalizedTaskId && normalizedTaskId !== boundTaskId) {
    return null
  }

  const next = {
    ...buildDefaultHumanTeacherAiAnnotation(),
    task_id: boundTaskId || normalizedTaskId,
    generated_at: normalizeHumanTeacherDraftText(
      source.generated_at ?? source.generatedAt,
      64
    ),
    runtime_backend: normalizeHumanTeacherDraftText(
      source.runtime_backend ?? source.runtimeBackend,
      64
    ),
    runtime_type: normalizeHumanTeacherDraftText(
      source.runtime_type ?? source.runtimeType,
      64
    ),
    model: normalizeHumanTeacherDraftText(source.model, 256),
    vision_model: normalizeHumanTeacherDraftText(
      source.vision_model || source.visionModel,
      256
    ),
    ordered_panel_descriptions: normalizeHumanTeacherDraftList(
      source.ordered_panel_descriptions ?? source.orderedPanelDescriptions,
      {
        maxItems: 8,
        maxLength: 280,
      }
    ),
    ordered_panel_text: normalizeHumanTeacherDraftList(
      source.ordered_panel_text ?? source.orderedPanelText,
      {
        maxItems: 8,
        maxLength: 200,
      }
    ),
    option_a_story_analysis: normalizeHumanTeacherDraftText(
      source.option_a_story_analysis ?? source.optionAStoryAnalysis,
      500
    ),
    option_b_story_analysis: normalizeHumanTeacherDraftText(
      source.option_b_story_analysis ?? source.optionBStoryAnalysis,
      500
    ),
    final_answer: ['left', 'right', 'skip'].includes(finalAnswer)
      ? finalAnswer
      : '',
    why_answer: normalizeHumanTeacherDraftText(
      source.why_answer || source.whyAnswer,
      900
    ),
    confidence: normalizeHumanTeacherDraftConfidence(source.confidence),
    text_required: normalizeHumanTeacherDraftBool(
      source.text_required ?? source.textRequired
    ),
    sequence_markers_present: normalizeHumanTeacherDraftBool(
      source.sequence_markers_present ?? source.sequenceMarkersPresent
    ),
    report_required: normalizeHumanTeacherDraftBool(
      source.report_required ?? source.reportRequired
    ),
    report_reason: normalizeHumanTeacherDraftText(
      source.report_reason ?? source.reportReason,
      400
    ),
    option_a_summary: normalizeHumanTeacherDraftText(
      source.option_a_summary ?? source.optionASummary,
      400
    ),
    option_b_summary: normalizeHumanTeacherDraftText(
      source.option_b_summary ?? source.optionBSummary,
      400
    ),
    rating: normalizeHumanTeacherAiAnnotationRating(source.rating),
  }

  return hasHumanTeacherAiAnnotation(next) ? next : null
}

function normalizeHumanTeacherAnnotationDraft(task = {}, annotation = {}) {
  const source =
    annotation && typeof annotation === 'object' && !Array.isArray(annotation)
      ? annotation
      : {}
  const expectedTaskId = String(task.task_id || task.taskId || '').trim()
  const benchmarkReview = normalizeHumanTeacherBenchmarkReviewLayer(
    source.benchmark_review ?? source.benchmarkReview,
    source
  )
  const finalAnswer = normalizeHumanTeacherDraftText(
    source.final_answer ?? source.finalAnswer,
    16
  ).toLowerCase()

  return {
    ...buildDefaultHumanTeacherAnnotationRow(task),
    annotator: normalizeHumanTeacherDraftText(source.annotator, 256),
    frame_captions: normalizeHumanTeacherDraftCaptions(
      source.frame_captions ?? source.frameCaptions
    ),
    option_a_summary: normalizeHumanTeacherDraftText(
      source.option_a_summary ?? source.optionASummary
    ),
    option_b_summary: normalizeHumanTeacherDraftText(
      source.option_b_summary ?? source.optionBSummary
    ),
    ai_annotation: normalizeHumanTeacherAiAnnotation(
      source.ai_annotation ?? source.aiAnnotation,
      expectedTaskId
    ),
    ai_annotation_feedback: normalizeHumanTeacherDraftText(
      source.ai_annotation_feedback ?? source.aiAnnotationFeedback,
      600
    ),
    panel_references: normalizeHumanTeacherDraftPanelReferences(
      source.panel_references ?? source.panelReferences
    ),
    text_required: normalizeHumanTeacherDraftBool(
      source.text_required ?? source.textRequired
    ),
    sequence_markers_present: normalizeHumanTeacherDraftBool(
      source.sequence_markers_present ?? source.sequenceMarkersPresent
    ),
    report_required: normalizeHumanTeacherDraftBool(
      source.report_required ?? source.reportRequired
    ),
    report_reason: normalizeHumanTeacherDraftText(
      source.report_reason ?? source.reportReason
    ),
    final_answer: ['left', 'right', 'skip'].includes(finalAnswer)
      ? finalAnswer
      : '',
    why_answer: normalizeHumanTeacherDraftText(
      source.why_answer ?? source.whyAnswer
    ),
    confidence: normalizeHumanTeacherDraftConfidence(source.confidence),
    benchmark_review: benchmarkReview,
    benchmarkReview,
    benchmark_review_issue_type: benchmarkReview.correction.issue_type,
    benchmark_review_failure_note: benchmarkReview.correction.failure_note,
    benchmark_review_retraining_hint:
      benchmarkReview.correction.retraining_hint,
    benchmark_review_include_for_training:
      benchmarkReview.correction.include_for_training,
  }
}

function hasHumanTeacherAnnotationDraft(annotation = {}) {
  const next = normalizeHumanTeacherAnnotationDraft({}, annotation)

  return Boolean(
    next.annotator ||
      next.frame_captions.some(Boolean) ||
      next.option_a_summary ||
      next.option_b_summary ||
      hasHumanTeacherAiAnnotation(next.ai_annotation) ||
      next.ai_annotation_feedback ||
      next.panel_references.some(
        (reference) => reference.description || reference.panel_index !== null
      ) ||
      next.report_reason ||
      next.final_answer ||
      next.why_answer ||
      next.benchmark_review_issue_type ||
      next.benchmark_review_failure_note ||
      next.benchmark_review_retraining_hint ||
      next.benchmark_review_include_for_training !== null ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.confidence !== null
  )
}

function getHumanTeacherAnnotationMissingRequiredFields(annotation = {}) {
  const next = normalizeHumanTeacherAnnotationDraft({}, annotation)
  const missingFields = []

  if (!next.final_answer) {
    missingFields.push('final_answer')
  }

  if (!next.why_answer) {
    missingFields.push('why_answer')
  }

  if (next.text_required === null) {
    missingFields.push('text_required')
  }

  if (next.sequence_markers_present === null) {
    missingFields.push('sequence_markers_present')
  }

  if (next.report_required === null) {
    missingFields.push('report_required')
  }

  if (next.report_required === true && !next.report_reason) {
    missingFields.push('report_reason')
  }

  if (next.confidence === null) {
    missingFields.push('confidence')
  }

  return missingFields
}

function isHumanTeacherAnnotationComplete(annotation = {}) {
  return getHumanTeacherAnnotationMissingRequiredFields(annotation).length === 0
}

async function readJsonlRows(filePath, fallbackValue = []) {
  const targetPath = String(filePath || '').trim()

  if (!targetPath) {
    throw new Error('filePath is required')
  }

  try {
    const rawBuffer = await fs.promises.readFile(targetPath)
    const raw = rawBuffer.toString('utf8')

    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue
    }

    throw error
  }
}

async function writeJsonlRows(filePath, rows) {
  const targetPath = String(filePath || '').trim()

  if (!targetPath) {
    throw new Error('filePath is required')
  }

  await fs.promises.mkdir(path.dirname(targetPath), {recursive: true})
  await fs.promises.writeFile(
    targetPath,
    rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
    'utf8'
  )

  return targetPath
}

async function ensureHumanTeacherDemoChunkWorkspace(
  storage,
  {
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    outputDir,
    batchSize = DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
    offset = 0,
    loadSample = loadHumanTeacherDemoSample,
    normalizeSampleName = normalizeDemoSampleName,
  } = {}
) {
  const nextSampleName = normalizeSampleName(sampleName)
  const nextOutputDir = String(outputDir || '').trim()

  if (!nextOutputDir) {
    throw new Error('outputDir is required')
  }

  const taskManifestPath = path.join(nextOutputDir, 'tasks.jsonl')
  const summary = (await storage.exists(taskManifestPath))
    ? {
        demo: true,
        developer: true,
        sampleName: nextSampleName,
        outputDir: nextOutputDir,
        manifestPath: taskManifestPath,
        templatePath: path.join(nextOutputDir, 'annotations.template.jsonl'),
        filledPath: path.join(nextOutputDir, 'annotations.filled.jsonl'),
        metadataPath: path.join(nextOutputDir, 'demo-metadata.json'),
      }
    : await buildHumanTeacherDemoWorkspace({
        outputDir: nextOutputDir,
        sampleName: nextSampleName,
        take: batchSize,
        offset,
        loadSample,
      })

  return {
    ...summary,
    taskManifestPath,
    annotationsPath: path.join(nextOutputDir, 'annotations.filled.jsonl'),
  }
}

async function buildWorkspaceFromOutputDir(outputDir, fallbackEpoch = null) {
  const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
  const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')
  const taskRows = await readJsonlRows(taskManifestPath, [])
  const annotationRows = await readJsonlRows(annotationsPath, [])
  const tasks = buildHumanTeacherWorkspaceTasks(
    taskRows,
    annotationRows,
    fallbackEpoch
  )

  return {
    outputDir,
    taskManifestPath,
    annotationsPath,
    taskRows,
    annotationRows,
    workspace: {
      outputDir,
      taskManifestPath,
      annotationsPath,
      taskCount: tasks.length,
      draftedCount: tasks.filter((task) => task.hasDraft).length,
      completedCount: tasks.filter((task) => task.isComplete).length,
      tasks,
    },
  }
}

function resolveWorkspaceChildPath(baseDir, relativePath) {
  const resolvedBaseDir = path.resolve(String(baseDir || '').trim())
  const resolvedPath = path.resolve(resolvedBaseDir, String(relativePath || ''))

  if (
    resolvedPath !== resolvedBaseDir &&
    !resolvedPath.startsWith(`${resolvedBaseDir}${path.sep}`)
  ) {
    throw new Error('Invalid human-teacher workspace path')
  }

  return resolvedPath
}

function resolveOptionalConstrainedPath(baseDir, candidatePath, fallbackPath) {
  const rawCandidate = String(candidatePath || '').trim()

  if (!rawCandidate) {
    return String(fallbackPath || '').trim()
  }

  return resolveWorkspaceChildPath(baseDir, rawCandidate)
}

async function assertHumanTeacherWorkspaceIntegrity(
  localAiStorage,
  {outputDir, taskManifestPath, epoch = null, packagePath = ''} = {}
) {
  const metadataPath = path.join(
    outputDir,
    HUMAN_TEACHER_WORKSPACE_METADATA_FILE
  )

  if (!(await localAiStorage.exists(metadataPath))) {
    throw new Error(
      'Human teacher workspace metadata is unavailable; export annotation tasks again'
    )
  }

  const metadataValue = await localAiStorage.readJson(metadataPath, null)
  const metadata =
    metadataValue &&
    typeof metadataValue === 'object' &&
    !Array.isArray(metadataValue)
      ? metadataValue
      : null

  if (
    !metadata ||
    String(metadata.workspaceType || '').trim() !== HUMAN_TEACHER_WORKSPACE_TYPE
  ) {
    throw new Error(
      'Human teacher workspace metadata is invalid; export annotation tasks again'
    )
  }

  const metadataEpoch = normalizeOptionalEpoch(metadata.epoch)

  if (epoch !== null && metadataEpoch !== null && metadataEpoch !== epoch) {
    throw new Error(
      'Human teacher workspace metadata does not match the requested epoch; export annotation tasks again'
    )
  }

  const metadataPackagePath = String(metadata.packagePath || '').trim()
  if (
    packagePath &&
    metadataPackagePath &&
    path.resolve(metadataPackagePath) !== path.resolve(packagePath)
  ) {
    throw new Error(
      'Human teacher workspace metadata does not match the current package; export annotation tasks again'
    )
  }

  const metadataManifestPath = String(metadata.taskManifestPath || '').trim()
  if (
    metadataManifestPath &&
    path.resolve(metadataManifestPath) !== path.resolve(taskManifestPath)
  ) {
    throw new Error(
      'Human teacher workspace metadata does not match the current manifest path; export annotation tasks again'
    )
  }

  const expectedManifestSha256 = String(
    metadata.taskManifestSha256 || ''
  ).trim()

  if (!expectedManifestSha256) {
    throw new Error(
      'Human teacher workspace metadata is incomplete; export annotation tasks again'
    )
  }

  const actualManifestSha256 = await localAiStorage.sha256File(taskManifestPath)

  if (actualManifestSha256 !== expectedManifestSha256) {
    throw new Error(
      'Human teacher task manifest was modified; export annotation tasks again'
    )
  }

  return {
    metadataPath,
    metadata,
    actualManifestSha256,
  }
}

function getHumanTeacherAnnotationStatus(annotation = {}) {
  const hasDraft = hasHumanTeacherAnnotationDraft(annotation)

  if (!hasDraft) {
    return 'pending'
  }

  return isHumanTeacherAnnotationComplete(annotation) ? 'complete' : 'drafted'
}

function buildHumanTeacherWorkspaceTasks(
  taskRows,
  annotationRows,
  fallbackEpoch
) {
  const annotationsByTaskId = new Map(
    annotationRows
      .map((row) => [String(row && row.task_id ? row.task_id : '').trim(), row])
      .filter(([taskId]) => taskId)
  )

  return taskRows.map((taskRow) => {
    const taskId = String(
      taskRow && taskRow.task_id ? taskRow.task_id : ''
    ).trim()
    const annotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      annotationsByTaskId.get(taskId)
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(annotation)

    return {
      taskId,
      sampleId: taskRow.sample_id || taskId,
      flipHash: taskRow.flip_hash || null,
      epoch:
        taskRow.epoch === null || typeof taskRow.epoch === 'undefined'
          ? fallbackEpoch
          : taskRow.epoch,
      consensusAnswer: taskRow.final_answer || null,
      consensusStrength: taskRow.consensus_strength || null,
      leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
      rightOrder: Array.isArray(taskRow.right_order) ? taskRow.right_order : [],
      hasDraft: hasHumanTeacherAnnotationDraft(annotation),
      isComplete: isHumanTeacherAnnotationComplete(annotation),
      missingRequiredFields:
        getHumanTeacherAnnotationMissingRequiredFields(annotation),
      annotationStatus,
      demo:
        taskRow.demo &&
        typeof taskRow.demo === 'object' &&
        !Array.isArray(taskRow.demo)
          ? taskRow.demo
          : null,
    }
  })
}

function createLocalAiManager({
  logger,
  isDev = false,
  storage,
  sidecar,
  getModelReference,
  runtimeController,
  modernTrainingCollector,
  developerTrainingRunner,
  systemTelemetryProvider,
} = {}) {
  const localAiStorage = storage || createLocalAiStorage()
  const localAiSidecar =
    sidecar ||
    createLocalAiSidecar({
      logger,
      isDev,
    })
  const localAiRuntimeController =
    runtimeController || createDefaultRuntimeController({logger, isDev})
  const localAiModernTrainingCollector =
    modernTrainingCollector ||
    createModernTrainingCollector({
      logger,
      storage: localAiStorage,
    })
  const localAiDeveloperTrainingRunner =
    developerTrainingRunner || createDeveloperTrainingRunner({logger, isDev})
  const localSystemTelemetryProvider =
    systemTelemetryProvider || createDefaultSystemTelemetryProvider()
  const developerStateMutationQueues = new Map()
  const initialRuntime = resolveLocalAiRuntimeAdapter()
  const state = {
    available: true,
    running: false,
    runtimeManaged: false,
    mode: 'sidecar',
    runtime: initialRuntime.runtime,
    runtimeBackend: initialRuntime.runtimeBackend,
    runtimeType: initialRuntime.runtimeType,
    baseUrl: initialRuntime.baseUrl,
    capturedCount: 0,
    lastError: null,
    sidecarReachable: null,
    sidecarCheckedAt: null,
    sidecarModels: [],
    captureIndex: [],
    recentCaptures: [],
    loadError: null,
    hydrated: false,
  }

  let hydrationPromise = null
  let persistQueue = Promise.resolve()

  function currentStatus() {
    return {
      available: state.available,
      running: state.running,
      runtimeManaged: state.runtimeManaged,
      mode: state.mode,
      runtime: state.runtime,
      runtimeBackend: state.runtimeBackend,
      runtimeType: state.runtimeType,
      baseUrl: state.baseUrl,
      capturedCount: state.capturedCount,
      lastError: state.lastError,
      sidecarReachable: state.sidecarReachable,
      sidecarCheckedAt: state.sidecarCheckedAt,
      sidecarModelCount: state.sidecarModels.length,
    }
  }

  function updateSidecarState({reachable, models, checkedAt, lastError}) {
    state.sidecarReachable =
      typeof reachable === 'boolean' ? reachable : state.sidecarReachable
    state.sidecarCheckedAt = checkedAt || new Date().toISOString()
    state.sidecarModels = Array.isArray(models) ? models : state.sidecarModels
    state.lastError = lastError || null
  }

  function applyRuntimeState(next) {
    state.mode = normalizeMode(next.mode, state.mode)
    state.runtime = next.runtime || state.runtime
    state.runtimeBackend = next.runtimeBackend || state.runtimeBackend
    state.runtimeType = next.runtimeType || state.runtimeType
    state.baseUrl = normalizeBaseUrl(next.baseUrl, state.baseUrl)
  }

  async function waitForRuntimeReady(payload) {
    const startedAt = Date.now()
    let result = await refreshSidecarStatus(payload)

    while (
      !result.ok &&
      Date.now() - startedAt < DEFAULT_RUNTIME_START_TIMEOUT_MS
    ) {
      await delay(DEFAULT_RUNTIME_START_RETRY_DELAY_MS)
      result = await refreshSidecarStatus(payload)
    }

    return result
  }

  function resolveInteractiveRuntimeTimeoutMs(value) {
    const parsed = Number.parseInt(value, 10)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_RUNTIME_START_TIMEOUT_MS
    }

    return Math.min(parsed, DEFAULT_RUNTIME_START_TIMEOUT_MS)
  }

  function normalizeSidecarHealthResult(rawHealth) {
    return rawHealth && typeof rawHealth === 'object'
      ? rawHealth
      : {
          ok: false,
          lastError: 'Local AI runtime health check returned no response.',
        }
  }

  function normalizeSidecarModelsResult(rawModels) {
    return rawModels && typeof rawModels === 'object'
      ? rawModels
      : {
          ok: false,
          models: [],
          total: 0,
          lastError: 'Local AI model listing returned no response.',
        }
  }

  function normalizeSidecarActionResult(rawResult, fallback) {
    return rawResult && typeof rawResult === 'object'
      ? rawResult
      : {
          ok: false,
          status: 'error',
          ...fallback,
        }
  }

  async function ensureInteractiveRuntimeReady(next) {
    if (next.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND) {
      return null
    }

    const readinessPayload = {
      ...next,
      timeoutMs: resolveInteractiveRuntimeTimeoutMs(next.timeoutMs),
    }
    const refreshed = await refreshSidecarStatus(readinessPayload)

    if (refreshed.ok || next.allowRuntimeStart === false) {
      return refreshed
    }

    return start(readinessPayload)
  }

  async function hydrate() {
    if (state.hydrated) {
      return
    }

    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        try {
          const persisted = normalizeCaptureIndex(
            await localAiStorage.readJson(captureIndexPath(localAiStorage), {
              version: CAPTURE_INDEX_VERSION,
              capturedCount: 0,
              captures: [],
              updatedAt: null,
            })
          )

          state.captureIndex = persisted.captures
          state.recentCaptures = persisted.captures.slice(-MAX_RECENT_CAPTURES)
          state.capturedCount = persisted.capturedCount
          state.loadError = null
        } catch (error) {
          state.captureIndex = []
          state.recentCaptures = []
          state.capturedCount = 0
          state.loadError = error
          state.lastError = 'Unable to load local AI capture index'

          if (logger && typeof logger.error === 'function') {
            logger.error('Unable to load local AI capture index', {
              error: error.toString(),
            })
          }
        } finally {
          state.hydrated = true
        }
      })()
    }

    await hydrationPromise
  }

  async function persistCaptureIndex() {
    const nextIndex = {
      version: CAPTURE_INDEX_VERSION,
      capturedCount: state.capturedCount,
      captures: state.captureIndex,
      updatedAt: new Date().toISOString(),
    }

    persistQueue = persistQueue
      .catch(() => {})
      .then(() =>
        localAiStorage.writeJsonAtomic(
          captureIndexPath(localAiStorage),
          nextIndex
        )
      )

    return persistQueue
  }

  async function loadDeveloperHumanTeacherState(
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    totalAvailableTasks = 0
  ) {
    const nextSampleName = normalizeDeveloperHumanTeacherSampleName(sampleName)
    const statePath = developerHumanTeacherStatePath(
      localAiStorage,
      nextSampleName
    )
    const currentState = await localAiStorage.readJson(statePath, null)
    const normalizedState = normalizeDeveloperHumanTeacherState(currentState, {
      sampleName: nextSampleName,
      totalAvailableTasks,
    })
    const comparisonPath = developerHumanTeacherComparisonPath(
      localAiStorage,
      nextSampleName
    )
    let nextState = normalizedState

    if (await localAiStorage.exists(comparisonPath)) {
      const comparisonResult = await localAiStorage.readJson(
        comparisonPath,
        null
      )
      const snapshot = extractDeveloperComparisonSnapshot(comparisonResult, {
        resultPath: comparisonPath,
        holdoutPath:
          normalizedState.comparison100?.holdoutPath ||
          comparisonResult?.holdoutPath ||
          null,
      })
      const mergedComparison = snapshot
        ? mergeDeveloperComparisonSnapshot(
            normalizedState.comparison100,
            snapshot
          )
        : normalizeDeveloperComparisonState({
            ...normalizedState.comparison100,
            status:
              normalizeDeveloperComparisonStatus(
                normalizedState.comparison100?.status
              ) === 'not_loaded'
                ? 'result_available'
                : normalizedState.comparison100?.status,
            lastResultPath:
              normalizedState.comparison100?.lastResultPath || comparisonPath,
          })

      if (
        JSON.stringify(mergedComparison) !==
        JSON.stringify(normalizedState.comparison100)
      ) {
        nextState = {
          ...normalizedState,
          comparison100: mergedComparison,
        }
        await localAiStorage.writeJsonAtomic(statePath, nextState)
      }
    }

    return {
      statePath,
      state: nextState,
    }
  }

  async function loadDemoHumanTeacherState(
    sampleName = DEFAULT_DEMO_SAMPLE_NAME,
    totalAvailableTasks = 0
  ) {
    const nextSampleName = normalizeDemoSampleName(sampleName)
    const statePath = demoHumanTeacherStatePath(localAiStorage, nextSampleName)
    const currentState = await localAiStorage.readJson(statePath, null)
    const normalizedState = normalizeDemoHumanTeacherState(currentState, {
      sampleName: nextSampleName,
      totalAvailableTasks,
    })

    return {
      statePath,
      state: normalizedState,
    }
  }

  async function writeDemoHumanTeacherState(sampleName, nextState) {
    const nextSampleName = normalizeDemoSampleName(sampleName)
    const statePath = demoHumanTeacherStatePath(localAiStorage, nextSampleName)
    const normalizedState = normalizeDemoHumanTeacherState(nextState, {
      sampleName: nextSampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })

    await localAiStorage.writeJsonAtomic(statePath, normalizedState)

    return {
      statePath,
      state: normalizedState,
    }
  }

  function summarizeDemoHumanTeacherState(nextState, extra = {}) {
    const normalizedState = normalizeDemoHumanTeacherState(nextState, {
      sampleName: nextState?.sampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })

    return {
      ...normalizedState,
      annotatedCount: normalizedState.annotatedTaskIds.length,
      trainedChunkCount: normalizedState.trainedChunkOffsets.length,
      remainingTaskCount: Math.max(
        normalizedState.totalAvailableTasks -
          normalizedState.annotatedTaskIds.length,
        0
      ),
      ...extra,
    }
  }

  async function writeDeveloperHumanTeacherState(sampleName, nextState) {
    const nextSampleName = normalizeDeveloperHumanTeacherSampleName(sampleName)
    const statePath = developerHumanTeacherStatePath(
      localAiStorage,
      nextSampleName
    )
    const normalizedState = normalizeDeveloperHumanTeacherState(nextState, {
      sampleName: nextSampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })

    await localAiStorage.writeJsonAtomic(statePath, normalizedState)

    return {
      statePath,
      state: normalizedState,
    }
  }

  function readDeveloperStatePathInfo(statePath) {
    const normalizedPath = String(statePath || '').trim()

    return {
      normalizedPath,
      sampleName: normalizeDeveloperHumanTeacherSampleName(
        path.basename(path.dirname(normalizedPath || '.'))
      ),
    }
  }

  function queueDeveloperStateMutation(statePath, mutate) {
    const {normalizedPath, sampleName} = readDeveloperStatePathInfo(statePath)

    if (!normalizedPath || typeof mutate !== 'function') {
      return Promise.resolve(null)
    }

    const previousQueue = developerStateMutationQueues.get(normalizedPath)
    const nextQueue = Promise.resolve(previousQueue)
      .catch(() => null)
      .then(async () => {
        const currentState = normalizeDeveloperHumanTeacherState(
          await localAiStorage.readJson(normalizedPath, null),
          {
            sampleName,
          }
        )
        const mutatedState = await mutate(currentState)
        const normalizedState = normalizeDeveloperHumanTeacherState(
          mutatedState,
          {
            sampleName,
            totalAvailableTasks:
              mutatedState?.totalAvailableTasks ||
              currentState.totalAvailableTasks,
          }
        )

        await localAiStorage.writeJsonAtomic(normalizedPath, normalizedState)
        return normalizedState
      })

    developerStateMutationQueues.set(normalizedPath, nextQueue)

    return nextQueue.finally(() => {
      if (developerStateMutationQueues.get(normalizedPath) === nextQueue) {
        developerStateMutationQueues.delete(normalizedPath)
      }
    })
  }

  function flushDeveloperStateMutations(statePath) {
    const normalizedPath = String(statePath || '').trim()
    return Promise.resolve(developerStateMutationQueues.get(normalizedPath))
      .catch(() => null)
      .then(() => null)
  }

  function createDeveloperActiveRunProgressHandler({
    statePath,
    kind,
    sampleName,
    chunkOffset = null,
    chunkSize = null,
    evaluationFlips = null,
    totalEpochs = null,
  } = {}) {
    const normalizedStatePath = String(statePath || '').trim()

    if (!normalizedStatePath) {
      return null
    }

    return async (progressUpdate = {}) => {
      const patch =
        progressUpdate &&
        typeof progressUpdate === 'object' &&
        !Array.isArray(progressUpdate)
          ? progressUpdate
          : {}

      await queueDeveloperStateMutation(normalizedStatePath, (currentState) => {
        const currentRun =
          normalizeDeveloperActiveRunState(currentState.activeRun) || {}
        const nextStage =
          String(patch.stage || currentRun.stage || '')
            .trim()
            .toLowerCase() || null
        const stageChanged =
          nextStage &&
          String(currentRun.stage || '')
            .trim()
            .toLowerCase() !== nextStage
        const nextRun = normalizeDeveloperActiveRunState({
          ...currentRun,
          ...patch,
          kind: String(patch.kind || kind || currentRun.kind || '')
            .trim()
            .toLowerCase(),
          status:
            String(patch.status || currentRun.status || 'running')
              .trim()
              .toLowerCase() || 'running',
          sampleName:
            patch.sampleName ||
            currentRun.sampleName ||
            sampleName ||
            currentState.sampleName,
          chunkOffset:
            typeof patch.chunkOffset !== 'undefined'
              ? patch.chunkOffset
              : currentRun.chunkOffset ?? chunkOffset,
          chunkSize:
            typeof patch.chunkSize !== 'undefined'
              ? patch.chunkSize
              : currentRun.chunkSize ?? chunkSize,
          evaluationFlips:
            typeof patch.evaluationFlips !== 'undefined'
              ? patch.evaluationFlips
              : currentRun.evaluationFlips ?? evaluationFlips,
          totalEpochs:
            typeof patch.totalEpochs !== 'undefined'
              ? patch.totalEpochs
              : currentRun.totalEpochs ?? totalEpochs,
          startedAt: currentRun.startedAt || new Date().toISOString(),
          stageStartedAt:
            !currentRun.stageStartedAt || stageChanged
              ? new Date().toISOString()
              : currentRun.stageStartedAt,
          updatedAt: new Date().toISOString(),
        })

        return {
          ...currentState,
          activeRun: nextRun,
        }
      })
    }
  }

  function summarizeDeveloperHumanTeacherState(nextState, extra = {}) {
    const normalizedState = normalizeDeveloperHumanTeacherState(nextState, {
      sampleName: nextState?.sampleName,
      totalAvailableTasks: nextState?.totalAvailableTasks,
    })
    const supportsLocalTraining = Boolean(
      localAiDeveloperTrainingRunner &&
        typeof localAiDeveloperTrainingRunner.runEpoch === 'function'
    )

    return {
      ...normalizedState,
      supportsLocalTraining,
      localTrainingMode: supportsLocalTraining ? 'mlx-fallback' : 'unavailable',
      pendingTrainingCount: normalizedState.pendingTrainingTaskIds.length,
      annotatedCount: normalizedState.annotatedTaskIds.length,
      trainedCount: normalizedState.trainedTaskIds.length,
      remainingTaskCount: Math.max(
        normalizedState.totalAvailableTasks -
          normalizedState.annotatedTaskIds.length,
        0
      ),
      ...extra,
    }
  }

  function sanitizePublicDeveloperHumanTeacherState(nextState, extra = {}) {
    const summary = summarizeDeveloperHumanTeacherState(nextState, extra)

    return {
      ...summary,
      comparison100: sanitizePublicDeveloperComparisonState(
        summary.comparison100
      ),
      lastTraining: normalizeDeveloperLastTrainingState(summary.lastTraining),
    }
  }

  function buildDeveloperExternalBundleId(
    createdAt = new Date().toISOString()
  ) {
    return `bundle-${String(createdAt)
      .trim()
      .replace(/[:.]/g, '-')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')}`
  }

  function buildDeveloperExternalTrainingBundleReadme({
    bundleId,
    createdAt,
    sampleName,
    annotatedCount,
    pendingCount,
    trainedCount,
    runtimeBackend,
    runtimeModel,
    runtimeVisionModel,
    developerPromptActive,
  }) {
    return [
      '# IdenaAI external training bundle',
      '',
      'This folder is the provider-neutral export for external GPU training.',
      'Upload only this folder to the machine or provider you want to use.',
      '',
      `Bundle id: ${bundleId}`,
      `Created at: ${createdAt}`,
      `Developer sample: ${sampleName}`,
      '',
      'What is inside:',
      '- annotations.normalized.jsonl: all annotated developer human-teacher rows currently saved on this desktop profile',
      '- annotations.pending.jsonl: rows that are annotated but not yet inside the active local model',
      '- annotations.trained.jsonl: rows that were already used by the local training path',
      '- training-bundle-manifest.json: machine-readable metadata for reproducible training and evaluation',
      '- README.md: this short guide',
      '',
      'Simple path for normal users:',
      '1. Rent one GPU computer from any managed jobs provider, GPU pod provider, or cloud VM.',
      '2. Upload this whole folder to that machine.',
      '3. Start with a benchmark-only smoke run before doing a longer training run.',
      EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL
        ? `4. For serious training, use the recommended MLX base ${EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL}.`
        : '4. No approved MLX base is bundled right now. Pick and audit your own base model before training.',
      `5. After training, run the fixed held-out comparison on ${EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE} unseen flips and keep the result JSON plus the adapter artifact together.`,
      '6. Import only the result files you intend to trust back into IdenaAI later.',
      '',
      'Safety notes:',
      '- this bundle should contain training data only, not wallet secrets or your whole desktop profile',
      '- do not upload unrelated local folders',
      '- benchmark candidates on unseen flips and publish predictions, not only a final score',
      '',
      'Current local context:',
      `- runtime backend: ${runtimeBackend || 'unknown'}`,
      `- runtime text model: ${runtimeModel || 'unknown'}`,
      `- runtime vision model: ${runtimeVisionModel || 'unknown'}`,
      `- annotated rows exported: ${annotatedCount}`,
      `- pending rows exported: ${pendingCount}`,
      `- already trained rows exported: ${trainedCount}`,
      `- custom developer prompt active: ${
        developerPromptActive ? 'yes' : 'no'
      }`,
      '',
    ].join('\n')
  }

  async function loadDeveloperHumanTeacherChunkWorkspace({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
  } = {}) {
    const nextSampleName = normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(nextSampleName)
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      offset,
      sample.totalFlips
    )
    const outputDir = developerHumanTeacherChunkDir(
      localAiStorage,
      nextSampleName,
      effectiveOffset
    )

    const summary = await ensureHumanTeacherDemoChunkWorkspace(localAiStorage, {
      sampleName: nextSampleName,
      outputDir,
      batchSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      loadSample: loadDeveloperHumanTeacherSample,
      normalizeSampleName: normalizeDeveloperHumanTeacherSampleName,
    })
    const nextWorkspace = await buildWorkspaceFromOutputDir(outputDir, null)
    const {statePath, state: developerState} =
      await loadDeveloperHumanTeacherState(nextSampleName, sample.totalFlips)

    return {
      sample,
      outputDir,
      offset: effectiveOffset,
      statePath,
      state: developerState,
      summary: {
        ...summary,
        tasks: nextWorkspace.taskRows.length,
        totalFlips: sample.totalFlips,
        offset: effectiveOffset,
      },
      workspace: nextWorkspace.workspace,
      taskRows: nextWorkspace.taskRows,
      annotationsPath: nextWorkspace.annotationsPath,
      taskManifestPath: nextWorkspace.taskManifestPath,
    }
  }

  async function loadDemoHumanTeacherChunkWorkspace({
    sampleName = DEFAULT_DEMO_SAMPLE_NAME,
    offset = 0,
  } = {}) {
    const nextSampleName = normalizeDemoSampleName(sampleName)
    const sample = await loadHumanTeacherDemoSample(nextSampleName)
    const effectiveOffset = clampDemoHumanTeacherOffset(
      offset,
      sample.totalFlips
    )
    const outputDir = demoHumanTeacherChunkDir(
      localAiStorage,
      nextSampleName,
      effectiveOffset
    )

    const summary = await ensureHumanTeacherDemoChunkWorkspace(localAiStorage, {
      sampleName: nextSampleName,
      outputDir,
      batchSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      loadSample: loadHumanTeacherDemoSample,
      normalizeSampleName: normalizeDemoSampleName,
    })
    const nextWorkspace = await buildWorkspaceFromOutputDir(outputDir, null)
    const {statePath, state: demoState} = await loadDemoHumanTeacherState(
      nextSampleName,
      sample.totalFlips
    )

    return {
      sample,
      outputDir,
      offset: effectiveOffset,
      statePath,
      state: demoState,
      summary: {
        ...summary,
        demo: true,
        developer: false,
        tasks: nextWorkspace.taskRows.length,
        totalFlips: sample.totalFlips,
        offset: effectiveOffset,
      },
      workspace: nextWorkspace.workspace,
      taskRows: nextWorkspace.taskRows,
      annotationsPath: nextWorkspace.annotationsPath,
      taskManifestPath: nextWorkspace.taskManifestPath,
    }
  }

  async function loadDeveloperHumanTeacherTaskFromChunk({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
    taskId,
  } = {}) {
    const taskDetailId = String(taskId || '').trim()

    if (!taskDetailId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName,
      offset,
    })
    const taskRow = chunk.taskRows.find(
      (row) =>
        String(row && row.task_id ? row.task_id : '').trim() === taskDetailId
    )

    if (!taskRow) {
      throw new Error('Human teacher developer task is unavailable')
    }

    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
    const annotationRow = annotationRows.find(
      (row) =>
        String(row && row.task_id ? row.task_id : '').trim() === taskDetailId
    )
    const panels = await Promise.all(
      (Array.isArray(taskRow.panels) ? taskRow.panels : []).map(
        async (panelRelativePath, index) => {
          const panelPath = resolveWorkspaceChildPath(
            chunk.outputDir,
            panelRelativePath
          )
          const panelBuffer = await localAiStorage.readBuffer(panelPath)

          return {
            id: `panel-${index + 1}`,
            index,
            path: panelPath,
            dataUrl: `data:image/png;base64,${panelBuffer.toString('base64')}`,
          }
        }
      )
    )

    return {
      demo: true,
      developer: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      task: {
        taskId: taskDetailId,
        sampleId: taskRow.sample_id || taskDetailId,
        flipHash: taskRow.flip_hash || null,
        epoch: null,
        consensusAnswer: taskRow.final_answer || null,
        consensusStrength: taskRow.consensus_strength || null,
        leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
        rightOrder: Array.isArray(taskRow.right_order)
          ? taskRow.right_order
          : [],
        words:
          taskRow.words &&
          typeof taskRow.words === 'object' &&
          !Array.isArray(taskRow.words)
            ? taskRow.words
            : {},
        demo:
          taskRow.demo &&
          typeof taskRow.demo === 'object' &&
          !Array.isArray(taskRow.demo)
            ? taskRow.demo
            : null,
        panels,
        annotation: normalizeHumanTeacherAnnotationDraft(
          taskRow,
          annotationRow
        ),
      },
    }
  }

  async function saveDeveloperHumanTeacherDraftToChunk({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
    taskId,
    annotation,
  } = {}) {
    const nextTaskId = String(taskId || '').trim()

    if (!nextTaskId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName,
      offset,
    })
    const taskRow = chunk.taskRows.find(
      (row) =>
        String(row && row.task_id ? row.task_id : '').trim() === nextTaskId
    )

    if (!taskRow) {
      throw new Error('Human teacher developer task is unavailable')
    }

    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
    const nextAnnotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      annotation
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(nextAnnotation)
    const nextAnnotationRows = annotationRows
      .filter(
        (row) =>
          String(row && row.task_id ? row.task_id : '').trim() !== nextTaskId
      )
      .concat(nextAnnotation)

    await writeJsonlRows(chunk.annotationsPath, nextAnnotationRows)

    return {
      demo: true,
      developer: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      task: {
        taskId: nextTaskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath: chunk.annotationsPath,
      },
    }
  }

  async function commitDeveloperHumanTeacherChunk({
    sampleName = DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE,
    offset = 0,
    trainNow = false,
    advance = false,
    allowSystemPressureOverride = false,
    trainingModelPath = null,
    localTrainingProfile = null,
    localTrainingThermalMode = null,
    localBenchmarkThermalMode = null,
    localTrainingEpochs = null,
    localTrainingBatchSize = null,
    localTrainingLoraRank = null,
    evaluationFlips = DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE,
  } = {}) {
    const chunk = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName,
      offset,
    })
    const normalizedTrainingModelPath =
      normalizeDeveloperTrainingModelPath(trainingModelPath)
    const normalizedLocalTrainingProfile =
      normalizeDeveloperTrainingProfile(localTrainingProfile)
    const normalizedLocalTrainingThermalMode =
      normalizeDeveloperTrainingThermalMode(localTrainingThermalMode)
    const normalizedLocalBenchmarkThermalMode =
      normalizeDeveloperTrainingThermalMode(
        localBenchmarkThermalMode || localTrainingThermalMode
      )
    const normalizedLocalTrainingEpochs = normalizeDeveloperTrainingInteger(
      localTrainingEpochs,
      1,
      1,
      6
    )
    const normalizedLocalTrainingBatchSize = normalizeDeveloperTrainingInteger(
      localTrainingBatchSize,
      1,
      1,
      4
    )
    const normalizedLocalTrainingLoraRank = normalizeDeveloperTrainingInteger(
      localTrainingLoraRank,
      10,
      4,
      16
    )

    if (
      Number(chunk.workspace.taskCount) > 0 &&
      Number(chunk.workspace.completedCount) < Number(chunk.workspace.taskCount)
    ) {
      throw new Error(
        'Complete all 5 developer training flips before committing this chunk'
      )
    }

    const normalizedPath = path.join(
      chunk.outputDir,
      'annotations.normalized.jsonl'
    )
    const summaryPath = path.join(
      chunk.outputDir,
      'annotations.import-summary.json'
    )
    const importSummary = await importHumanTeacherAnnotations({
      taskManifestPath: chunk.taskManifestPath,
      annotationsJsonlPath: chunk.annotationsPath,
      outputJsonlPath: normalizedPath,
      summaryPath,
    })
    const annotatedPath = developerHumanTeacherAnnotatedPath(
      localAiStorage,
      chunk.sample.sampleName
    )
    const pendingPath = developerHumanTeacherPendingPath(
      localAiStorage,
      chunk.sample.sampleName
    )
    const trainedPath = developerHumanTeacherTrainedPath(
      localAiStorage,
      chunk.sample.sampleName
    )
    const existingAnnotatedRows = await readJsonlRows(annotatedPath, [])
    let pendingRows = await readJsonlRows(pendingPath, [])
    let trainedRows = await readJsonlRows(trainedPath, [])
    const committedAt = new Date().toISOString()
    const existingState = chunk.state
    const normalizedRows = Array.isArray(importSummary.rows)
      ? importSummary.rows
      : []
    const normalizedSummary = summarizeDeveloperChunkRows(normalizedRows)

    const nextAnnotatedRows = mergeJsonlRowsByTaskId(
      existingAnnotatedRows,
      normalizedRows
    )
    pendingRows = mergeJsonlRowsByTaskId(pendingRows, normalizedRows)

    await writeJsonlRows(annotatedPath, nextAnnotatedRows)
    await writeJsonlRows(pendingPath, pendingRows)

    let trainingResult = null
    let trainingStatus = 'pending'
    let baseState = existingState
    let trainedTaskIds = uniqueStrings(existingState.trainedTaskIds)
    let pendingTaskIds = uniqueStrings(
      mergeJsonlRowsByTaskId([], pendingRows).map((row) => row && row.task_id)
    )
    let nextComparison = normalizeDeveloperComparisonState(
      existingState.comparison100
    )
    const resolvedEvaluationFlips =
      normalizeDeveloperLocalBenchmarkFlips(evaluationFlips)

    if (trainNow) {
      const activeRunProgress = createDeveloperActiveRunProgressHandler({
        statePath: chunk.statePath,
        kind: 'training',
        sampleName: chunk.sample.sampleName,
        chunkOffset: chunk.offset,
        chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
        evaluationFlips: resolvedEvaluationFlips,
        totalEpochs: normalizedLocalTrainingEpochs,
      })
      const runningState = await writeDeveloperHumanTeacherState(
        chunk.sample.sampleName,
        {
          ...existingState,
          totalAvailableTasks: chunk.sample.totalFlips,
          activeRun: {
            kind: 'training',
            status: 'running',
            stage: 'prepare_training_dataset',
            stageIndex: 1,
            stageCount: 5,
            progressPercent: 2,
            message: 'Preparing the 5-flip training pack',
            sampleName: chunk.sample.sampleName,
            chunkOffset: chunk.offset,
            chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
            evaluationFlips: resolvedEvaluationFlips,
            totalEpochs: normalizedLocalTrainingEpochs,
            trainingThermalMode: normalizedLocalTrainingThermalMode,
            benchmarkThermalMode: normalizedLocalBenchmarkThermalMode,
            startedAt: new Date().toISOString(),
            stageStartedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }
      )
      baseState = runningState.state
      const comparisonPath = developerHumanTeacherComparisonPath(
        localAiStorage,
        chunk.sample.sampleName,
        resolvedEvaluationFlips
      )
      trainingResult = await trainEpoch({
        input: {
          developerHumanTeacher: true,
          allowSystemPressureOverride,
          sampleName: chunk.sample.sampleName,
          trainingModelPath: normalizedTrainingModelPath || undefined,
          localTrainingProfile: normalizedLocalTrainingProfile,
          localTrainingThermalMode: normalizedLocalTrainingThermalMode,
          localBenchmarkThermalMode: normalizedLocalBenchmarkThermalMode,
          localTrainingEpochs: normalizedLocalTrainingEpochs,
          localTrainingBatchSize: normalizedLocalTrainingBatchSize,
          localTrainingLoraRank: normalizedLocalTrainingLoraRank,
          offset: chunk.offset,
          chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
          normalizedAnnotationsPath: normalizedPath,
          pendingAnnotationsPath: pendingPath,
          annotatedAnnotationsPath: annotatedPath,
          trainedAnnotationsPath: trainedPath,
          developerStatePath: chunk.statePath,
          comparisonPath,
          evaluationFlips: resolvedEvaluationFlips,
        },
        onDeveloperHumanTeacherProgress: activeRunProgress,
      })
      await flushDeveloperStateMutations(chunk.statePath)
      const partialTrainingCompleted =
        trainingResult?.status === 'stopped' &&
        trainingResult?.partialTrainingCompleted === true

      if (trainingResult && trainingResult.ok) {
        trainedRows = mergeJsonlRowsByTaskId(trainedRows, pendingRows)
        await writeJsonlRows(trainedPath, trainedRows)
        pendingRows = []
        await writeJsonlRows(pendingPath, pendingRows)
        trainedTaskIds = uniqueStrings(
          trainedRows.map((row) => row && row.task_id)
        )
        pendingTaskIds = []
        trainingStatus = 'trained'
        nextComparison = mergeDeveloperComparisonSnapshot(
          nextComparison,
          extractDeveloperComparisonSnapshot(trainingResult, {
            resultPath: comparisonPath,
          }),
          'trained'
        )
      } else if (partialTrainingCompleted) {
        trainedRows = mergeJsonlRowsByTaskId(trainedRows, pendingRows)
        await writeJsonlRows(trainedPath, trainedRows)
        pendingRows = []
        await writeJsonlRows(pendingPath, pendingRows)
        trainedTaskIds = uniqueStrings(
          trainedRows.map((row) => row && row.task_id)
        )
        pendingTaskIds = []
        trainingStatus = 'trained'
      } else {
        trainingStatus = 'failed'
      }

      if (
        trainingResult &&
        trainingResult.ok &&
        (await localAiStorage.exists(comparisonPath))
      ) {
        const comparisonResult = await localAiStorage.readJson(
          comparisonPath,
          null
        )
        nextComparison = mergeDeveloperComparisonSnapshot(
          nextComparison,
          extractDeveloperComparisonSnapshot(comparisonResult, {
            resultPath: comparisonPath,
            holdoutPath:
              nextComparison.holdoutPath ||
              comparisonResult?.holdoutPath ||
              null,
          }),
          trainingResult && trainingResult.ok ? 'evaluated' : 'result_available'
        )
      } else if (
        (trainingResult && trainingResult.ok) ||
        partialTrainingCompleted
      ) {
        nextComparison = normalizeDeveloperComparisonState({
          ...nextComparison,
          status: 'trained_pending_evaluation',
          benchmarkFlips: resolvedEvaluationFlips,
          lastResultPath: nextComparison.lastResultPath || comparisonPath,
        })
      }
    }

    const chunkEntries = Array.isArray(baseState.chunks)
      ? baseState.chunks.filter((entry) => entry.offset !== chunk.offset)
      : []
    chunkEntries.push({
      offset: chunk.offset,
      taskIds: normalizedSummary.taskIds,
      rowCount: normalizedSummary.rowCount,
      committedAt,
      trainedAt: trainingStatus === 'trained' ? new Date().toISOString() : null,
      trainingStatus,
      normalizedPath,
      summaryPath,
    })
    const requestedNextOffset = clampDeveloperHumanTeacherOffset(
      chunk.offset + DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
      chunk.sample.totalFlips
    )
    const nextAnnotatedTaskIds = uniqueStrings(
      nextAnnotatedRows.map((row) => row && row.task_id)
    )
    const nextOffset = advance
      ? resolveDeveloperHumanTeacherSessionOffset(
          {
            ...baseState,
            annotatedTaskIds: nextAnnotatedTaskIds,
            chunks: chunkEntries,
          },
          chunk.sample.totalFlips,
          requestedNextOffset
        )
      : chunk.offset

    const nextState = {
      ...baseState,
      currentOffset: nextOffset,
      annotatedTaskIds: nextAnnotatedTaskIds,
      pendingTrainingTaskIds: pendingTaskIds,
      trainedTaskIds,
      activeTrainingModelPath:
        trainingStatus === 'trained'
          ? String(trainingResult?.modelPath || '').trim() || null
          : baseState.activeTrainingModelPath || null,
      activeTrainingBackend:
        trainingStatus === 'trained'
          ? String(trainingResult?.trainingBackend || '').trim() || null
          : baseState.activeTrainingBackend || null,
      activeLocalTrainingProfile:
        trainingStatus === 'trained'
          ? String(trainingResult?.localTrainingProfile || '').trim() || null
          : baseState.activeLocalTrainingProfile || null,
      activeLocalTrainingThermalMode:
        trainingStatus === 'trained'
          ? String(trainingResult?.localTrainingThermalMode || '').trim() ||
            null
          : baseState.activeLocalTrainingThermalMode || null,
      activeRun: null,
      chunks: chunkEntries,
      lastSavedAt: committedAt,
      comparison100: nextComparison,
      lastTraining: trainNow
        ? {
            at: new Date().toISOString(),
            status: trainingStatus,
            offset: chunk.offset,
            rowCount: normalizedSummary.rowCount,
            failureReason:
              trainingStatus === 'failed'
                ? extractDeveloperTrainingFailureReason(trainingResult)
                : null,
            result:
              trainingResult &&
              typeof trainingResult === 'object' &&
              !Array.isArray(trainingResult)
                ? trainingResult
                : null,
          }
        : baseState.lastTraining,
    }
    const persistedState = await writeDeveloperHumanTeacherState(
      chunk.sample.sampleName,
      {
        ...nextState,
        totalAvailableTasks: chunk.sample.totalFlips,
      }
    )

    return {
      demo: true,
      developer: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      nextOffset,
      taskCount: normalizedSummary.rowCount,
      import: {
        normalizedPath,
        summaryPath,
        annotationsPath: chunk.annotationsPath,
        normalizedRows: Number(importSummary.normalizedRows) || 0,
        missingAnnotations: Number(importSummary.missingAnnotations) || 0,
        unmatchedAnnotations: Number(importSummary.unmatchedAnnotations) || 0,
        invalidAnnotations: Number(importSummary.invalidAnnotations) || 0,
        duplicateAnnotations: Number(importSummary.duplicateAnnotations) || 0,
      },
      training: sanitizePublicDeveloperRunResult(trainingResult),
      state: sanitizePublicDeveloperHumanTeacherState(persistedState.state),
    }
  }

  async function refreshSidecarStatus(payload = {}) {
    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const rawHealth = await localAiSidecar.getHealth({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      timeoutMs: next.timeoutMs,
    })
    const health = normalizeSidecarHealthResult(rawHealth)
    let models = normalizeSidecarModelsResult(null)
    models.lastError = null

    if (health.ok) {
      const rawModels = await localAiSidecar.listModels({
        baseUrl: state.baseUrl,
        runtimeBackend: next.runtimeBackend,
        runtimeType: next.runtimeType,
        timeoutMs: next.timeoutMs,
      })
      models = normalizeSidecarModelsResult(rawModels)
    }

    updateSidecarState({
      reachable: Boolean(health.ok),
      models: models.ok ? models.models : [],
      checkedAt: new Date().toISOString(),
      lastError: health.ok ? models.lastError : health.lastError,
    })

    return {
      ok: Boolean(health.ok),
      status:
        String(health.status || (health.ok ? 'ok' : 'error')).trim() ||
        (health.ok ? 'ok' : 'error'),
      error: health.ok ? models.error || null : health.error || null,
      health,
      models,
      ...currentStatus(),
    }
  }

  async function status(payload = {}) {
    await hydrate()

    if (payload && payload.refresh) {
      return refreshSidecarStatus(payload)
    }

    return currentStatus()
  }

  async function start(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)
    state.running = true
    state.lastError = null

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI runtime marked as started', {
        mode: state.mode,
        runtimeBackend: state.runtimeBackend,
        capturedCount: state.capturedCount,
      })
    }

    const initialStatus = await refreshSidecarStatus(next)

    if (
      initialStatus.ok ||
      initialStatus.status === 'config_error' ||
      next.runtimeBackend !== LOCAL_AI_OLLAMA_RUNTIME_BACKEND
    ) {
      state.runtimeManaged = false
      state.running = Boolean(initialStatus.ok)
      return {
        ...initialStatus,
        ...currentStatus(),
      }
    }

    try {
      const runtimeStart = await localAiRuntimeController.start(next)
      state.runtimeManaged = Boolean(runtimeStart && runtimeStart.managed)

      const readyStatus = await waitForRuntimeReady(next)
      state.running = Boolean(
        readyStatus.ok || (runtimeStart && runtimeStart.started)
      )

      if (!readyStatus.ok && runtimeStart && runtimeStart.started) {
        return {
          ...readyStatus,
          ...currentStatus(),
          error: readyStatus.error || 'runtime_start_timeout',
          lastError:
            readyStatus.lastError ||
            'Ollama was started but is not responding yet.',
        }
      }

      return {
        ...readyStatus,
        ...currentStatus(),
      }
    } catch (error) {
      state.running = false
      state.runtimeManaged = false
      state.lastError = String((error && error.message) || error || '').trim()
      state.sidecarReachable = false
      state.sidecarCheckedAt = new Date().toISOString()
      state.sidecarModels = []

      return {
        ok: false,
        status: 'error',
        error: 'runtime_start_failed',
        lastError:
          state.lastError || 'Unable to start the configured Local AI runtime.',
        ...currentStatus(),
      }
    }
  }

  async function getDeveloperTelemetry() {
    try {
      const telemetry = await localSystemTelemetryProvider()
      const normalizedTelemetry =
        telemetry && typeof telemetry === 'object' && !Array.isArray(telemetry)
          ? telemetry
          : {
              collectedAt: new Date().toISOString(),
              system: {
                available: false,
                lastError: 'Developer telemetry provider returned no data',
              },
            }

      return {
        ...normalizedTelemetry,
        trainingReadiness: getTelemetryTrainingReadiness(normalizedTelemetry),
      }
    } catch (error) {
      const fallbackTelemetry = {
        collectedAt: new Date().toISOString(),
        system: {
          available: false,
          lastError: String(
            error && error.message ? error.message : error || ''
          ),
        },
      }

      return {
        ...fallbackTelemetry,
        trainingReadiness: getTelemetryTrainingReadiness(fallbackTelemetry),
      }
    }
  }

  async function stop() {
    await hydrate()

    try {
      await localAiRuntimeController.stop({
        runtimeBackend: state.runtimeBackend,
      })
    } catch (error) {
      state.lastError = String((error && error.message) || error || '').trim()
    }

    state.running = false
    state.runtimeManaged = false
    state.lastError = null
    state.sidecarReachable = null
    state.sidecarCheckedAt = new Date().toISOString()
    state.sidecarModels = []

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI runtime marked as stopped', {
        capturedCount: state.capturedCount,
      })
    }

    return currentStatus()
  }

  async function listModels(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        models: [],
        total: 0,
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.listModels({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      timeoutMs: next.timeoutMs,
    })
    const result = normalizeSidecarModelsResult(rawResult)

    updateSidecarState({
      reachable: Boolean(result.ok),
      models: result.ok ? result.models : [],
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function chat(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        status: 'error',
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        content: null,
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.chat({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      model: next.model,
      visionModel: next.visionModel,
      messages: next.messages,
      message: next.message,
      prompt: next.prompt,
      input: next.input,
      timeoutMs: next.timeoutMs,
      responseFormat: next.responseFormat,
      generationOptions: next.generationOptions,
      modelFallbacks: next.modelFallbacks,
      visionModelFallbacks: next.visionModelFallbacks,
    })
    const result = normalizeSidecarActionResult(rawResult, {
      error: 'chat_unavailable',
      lastError: 'Local AI chat returned no response.',
      content: null,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function flipToText(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        status: 'error',
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        text: null,
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.flipToText({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
      timeoutMs: next.timeoutMs,
    })
    const result = normalizeSidecarActionResult(rawResult, {
      error: 'flip_to_text_unavailable',
      lastError: 'Local AI flip text returned no response.',
      text: null,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function checkFlipSequence(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const readiness = await ensureInteractiveRuntimeReady(next)

    if (readiness && !readiness.ok) {
      return {
        ok: false,
        status: 'error',
        error: readiness.error || 'runtime_unavailable',
        lastError:
          readiness.lastError || 'Local AI runtime is unavailable right now.',
        classification: null,
        confidence: null,
        reason: null,
        sequenceText: null,
        ...currentStatus(),
      }
    }

    const rawResult = await localAiSidecar.checkFlipSequence({
      baseUrl: state.baseUrl,
      runtimeBackend: next.runtimeBackend,
      runtimeType: next.runtimeType,
      visionModel: next.visionModel,
      model: next.model,
      input: pickRuntimeInput(next),
      timeoutMs: next.timeoutMs,
    })
    const result = normalizeSidecarActionResult(rawResult, {
      error: 'flip_check_unavailable',
      lastError: 'Local AI flip checker returned no response.',
      classification: null,
      confidence: null,
      reason: null,
      sequenceText: null,
    })

    updateSidecarState({
      reachable: Boolean(result.ok),
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function captionFlip(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.captionFlip({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function ocrImage(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload, state)

    applyRuntimeState(next)

    const result = await localAiSidecar.ocrImage({
      ...next,
      baseUrl: state.baseUrl,
    })

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function trainEpoch(payload = {}) {
    await hydrate()

    const next = sanitizeDeveloperHumanTeacherTrainingPayload(
      normalizeRuntimePayload(payload, state)
    )
    const developerHumanTeacher = isDeveloperHumanTeacherTrainingRequest(next)
    const allowSystemPressureOverride =
      developerHumanTeacher && hasDeveloperTrainingSystemPressureOverride(next)
    const onDeveloperHumanTeacherProgress =
      developerHumanTeacher &&
      typeof next.onDeveloperHumanTeacherProgress === 'function'
        ? next.onDeveloperHumanTeacherProgress
        : null

    applyRuntimeState(next)

    if (developerHumanTeacher) {
      const telemetry = await getDeveloperTelemetry()
      const trainingReadiness =
        telemetry &&
        typeof telemetry.trainingReadiness === 'object' &&
        !Array.isArray(telemetry.trainingReadiness)
          ? telemetry.trainingReadiness
          : getTelemetryTrainingReadiness(telemetry)

      if (
        trainingReadiness.status === 'blocked' &&
        allowSystemPressureOverride !== true
      ) {
        return {
          ...currentStatus(),
          ok: false,
          status: 'blocked_by_system_pressure',
          error: 'system_pressure',
          lastError:
            trainingReadiness.message ||
            'Local training is blocked by current system conditions.',
          trainingReadiness,
        }
      }
    }

    const sidecarPayload = {
      ...next,
      baseUrl: state.baseUrl,
    }
    delete sidecarPayload.onDeveloperHumanTeacherProgress

    let result = await localAiSidecar.trainEpoch(sidecarPayload)

    updateSidecarState({
      reachable: result.status !== 'error',
      checkedAt: new Date().toISOString(),
      lastError: result.lastError,
    })

    if (
      developerHumanTeacher &&
      result &&
      result.ok !== true &&
      result.status === 'not_implemented' &&
      localAiDeveloperTrainingRunner &&
      typeof localAiDeveloperTrainingRunner.runEpoch === 'function'
    ) {
      result = await localAiDeveloperTrainingRunner.runEpoch({
        ...sidecarPayload,
        baseUrl: state.baseUrl,
        onProgress: onDeveloperHumanTeacherProgress,
      })

      updateSidecarState({
        reachable: state.sidecarReachable,
        checkedAt: new Date().toISOString(),
        lastError:
          result && result.ok === true
            ? null
            : extractDeveloperTrainingFailureReason(result),
      })
    }

    return {
      ...result,
      ...currentStatus(),
    }
  }

  async function captureFlip(payload) {
    await hydrate()

    const nextCapture = toCaptureMeta(payload)

    if (!nextCapture) {
      state.lastError = 'Invalid local AI capture payload'

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Ignoring invalid local AI capture payload')
      }

      return {
        ok: false,
        error: state.lastError,
        ...currentStatus(),
      }
    }

    const existingCapture = reduceLatestCaptures(state.captureIndex).find(
      ({flipHash}) => flipHash === nextCapture.flipHash
    )
    const capture = mergeCaptureMeta(existingCapture, nextCapture)

    // Decoded flips often arrive before final consensus, so only explicit
    // disqualifiers are blocked here. Unknown cases still rely on manifest-time
    // post-consensus filtering.
    const skipReasons = getCaptureSkipReasons(payload, capture)

    if (skipReasons.length) {
      state.lastError = null

      if (isDev && logger && typeof logger.debug === 'function') {
        logger.debug('Skipping ineligible local AI capture', {
          flipHash: capture.flipHash,
          reasons: skipReasons,
        })
      }

      return {
        ok: false,
        skipped: true,
        reasons: skipReasons,
        ...currentStatus(),
      }
    }

    state.capturedCount += existingCapture ? 0 : 1
    state.lastError = null
    state.captureIndex = state.captureIndex
      .filter(({flipHash}) => flipHash !== capture.flipHash)
      .concat(capture)
      .slice(-MAX_CAPTURE_INDEX_ITEMS)
    state.recentCaptures = state.captureIndex.slice(-MAX_RECENT_CAPTURES)

    try {
      await persistCaptureIndex()
      state.loadError = null
    } catch (error) {
      state.lastError = 'Unable to persist local AI capture index'

      if (logger && typeof logger.error === 'function') {
        logger.error('Unable to persist local AI capture index', {
          error: error.toString(),
        })
      }

      return {
        ok: false,
        error: state.lastError,
        ...currentStatus(),
      }
    }

    // MVP boundary: record metadata only, never retain decoded image bytes.
    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI flip captured', {
        flipHash: capture.flipHash,
        epoch: capture.epoch,
        sessionType: capture.sessionType,
        panelCount: capture.panelCount,
        capturedCount: state.capturedCount,
      })
    }

    return {
      ok: true,
      capture,
      ...currentStatus(),
    }
  }

  async function buildManifest(epochValue) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(epochValue)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : epochValue
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {...next, epoch},
      modelReference
    )

    const eligibleFlipHashes = []
    const excluded = []

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      eligibleFlipHashes.push(capture.flipHash)
    })

    const inconsistencyFlags = collectInconsistencyFlags(excluded)

    const manifest = {
      epoch,
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterStrategy: String(next.adapterStrategy || '').trim() || null,
      trainingPolicy: String(next.trainingPolicy || '').trim() || null,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      adapterArtifact: adapterContract.adapterArtifact || null,
      trainingConfigHash: adapterContract.trainingConfigHash,
      eligibleFlipHashes,
      flipCount: eligibleFlipHashes.length,
      excluded,
      skippedCount: excluded.length,
      inconsistencyFlags,
      generatedAt: new Date().toISOString(),
    }
    const nextManifestPath = manifestPath(localAiStorage, epoch)

    await localAiStorage.writeJsonAtomic(nextManifestPath, manifest)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI manifest built', {
        epoch,
        eligibleCount: eligibleFlipHashes.length,
        excludedCount: excluded.length,
        manifestPath: nextManifestPath,
      })
    }

    return {
      epoch,
      eligibleCount: eligibleFlipHashes.length,
      excludedCount: excluded.length,
      manifestPath: nextManifestPath,
    }
  }

  async function registerAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const artifactToken = normalizeAdapterImportToken(
      next.artifactToken ||
        next.importedArtifactToken ||
        (next.adapterArtifact &&
        typeof next.adapterArtifact === 'object' &&
        !Array.isArray(next.adapterArtifact)
          ? next.adapterArtifact.artifactToken ||
            next.adapterArtifact.importedArtifactToken ||
            next.adapterArtifact.token
          : '')
    )

    if (!artifactToken) {
      if (
        next.sourcePath ||
        next.artifactPath ||
        (next.adapterArtifact &&
          typeof next.adapterArtifact === 'object' &&
          !Array.isArray(next.adapterArtifact) &&
          (next.adapterArtifact.sourcePath ||
            next.adapterArtifact.path ||
            next.adapterArtifact.filePath))
      ) {
        throw new Error(
          'Direct adapter file paths are no longer accepted. Import the adapter file first.'
        )
      }

      throw new Error('Import a local adapter file first')
    }

    const sourcePath = adapterImportedArtifactPath(
      localAiStorage,
      epoch,
      artifactToken
    )

    if (!(await localAiStorage.exists(sourcePath))) {
      throw new Error('Imported adapter file is unavailable')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterFile = adapterArtifactFileNameFromToken(
      artifactToken,
      path.basename(sourcePath)
    )
    const sizeBytes = await localAiStorage.fileSize(sourcePath)
    const adapterSha256 = await localAiStorage.sha256File(sourcePath)
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {
        ...next,
        epoch,
        deltaType: 'lora_adapter',
        adapterSha256,
        adapterArtifact: {
          file: adapterFile,
          sourcePath,
          sizeBytes,
          artifactToken,
        },
      },
      modelReference
    )
    const adapterManifest = {
      epoch,
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      trainingConfigHash: adapterContract.trainingConfigHash,
      adapterArtifact: {
        file: adapterFile,
        sourcePath,
        sizeBytes,
        artifactToken,
      },
      registeredAt: new Date().toISOString(),
    }
    const nextManifestPath = adapterArtifactManifestPath(localAiStorage, epoch)

    await localAiStorage.writeJsonAtomic(nextManifestPath, adapterManifest)

    return toPublicAdapterArtifactManifest(nextManifestPath, adapterManifest)
  }

  async function importAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const artifactBuffer = decodeAdapterImportBuffer(
      next.artifactBase64 ||
        next.base64 ||
        next.dataUrl ||
        (next.adapterArtifact &&
        typeof next.adapterArtifact === 'object' &&
        !Array.isArray(next.adapterArtifact)
          ? next.adapterArtifact.artifactBase64 ||
            next.adapterArtifact.base64 ||
            next.adapterArtifact.dataUrl
          : '')
    )

    if (!artifactBuffer) {
      throw new Error('Adapter file contents are required')
    }

    if (artifactBuffer.length > MAX_IMPORTED_ADAPTER_BYTES) {
      throw new Error(
        `Adapter file is too large to import through the secure bridge (max ${MAX_IMPORTED_ADAPTER_BYTES} bytes)`
      )
    }

    const artifactFileName = sanitizeAdapterArtifactFileName(
      next.artifactFileName ||
        next.fileName ||
        next.name ||
        (next.adapterArtifact &&
        typeof next.adapterArtifact === 'object' &&
        !Array.isArray(next.adapterArtifact)
          ? next.adapterArtifact.file ||
            next.adapterArtifact.fileName ||
            next.adapterArtifact.name
          : ''),
      `epoch-${epoch}-adapter.bin`
    )
    const artifactSha256 = localAiStorage.sha256(artifactBuffer)
    const artifactToken = normalizeAdapterImportToken(
      `${Date.now()}-${artifactSha256.slice(0, 12)}-${artifactFileName}`
    )
    const storedPath = adapterImportedArtifactPath(
      localAiStorage,
      epoch,
      artifactToken
    )

    await localAiStorage.writeBuffer(storedPath, artifactBuffer)

    return {
      epoch,
      artifactToken,
      artifactFileName,
      sizeBytes: artifactBuffer.length,
      artifactSha256,
      importedAt: new Date().toISOString(),
    }
  }

  async function loadAdapterArtifact(payload = {}) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextManifestPath = adapterArtifactManifestPath(localAiStorage, epoch)
    const adapterManifest = await localAiStorage.readJson(
      nextManifestPath,
      null
    )

    if (!adapterManifest) {
      throw new Error('Adapter artifact is unavailable')
    }

    return toPublicAdapterArtifactManifest(nextManifestPath, adapterManifest)
  }

  async function buildTrainingCandidatePackage(payload) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const modelReference = await resolveModelReference(
      localAiStorage,
      getModelReference,
      next
    )
    const adapterContract = await resolveAdapterContract(
      localAiStorage,
      {...next, epoch},
      modelReference
    )

    const items = []
    const excluded = []
    const packagedCandidates = []

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      try {
        const item = buildTrainingCandidateItem(capture)
        items.push(item)
        packagedCandidates.push({
          capture,
          item,
        })
      } catch (error) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons: ['packaging_failed'],
        })

        if (logger && typeof logger.error === 'function') {
          logger.error('Unable to package local AI training candidate', {
            flipHash: capture.flipHash || null,
            epoch,
            error: error.toString(),
          })
        }
      }
    })

    let finalItems = items
    let finalExcluded = excluded
    let rankingMetadata = {}

    if (
      next.rankingPolicy &&
      String(next.rankingPolicy.sourcePriority || '').trim() ===
        'local-node-first'
    ) {
      const ranked = await localAiModernTrainingCollector.buildCandidatePackage(
        {
          epoch,
          candidates: packagedCandidates,
          rankingPolicy: next.rankingPolicy,
          allowPublicIndexerFallback: next.allowPublicIndexerFallback,
          fetchFlipPayloads: next.fetchFlipPayloads === true,
          requireFlipPayloads: next.requireFlipPayloads === true,
          rpcUrl: next.rpcUrl,
          rpcKey: next.rpcKey,
          refreshPublicFallback: next.refreshPublicFallback === true,
        }
      )

      finalItems = ranked.items
      finalExcluded = excluded.concat(ranked.excluded || [])
      rankingMetadata = {
        sourcePriority: ranked.sourcePriority,
        rankingPolicy: ranked.rankingPolicy,
        localIndexPath: ranked.localIndexPath,
        fallbackIndexPath: ranked.fallbackIndexPath,
        fallbackUsed: ranked.fallbackUsed,
      }
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    const inconsistencyFlags = collectInconsistencyFlags(finalExcluded)
    const candidatePackage = {
      schemaVersion: TRAINING_CANDIDATE_PACKAGE_VERSION,
      packageType: 'local-ai-training-candidates',
      epoch,
      createdAt: new Date().toISOString(),
      publicModelId: modelReference.publicModelId,
      publicVisionId: modelReference.publicVisionId,
      runtimeBackend: modelReference.runtimeBackend,
      reasonerBackend: modelReference.reasonerBackend,
      visionBackend: modelReference.visionBackend,
      contractVersion: modelReference.contractVersion,
      baseModelId: modelReference.baseModelId,
      baseModelHash: modelReference.baseModelHash,
      adapterStrategy: String(next.adapterStrategy || '').trim() || null,
      trainingPolicy: String(next.trainingPolicy || '').trim() || null,
      deltaType: adapterContract.deltaType,
      adapterFormat: adapterContract.adapterFormat,
      adapterSha256: adapterContract.adapterSha256,
      adapterArtifact: adapterContract.adapterArtifact || null,
      trainingConfigHash: adapterContract.trainingConfigHash,
      reviewStatus: 'draft',
      reviewedAt: null,
      federatedReady: false,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      inconsistencyFlags,
      items: finalItems,
      excluded: finalExcluded,
      ...rankingMetadata,
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, candidatePackage)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI training candidate package built', {
        epoch,
        eligibleCount: finalItems.length,
        excludedCount: finalExcluded.length,
        packagePath: nextPackagePath,
      })
    }

    return {
      epoch,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      packagePath: nextPackagePath,
      package: next.includePackage ? candidatePackage : undefined,
    }
  }

  async function buildHumanTeacherPackage(payload) {
    await hydrate()

    if (state.loadError) {
      throw new Error('Local AI capture index is unavailable')
    }

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'packaging')

    const batchSize = normalizeHumanTeacherBatchSize(next.batchSize)
    const excluded = []
    const packagedCandidates = []
    const captureByFlipHash = new Map()

    reduceLatestCaptures(state.captureIndex).forEach((capture) => {
      const reasons = getExclusionReasons(capture, epoch)

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons,
        })
        return
      }

      try {
        const item = buildTrainingCandidateItem(capture)
        captureByFlipHash.set(capture.flipHash, capture)
        packagedCandidates.push({
          capture,
          item,
        })
      } catch (error) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons: ['packaging_failed'],
        })

        if (logger && typeof logger.error === 'function') {
          logger.error('Unable to package local AI human-teacher candidate', {
            flipHash: capture.flipHash || null,
            epoch,
            error: error.toString(),
          })
        }
      }
    })

    const ranked = await localAiModernTrainingCollector.buildCandidatePackage({
      epoch,
      candidates: packagedCandidates,
      rankingPolicy: next.rankingPolicy || {
        sourcePriority: 'local-node-first',
      },
      allowPublicIndexerFallback:
        typeof next.allowPublicIndexerFallback === 'boolean'
          ? next.allowPublicIndexerFallback
          : true,
      fetchFlipPayloads:
        typeof next.fetchFlipPayloads === 'boolean'
          ? next.fetchFlipPayloads
          : true,
      requireFlipPayloads:
        typeof next.requireFlipPayloads === 'boolean'
          ? next.requireFlipPayloads
          : true,
      rpcUrl: next.rpcUrl,
      rpcKey: next.rpcKey,
      refreshPublicFallback: next.refreshPublicFallback === true,
    })

    const finalExcluded = excluded.concat(ranked.excluded || [])
    const finalItems = []

    sortHumanTeacherItems(ranked.items || [])
      .slice(0, batchSize)
      .forEach((item) => {
        try {
          const originalCapture = captureByFlipHash.get(item.flipHash) || {}
          finalItems.push(
            buildHumanTeacherItem({
              ...originalCapture,
              ...item,
              orders: Array.isArray(originalCapture.orders)
                ? originalCapture.orders
                : [],
              selectedOrder: originalCapture.selectedOrder || null,
              relevance: originalCapture.relevance || null,
              best: originalCapture.best === true || item.best === true,
              author:
                item.author ||
                originalCapture.author ||
                (item.audit && item.audit.author) ||
                null,
            })
          )
        } catch (error) {
          finalExcluded.push({
            flipHash: item && item.flipHash ? item.flipHash : null,
            reasons: ['annotation_packaging_failed'],
          })

          if (logger && typeof logger.error === 'function') {
            logger.error('Unable to build local AI human-teacher task', {
              flipHash: item && item.flipHash ? item.flipHash : null,
              epoch,
              error: error.toString(),
            })
          }
        }
      })

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = {
      schemaVersion: HUMAN_TEACHER_PACKAGE_VERSION,
      packageType: 'local-ai-human-teacher-tasks',
      epoch,
      createdAt: new Date().toISOString(),
      batchSize,
      candidatePoolSize: Array.isArray(ranked.items) ? ranked.items.length : 0,
      reviewStatus: 'draft',
      reviewedAt: null,
      annotationReady: false,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      inconsistencyFlags: collectInconsistencyFlags(finalExcluded),
      sourcePriority: ranked.sourcePriority,
      rankingPolicy: ranked.rankingPolicy,
      localIndexPath: ranked.localIndexPath,
      fallbackIndexPath: ranked.fallbackIndexPath,
      fallbackUsed: ranked.fallbackUsed,
      items: finalItems,
      excluded: finalExcluded,
      annotationInstructions: {
        batchGoal: 'human_explanation_for_consensus_flip',
        requiredFields: [
          'textRequired',
          'sequenceMarkersPresent',
          'reportRequired',
          'finalAnswer',
          'whyAnswer',
          'confidence',
        ],
      },
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, taskPackage)

    if (isDev && logger && typeof logger.debug === 'function') {
      logger.debug('Local AI human-teacher package built', {
        epoch,
        eligibleCount: finalItems.length,
        excludedCount: finalExcluded.length,
        batchSize,
        packagePath: nextPackagePath,
      })
    }

    return {
      epoch,
      eligibleCount: finalItems.length,
      excludedCount: finalExcluded.length,
      packagePath: nextPackagePath,
      package: next.includePackage ? taskPackage : undefined,
    }
  }

  async function loadTrainingCandidatePackage(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    const candidatePackage = await localAiStorage.readTrainingCandidatePackage(
      nextPackagePath,
      null
    )

    if (!candidatePackage) {
      throw new Error('Training candidate package is unavailable')
    }

    return {
      epoch,
      eligibleCount: Number(candidatePackage.eligibleCount) || 0,
      excludedCount: Number(candidatePackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: candidatePackage,
    }
  }

  async function updateTrainingCandidatePackageReview(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = trainingCandidatePackagePath(localAiStorage, epoch)
    let candidatePackage

    try {
      candidatePackage =
        await localAiStorage.updateTrainingCandidatePackageReview(
          nextPackagePath,
          {
            reviewStatus: next.reviewStatus,
          }
        )
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('Training candidate package is unavailable')
      }

      throw error
    }

    return {
      epoch,
      eligibleCount: Number(candidatePackage.eligibleCount) || 0,
      excludedCount: Number(candidatePackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: candidatePackage,
    }
  }

  async function loadHumanTeacherPackage(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
    }
  }

  async function updateHumanTeacherPackageReview(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'review')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    let taskPackage

    try {
      taskPackage = await localAiStorage.updateHumanTeacherPackageReview(
        nextPackagePath,
        {
          reviewStatus: next.reviewStatus,
        }
      )
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('Human teacher package is unavailable')
      }

      throw error
    }

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
    }
  }

  async function exportHumanTeacherTasksWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'export')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if ((Number(taskPackage.eligibleCount) || 0) <= 0) {
      throw new Error(
        'Human teacher package does not contain any eligible tasks'
      )
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotation tasks can be exported'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const exportSummary = await exportHumanTeacherTasks({
      packagePath: nextPackagePath,
      outputDir,
      take: next.batchSize,
    })

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
      outputDir,
      export: exportSummary,
    }
  }

  async function loadHumanTeacherAnnotationWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation workspace')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before the annotation workspace can be opened'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')

    if (!(await localAiStorage.exists(taskManifestPath))) {
      throw new Error(
        'Human teacher task manifest is unavailable; export annotation tasks first'
      )
    }

    await assertHumanTeacherWorkspaceIntegrity(localAiStorage, {
      outputDir,
      taskManifestPath,
      epoch,
      packagePath: nextPackagePath,
    })

    const taskRows = await readJsonlRows(taskManifestPath, [])
    const annotationRows = await readJsonlRows(annotationsPath, [])
    const tasks = buildHumanTeacherWorkspaceTasks(
      taskRows,
      annotationRows,
      epoch
    )

    return {
      epoch,
      eligibleCount: Number(taskPackage.eligibleCount) || 0,
      excludedCount: Number(taskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: taskPackage,
      outputDir,
      workspace: {
        outputDir,
        taskManifestPath,
        annotationsPath,
        taskCount: tasks.length,
        draftedCount: tasks.filter((task) => task.hasDraft).length,
        completedCount: tasks.filter((task) => task.isComplete).length,
        tasks,
      },
    }
  }

  async function loadHumanTeacherDemoWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDemoSampleName(next.sampleName)
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const session = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })

    return {
      demo: true,
      sampleName: sample.sampleName,
      samples: listHumanTeacherDemoSamples(),
      chunkSize: DEMO_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      state: summarizeDemoHumanTeacherState(demoState, {
        currentOffset: effectiveOffset,
      }),
      summary: session.summary,
      workspace: session.workspace,
    }
  }

  async function loadHumanTeacherDeveloperSession(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'session start'
    )
    const sampleName = normalizeDemoSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const normalizedSampleName =
      normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(normalizedSampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset =
      typeof next.offset === 'number'
        ? clampDeveloperHumanTeacherOffset(next.offset, sample.totalFlips)
        : resolveDeveloperHumanTeacherSessionOffset(
            developerState,
            sample.totalFlips,
            developerState.currentOffset
          )
    const session = await loadDeveloperHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })

    return {
      demo: true,
      developer: true,
      sampleName: sample.sampleName,
      samples: listDeveloperHumanTeacherSamples(),
      chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
      offset: effectiveOffset,
      state: sanitizePublicDeveloperHumanTeacherState(developerState, {
        currentOffset: effectiveOffset,
      }),
      summary: session.summary,
      workspace: session.workspace,
      comparison100: sanitizePublicDeveloperComparisonState(
        developerState.comparison100
      ),
    }
  }

  async function loadHumanTeacherDeveloperSessionState(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'session status'
    )
    const sampleName = normalizeDemoSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const normalizedSampleName =
      normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(normalizedSampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return {
      developer: true,
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      state: sanitizePublicDeveloperHumanTeacherState(developerState, {
        currentOffset: effectiveOffset,
      }),
    }
  }

  async function stopHumanTeacherDeveloperRun(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'stop local training'
    )
    const sampleName = normalizeDemoSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const normalizedSampleName =
      normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(normalizedSampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const activeRun = normalizeDeveloperActiveRunState(developerState.activeRun)
    const stopMode = normalizeDeveloperRunStopMode(next.stopMode)

    if (!activeRun || activeRun.status !== 'running') {
      return {
        developer: true,
        stopped: false,
        state: sanitizePublicDeveloperHumanTeacherState(developerState),
      }
    }

    if (
      !localAiDeveloperTrainingRunner ||
      typeof localAiDeveloperTrainingRunner.stopCurrentRun !== 'function'
    ) {
      return {
        developer: true,
        stopped: false,
        error: 'stop_not_supported',
        lastError: 'This local training backend does not expose stop control.',
        state: sanitizePublicDeveloperHumanTeacherState(developerState),
      }
    }

    const stopResult = await localAiDeveloperTrainingRunner.stopCurrentRun({
      sampleName: sample.sampleName,
      kind: activeRun.kind,
      stopMode,
    })

    if (stopResult?.stopped !== true) {
      return {
        developer: true,
        stopped: false,
        state: sanitizePublicDeveloperHumanTeacherState(developerState),
      }
    }

    let stoppingMessage = 'Cancelling this local run now…'

    if (stopMode === 'after_unit') {
      const benchmarkStage =
        activeRun.kind === 'comparison' ||
        String(activeRun.stage || '')
          .trim()
          .startsWith('benchmark_')

      stoppingMessage = benchmarkStage
        ? 'Stopping after the current benchmark flip…'
        : 'Stopping after the current training step…'
    }

    const stoppingState = await writeDeveloperHumanTeacherState(
      sample.sampleName,
      {
        ...developerState,
        totalAvailableTasks: sample.totalFlips,
        activeRun: {
          ...activeRun,
          status: 'stopping',
          stopMode,
          message: stoppingMessage,
          updatedAt: new Date().toISOString(),
        },
      }
    )

    return {
      developer: true,
      stopped: true,
      stop: stopResult,
      state: sanitizePublicDeveloperHumanTeacherState(stoppingState.state),
    }
  }

  async function updateHumanTeacherDeveloperRunControls(payload) {
    await hydrate()

    const next = sanitizeDeveloperHumanTeacherTrainingPayload(
      normalizeRuntimePayload(payload)
    )
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'update local run controls'
    )
    const sampleName = normalizeDemoSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const normalizedSampleName =
      normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(normalizedSampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const activeRun = normalizeDeveloperActiveRunState(developerState.activeRun)

    if (!activeRun || activeRun.status !== 'running') {
      return {
        developer: true,
        updated: false,
        error: 'run_not_active',
        state: sanitizePublicDeveloperHumanTeacherState(developerState),
      }
    }

    if (
      !localAiDeveloperTrainingRunner ||
      typeof localAiDeveloperTrainingRunner.updateCurrentRunControls !==
        'function'
    ) {
      return {
        developer: true,
        updated: false,
        error: 'run_control_not_supported',
        lastError:
          'This local training backend does not expose live run controls.',
        state: sanitizePublicDeveloperHumanTeacherState(developerState),
      }
    }

    const updateResult =
      await localAiDeveloperTrainingRunner.updateCurrentRunControls({
        localTrainingThermalMode:
          next.localTrainingThermalMode || activeRun.trainingThermalMode,
        localBenchmarkThermalMode:
          next.localBenchmarkThermalMode || activeRun.benchmarkThermalMode,
      })

    if (updateResult?.updated !== true) {
      return {
        developer: true,
        updated: false,
        state: sanitizePublicDeveloperHumanTeacherState(developerState),
      }
    }

    const updatedState = await writeDeveloperHumanTeacherState(
      sample.sampleName,
      {
        ...developerState,
        totalAvailableTasks: sample.totalFlips,
        activeRun: {
          ...activeRun,
          trainingThermalMode:
            updateResult.trainingThermalMode || activeRun.trainingThermalMode,
          benchmarkThermalMode:
            updateResult.benchmarkThermalMode || activeRun.benchmarkThermalMode,
          updatedAt: new Date().toISOString(),
        },
      }
    )

    return {
      developer: true,
      updated: true,
      controls: updateResult,
      state: sanitizePublicDeveloperHumanTeacherState(updatedState.state),
    }
  }

  async function loadHumanTeacherDeveloperComparisonExamples(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const parsedMaxExamples = Number.parseInt(next.maxExamples, 10)
    const maxExamples = Number.isFinite(parsedMaxExamples)
      ? Math.min(
          MAX_DEVELOPER_LOCAL_BENCHMARK_SIZE,
          Math.max(1, parsedMaxExamples)
        )
      : 12
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'comparison examples'
    )
    const sampleName = normalizeDemoSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const normalizedSampleName =
      normalizeDeveloperHumanTeacherSampleName(sampleName)
    const sample = await loadDeveloperHumanTeacherSample(normalizedSampleName)
    const {statePath, state: developerState} =
      await loadDeveloperHumanTeacherState(sample.sampleName, sample.totalFlips)
    const comparison = normalizeDeveloperComparisonState(
      developerState.comparison100
    )
    const benchmarkFlips = normalizeDeveloperLocalBenchmarkFlips(
      next.evaluationFlips || next.benchmarkFlips
    )
    const historyForBenchmark = comparison.history.filter(
      (entry) => Number.parseInt(entry?.benchmarkFlips, 10) === benchmarkFlips
    )
    const latestEntry = historyForBenchmark[0] || null
    const previousEntry = historyForBenchmark[1] || null
    const developerDir = path.dirname(statePath)

    if (!latestEntry || !latestEntry.resultPath) {
      return {
        developer: true,
        sampleName: sample.sampleName,
        benchmarkFlips,
        current: null,
        previous: null,
        examples: [],
      }
    }

    const currentArtifact = await loadDeveloperComparisonArtifact(
      developerDir,
      latestEntry
    )
    const previousArtifact = previousEntry
      ? await loadDeveloperComparisonArtifact(developerDir, previousEntry)
      : null
    const examples = currentArtifact?.hasDetailedResults
      ? selectDeveloperComparisonExamples({
          currentArtifact,
          previousArtifact,
          sample,
          maxExamples,
        })
      : []

    return {
      developer: true,
      sampleName: sample.sampleName,
      benchmarkFlips,
      current: currentArtifact
        ? {
            evaluatedAt:
              currentArtifact.summary.evaluatedAt ||
              currentArtifact.entry.evaluatedAt,
            accuracy:
              currentArtifact.summary.accuracy !== null
                ? currentArtifact.summary.accuracy
                : currentArtifact.entry.accuracy,
            correct:
              currentArtifact.summary.correct !== null
                ? currentArtifact.summary.correct
                : currentArtifact.entry.correct,
            totalFlips:
              currentArtifact.summary.totalFlips !== null
                ? currentArtifact.summary.totalFlips
                : currentArtifact.entry.totalFlips,
            deltaAccuracy: currentArtifact.summary.deltaAccuracy,
            fairBenchmark: currentArtifact.summary.fairBenchmark,
          }
        : null,
      previous: previousArtifact
        ? {
            evaluatedAt:
              previousArtifact.summary.evaluatedAt ||
              previousArtifact.entry.evaluatedAt,
            accuracy:
              previousArtifact.summary.accuracy !== null
                ? previousArtifact.summary.accuracy
                : previousArtifact.entry.accuracy,
            correct:
              previousArtifact.summary.correct !== null
                ? previousArtifact.summary.correct
                : previousArtifact.entry.correct,
            totalFlips:
              previousArtifact.summary.totalFlips !== null
                ? previousArtifact.summary.totalFlips
                : previousArtifact.entry.totalFlips,
            deltaAccuracy: previousArtifact.summary.deltaAccuracy,
            fairBenchmark: previousArtifact.summary.fairBenchmark,
          }
        : null,
      examples,
      hasDetailedResults: Boolean(currentArtifact?.hasDetailedResults),
    }
  }

  async function exportHumanTeacherDeveloperBundle(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const annotatedSourcePath = developerHumanTeacherAnnotatedPath(
      localAiStorage,
      sample.sampleName
    )
    const pendingSourcePath = developerHumanTeacherPendingPath(
      localAiStorage,
      sample.sampleName
    )
    const trainedSourcePath = developerHumanTeacherTrainedPath(
      localAiStorage,
      sample.sampleName
    )
    const annotatedRows = await readJsonlRows(annotatedSourcePath, [])
    const pendingRows = await readJsonlRows(pendingSourcePath, [])
    const trainedRows = await readJsonlRows(trainedSourcePath, [])

    if (!annotatedRows.length) {
      throw new Error(
        'Annotate at least one completed developer flip before exporting an external training bundle'
      )
    }

    const createdAt = new Date().toISOString()
    const bundleId = buildDeveloperExternalBundleId(createdAt)
    const outputDir = developerHumanTeacherExternalBundleDir(
      localAiStorage,
      sample.sampleName,
      bundleId
    )
    const annotationsPath = path.join(outputDir, 'annotations.normalized.jsonl')
    const pendingPath = path.join(outputDir, 'annotations.pending.jsonl')
    const trainedPath = path.join(outputDir, 'annotations.trained.jsonl')
    const bundleManifestPath = path.join(
      outputDir,
      'training-bundle-manifest.json'
    )
    const readmePath = path.join(outputDir, 'README.md')
    const developerPrompt = String(
      next.developerHumanTeacherSystemPrompt || ''
    ).trim()
    const runtimeModel = String(next.model || '').trim() || null
    const runtimeVisionModel = String(next.visionModel || '').trim() || null

    await localAiStorage.ensureDir(outputDir)
    await writeJsonlRows(annotationsPath, annotatedRows)
    await writeJsonlRows(pendingPath, pendingRows)
    await writeJsonlRows(trainedPath, trainedRows)

    const annotationSha256 = await localAiStorage.sha256File(annotationsPath)
    const pendingSha256 = await localAiStorage.sha256File(pendingPath)
    const trainedSha256 = await localAiStorage.sha256File(trainedPath)
    const manifest = {
      version: EXTERNAL_DEVELOPER_TRAINING_BUNDLE_VERSION,
      bundleType: 'idenaai-human-teacher-external-training',
      bundleId,
      createdAt,
      developerSession: {
        sampleName: sample.sampleName,
        sampleLabel: sample.label,
        totalAvailableTasks: sample.totalFlips,
        chunkSize: DEVELOPER_HUMAN_TEACHER_BATCH_SIZE,
        annotatedTaskIds: developerState.annotatedTaskIds,
        pendingTrainingTaskIds: developerState.pendingTrainingTaskIds,
        trainedTaskIds: developerState.trainedTaskIds,
      },
      runtime: {
        runtimeBackend: String(next.runtimeBackend || '').trim() || null,
        runtimeType: String(next.runtimeType || '').trim() || null,
        baseUrl: String(next.baseUrl || '').trim() || null,
        model: runtimeModel,
        visionModel: runtimeVisionModel,
      },
      training: {
        recommendedModel: EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL || null,
        humanTeacherSystemPrompt: developerPrompt || null,
      },
      benchmark: {
        recommendedHoldoutFlips: EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE,
        policy:
          'benchmark on unseen flips and publish per-flip predictions, not only a final score',
      },
      files: {
        annotations: {
          path: annotationsPath,
          rowCount: annotatedRows.length,
          sha256: annotationSha256,
        },
        pending: {
          path: pendingPath,
          rowCount: pendingRows.length,
          sha256: pendingSha256,
        },
        trained: {
          path: trainedPath,
          rowCount: trainedRows.length,
          sha256: trainedSha256,
        },
      },
    }

    await localAiStorage.writeJsonAtomic(bundleManifestPath, manifest)
    await localAiStorage.writeBuffer(
      readmePath,
      Buffer.from(
        buildDeveloperExternalTrainingBundleReadme({
          bundleId,
          createdAt,
          sampleName: sample.sampleName,
          annotatedCount: annotatedRows.length,
          pendingCount: pendingRows.length,
          trainedCount: trainedRows.length,
          runtimeBackend: manifest.runtime.runtimeBackend,
          runtimeModel: manifest.runtime.model,
          runtimeVisionModel: manifest.runtime.visionModel,
          developerPromptActive: Boolean(developerPrompt),
        }),
        'utf8'
      )
    )

    return {
      developer: true,
      bundleId,
      outputDir,
      manifestPath: bundleManifestPath,
      readmePath,
      annotationsPath,
      pendingPath,
      trainedPath,
      sampleName: sample.sampleName,
      annotatedCount: annotatedRows.length,
      pendingCount: pendingRows.length,
      trainedCount: trainedRows.length,
      recommendedTrainingModel: EXTERNAL_DEVELOPER_RECOMMENDED_TRAINING_MODEL,
      recommendedBenchmarkFlips: EXTERNAL_DEVELOPER_RECOMMENDED_BENCHMARK_SIZE,
      supportsLocalTraining:
        summarizeDeveloperHumanTeacherState(developerState)
          .supportsLocalTraining,
    }
  }

  async function loadHumanTeacherAnnotationTask(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)
    const taskId = String(next.taskId || '').trim()

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    if (!taskId) {
      throw new Error('taskId is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation task')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotation tasks can be opened'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')
    await assertHumanTeacherWorkspaceIntegrity(localAiStorage, {
      outputDir,
      taskManifestPath,
      epoch,
      packagePath: nextPackagePath,
    })
    const taskRows = await readJsonlRows(taskManifestPath, [])
    const annotationRows = await readJsonlRows(annotationsPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher task is unavailable')
    }

    const annotationRow = annotationRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )
    const panels = await Promise.all(
      (Array.isArray(taskRow.panels) ? taskRow.panels : []).map(
        async (panelRelativePath, index) => {
          const panelPath = resolveWorkspaceChildPath(
            outputDir,
            panelRelativePath
          )
          const panelBuffer = await localAiStorage.readBuffer(panelPath)

          return {
            id: `panel-${index + 1}`,
            index,
            path: panelPath,
            dataUrl: `data:image/png;base64,${panelBuffer.toString('base64')}`,
          }
        }
      )
    )

    return {
      epoch,
      task: {
        taskId,
        sampleId: taskRow.sample_id || taskId,
        flipHash: taskRow.flip_hash || null,
        epoch: taskRow.epoch ?? epoch,
        consensusAnswer: taskRow.final_answer || null,
        consensusStrength: taskRow.consensus_strength || null,
        leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
        rightOrder: Array.isArray(taskRow.right_order)
          ? taskRow.right_order
          : [],
        words:
          taskRow.words &&
          typeof taskRow.words === 'object' &&
          !Array.isArray(taskRow.words)
            ? taskRow.words
            : {},
        panels,
        annotation: normalizeHumanTeacherAnnotationDraft(
          taskRow,
          annotationRow
        ),
      },
    }
  }

  async function loadHumanTeacherDemoTask(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDemoSampleName(next.sampleName)
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const taskId = String(next.taskId || '').trim()

    if (!taskId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })
    const taskRows = await readJsonlRows(chunk.taskManifestPath, [])
    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher demo task is unavailable')
    }

    const annotationRow = annotationRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )
    const panels = await Promise.all(
      (Array.isArray(taskRow.panels) ? taskRow.panels : []).map(
        async (panelRelativePath, index) => {
          const panelPath = resolveWorkspaceChildPath(
            chunk.outputDir,
            panelRelativePath
          )
          const panelBuffer = await localAiStorage.readBuffer(panelPath)

          return {
            id: `panel-${index + 1}`,
            index,
            path: panelPath,
            dataUrl: `data:image/png;base64,${panelBuffer.toString('base64')}`,
          }
        }
      )
    )

    return {
      demo: true,
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      task: {
        taskId,
        sampleId: taskRow.sample_id || taskId,
        flipHash: taskRow.flip_hash || null,
        epoch: null,
        consensusAnswer: taskRow.final_answer || null,
        consensusStrength: taskRow.consensus_strength || null,
        leftOrder: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
        rightOrder: Array.isArray(taskRow.right_order)
          ? taskRow.right_order
          : [],
        words:
          taskRow.words &&
          typeof taskRow.words === 'object' &&
          !Array.isArray(taskRow.words)
            ? taskRow.words
            : {},
        demo:
          taskRow.demo &&
          typeof taskRow.demo === 'object' &&
          !Array.isArray(taskRow.demo)
            ? taskRow.demo
            : null,
        panels,
        annotation: normalizeHumanTeacherAnnotationDraft(
          taskRow,
          annotationRow
        ),
      },
    }
  }

  async function loadHumanTeacherDeveloperTask(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(next.currentPeriod, 'task open')
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return loadDeveloperHumanTeacherTaskFromChunk({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      taskId: next.taskId,
    })
  }

  async function saveHumanTeacherAnnotationDraft(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)
    const taskId = String(next.taskId || '').trim()

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    if (!taskId) {
      throw new Error('taskId is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation draft save')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotation drafts can be saved'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const annotationsPath = path.join(outputDir, 'annotations.filled.jsonl')
    await assertHumanTeacherWorkspaceIntegrity(localAiStorage, {
      outputDir,
      taskManifestPath,
      epoch,
      packagePath: nextPackagePath,
    })
    const taskRows = await readJsonlRows(taskManifestPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher task is unavailable')
    }

    const annotationRows = await readJsonlRows(annotationsPath, [])
    const nextAnnotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      next.annotation
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(nextAnnotation)
    const nextAnnotationRows = annotationRows
      .filter(
        (row) => String(row && row.task_id ? row.task_id : '').trim() !== taskId
      )
      .concat(nextAnnotation)

    await writeJsonlRows(annotationsPath, nextAnnotationRows)

    const nextTaskPackage = {
      ...taskPackage,
      items: Array.isArray(taskPackage.items)
        ? taskPackage.items.map((item) => {
            const itemTaskId = String(
              item && item.taskId ? item.taskId : ''
            ).trim()

            if (itemTaskId !== taskId) {
              return item
            }

            return {
              ...item,
              annotationStatus,
            }
          })
        : [],
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, nextTaskPackage)

    return {
      epoch,
      packagePath: nextPackagePath,
      package: nextTaskPackage,
      task: {
        taskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath,
      },
    }
  }

  async function saveHumanTeacherDemoDraft(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDemoSampleName(next.sampleName)
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const taskId = String(next.taskId || '').trim()

    if (!taskId) {
      throw new Error('taskId is required')
    }

    const chunk = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })
    const taskRows = await readJsonlRows(chunk.taskManifestPath, [])
    const taskRow = taskRows.find(
      (row) => String(row && row.task_id ? row.task_id : '').trim() === taskId
    )

    if (!taskRow) {
      throw new Error('Human teacher demo task is unavailable')
    }

    const annotationRows = await readJsonlRows(chunk.annotationsPath, [])
    const nextAnnotation = normalizeHumanTeacherAnnotationDraft(
      taskRow,
      next.annotation
    )
    const annotationStatus = getHumanTeacherAnnotationStatus(nextAnnotation)
    const nextAnnotationRows = annotationRows
      .filter(
        (row) => String(row && row.task_id ? row.task_id : '').trim() !== taskId
      )
      .concat(nextAnnotation)

    await writeJsonlRows(chunk.annotationsPath, nextAnnotationRows)
    await writeDemoHumanTeacherState(sample.sampleName, {
      ...demoState,
      totalAvailableTasks: sample.totalFlips,
      currentOffset: effectiveOffset,
      lastSavedAt: new Date().toISOString(),
    })

    return {
      demo: true,
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      task: {
        taskId,
        annotation: nextAnnotation,
        annotationStatus,
      },
      workspace: {
        annotationsPath: chunk.annotationsPath,
      },
    }
  }

  async function finalizeHumanTeacherDemoChunk(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)

    if (next.trainNow === true && next.advance === true) {
      throw new Error(
        'Demo chunk finalization must choose either training now or advancing to the next chunk, not both'
      )
    }

    const sampleName = normalizeDemoSampleName(next.sampleName)
    const sample = await loadHumanTeacherDemoSample(sampleName)
    const {state: demoState} = await loadDemoHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDemoHumanTeacherOffset(
      typeof next.offset === 'number' ? next.offset : demoState.currentOffset,
      sample.totalFlips
    )
    const chunk = await loadDemoHumanTeacherChunkWorkspace({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
    })
    const taskCount = Number(chunk.workspace.taskCount) || 0

    if (taskCount <= 0) {
      throw new Error('Demo chunk is unavailable')
    }

    if (Number(chunk.workspace.completedCount) < taskCount) {
      throw new Error('Complete all 5 demo flips before finishing this chunk')
    }

    const chunkTaskIds = uniqueStrings(
      chunk.taskRows.map((row) => row && row.task_id)
    )
    const committedAt = new Date().toISOString()
    const shouldAdvance = next.advance === true || next.trainNow === true
    const nextOffset = shouldAdvance
      ? clampDemoHumanTeacherOffset(
          chunk.offset + DEMO_HUMAN_TEACHER_BATCH_SIZE,
          chunk.sample.totalFlips
        )
      : chunk.offset
    const chunkEntries = Array.isArray(demoState.chunks)
      ? demoState.chunks.filter((entry) => entry.offset !== chunk.offset)
      : []
    chunkEntries.push({
      offset: chunk.offset,
      taskIds: chunkTaskIds,
      rowCount: chunkTaskIds.length,
      committedAt,
      trainedAt: next.trainNow === true ? committedAt : null,
      trainingStatus: next.trainNow === true ? 'demo_trained' : 'saved',
    })

    const persistedState = await writeDemoHumanTeacherState(
      chunk.sample.sampleName,
      {
        ...demoState,
        totalAvailableTasks: chunk.sample.totalFlips,
        currentOffset: nextOffset,
        annotatedTaskIds: uniqueStrings([
          ...demoState.annotatedTaskIds,
          ...chunkTaskIds,
        ]),
        trainedChunkOffsets:
          next.trainNow === true
            ? uniqueNumbers([...demoState.trainedChunkOffsets, chunk.offset])
            : uniqueNumbers(demoState.trainedChunkOffsets),
        chunks: chunkEntries,
        lastSavedAt: committedAt,
        lastTraining:
          next.trainNow === true
            ? {
                at: committedAt,
                status: 'demo_trained',
                offset: chunk.offset,
                rowCount: chunkTaskIds.length,
              }
            : demoState.lastTraining,
      }
    )

    return {
      demo: true,
      sampleName: chunk.sample.sampleName,
      offset: chunk.offset,
      nextOffset,
      taskCount: chunkTaskIds.length,
      training:
        next.trainNow === true
          ? {
              ok: true,
              status: 'demo_simulated',
              simulated: true,
            }
          : null,
      state: summarizeDemoHumanTeacherState(persistedState.state),
    }
  }

  async function saveHumanTeacherDeveloperDraft(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return saveDeveloperHumanTeacherDraftToChunk({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      taskId: next.taskId,
      annotation: next.annotation,
    })
  }

  async function finalizeHumanTeacherDeveloperChunk(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'training commit'
    )
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {state: developerState} = await loadDeveloperHumanTeacherState(
      sample.sampleName,
      sample.totalFlips
    )
    const effectiveOffset = clampDeveloperHumanTeacherOffset(
      typeof next.offset === 'number'
        ? next.offset
        : developerState.currentOffset,
      sample.totalFlips
    )

    return commitDeveloperHumanTeacherChunk({
      sampleName: sample.sampleName,
      offset: effectiveOffset,
      trainNow: next.trainNow === true,
      advance: next.advance === true,
      allowSystemPressureOverride: next.allowSystemPressureOverride === true,
      trainingModelPath:
        String(next.trainingModelPath || next.modelPath || '').trim() || null,
      localTrainingProfile:
        String(next.localTrainingProfile || '')
          .trim()
          .toLowerCase() || null,
      localTrainingThermalMode:
        String(next.localTrainingThermalMode || '')
          .trim()
          .toLowerCase() || null,
      localBenchmarkThermalMode:
        String(next.localBenchmarkThermalMode || '')
          .trim()
          .toLowerCase() || null,
      localTrainingEpochs:
        typeof next.localTrainingEpochs === 'number'
          ? next.localTrainingEpochs
          : null,
      localTrainingBatchSize:
        typeof next.localTrainingBatchSize === 'number'
          ? next.localTrainingBatchSize
          : null,
      localTrainingLoraRank:
        typeof next.localTrainingLoraRank === 'number'
          ? next.localTrainingLoraRank
          : null,
      evaluationFlips:
        typeof next.evaluationFlips !== 'undefined'
          ? next.evaluationFlips
          : DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE,
    })
  }

  async function runHumanTeacherDeveloperComparison(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    assertDeveloperHumanTeacherSessionAllowed(
      next.currentPeriod,
      'comparison run'
    )
    const sampleName = normalizeDeveloperHumanTeacherSampleName(
      next.sampleName || DEVELOPER_HUMAN_TEACHER_DEFAULT_SAMPLE
    )
    const sample = await loadDeveloperHumanTeacherSample(sampleName)
    const {statePath, state: existingState} =
      await loadDeveloperHumanTeacherState(sample.sampleName, sample.totalFlips)
    const evaluationFlips = normalizeDeveloperLocalBenchmarkFlips(
      next.evaluationFlips
    )

    if (existingState.trainedTaskIds.length === 0) {
      if (existingState.pendingTrainingTaskIds.length > 0) {
        throw new Error(
          `Train the saved 5-flip chunk first before running the ${evaluationFlips}-flip comparison`
        )
      }

      throw new Error(
        `Train at least one 5-flip chunk before running the ${evaluationFlips}-flip comparison`
      )
    }

    const annotatedPath = developerHumanTeacherAnnotatedPath(
      localAiStorage,
      sample.sampleName
    )
    const pendingPath = developerHumanTeacherPendingPath(
      localAiStorage,
      sample.sampleName
    )
    const trainedPath = developerHumanTeacherTrainedPath(
      localAiStorage,
      sample.sampleName
    )
    const comparisonPath = developerHumanTeacherComparisonPath(
      localAiStorage,
      sample.sampleName,
      evaluationFlips
    )

    const runningState = await writeDeveloperHumanTeacherState(
      sample.sampleName,
      {
        ...existingState,
        totalAvailableTasks: sample.totalFlips,
        activeRun: {
          kind: 'comparison',
          status: 'running',
          stage: 'prepare_holdout',
          stageIndex: 1,
          stageCount: 3,
          progressPercent: 5,
          message: 'Preparing the unseen benchmark flips',
          sampleName: sample.sampleName,
          evaluationFlips,
          trainingThermalMode: DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE,
          benchmarkThermalMode: normalizeDeveloperTrainingThermalMode(
            next.localBenchmarkThermalMode ||
              DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE
          ),
          startedAt: new Date().toISOString(),
          stageStartedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        comparison100: normalizeDeveloperComparisonState({
          ...existingState.comparison100,
          status: 'running',
          benchmarkFlips: evaluationFlips,
          lastResultPath:
            existingState.comparison100?.lastResultPath || comparisonPath,
        }),
      }
    )

    const comparisonResult = await trainEpoch({
      input: {
        developerHumanTeacher: true,
        sampleName: sample.sampleName,
        comparisonOnly: true,
        compareOnly: true,
        evaluationFlips,
        localBenchmarkThermalMode: normalizeDeveloperTrainingThermalMode(
          next.localBenchmarkThermalMode ||
            DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE
        ),
        annotatedAnnotationsPath: annotatedPath,
        pendingAnnotationsPath: pendingPath,
        trainedAnnotationsPath: trainedPath,
        developerStatePath: statePath,
        comparisonPath,
      },
      onDeveloperHumanTeacherProgress: createDeveloperActiveRunProgressHandler({
        statePath,
        kind: 'comparison',
        sampleName: sample.sampleName,
        evaluationFlips,
      }),
    })
    await flushDeveloperStateMutations(statePath)

    const comparisonMissingMetricsMessage =
      'The local comparison finished without benchmark metrics.'
    let nextComparison = normalizeDeveloperComparisonState(
      runningState.state.comparison100
    )

    if (await localAiStorage.exists(comparisonPath)) {
      const persistedComparison = await localAiStorage.readJson(
        comparisonPath,
        null
      )
      nextComparison = mergeDeveloperComparisonSnapshot(
        nextComparison,
        extractDeveloperComparisonSnapshot(persistedComparison, {
          resultPath: comparisonPath,
          holdoutPath:
            nextComparison.holdoutPath ||
            persistedComparison?.holdoutPath ||
            null,
        }),
        comparisonResult && comparisonResult.ok
          ? 'evaluated'
          : 'result_available'
      )
    } else if (comparisonResult && comparisonResult.ok) {
      nextComparison = mergeDeveloperComparisonSnapshot(
        nextComparison,
        extractDeveloperComparisonSnapshot(comparisonResult, {
          resultPath: comparisonPath,
        }),
        'evaluated'
      )
    } else {
      nextComparison = normalizeDeveloperComparisonState({
        ...nextComparison,
        status: 'failed',
        benchmarkFlips: evaluationFlips,
        lastResultPath: nextComparison.lastResultPath || comparisonPath,
      })
    }

    const comparisonCompletedWithMetrics =
      comparisonResult?.ok === true &&
      hasDeveloperComparisonMetrics(nextComparison)
    const publicComparisonResult =
      comparisonResult?.ok === true && !comparisonCompletedWithMetrics
        ? {
            ...comparisonResult,
            ok: false,
            status: 'failed',
            failureReason: comparisonMissingMetricsMessage,
            lastError: comparisonMissingMetricsMessage,
            error: 'comparison_metrics_missing',
          }
        : comparisonResult

    if (!comparisonCompletedWithMetrics) {
      nextComparison = normalizeDeveloperComparisonState({
        ...nextComparison,
        status: 'failed',
        benchmarkFlips: evaluationFlips,
        lastResultPath: nextComparison.lastResultPath || comparisonPath,
      })
    }

    const persistedState = await writeDeveloperHumanTeacherState(
      sample.sampleName,
      {
        ...existingState,
        totalAvailableTasks: sample.totalFlips,
        activeTrainingModelPath: comparisonCompletedWithMetrics
          ? String(
              publicComparisonResult?.modelPath ||
                existingState.activeTrainingModelPath ||
                ''
            ).trim() || null
          : existingState.activeTrainingModelPath || null,
        activeTrainingBackend: comparisonCompletedWithMetrics
          ? String(
              publicComparisonResult?.trainingBackend ||
                existingState.activeTrainingBackend ||
                ''
            ).trim() || null
          : existingState.activeTrainingBackend || null,
        activeLocalTrainingProfile: comparisonCompletedWithMetrics
          ? String(
              publicComparisonResult?.localTrainingProfile ||
                existingState.activeLocalTrainingProfile ||
                ''
            ).trim() || null
          : existingState.activeLocalTrainingProfile || null,
        activeLocalTrainingThermalMode: comparisonCompletedWithMetrics
          ? String(
              publicComparisonResult?.localTrainingThermalMode ||
                existingState.activeLocalTrainingThermalMode ||
                ''
            ).trim() || null
          : existingState.activeLocalTrainingThermalMode || null,
        activeRun: null,
        comparison100: nextComparison,
      }
    )

    return {
      developer: true,
      sampleName: sample.sampleName,
      comparison100: sanitizePublicDeveloperComparisonState(
        persistedState.state.comparison100
      ),
      state: sanitizePublicDeveloperHumanTeacherState(persistedState.state),
      comparison: sanitizePublicDeveloperRunResult(publicComparisonResult),
    }
  }

  async function importHumanTeacherAnnotationsWorkspace(payload) {
    await hydrate()

    const next = normalizeRuntimePayload(payload)
    const epoch = normalizeEpoch(
      typeof next.epoch !== 'undefined' ? next.epoch : payload
    )
    const currentEpoch = normalizeOptionalEpoch(next.currentEpoch)

    if (epoch === null) {
      throw new Error('Epoch is required')
    }

    assertPastHumanTeacherEpoch(epoch, currentEpoch, 'annotation import')

    const nextPackagePath = humanTeacherPackagePath(localAiStorage, epoch)
    const taskPackage = await localAiStorage.readHumanTeacherPackage(
      nextPackagePath,
      null
    )

    if (!taskPackage) {
      throw new Error('Human teacher package is unavailable')
    }

    if (
      String(taskPackage.reviewStatus || '')
        .trim()
        .toLowerCase() !== 'approved'
    ) {
      throw new Error(
        'Human teacher package must be approved before annotations can be imported'
      )
    }

    const outputDir = humanTeacherExportDir(localAiStorage, epoch)
    const taskManifestPath = path.join(outputDir, 'tasks.jsonl')
    const defaultAnnotationsPath = path.join(
      outputDir,
      'annotations.filled.jsonl'
    )
    const defaultNormalizedPath = humanTeacherNormalizedAnnotationsPath(
      localAiStorage,
      epoch
    )
    const defaultSummaryPath = humanTeacherImportSummaryPath(
      localAiStorage,
      epoch
    )
    const annotationsPath = resolveOptionalConstrainedPath(
      outputDir,
      next.annotationsPath,
      defaultAnnotationsPath
    )
    const normalizedPath = resolveOptionalConstrainedPath(
      path.dirname(defaultNormalizedPath),
      next.outputJsonlPath,
      defaultNormalizedPath
    )
    const summaryPath = resolveOptionalConstrainedPath(
      path.dirname(defaultSummaryPath),
      next.summaryPath,
      defaultSummaryPath
    )

    if (!(await localAiStorage.exists(taskManifestPath))) {
      throw new Error(
        'Human teacher task manifest is unavailable; export annotation tasks first'
      )
    }

    await assertHumanTeacherWorkspaceIntegrity(localAiStorage, {
      outputDir,
      taskManifestPath,
      epoch,
      packagePath: nextPackagePath,
    })

    if (!(await localAiStorage.exists(annotationsPath))) {
      throw new Error(
        'Filled annotation file is unavailable; complete annotations.filled.jsonl first'
      )
    }

    const importSummary = await importHumanTeacherAnnotations({
      taskManifestPath,
      annotationsJsonlPath: annotationsPath,
      outputJsonlPath: normalizedPath,
      summaryPath,
    })
    const importedTaskIds = new Set(
      (importSummary.rows || []).map((row) => String(row.task_id || '').trim())
    )
    const nextTaskPackage = {
      ...taskPackage,
      importedAnnotations: {
        importedAt: new Date().toISOString(),
        normalizedPath,
        summaryPath,
        sourceAnnotationsPath: annotationsPath,
        taskManifestPath,
        normalizedRows: Number(importSummary.normalizedRows) || 0,
        missingAnnotations: Number(importSummary.missingAnnotations) || 0,
        unmatchedAnnotations: Number(importSummary.unmatchedAnnotations) || 0,
        invalidAnnotations: Number(importSummary.invalidAnnotations) || 0,
      },
      items: Array.isArray(taskPackage.items)
        ? taskPackage.items.map((item) => {
            const taskId = String(item && item.taskId ? item.taskId : '').trim()

            return importedTaskIds.has(taskId)
              ? {
                  ...item,
                  annotationStatus: 'annotated',
                }
              : item
          })
        : [],
    }

    await localAiStorage.writeJsonAtomic(nextPackagePath, nextTaskPackage)

    return {
      epoch,
      eligibleCount: Number(nextTaskPackage.eligibleCount) || 0,
      excludedCount: Number(nextTaskPackage.excludedCount) || 0,
      packagePath: nextPackagePath,
      package: nextTaskPackage,
      outputDir,
      import: {
        normalizedPath,
        summaryPath,
        annotationsPath,
        normalizedRows: Number(importSummary.normalizedRows) || 0,
        missingAnnotations: Number(importSummary.missingAnnotations) || 0,
        unmatchedAnnotations: Number(importSummary.unmatchedAnnotations) || 0,
        invalidAnnotations: Number(importSummary.invalidAnnotations) || 0,
        duplicateAnnotations: Number(importSummary.duplicateAnnotations) || 0,
      },
    }
  }

  return {
    status,
    start,
    stop,
    getDeveloperTelemetry,
    listModels,
    chat,
    checkFlipSequence,
    flipToText,
    captionFlip,
    ocrImage,
    trainEpoch,
    captureFlip,
    importAdapterArtifact,
    registerAdapterArtifact,
    loadAdapterArtifact,
    buildManifest,
    buildTrainingCandidatePackage,
    buildHumanTeacherPackage,
    loadTrainingCandidatePackage,
    loadHumanTeacherPackage,
    loadHumanTeacherAnnotationWorkspace,
    loadHumanTeacherAnnotationTask,
    loadHumanTeacherDemoWorkspace,
    loadHumanTeacherDemoTask,
    loadHumanTeacherDeveloperSession,
    loadHumanTeacherDeveloperSessionState,
    stopHumanTeacherDeveloperRun,
    updateHumanTeacherDeveloperRunControls,
    loadHumanTeacherDeveloperComparisonExamples,
    loadHumanTeacherDeveloperTask,
    exportHumanTeacherDeveloperBundle,
    updateTrainingCandidatePackageReview,
    updateHumanTeacherPackageReview,
    exportHumanTeacherTasks: exportHumanTeacherTasksWorkspace,
    saveHumanTeacherAnnotationDraft,
    saveHumanTeacherDemoDraft,
    saveHumanTeacherDeveloperDraft,
    finalizeHumanTeacherDemoChunk,
    finalizeHumanTeacherDeveloperChunk,
    runHumanTeacherDeveloperComparison,
    importHumanTeacherAnnotations: importHumanTeacherAnnotationsWorkspace,
  }
}

module.exports = {
  createLocalAiManager,
  defaultCaptureIndex,
  getTelemetryTrainingReadiness,
  parseIoregGpuOutput,
  parsePmsetBatteryOutput,
}
