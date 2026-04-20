#!/usr/bin/env node

// eslint-disable-next-line import/no-extraneous-dependencies
const http = require('http')
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

function withLegacyOpenSsl(env) {
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
    ...env,
    NODE_OPTIONS: nodeOptions.join(' ').trim(),
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
  process.exit(code)
}

async function main() {
  rendererProcess = spawn(
    process.execPath,
    [NEXT_BIN, 'dev', 'renderer', '-p', String(DEV_PORT), '-H', DEV_HOST],
    {
      cwd: ROOT,
      env: {
        ...withLegacyOpenSsl(process.env),
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

  electronProcess = spawn(ELECTRON_BIN, ['.'], {
    cwd: ROOT,
    env: {
      ...process.env,
      IDENA_DESKTOP_RENDERER_DEV_SERVER_URL: DEV_SERVER_URL,
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    stdio: 'inherit',
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
