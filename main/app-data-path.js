/* eslint-disable prefer-rest-params */
/* eslint-disable no-param-reassign */
// eslint-disable-next-line import/no-extraneous-dependencies
let electron = {}
try {
  electron = require('electron') || {}
} catch {
  electron = {}
}
const path = require('path')
const fs = require('fs')
const os = require('os')
const {APP_PATH_COMMAND} = require('./channels')

const app = electron.app || null
const ipcRenderer = electron.ipcRenderer || null

const homeDir = os.homedir ? os.homedir() : process.env.HOME

function getPathFromMainProcess(folder) {
  if (!ipcRenderer || typeof ipcRenderer.sendSync !== 'function') {
    throw new Error('Electron app path IPC is unavailable')
  }
  return ipcRenderer.sendSync(APP_PATH_COMMAND, folder)
}

function mkDir(dirPath, root) {
  const dirs = dirPath.split(path.sep)
  const dir = dirs.shift()
  root = (root || '') + dir + path.sep

  try {
    fs.mkdirSync(root)
  } catch (e) {
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(e)
    }
  }

  return !dirs.length || mkDir(dirs.join(path.sep), root)
}

function prepareDir(dirPath) {
  if (!this || this.or !== prepareDir || !this.result) {
    if (!dirPath) {
      return {or: prepareDir}
    }

    // eslint-disable-next-line prefer-spread
    dirPath = path.join.apply(path, arguments)
    mkDir(dirPath)

    try {
      fs.accessSync(dirPath, fs.W_OK)
    } catch (e) {
      return {or: prepareDir}
    }
  }

  return {
    or: prepareDir,
    result: (this ? this.result : false) || dirPath,
  }
}

function appDataPath(folder) {
  if (!app) {
    return getPathFromMainProcess(folder)
  }

  switch (process.platform) {
    case 'darwin':
    case 'win32':
      return app.getPath(folder)
    default:
      return prepareDir(app.getPath('userData'))
        .or(process.env.XDG_CONFIG_HOME)
        .or(homeDir, '.config')
        .or(process.env.XDG_DATA_HOME)
        .or(homeDir, '.local', 'share').result
  }
}

module.exports = appDataPath
