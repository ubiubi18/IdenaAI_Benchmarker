const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {
  DEV_LOCAL_AI_BRIDGE_HEADER,
  DEV_LOCAL_AI_BRIDGE_HEADER_VALUE,
  assertDevBridgeMethodAllowed,
  isTrustedDevBridgeRequest,
  sanitizeBridgeValue,
} = require('./local-ai-dev-bridge')

describe('local-ai dev bridge', () => {
  let tempDir

  function writeSettings(localAi = {}) {
    fs.writeJsonSync(path.join(tempDir, 'settings.json'), {localAi})
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-local-ai-dev-'))
    process.env.IDENA_DESKTOP_LOCAL_AI_DEV_BASE_DIR = tempDir
  })

  afterEach(() => {
    delete process.env.IDENA_DESKTOP_LOCAL_AI_DEV_BASE_DIR
    fs.removeSync(tempDir)
  })

  it('trusts only signed same-origin localhost requests', () => {
    expect(
      isTrustedDevBridgeRequest({
        headers: {
          host: '127.0.0.1:8011',
          origin: 'http://127.0.0.1:8011',
          [DEV_LOCAL_AI_BRIDGE_HEADER]: DEV_LOCAL_AI_BRIDGE_HEADER_VALUE,
        },
      })
    ).toBe(true)

    expect(
      isTrustedDevBridgeRequest({
        headers: {
          host: '127.0.0.1:8011',
          origin: 'http://127.0.0.1:8011',
        },
      })
    ).toBe(false)

    expect(
      isTrustedDevBridgeRequest({
        headers: {
          host: '127.0.0.1:8011',
          origin: 'http://evil.example',
          [DEV_LOCAL_AI_BRIDGE_HEADER]: DEV_LOCAL_AI_BRIDGE_HEADER_VALUE,
        },
      })
    ).toBe(false)
  })

  it('applies the same feature gates as the desktop bridge', () => {
    writeSettings({enabled: false})
    expect(() => assertDevBridgeMethodAllowed('chat')).toThrow(
      'Local AI is disabled'
    )

    writeSettings({enabled: true, captureEnabled: false})
    expect(() => assertDevBridgeMethodAllowed('trainEpoch')).not.toThrow()
    expect(() => assertDevBridgeMethodAllowed('captureFlip')).toThrow(
      'Local AI capture is disabled'
    )
  })

  it('scrubs dangerous keys and path-like values in dev bridge results', () => {
    const value = Object.create(null)
    Object.defineProperty(value, '__proto__', {
      value: {polluted: true},
      enumerable: true,
      configurable: true,
      writable: true,
    })
    value.adapterManifestPath = '/tmp/secret/adapter-manifest.json'
    value.nested = {outputDir: '/tmp/secret/workspace'}

    const sanitized = sanitizeBridgeValue(value)

    expect(sanitized.safe___proto__.polluted).toBe(true)
    expect(sanitized.polluted).toBeUndefined()
    expect(sanitized.adapterManifestPath).toBe('adapter-manifest.json')
    expect(sanitized.nested.outputDir).toBe('workspace')
  })
})
