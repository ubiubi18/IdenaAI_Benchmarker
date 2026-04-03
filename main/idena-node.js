/* eslint-disable no-console */
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const {spawn} = require('child_process')
const axios = require('axios')
const progress = require('progress-stream')
const semver = require('semver')
const kill = require('tree-kill')
const lineReader = require('reverse-line-reader')
// eslint-disable-next-line import/no-extraneous-dependencies
const appDataPath = require('./app-data-path')
const logger = require('./logger')

const idenaBin = 'idena-go'
const pinnedNodeVersion = '1.1.2'
const pinnedNodeTag = `v${pinnedNodeVersion}`
const idenaNodePinnedReleaseUrl = `https://api.github.com/repos/idena-network/idena-go/releases/tags/${pinnedNodeTag}`
const idenaChainDbFolder = 'idenachain.db'
const minNodeBinarySize = 1024 * 1024
const localNodeBuildToolchain = 'go1.19.13'
const legacyDesktopDataDirName = 'Idena'

const getBinarySuffix = () => (process.platform === 'win32' ? '.exe' : '')

function getCurrentUserDataDir() {
  return appDataPath('userData')
}

function getLegacyUserDataDir() {
  const currentUserDataDir = getCurrentUserDataDir()
  const legacyUserDataDir = path.join(
    path.dirname(currentUserDataDir),
    legacyDesktopDataDirName
  )

  if (legacyUserDataDir === currentUserDataDir) return null
  return legacyUserDataDir
}

function resolveNodeStorageBaseDir() {
  const currentUserDataDir = getCurrentUserDataDir()
  const currentNodeDir = path.join(currentUserDataDir, 'node')
  if (fs.existsSync(currentNodeDir)) {
    return currentUserDataDir
  }

  const legacyUserDataDir = getLegacyUserDataDir()
  if (!legacyUserDataDir) {
    return currentUserDataDir
  }

  const legacyNodeDir = path.join(legacyUserDataDir, 'node')
  if (fs.existsSync(legacyNodeDir)) {
    logger.info(
      `using legacy node storage directory for compatibility: ${legacyNodeDir}`
    )
    return legacyUserDataDir
  }

  return currentUserDataDir
}

const getNodeDir = () => path.join(resolveNodeStorageBaseDir(), 'node')

const getNodeDataDir = () => path.join(getNodeDir(), 'datadir')

const getNodeFile = () => path.join(getNodeDir(), idenaBin + getBinarySuffix())

const getNodeConfigFile = () => path.join(getNodeDir(), 'config.json')

const getTempNodeFile = () =>
  path.join(getNodeDir(), `new-${idenaBin}${getBinarySuffix()}`)

const getNodeChainDbFolder = () =>
  path.join(getNodeDataDir(), idenaChainDbFolder)

const getNodeIpfsDir = () => path.join(getNodeDataDir(), 'ipfs')

const getNodeLogsFile = () => path.join(getNodeDataDir(), 'logs', 'output.log')

const getNodeErrorFile = () => path.join(getNodeDataDir(), 'logs', 'error.log')

function isCompatibleAssetName(assetName) {
  if (!assetName) return false
  if (process.platform === 'win32') {
    return assetName.startsWith('idena-node-win')
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      return (
        assetName.startsWith('idena-node-mac-arm64') ||
        assetName.startsWith('idena-node-mac-aarch64')
      )
    }
    return assetName.startsWith('idena-node-mac')
  }
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      return assetName.startsWith('idena-node-linux-aarch64')
    }
    return (
      assetName.startsWith('idena-node-linux') && !assetName.includes('aarch64')
    )
  }
  return false
}

async function getPinnedRelease() {
  const {data: release} = await axios.get(idenaNodePinnedReleaseUrl, {
    timeout: 15000,
  })
  return release
}

function getLocalNodeRepoCandidates() {
  return [
    path.resolve(__dirname, '..', '..', 'idena-go'),
    path.resolve(process.cwd(), '..', 'idena-go'),
    process.env.IDENA_BENCHMARK_NODE_SOURCE_DIR,
  ].filter(Boolean)
}

function findLocalNodeRepo() {
  const candidates = getLocalNodeRepoCandidates()
  for (const repoDir of candidates) {
    const goMod = path.join(repoDir, 'go.mod')
    if (fs.existsSync(goMod)) {
      return repoDir
    }
  }
  return null
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({stdout, stderr})
        return
      }
      reject(
        new Error(
          `command failed (${command} ${args.join(' ')}): ${stderr || stdout}`
        )
      )
    })
  })
}

async function buildLocalArm64PinnedNode(tempNodeFile, onProgress) {
  const repoDir = findLocalNodeRepo()
  if (!repoDir) {
    throw new Error(
      'cannot find local idena-go repo for darwin/arm64 pinned build'
    )
  }

  const cargoBinDir = path.join(os.homedir(), '.cargo', 'bin')
  const env = {
    ...process.env,
    GOTOOLCHAIN: localNodeBuildToolchain,
    PATH: [process.env.PATH || '', cargoBinDir].join(path.delimiter),
  }
  const buildScript = path.join(repoDir, 'scripts', 'build-node-macos-arm64.sh')

  if (onProgress) {
    onProgress({
      version: pinnedNodeVersion,
      percentage: 5,
      transferred: 0,
      length: 1,
      eta: 0,
      runtime: 0,
      speed: 0,
      stage: 'build-start',
    })
  }

  if (fs.existsSync(buildScript)) {
    await runCommand(buildScript, [tempNodeFile], {
      cwd: repoDir,
      env,
    })
  } else {
    const wasmBindingDir = path.resolve(repoDir, '..', 'idena-wasm-binding')
    const wasmBindingGoMod = path.join(wasmBindingDir, 'go.mod')
    const wasmBindingArm64Lib = path.join(
      wasmBindingDir,
      'lib',
      'libidena_wasm_darwin_arm64.a'
    )
    if (
      !fs.existsSync(wasmBindingGoMod) ||
      !fs.existsSync(wasmBindingArm64Lib)
    ) {
      throw new Error(
        'missing local idena-wasm-binding arm64 artifacts. Expected ../idena-wasm-binding with lib/libidena_wasm_darwin_arm64.a'
      )
    }

    await runCommand(
      'go',
      [
        'build',
        '-ldflags',
        `-X main.version=${pinnedNodeVersion}`,
        '-o',
        tempNodeFile,
        '.',
      ],
      {
        cwd: repoDir,
        env,
      }
    )
  }

  const stats = await fs.stat(tempNodeFile)
  if (!stats || stats.size < minNodeBinarySize) {
    throw new Error(
      `locally built node binary is too small (${stats ? stats.size : 0} bytes)`
    )
  }

  if (process.platform !== 'win32') {
    await fs.chmod(tempNodeFile, '755')
  }

  if (onProgress) {
    onProgress({
      version: pinnedNodeVersion,
      percentage: 100,
      transferred: stats.size,
      length: stats.size,
      eta: 0,
      runtime: 0,
      speed: 0,
      stage: 'build-complete',
    })
  }
}

async function getCompatibleReleaseInfo() {
  const release = await getPinnedRelease()
  if (release && !release.draft) {
    const assets = Array.isArray(release.assets) ? release.assets : []
    const asset = assets.find(({name}) => isCompatibleAssetName(name))
    const version = semver.clean(release.tag_name)

    if (asset && asset.browser_download_url && version) {
      return {
        version,
        url: asset.browser_download_url,
        assetName: asset.name,
        assetSize: Number(asset.size) || 0,
        tag: release.tag_name,
      }
    }
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return {
      version: pinnedNodeVersion,
      url: '',
      assetName: '',
      assetSize: 0,
      tag: pinnedNodeTag,
      localBuild: true,
    }
  }

  throw new Error(
    `cannot find ${pinnedNodeTag} compatible idena-node release for ${process.platform}/${process.arch}`
  )
}

const getRemoteVersion = async () => pinnedNodeVersion

async function downloadNode(onProgress) {
  const tempNodeFile = getTempNodeFile()

  try {
    const release = await getCompatibleReleaseInfo()
    const {url, version, localBuild} = release

    await fs.ensureDir(getNodeDir())
    await fs.remove(tempNodeFile)

    if (localBuild) {
      await buildLocalArm64PinnedNode(tempNodeFile, onProgress)
    } else {
      if (!url) {
        throw new Error(
          `cannot resolve node download URL for release ${
            release.tag || version
          }`
        )
      }

      const response = await axios.request({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 30000,
        validateStatus: (status) => status >= 200 && status < 300,
      })

      const headerLength = Number.parseInt(
        response.headers['content-length'],
        10
      )
      const expectedLength =
        Number.isFinite(headerLength) && headerLength > 0
          ? headerLength
          : release.assetSize
      const streamLength = expectedLength > 0 ? expectedLength : 1

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tempNodeFile)
        const str = progress({
          time: 1000,
          length: streamLength,
        })

        str.on('progress', (p) => {
          if (onProgress) {
            onProgress({...p, version})
          }
        })

        writer.on('error', reject)
        response.data.on('error', reject)
        writer.on('finish', () => writer.close(resolve))
        response.data.pipe(str).pipe(writer)
      })
    }

    const stats = await fs.stat(tempNodeFile)
    if (!stats || stats.size < minNodeBinarySize) {
      throw new Error(
        `downloaded node binary is too small (${stats ? stats.size : 0} bytes)`
      )
    }

    return version
  } catch (error) {
    await fs.remove(tempNodeFile).catch(() => {})
    throw error
  }
}

function writeError(err) {
  try {
    fs.appendFileSync(
      getNodeErrorFile(),
      `-- node error, time: ${new Date().toUTCString()} --\n${err}\n -- end of error -- \n`
    )
  } catch (e) {
    console.log(`cannot write error to file: ${e.toString()}`)
  }
}

async function startNode(
  port,
  tcpPort,
  ipfsPort,
  apiKey,
  autoActivateMining,
  // eslint-disable-next-line default-param-last
  useLogging = true,
  onLog,
  onExit
) {
  const parameters = [
    '--datadir',
    getNodeDataDir(),
    '--rpcport',
    port,
    '--port',
    tcpPort,
    '--ipfsport',
    ipfsPort,
    '--apikey',
    apiKey,
  ]

  const version = await getCurrentVersion(false)

  if (autoActivateMining && semver.gt(version, '0.28.3')) {
    parameters.push('--autoonline')
  }

  const configFile = getNodeConfigFile()
  if (fs.existsSync(configFile)) {
    parameters.push('--config')
    parameters.push(configFile)
  }

  const idenaNode = spawn(getNodeFile(), parameters)

  idenaNode.stdout.on('data', (data) => {
    const str = data.toString()
    if (onLog) onLog(str.split('\n').filter((x) => x))
    if (useLogging) {
      console.log(str)
    }
  })

  idenaNode.stderr.on('data', (err) => {
    const str = err.toString()
    writeError(str)
    if (onLog) onLog(str.split('\n').filter((x) => x))
    if (useLogging) {
      console.error(str)
    }
  })

  idenaNode.on('exit', (code) => {
    if (useLogging) {
      console.info(`child process exited with code ${code}`)
    }
    if (onExit) {
      onExit(`node stopped with code ${code}`, code)
    }
  })

  return idenaNode
}

async function stopNode(node) {
  return new Promise((resolve, reject) => {
    try {
      if (!node) {
        resolve('node process not found')
      }
      if (node.exitCode != null) {
        resolve(`node already exited with code ${node.exitCode}`)
      }
      if (process.platform !== 'win32') {
        kill(node.pid, 'SIGINT', (err) => {
          if (err) {
            return reject(err)
          }
          return resolve(`node ${node.pid} stopped successfully`)
        })
      } else {
        node.on('exit', () => resolve(`node ${node.pid} stopped successfully`))
        node.on('error', reject)
        node.kill()
      }
    } catch (e) {
      reject(e)
    }
  })
}

function getCurrentVersion(tempNode) {
  const node = tempNode ? getTempNodeFile() : getNodeFile()
  return getBinaryVersion(node)
}

function getBinaryVersion(nodePath) {
  return new Promise((resolve, reject) => {
    try {
      const nodeVersion = spawn(nodePath, ['--version'])
      nodeVersion.stdout.on('data', (data) => {
        const output = data.toString()
        const coerced = semver.coerce(output)
        const parsed = coerced && semver.valid(coerced.version)
        return parsed
          ? resolve(parsed)
          : reject(new Error(`cannot resolve node version, stdout: ${output}`))
      })

      nodeVersion.stderr.on('data', (data) =>
        reject(
          new Error(`cannot resolve node version, stderr: ${data.toString()}`)
        )
      )

      nodeVersion.on('exit', (code) => {
        if (code) {
          return reject(
            new Error(`cannot resolve node version, exit code ${code}`)
          )
        }
      })

      nodeVersion.on('error', (err) => reject(err))
    } catch (e) {
      reject(e)
    }
  })
}

function updateNode() {
  return new Promise((resolve, reject) => {
    try {
      const currentNode = getNodeFile()
      const tempNode = getTempNodeFile()

      if (!fs.existsSync(tempNode)) {
        reject(new Error('cannot update idena-go: temp binary does not exist'))
        return
      }

      const tempStats = fs.statSync(tempNode)
      if (!tempStats || tempStats.size < minNodeBinarySize) {
        fs.removeSync(tempNode)
        reject(
          new Error(
            `cannot update idena-go: downloaded binary too small (${
              tempStats ? tempStats.size : 0
            } bytes)`
          )
        )
        return
      }

      fs.moveSync(tempNode, currentNode, {overwrite: true})
      if (process.platform !== 'win32') {
        fs.chmodSync(currentNode, '755')
      }
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

function nodeExists() {
  return fs.existsSync(getNodeFile())
}

function cleanNodeState() {
  const chainDbDirectory = getNodeChainDbFolder()
  if (fs.existsSync(chainDbDirectory)) {
    fs.removeSync(chainDbDirectory)
  }
}

function getLastLogs() {
  const number = 100
  return new Promise((resolve, reject) => {
    try {
      const logs = []
      lineReader.eachLine(getNodeLogsFile(), (line, last) => {
        logs.push(line)
        if (logs.length === number || last) {
          resolve(logs.reverse())
          return false
        }
        return true
      })
    } catch (e) {
      reject(e)
    }
  })
}

async function tryStopNode(node, {onSuccess, onFail}) {
  try {
    if (node) {
      const log = await stopNode(node)
      logger.info(log)
      if (onSuccess) {
        onSuccess()
      }
    }
  } catch (e) {
    logger.error('error while stopping node', e.toString())
    if (onFail) {
      onFail()
    }
  }
}

module.exports = {
  downloadNode,
  getCurrentVersion,
  getRemoteVersion,
  startNode,
  stopNode,
  updateNode,
  nodeExists,
  cleanNodeState,
  getLastLogs,
  getNodeFile,
  getNodeChainDbFolder,
  getNodeIpfsDir,
  tryStopNode,
}
