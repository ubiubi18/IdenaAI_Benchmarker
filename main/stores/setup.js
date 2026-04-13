/* eslint-disable import/no-extraneous-dependencies, global-require */
const path = require('path')

let electron = {}
try {
  electron = require('electron') || {}
} catch {
  electron = {}
}
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const fs = require('fs')
const {APP_PATH_COMMAND} = require('../channels')

const app = electron.app || null
const ipcRenderer = electron.ipcRenderer || null

function getUserDataPath() {
  if (app) {
    return app.getPath('userData')
  }
  if (!ipcRenderer || typeof ipcRenderer.sendSync !== 'function') {
    throw new Error('Electron app path IPC is unavailable')
  }
  return ipcRenderer.sendSync(APP_PATH_COMMAND, 'userData')
}

function dbPath(fileDb) {
  return path.join(getUserDataPath(), fileDb)
}

module.exports = {
  dbPath,
  prepareDb(name) {
    const adapter = new FileSync(dbPath(`${name}.json`))
    return low(adapter)
  },
  checkDbExists(name) {
    return fs.existsSync(dbPath(`${name}.json`))
  },
}
