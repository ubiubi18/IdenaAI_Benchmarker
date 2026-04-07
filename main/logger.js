const os = require('os')
const fs = require('fs')
const {platform} = require('process')
const path = require('path')
const pino = require('pino')

const appDataPath = require('./app-data-path')

function getRuntimeSystemVersion() {
  if (typeof process.getSystemVersion === 'function') {
    return process.getSystemVersion()
  }
  return os.release()
}

function getLogFilePath() {
  try {
    return path.join(appDataPath('logs'), 'idena.log')
  } catch (error) {
    const fallbackDir = path.join(process.cwd(), '.tmp', 'logs')
    fs.mkdirSync(fallbackDir, {recursive: true})
    return path.join(fallbackDir, 'idena.log')
  }
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'debug',
    base: {pid: process.pid, os: `${platform} ${getRuntimeSystemVersion()}`},
    redact: [
      'hex',
      'data[*].hex',
      'flips[*].hex',
      'flips[*].publicHex',
      'flips[*].privateHex',
      'flips[*].pics',
      'flips[*].urls',
      'context.shortFlips[*].hex',
      'context.longFlips[*].hex',
      'context.shortFlips[*].publicHex',
      'context.longFlips[*].publicHex',
      'context.shortFlips[*].privateHex',
      'context.longFlips[*].privateHex',
      'context.shortFlips[*].images',
      'context.longFlips[*].images',
      'context.longFlips[*].images',
      'internalApiKey',
      'externalApiKey',
      'apiKey',
      '*.apiKey',
      'api_key',
      '*.api_key',
      'key',
      'query.key',
      '*.query.key',
      'accessToken',
      '*.accessToken',
      'access_token',
      '*.access_token',
      'providerConfig.apiKey',
      'payload.providerConfig.apiKey',
      '*.authorization',
      '*.Authorization',
      'authorization',
      'Authorization',
      '*.leftImage',
      '*.rightImage',
      'headers.Authorization',
      'headers.authorization',
      'headers["x-api-key"]',
      'headers["X-Api-Key"]',
      'headers["x-goog-api-key"]',
      'config.headers.Authorization',
      'config.headers.authorization',
      'config.headers["x-api-key"]',
      'config.headers["X-Api-Key"]',
      'config.headers["x-goog-api-key"]',
      'config.url',
      'request.url',
      'response.config.url',
      '*.url',
      'payload.apiKey',
      'payload.api_key',
      'payload.flips[*].leftImage',
      'payload.flips[*].rightImage',
      'flips[*].leftImage',
      'flips[*].rightImage',
    ],
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  },
  getLogFilePath()
)

module.exports = logger
