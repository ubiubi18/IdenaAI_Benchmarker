/* eslint-disable import/no-extraneous-dependencies */
const path = require('path')
const {app, remote} = require('electron')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const fs = require('fs')

function getElectronApp() {
  const whichApp = app || (remote && remote.app)
  if (!whichApp) {
    throw new Error('Electron app is unavailable')
  }
  return whichApp
}

function dbPath(fileDb) {
  const whichApp = getElectronApp()
  return path.join(whichApp.getPath('userData'), fileDb)
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
