#!/usr/bin/env node

// eslint-disable-next-line import/no-extraneous-dependencies
const http = require('http')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const {spawn} = require('child_process')

const ROOT = path.join(__dirname, '..')
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
// eslint-disable-next-line import/no-extraneous-dependencies
const ELECTRON_BIN = require('electron')

const DEV_PORT = Number.parseInt(
  process.env.IDENA_DESKTOP_RENDERER_PORT || '8000',
  10
)
const DEV_HOST = process.env.IDENA_DESKTOP_RENDERER_HOST || '127.0.0.1'
const DEV_SERVER_URL = `http://${DEV_HOST}:${DEV_PORT}`
const STARTUP_TIMEOUT_MS = 120000
const POLL_INTERVAL_MS = 1000

let rendererProcess = null
let electronProcess = null
let shuttingDown = false
let electronLogFd = null

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, {recursive: true})
  return dirPath
}

function cleanRendererDevOutput() {
  ;['renderer/.next', 'renderer/out'].forEach((relativePath) => {
    fs.rmSync(path.join(ROOT, relativePath), {
      recursive: true,
      force: true,
    })
  })
}

function resolveDevUserDataDir(env) {
  if (env.IDENA_DESKTOP_USER_DATA_DIR) {
    return env.IDENA_DESKTOP_USER_DATA_DIR
  }

  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    `IdenaAI-dev-${path.basename(ROOT)}`
  )
}

function assertRendererPortFree() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', (error) => {
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Renderer dev port ${DEV_PORT} is already in use. Stop the old IdenaAI/Benchmarker dev runtime before starting this one.`
            : `Unable to check renderer dev port ${DEV_PORT}: ${error.message}`
        )
      )
    })

    server.once('listening', () => {
      server.close(resolve)
    })

    server.listen(DEV_PORT, DEV_HOST)
  })
}

function resolveUserDataDir() {
  if (process.env.IDENA_DESKTOP_USER_DATA_DIR) {
    return process.env.IDENA_DESKTOP_USER_DATA_DIR
  }

  const homeDir = os.homedir()

  switch (process.platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'IdenaAI')
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
        'IdenaAI'
      )
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'),
        'IdenaAI'
      )
  }
}

function openElectronDevLogFd() {
  const fallbackLogsDir = ensureDir(path.join(ROOT, '.tmp', 'logs'))

  try {
    const logsDir = ensureDir(path.join(resolveUserDataDir(), 'logs'))
    const logPath = path.join(logsDir, 'electron-dev.log')
    fs.appendFileSync(
      logPath,
      `\n[${new Date().toISOString()}] starting Electron dev runtime\n`
    )
    return {
      fd: fs.openSync(logPath, 'a'),
      path: logPath,
    }
  } catch {
    const logPath = path.join(fallbackLogsDir, 'electron-dev.log')
    fs.appendFileSync(
      logPath,
      `\n[${new Date().toISOString()}] starting Electron dev runtime\n`
    )
    return {
      fd: fs.openSync(logPath, 'a'),
      path: logPath,
    }
  }
}

function resolveRendererNodeLaunch(env) {
  const baseNodeOptions = env.NODE_OPTIONS || ''
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
  const needsLegacyProvider =
    nodeMajor >= 17 && !baseNodeOptions.includes('--openssl-legacy-provider')
  const requestedHeapMb = Number.parseInt(
    env.IDENA_DESKTOP_DEV_HEAP_MB || '8192',
    10
  )
  const needsHeapIncrease =
    Number.isFinite(requestedHeapMb) &&
    requestedHeapMb > 0 &&
    !/--max-old-space-size=\d+/.test(baseNodeOptions)

  const nodeOptions = [baseNodeOptions]

  if (needsLegacyProvider) {
    nodeOptions.push('--openssl-legacy-provider')
  }

  if (needsHeapIncrease) {
    nodeOptions.push(`--max-old-space-size=${requestedHeapMb}`)
  }

  return {
    env: {
      ...env,
      NODE_OPTIONS: nodeOptions.join(' ').trim(),
    },
    nodeArgs: [
      ...(needsLegacyProvider ? ['--openssl-legacy-provider'] : []),
      ...(needsHeapIncrease ? [`--max-old-space-size=${requestedHeapMb}`] : []),
    ],
    heapMb:
      Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
        ? requestedHeapMb
        : null,
  }
}

function resolveElectronLaunch(env) {
  const requestedHeapMb = Number.parseInt(
    env.IDENA_DESKTOP_ELECTRON_HEAP_MB ||
      env.IDENA_DESKTOP_DEV_HEAP_MB ||
      '8192',
    10
  )

  return {
    env: {
      ...env,
      ...(Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
        ? {
            IDENA_DESKTOP_ELECTRON_HEAP_MB: String(requestedHeapMb),
          }
        : {}),
    },
    heapMb:
      Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
        ? requestedHeapMb
        : null,
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRendererReady() {
  return new Promise((resolve) => {
    const request = http.get(
      `${DEV_SERVER_URL}/home`,
      {
        headers: {
          Connection: 'close',
        },
      },
      (response) => {
        response.resume()
        resolve(response.statusCode >= 200 && response.statusCode < 500)
      }
    )

    request.on('error', () => {
      resolve(false)
    })
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(false)
    })
  })
}

async function waitForRenderer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (rendererProcess && rendererProcess.exitCode !== null) {
      throw new Error(
        `Renderer dev server exited early with code ${rendererProcess.exitCode}`
      )
    }

    if (await isRendererReady()) {
      return
    }

    await wait(POLL_INTERVAL_MS)
  }

  throw new Error(
    `Renderer dev server did not become ready within ${
      STARTUP_TIMEOUT_MS / 1000
    }s at ${DEV_SERVER_URL}`
  )
}

function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.killed || child.exitCode !== null) {
    return
  }

  try {
    child.kill(signal)
  } catch (error) {
    // Ignore shutdown races when the child has already exited.
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  terminateChild(electronProcess)
  terminateChild(rendererProcess)
  if (Number.isInteger(electronLogFd)) {
    try {
      fs.closeSync(electronLogFd)
    } catch {
      // Ignore log-fd shutdown races.
    }
    electronLogFd = null
  }
  process.exit(code)
}

async function main() {
  const baseEnv = {
    ...process.env,
    IDENA_DESKTOP_USER_DATA_DIR: resolveDevUserDataDir(process.env),
  }
  process.env.IDENA_DESKTOP_USER_DATA_DIR = baseEnv.IDENA_DESKTOP_USER_DATA_DIR

  await assertRendererPortFree()
  cleanRendererDevOutput()

  const rendererNodeLaunch = resolveRendererNodeLaunch(baseEnv)
  const electronLaunch = resolveElectronLaunch(baseEnv)

  if (rendererNodeLaunch.heapMb) {
    console.log(
      `[IdenaAI] Starting renderer dev server with Node heap ${rendererNodeLaunch.heapMb} MB`
    )
  }

  if (electronLaunch.heapMb) {
    console.log(
      `[IdenaAI] Starting Electron with V8 heap ${electronLaunch.heapMb} MB`
    )
  }

  rendererProcess = spawn(
    process.execPath,
    [
      ...rendererNodeLaunch.nodeArgs,
      NEXT_BIN,
      'dev',
      'renderer',
      '-p',
      String(DEV_PORT),
      '-H',
      DEV_HOST,
    ],
    {
      cwd: ROOT,
      env: {
        ...rendererNodeLaunch.env,
        BROWSERSLIST_IGNORE_OLD_DATA: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: 'inherit',
    }
  )

  rendererProcess.on('exit', (code) => {
    if (!shuttingDown && !electronProcess) {
      process.exit(code || 1)
    }

    if (!shuttingDown && electronProcess && electronProcess.exitCode === null) {
      shutdown(code || 1)
    }
  })

  await waitForRenderer()

  const electronLog = openElectronDevLogFd()
  electronLogFd = electronLog.fd
  console.log(`[IdenaAI] Electron main-process log: ${electronLog.path}`)

  electronProcess = spawn(ELECTRON_BIN, ['.'], {
    cwd: ROOT,
    env: {
      ...electronLaunch.env,
      IDENA_DESKTOP_RENDERER_DEV_SERVER_URL: DEV_SERVER_URL,
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    stdio: ['ignore', electronLog.fd, electronLog.fd],
  })

  electronProcess.on('exit', (code) => {
    shutdown(code || 0)
  })
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))
process.on('exit', () => {
  terminateChild(electronProcess, 'SIGKILL')
  terminateChild(rendererProcess, 'SIGKILL')
})

main().catch((error) => {
  console.error(
    `Unable to start the desktop development runtime: ${error.message}`
  )
  shutdown(1)
})
