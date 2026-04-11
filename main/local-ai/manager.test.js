const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createLocalAiStorage} = require('./storage')
const {createLocalAiManager} = require('./manager')

function mockLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn(),
  }
}

describe('local-ai manager', () => {
  let tempDir
  let storage

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-local-ai-'))
    storage = createLocalAiStorage({
      baseDir: path.join(tempDir, 'local-ai'),
    })
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('persists capture metadata and builds a conservative epoch manifest', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})

    await manager.captureFlip({
      flipHash: 'flip-a',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right'],
      consensus: {
        finalAnswer: 'left',
        reported: false,
      },
    })
    await manager.captureFlip({
      flipHash: 'flip-b',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right'],
    })
    await manager.captureFlip({
      flipHash: 'flip-c',
      epoch: 12,
      sessionType: 'long',
      images: ['left', 'right'],
      consensus: {
        finalAnswer: 'right',
        reported: true,
      },
    })
    await manager.captureFlip({
      flipHash: 'flip-d',
      epoch: 13,
      sessionType: 'short',
      images: ['left', 'right'],
      consensus: {
        finalAnswer: 'left',
        reported: false,
      },
    })

    const rehydrated = createLocalAiManager({logger: mockLogger(), storage})

    await expect(rehydrated.status()).resolves.toMatchObject({
      capturedCount: 4,
      running: false,
    })

    const summary = await rehydrated.buildManifest(12)
    const manifest = await storage.readJson(summary.manifestPath)
    const captureIndex = await storage.readJson(
      storage.resolveLocalAiPath('captures', 'index.json')
    )

    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 3,
    })
    expect(manifest).toMatchObject({
      epoch: 12,
      baseModelId: 'local-ai:sidecar:mvp-placeholder-v1',
      eligibleFlipHashes: ['flip-a'],
    })
    expect(manifest.excluded).toEqual(
      expect.arrayContaining([
        {flipHash: 'flip-b', reasons: ['missing_consensus']},
        {flipHash: 'flip-c', reasons: ['reported']},
        {flipHash: 'flip-d', reasons: ['epoch_mismatch']},
      ])
    )
    expect(captureIndex.capturedCount).toBe(4)
    expect(JSON.stringify(captureIndex)).not.toContain('"images"')
  })

  it('refreshes Local AI sidecar health and model status without requiring cloud providers', async () => {
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar: {
        getHealth: jest.fn(async () => ({
          ok: true,
          reachable: true,
          data: {service: 'local-ai-sidecar-stub'},
          lastError: null,
        })),
        listModels: jest.fn(async () => ({
          ok: true,
          reachable: true,
          models: ['local-stub-chat'],
          total: 1,
          lastError: null,
        })),
        chat: jest.fn(),
        captionFlip: jest.fn(),
        ocrImage: jest.fn(),
        trainEpoch: jest.fn(),
      },
    })

    await expect(
      manager.status({
        refresh: true,
        baseUrl: 'http://localhost:5050',
      })
    ).resolves.toMatchObject({
      baseUrl: 'http://localhost:5050',
      sidecarReachable: true,
      sidecarModelCount: 1,
      lastError: null,
    })
  })
})
