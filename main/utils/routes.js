/* eslint-disable import/no-extraneous-dependencies */
const {app} = require('electron')

function resolveDevServerUrl() {
  const rawUrl =
    process.env.IDENA_DESKTOP_RENDERER_DEV_SERVER_URL || 'http://127.0.0.1:8000'
  const nextUrl = new URL(rawUrl)

  if (!['127.0.0.1', 'localhost'].includes(nextUrl.hostname)) {
    throw new Error('IDENA_DESKTOP_RENDERER_DEV_SERVER_URL must use loopback')
  }

  return nextUrl
}

const DEV_SERVER = resolveDevServerUrl()
const DEV_SERVER_URL = DEV_SERVER.toString().replace(/\/$/, '')
const DEV_SERVER_ORIGIN = DEV_SERVER.origin
const isDev = !app.isPackaged

const loadRoute = (win, routeName) => {
  if (isDev) {
    win.loadURL(`${DEV_SERVER_URL}/${routeName}`)
  } else {
    win.loadFile(`${app.getAppPath()}/renderer/out/${routeName}.html`)
  }
}

loadRoute.DEV_SERVER_URL = DEV_SERVER_URL
loadRoute.DEV_SERVER_ORIGIN = DEV_SERVER_ORIGIN

module.exports = loadRoute
