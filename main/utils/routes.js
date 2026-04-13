/* eslint-disable import/no-extraneous-dependencies */
const {app} = require('electron')

const DEV_SERVER_URL =
  process.env.IDENA_DESKTOP_RENDERER_DEV_SERVER_URL || 'http://127.0.0.1:8010'
const isDev = !app.isPackaged

const loadRoute = (win, routeName) => {
  if (isDev) {
    win.loadURL(`${DEV_SERVER_URL}/${routeName}`)
  } else {
    win.loadFile(`${app.getAppPath()}/renderer/out/${routeName}.html`)
  }
}

module.exports = loadRoute
