const crypto = require('crypto')
const path = require('path')
const fs = require('fs-extra')

let appDataPath = null

try {
  // eslint-disable-next-line global-require
  appDataPath = require('../app-data-path')
} catch (error) {
  appDataPath = null
}

function resolveUserDataPath() {
  if (!appDataPath) {
    throw new Error('app-data-path is unavailable in this environment')
  }

  return appDataPath('userData')
}

function createLocalAiStorage({
  baseDir,
  getUserDataPath = resolveUserDataPath,
} = {}) {
  function resolveBaseDir() {
    return baseDir || path.join(getUserDataPath(), 'local-ai')
  }

  function resolveLocalAiPath() {
    return path.join(resolveBaseDir(), ...arguments)
  }

  async function ensureDir(dirPath) {
    await fs.ensureDir(dirPath)
    return dirPath
  }

  async function exists(filePath) {
    return fs.pathExists(filePath)
  }

  async function writeJsonAtomic(filePath, obj) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    const dirPath = path.dirname(targetPath)
    const tempPath = path.join(
      dirPath,
      `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
    )

    await fs.ensureDir(dirPath)
    await fs.writeFile(tempPath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')

    try {
      await fs.move(tempPath, targetPath, {overwrite: true})
    } catch (error) {
      await fs.remove(tempPath).catch(() => {})
      throw error
    }

    return targetPath
  }

  async function readJson(filePath, fallbackValue) {
    try {
      return await fs.readJson(filePath)
    } catch (error) {
      if (error && error.code === 'ENOENT' && arguments.length > 1) {
        return fallbackValue
      }

      throw error
    }
  }

  async function writeBuffer(filePath, buffer) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    const nextBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)

    await fs.ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, nextBuffer)
    return targetPath
  }

  function sha256(bufferOrString) {
    if (!Buffer.isBuffer(bufferOrString) && typeof bufferOrString !== 'string') {
      throw new TypeError('sha256 expects a Buffer or string input')
    }

    return crypto.createHash('sha256').update(bufferOrString).digest('hex')
  }

  return {
    ensureDir,
    exists,
    readJson,
    resolveLocalAiPath,
    sha256,
    writeBuffer,
    writeJsonAtomic,
  }
}

module.exports = {
  createLocalAiStorage,
}
